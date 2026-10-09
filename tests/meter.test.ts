import { expect, test } from 'claude-code/testing'

import { bandSegments, formatMeter, formatReset, meterBar, zoneOf } from '../hooks/zones'
import { fakeEngine } from './kit'

const RESETS = '2026-10-08T22:20:00-05:00'

test('zoneOf boundaries', () => {
  expect(zoneOf(59.9)).toBe('ok')
  expect(zoneOf(60)).toBe('watch')
  expect(zoneOf(80)).toBe('warn')
  expect(zoneOf(90)).toBe('high')
  expect(zoneOf(95)).toBe('danger')
})

test('formatMeter full', () => {
  const text = formatMeter(
    {
      ctxPct: 42,
      fiveHour: { pct: 63, resetsAt: RESETS },
      weekly: { pct: 31 },
      costUsd: null,
      at: 0,
    },
    new Date(RESETS),
    'America/Chicago',
  )
  expect(text).toBe('Context 42% · 5h 63% ↻10:20p · Week 31%')
})

test('formatReset adds weekday for other days', () => {
  const now = new Date('2026-10-08T12:00:00-05:00')
  expect(formatReset(RESETS, now, 'America/Chicago')).toBe('10:20p')
  expect(formatReset('2026-10-10T09:05:00-05:00', now, 'America/Chicago')).toBe('Sat 9:05a')
  expect(formatReset(undefined, now, 'America/Chicago')).toBe('soon')
})

test('meter tolerates missing figures', async ($, on) => {
  const { statuses } = fakeEngine(on)

  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })

  expect(statuses.at(-1)).toBe('Context – · 5h – · Week –')
})

test('measure updates the status line', async ($, on) => {
  const { statuses } = fakeEngine(on)

  await $.session.measure({
    context: { window: 200000, tokens: 84000, percent: 42 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 63, resetsAt: new Date(Date.now() + 60_000).toISOString() },
      { kind: 'seven_day', percentUsed: 31 },
    ],
    changed: ['context', 'rateLimits'],
  })

  expect(statuses.at(-1)).toMatch(/^Context 42% · 5h 63% ↻\d{1,2}:\d{2}[ap] · Week 31%$/)
})

test('status file is written under the user profile', async ($, on) => {
  const { writes } = fakeEngine(on, { env: { USERPROFILE: 'C:\\Users\\me' } })

  await $.session.measure({
    context: { window: 200000, percent: 10 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 20 }],
    changed: ['context'],
  })

  expect(writes.at(-1)?.path.replace(/\\/g, '/')).toBe('C:/Users/me/.claude/mission-control/status.json')
  expect(JSON.parse(writes.at(-1)?.text ?? '{}').meter.fiveHour.pct).toBe(20)
})

test('meterBar fills five cells', () => {
  expect(meterBar(42)).toBe('▰▰▱▱▱')
  expect(meterBar(100)).toBe('▰▰▰▰▰')
  expect(meterBar(null)).toBe('▱▱▱▱▱')
})

test('bandSegments label each meter plainly', () => {
  const segs = bandSegments(
    { ctxPct: 42, fiveHour: { pct: 63, resetsAt: RESETS }, weekly: { pct: 31 }, costUsd: 1.24, at: 0 },
    new Date(RESETS),
    'America/Chicago',
  )
  expect(segs.map(x => x.label)).toEqual(['Context', '5-hour limit', 'Weekly limit'])
  expect(segs[1]).toEqual({ label: '5-hour limit', pct: 63, bar: '▰▰▰▱▱', note: 'resets 10:20p' })
})
