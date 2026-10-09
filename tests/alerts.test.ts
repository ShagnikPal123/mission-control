import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fakeEngine } from './kit'

const RESETS = '2026-10-08T22:20:00-05:00'

async function measure($: Engine, kind: 'five_hour' | 'seven_day', pct: number) {
  await $.session.measure({
    context: { window: 200000, percent: 10 },
    rateLimits: [{ kind, percentUsed: pct, resetsAt: RESETS }],
    changed: ['rateLimits'],
  })
}

const START = { cwd: 'C:/p', surface: 'terminal', isInteractive: true } as const

test('90 percent alert fires once per window', async ($, on) => {
  mock.store(on)
  const seen = fakeEngine(on)
  await $.session.start(START)

  await measure($, 'five_hour', 91)
  await measure($, 'five_hour', 92)

  expect(seen.pushes.length).toBe(1)
  expect(seen.pushes[0]).toMatch(/^5h at 90% · resets .+ · now: /)
})

test('alert falls back to a toast when push is refused', async ($, on) => {
  mock.store(on)
  const seen = fakeEngine(on, { push: { deny: 'no remote' } })
  await $.session.start(START)

  await measure($, 'five_hour', 91)

  expect(seen.pushes.length).toBe(0)
  expect(seen.toasts.at(-1)).toMatch(/^5h at 90%/)
})

test('alerts off sends nothing', async ($, on) => {
  mock.store(on, { 'mc.settings': { alerts: false } })
  const seen = fakeEngine(on)
  await $.session.start(START)

  await measure($, 'five_hour', 91)

  expect(seen.pushes.length).toBe(0)
  expect(seen.toasts.length).toBe(0)
})

test('weekly window alerts on its own', async ($, on) => {
  mock.store(on)
  const seen = fakeEngine(on)
  await $.session.start(START)

  await measure($, 'seven_day', 93)

  expect(seen.pushes[0]).toMatch(/^Weekly at 90%/)
})

test('alert names the task in progress', async ($, on) => {
  mock.store(on)
  const seen = fakeEngine(on)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  await $.session.start(START)

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Write tests', status: 'completed', activeForm: 'Writing tests' },
      { content: 'Build router', status: 'in_progress', activeForm: 'Building router' },
    ],
  })
  await measure($, 'five_hour', 91)

  expect(seen.pushes[0]).toMatch(/now: Build router$/)
})
