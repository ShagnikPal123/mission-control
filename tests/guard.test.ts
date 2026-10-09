import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fakeEngine } from './kit'

const T0 = Date.parse('2026-10-08T20:00:00-05:00')
const MIN = 60_000
const RESUME = 'Auto-resumed after the usage reset. Continue where you left off.'
const START = { cwd: 'C:/p', surface: 'terminal', isInteractive: true } as const

/** The live usage the guard re-reads when its timer fires. */
function usageReads(on: On, pct: () => number) {
  on('session.usage', () => ({
    value: { startedAt: T0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: pct() }] },
  }))
}

async function measure($: Engine, pct: number, resetsAt?: string) {
  await $.session.measure({
    context: { window: 200000, percent: 10 },
    rateLimits: [resetsAt === undefined ? { kind: 'five_hour', percentUsed: pct } : { kind: 'five_hour', percentUsed: pct, resetsAt }],
    changed: ['rateLimits'],
  })
}

const at = (ms: number) => new Date(ms).toISOString()

test('limit hit arms resume and submits after reset', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  usageReads(on, () => 5)
  await $.session.start(START)

  await measure($, 100, at(T0 + 10 * MIN))

  expect(seen.toasts.at(-1)).toMatch(/^5-hour limit reached · resets .+ · I'll continue automatically\.$/)
  expect(seen.pushes.some(p => p.startsWith('Limit hit · resumes '))).toBe(true)
  await clock.advance(10 * MIN + 30_000)
  expect(seen.submitted).not.toContain(RESUME)
  await clock.advance(31_000)
  expect(seen.submitted).toContain(RESUME)
  expect(seen.pushes.some(p => p.startsWith('Resumed after reset'))).toBe(true)
})

test('limit without resetsAt rechecks in 15 minutes', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  usageReads(on, () => 5)
  await $.session.start(START)

  await measure($, 100)
  await clock.advance(14 * MIN)
  expect(seen.submitted).not.toContain(RESUME)
  await clock.advance(2 * MIN)
  expect(seen.submitted).toContain(RESUME)
})

test('try again is held while limited', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  usageReads(on, () => 100)
  await $.session.start(START)
  await measure($, 100, at(T0 + 10 * MIN))

  const r = await $.prompt.submit({ text: 'Try again' })

  expect(r.drop).toMatch(/^Still limited until .+\. Auto-resume is queued\.$/)
})

test('a real prompt is not held while limited', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  usageReads(on, () => 100)
  await $.session.start(START)
  await measure($, 100, at(T0 + 10 * MIN))

  const r = await $.prompt.submit({ text: 'Add a login page to the site' })

  expect(r.drop).toBeUndefined()
})

test('resume re-arms after reload', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on, { 'mc.resumeAt': { kind: 'five_hour', until: T0 - 1000, resetsAt: null } })
  const seen = fakeEngine(on)
  usageReads(on, () => 5)

  await $.session.start(START)
  await clock.advance(1000)

  expect(seen.submitted).toContain(RESUME)
})

test('still limited at fire re-arms while the reset is in the future', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  on('session.usage', () => ({
    value: { startedAt: T0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: at(T0 + 40 * MIN) }] },
  }))
  await $.session.start(START)
  await measure($, 100, at(T0 + 10 * MIN))

  await clock.advance(11 * MIN)
  expect(seen.submitted).not.toContain(RESUME)
})

test('a stale 100 percent reading after the reset does not block the resume', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  on('session.usage', () => ({
    value: { startedAt: T0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: at(T0 + 10 * MIN) }] },
  }))
  await $.session.start(START)
  await measure($, 100, at(T0 + 10 * MIN))

  await clock.advance(12 * MIN)

  expect(seen.submitted).toContain(RESUME)
})

test('a missing resetsAt keeps one deadline and one alert', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  usageReads(on, () => 100)
  await $.session.start(START)

  await measure($, 100)
  await clock.advance(MIN)
  await measure($, 100)
  await clock.advance(MIN)
  await measure($, 100)

  expect(seen.toasts.filter(t => /limit reached/.test(t)).length).toBe(1)
  expect(seen.pushes.filter(p => p.startsWith('Limit hit')).length).toBe(1)
})

test('a resume left by another session is ignored', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on, { 'mc.resumeAt': { kind: 'five_hour', until: T0 - 1000, resetsAt: null, sid: 'old-session' } })
  const seen = fakeEngine(on)
  on('session.id', () => ({ value: 'new-session' }))
  usageReads(on, () => 5)

  await $.session.start(START)
  await clock.advance(2000)

  expect(seen.submitted).not.toContain(RESUME)
})

test('an error turn at 99 percent counts as a limit hit', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  usageReads(on, () => 99)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start(START)
  await measure($, 99, at(T0 + 10 * MIN))
  expect(seen.toasts.length).toBe(0)

  await $.turn.complete({ reason: 'error', answer: '', durationMs: 10, isAborted: false, turnId: 't1' })

  expect(seen.toasts.at(-1)).toMatch(/^5-hour limit reached/)
})

test('auto-resume off sends nothing at reset', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on, { 'mc.settings': { resume: false } })
  const seen = fakeEngine(on)
  usageReads(on, () => 5)
  await $.session.start(START)
  await measure($, 100, at(T0 + 10 * MIN))

  await clock.advance(12 * MIN)

  expect(seen.submitted).not.toContain(RESUME)
})
