import { expect, mock, test } from 'claude-code/testing'

import { pace, sparkline } from '../hooks/zones'
import { fakeEngine } from './kit'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } } as const
const START = { cwd: 'C:/p', surface: 'terminal', isInteractive: true } as const

test('sparkline draws eight levels', () => {
  expect(sparkline([0, 25, 50, 75, 100])).toBe('▁▂▄▆█')
  expect(sparkline([])).toBe('')
})

test('pace compares usage with time elapsed in the window', () => {
  const now = Date.parse('2026-10-09T12:00:00Z')
  // 2.5 of 5 hours gone (50%), 70% used: 20 points ahead of pace.
  expect(pace(70, new Date(now + 2.5 * 3600_000).toISOString(), now)).toBe(20)
  expect(pace(30, new Date(now + 2.5 * 3600_000).toISOString(), now)).toBe(-20)
  expect(pace(30, undefined, now)).toBeNull()
})

test('the band shows the context trend and the pace', async ($, on) => {
  fakeEngine(on)
  for (const ctx of [10, 20, 30]) {
    await $.session.measure({
      context: { window: 200000, percent: ctx },
      rateLimits: [{ kind: 'five_hour', percentUsed: 70, resetsAt: new Date(Date.now() + 2.5 * 3600_000).toISOString() }],
      changed: ['context'],
    })
  }
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'trend' }))?.text).toMatch(/^[▁-█]{3}$/)
  expect((await ui.find({ key: 'pace' }))?.text).toMatch(/^ ▲ \d+ ahead$/)
})

test('a new session shows the last-known readings, dimmed, before the first call', async ($, on) => {
  mock.store(on, {
    'mc.lastMeter': { ctxPct: 33, fiveHour: { pct: 44 }, weekly: { pct: 11 }, costUsd: null, at: 1 },
  })
  fakeEngine(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'meter' }))?.text).toMatch(/44%/)
  expect((await ui.find({ key: 'stale' }))?.text).toBe(' (last known)')
})

test('the panel key opens the side panel without changing the layout', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })

  await ui.press({ key: 'peek' })

  expect(opened).toEqual(['mc-side'])
  expect(await ui.find({ key: 'meter' })).toBeDefined()
})
