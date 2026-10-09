import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { tokenSummary } from '../hooks/waste'
import { fakeEngine } from './kit'

const START = { cwd: 'C:/demo/app', surface: 'terminal', isInteractive: true } as const
const PANE = { component: 'Pane', requestId: 'mc-side', props: { title: 'Mission Control' } } as const

function host(on: On) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: 'C:/demo/app' }))
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({
    result: { questions: e.questions, answers: Object.fromEntries(e.questions.map(q => [q.question, 'Approve'])) },
  }))
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'inherit', agentId: 'a1' }))
  return filled
}

test('tokenSummary says how much output was spent and wasted', () => {
  const turns = [
    { turnId: 'a', outputTokens: 900, words: 300, size: 'small' as const, flag: 'long report for a small task' },
    { turnId: 'b', outputTokens: 200, words: 60, size: 'large' as const, flag: null },
  ]
  expect(tokenSummary(turns)).toBe('output 1,100 · 1 of 2 turns padded · ~900 wasted')
  expect(tokenSummary([])).toBe('no turns yet')
})

test('the side panel shows each agent with its model, effort and type', async ($, on) => {
  mock.store(on)
  fakeEngine(on, { agents: [{ id: 'a1', description: 'find the loader', type: 'Explore', status: 'running' }] })
  host(on)
  await $.session.start(START)
  await $.agent.spawn({ prompt: 'Find the config loader', subagentType: 'Explore', description: 'find the loader' })

  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE })

  expect((await ui.find({ key: 'side-agents' }))?.text).toMatch(/find the loader · haiku·low · Explore · running/)
})

test('a tell button puts a message to that agent in the prompt', async ($, on) => {
  mock.store(on)
  fakeEngine(on, { agents: [{ id: 'a1', description: 'find the loader', type: 'Explore', status: 'running', name: 'scout' }] })
  const filled = host(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE })

  await ui.press({ key: 'tell-a1' })

  expect(filled).toEqual(['Tell scout: '])
})

test('the panel lists projects and marks the current one', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  host(on)
  await $.session.start(START)
  await $.command.run({ command: 'project', args: 'add Demo = C:/demo' })

  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE })

  const text = (await ui.find({ key: 'side-projects' }))?.text ?? ''
  expect(text).toContain('▶ Demo')
})

test('the panel shows the token analysis', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  host(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE })

  expect((await ui.find({ key: 'side-tokens' }))?.text).toMatch(/Tokens\s+no turns yet/)
})

test('/look quotes what you selected into the prompt', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  const filled = host(on)
  let selection: string | undefined = 'cpu 98% on worker-3'
  on('ui.selection', () => ({ value: selection === undefined ? undefined : { text: selection } }))
  await $.session.start(START)

  expect((await $.command.run({ command: 'look', args: '' })).text).toBe('Quoted your selection into the prompt.')
  expect(filled).toEqual(['Check on this and tell me what is wrong, if anything:\n> cpu 98% on worker-3\n\n'])
  selection = undefined
  expect((await $.command.run({ command: 'look', args: '' })).text).toBe('Nothing is selected. Highlight some text first, then run /look.')
})
