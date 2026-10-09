import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fakeEngine } from './kit'

const SURFACES = ['terminal', 'desktop'] as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } } as const

async function measure($: Engine, fivePct: number) {
  await $.session.measure({
    context: { window: 200000, percent: 10 },
    rateLimits: [{ kind: 'five_hour', percentUsed: fivePct }],
    changed: ['rateLimits'],
  })
}

test('band colour follows zone', async ($, on) => {
  fakeEngine(on)
  await measure($, 63)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface, ...BAND })
    expect((await ui.find({ key: 'frame' }))?.props.borderColor).toBe('yellow')
    expect((await ui.find({ key: 'meter' }))?.text).toMatch(/5-hour limit.*63%/)
    await ui.unmount()
  }
})

test('danger pulses until Got it', async ($, on) => {
  fakeEngine(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })
  await measure($, 96)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })

  await clock.advance(1000)
  expect((await ui.find({ type: 'Text', text: /^ DANGER $/ }))?.props.inverse).toBe(true)

  await ui.press({ key: 'ack' })
  await clock.advance(1000)
  expect((await ui.find({ type: 'Text', text: /^ DANGER $/ }))?.props.inverse).not.toBe(true)
  await clock.advance(1000)
  expect((await ui.find({ type: 'Text', text: /^ DANGER $/ }))?.props.inverse).not.toBe(true)
  expect(await ui.find({ key: 'ack' })).toBeUndefined()
})

test('pulse returns on the next danger episode', async ($, on) => {
  fakeEngine(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })
  await measure($, 96)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })
  await ui.press({ key: 'ack' })

  await measure($, 85)
  await clock.advance(1000)
  await measure($, 97)
  await clock.advance(1000)

  expect((await ui.find({ type: 'Text', text: /^ DANGER $/ }))?.props.inverse).toBe(true)
})

test('hint line carries the zone dot', async ($, on) => {
  fakeEngine(on)
  await measure($, 91)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'mission-control',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    const dot = await ui.find({ key: 'zone-dot' })
    expect(dot?.text).toBe('● high')
    expect((await ui.find({ type: 'Text', text: /^● / }))?.props.color).toBe('red')
    expect((await ui.find({ text: /\? for shortcuts/ }))).toBeDefined()
    await ui.unmount()
  }
})

test('band shows agents against the cap and the session cost', async ($, on) => {
  fakeEngine(on, { agents: [{ id: 'a', description: 'tests', type: 'general-purpose', status: 'running' }] })
  await $.session.measure({
    context: { window: 200000, percent: 10 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 20 }],
    cost: { usd: 1.237 },
    changed: ['cost'],
  })
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'agents' }))?.text).toContain('1/3 agents')
  expect((await ui.find({ key: 'cost' }))?.text).toContain('$1.24')
  expect((await ui.find({ key: 'zone' }))?.text).toBe(' OK ')
})

test('the moon button starts midnight', async ($, on) => {
  const seen = fakeEngine(on)
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('mcp.call', () => ({ deny: 'none' }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({
    result: { questions: e.questions, answers: Object.fromEntries(e.questions.map(q => [q.question, 'Start'])) },
  }))
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })

  await ui.press({ key: 'midnight' })
  await clock.advance(500)

  expect(seen.submitted.some(t => t.startsWith('Midnight: continue'))).toBe(true)
  expect((await ui.find({ key: 'midnight-chip' }))?.text).toMatch(/^ 🌙 midnight · \d+h\d*m? left/)
  expect(await ui.find({ key: 'midnight' })).toBeUndefined()
})

test('other plugins and real prompts are not collapsed', async ($, on) => {
  fakeEngine(on)
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const cases = [
    { text: 'Midnight: continue with the next unfinished item.', origin: { kind: 'plugin', name: 'some-other-mod' } },
    { text: 'Midnight: how do I set this up?', origin: { kind: 'composer' } },
  ] as const
  for (const c of cases) {
    const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', component: 'UserMessage', props: { ...c, isExpanded: false } })
    expect(await ui.find({ text: /🌙/ })).toBeUndefined()
    expect(await ui.find({ text: /^Midnight:/ })).toBeDefined()
    await ui.unmount()
  }
})
