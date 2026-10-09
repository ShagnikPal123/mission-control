import type { On, TurnStepInput } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fakeEngine } from './kit'

const START = { cwd: 'C:/p', surface: 'terminal', isInteractive: true } as const
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ROUTE = '{"size":"large","kind":"feature","model":"opus","effort":"high","plan":true,"agents":[]}'

/** Haiku beneath: answers `reply` (or fails) and counts the calls. */
function haiku(on: On, reply: string | null) {
  const calls: string[] = []
  on('model.complete', (_, e) => {
    calls.push(e.model)
    return reply === null
      ? { value: { isAnswered: false, reason: 'empty-reply', usage: ZERO } }
      : { value: { isAnswered: true, text: reply, usage: ZERO } }
  })
  return calls
}

/** The model request beneath every plugin: records what each step was sent with. */
function steps(on: On) {
  const sent: { model: string; effort: TurnStepInput['effort'] }[] = []
  on('turn.step', async function* (_, e) {
    sent.push({ model: e.model, effort: e.effort })
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return sent
}

async function step($: Engine, index: number) {
  const s = $.turn.step({ turnId: 't1', index, model: 'claude-sonnet-5-5', effort: 'medium', messageCount: 3 + index })
  for await (const _ of s) {
    // drain
  }
  return s.result
}

test('router applies route on the first step', async ($, on) => {
  fakeEngine(on)
  haiku(on, ROUTE)
  const sent = steps(on)
  await $.session.start(START)

  const r = await $.prompt.submit({ text: 'Build the World tab with three panels' })
  await step($, 0)

  expect(sent[0]).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  expect(r.context?.some(c => c.startsWith('[router] large feature → opus/high, plan first'))).toBe(true)
  expect(r.context?.some(c => c.startsWith('[resources] '))).toBe(true)
})

test('skippable prompts reuse the route without a model call', async ($, on) => {
  fakeEngine(on)
  const calls = haiku(on, ROUTE)
  steps(on)
  await $.session.start(START)

  await $.prompt.submit({ text: 'Build the World tab with three panels' })
  await $.prompt.submit({ text: 'continue' })

  expect(calls.length).toBe(1)
})

test('effort rises after two failures in a row', async ($, on) => {
  fakeEngine(on)
  haiku(on, ROUTE)
  const sent = steps(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true }))
  await $.session.start(START)
  await $.prompt.submit({ text: 'Build the World tab with three panels' })
  await $.turn.start({ turnId: 't1' })
  await step($, 0)

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await step($, 1)

  expect(sent[1]).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
})

test('model steps up once after three failures', async ($, on) => {
  fakeEngine(on)
  haiku(on, '{"size":"small","kind":"edit","model":"haiku","effort":"low","plan":false,"agents":[]}')
  const sent = steps(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: 'boom', interrupted: false }, isError: true }))
  await $.session.start(START)
  await $.prompt.submit({ text: 'Fix the typo in the README title' })
  await $.turn.start({ turnId: 't1' })
  await step($, 0)

  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await step($, 1)
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await step($, 2)

  expect(sent[1]?.model).toBe('claude-sonnet-5-5')
  expect(sent[2]?.model).toBe('claude-sonnet-5-5')
})

test('router failure keeps the current model', async ($, on) => {
  fakeEngine(on)
  haiku(on, null)
  const sent = steps(on)
  await $.session.start(START)

  await $.prompt.submit({ text: 'Build the World tab with three panels' })
  await step($, 0)

  expect(sent[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
})

test('a pinned model holds over the router', async ($, on) => {
  mock.store(on, { 'mc.settings': { pin: 'opus' } })
  fakeEngine(on)
  haiku(on, '{"size":"small","kind":"edit","model":"haiku","effort":"low","plan":false,"agents":[]}')
  const sent = steps(on)
  await $.session.start(START)

  await $.prompt.submit({ text: 'Fix the typo in the README title' })
  await step($, 0)

  expect(sent[0]?.model).toBe('claude-opus-5-5')
})

test('router off still attaches the resources line', async ($, on) => {
  mock.store(on, { 'mc.settings': { router: false } })
  fakeEngine(on)
  const calls = haiku(on, ROUTE)
  await $.session.start(START)

  const r = await $.prompt.submit({ text: 'Build the World tab with three panels' })

  expect(calls.length).toBe(0)
  expect(r.context?.some(c => c.startsWith('[resources] '))).toBe(true)
})

test('subagent steps are left alone by the main router', async ($, on) => {
  fakeEngine(on)
  haiku(on, ROUTE)
  const sent = steps(on)
  await $.session.start(START)
  await $.prompt.submit({ text: 'Build the World tab with three panels' })

  const s = $.turn.step({ turnId: 't9', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 2, agentId: 'a1' })
  for await (const _ of s) {
    // drain
  }

  expect(sent[0]).toEqual({ model: 'claude-haiku-5-5', effort: 'low' })
})

test('a route arriving mid-turn waits for the next turn', async ($, on) => {
  fakeEngine(on)
  haiku(on, ROUTE)
  const sent = steps(on)
  await $.session.start(START)
  await $.turn.start({ turnId: 't1' })
  await step($, 0)

  await $.prompt.submit({ text: 'Also add a settings page with toggles' })
  await step($, 1)

  expect(sent[1]).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
})
