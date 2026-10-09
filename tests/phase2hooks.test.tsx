import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fakeEngine } from './kit'

const T0 = Date.parse('2026-10-09T09:00:00-05:00')
const MIN = 60_000
const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false } } as const
const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** The engine pieces Phase 2 calls on. `answer` is the owner's reply to any pop-up. */
function host(on: On, answer: string | null = 'Approve') {
  const opened: string[] = []
  const compacted: string[] = []
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('mcp.call', () => ({ deny: 'none' }))
  if (answer !== null) {
    on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => ({
      result: { questions: e.questions, answers: Object.fromEntries(e.questions.map(q => [q.question, answer])) },
    }))
  }
  on('session.compact', (_, e) => {
    compacted.push(e.instructions ?? '')
    return { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return { opened, compacted }
}

async function measure($: Engine, ctx: number, five = 10) {
  await $.session.measure({ context: { window: 200000, percent: ctx }, rateLimits: [{ kind: 'five_hour', percentUsed: five }], changed: ['context'] })
}

const complete = ($: Engine, answer: string, turnId = `t${Math.random()}`) =>
  $.turn.complete({ reason: 'answer', answer, durationMs: 5, isAborted: false, turnId })

// ── A. Layout ───────────────────────────────────────────────────────────────
test('the layout button moves the meters into the side panel', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  const { opened } = host(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })

  await ui.press({ key: 'layout' })

  expect(opened).toContain('mc-side')
  expect((await ui.find({ key: 'side-chip' }))?.text).toMatch(/side panel/)
})

test('locking hides the layout button', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  host(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })

  await ui.press({ key: 'lock' })

  expect(await ui.find({ key: 'layout' })).toBeUndefined()
  await ui.press({ key: 'lock' })
  expect(await ui.find({ key: 'layout' })).toBeDefined()
})

test('compact layout is one line', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  host(on)
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })

  await ui.press({ key: 'layout' })
  await ui.press({ key: 'layout' })

  expect((await ui.find({ key: 'compact' }))?.text).toMatch(/^Context .* · 5h .* · Week /)
  expect(await ui.find({ key: 'meter' })).toBeUndefined()
})

// ── B. Side pane ────────────────────────────────────────────────────────────
for (const surface of ['terminal', 'desktop'] as const) {
  test(`the side pane stacks meters, agents and progress on ${surface}`, async ($, on) => {
    mock.store(on)
    fakeEngine(on, { agents: [{ id: 'a1', description: 'write tests', type: 'general-purpose', status: 'running' }] })
    host(on)
    on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
    await $.session.start(START)
    await measure($, 42)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'a', status: 'completed', activeForm: 'a' },
        { content: 'b', status: 'in_progress', activeForm: 'b' },
      ],
    })

    const ui = await $.ui.mount({ plugin: 'mission-control', surface, component: 'Pane', requestId: 'mc-side', props: { title: 'Mission Control' } })

    expect((await ui.find({ key: 'side-meters' }))?.text).toMatch(/Context/)
    expect((await ui.find({ key: 'side-agents' }))?.text).toMatch(/write tests/)
    expect((await ui.find({ key: 'side-progress' }))?.text).toMatch(/1\/2/)
    await ui.unmount()
  })
}

// ── B. Approvals ────────────────────────────────────────────────────────────
test('a denied agent does not start', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  host(on, 'Deny')
  const started: string[] = []
  on('agent.spawn', (_, e) => {
    started.push(e.prompt)
    return { model: 'sonnet', agentId: 'x' }
  })
  await $.session.start(START)

  const r = await $.agent.spawn({ prompt: 'Write tests', subagentType: 'general-purpose' })

  expect(r.deny).toMatch(/owner denied/i)
  expect(started.length).toBe(0)
})

test('auto-approve stops asking', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  host(on, null)
  let asks = 0
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    asks += 1
    return { result: { questions: e.questions, answers: Object.fromEntries(e.questions.map(q => [q.question, 'Auto-approve'])) } }
  })
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'x' }))
  await $.session.start(START)

  await $.agent.spawn({ prompt: 'Write tests', subagentType: 'general-purpose' })
  await $.agent.spawn({ prompt: 'Write docs', subagentType: 'general-purpose' })

  expect(asks).toBe(1)
})

// ── C. Proof card ───────────────────────────────────────────────────────────
test('a turn that edited files ends with a proof card', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  host(on)
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} }))
  on('tool.call', { tool: 'Bash' }, (_, e) => ({ result: { stdout: e.command.includes('test') ? ' 12 pass\n 0 fail' : '', stderr: '', interrupted: false }, text: e.command.includes('test') ? ' 12 pass\n 0 fail' : '' }))
  await $.session.start(START)
  await $.turn.start({ turnId: 'p1' })

  await $.tool.call({ tool: 'Edit', file_path: 'C:/proj/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const r = await complete($, 'Done.', 'p1')

  expect(r.text).toBe('✓ tests 12 pass · – no build · ✗ not browser-checked · – not committed · – not pushed')
})

test('a read-only turn has no proof card', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  host(on)
  await $.session.start(START)
  await $.turn.start({ turnId: 'p2' })

  const r = await complete($, 'Here is the answer.', 'p2')

  expect(r.text).toBe('Here is the answer.')
})

// ── D. Context health ───────────────────────────────────────────────────────
test('a heavy context asks for a handoff, then compacts and continues', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  const { compacted } = host(on)
  await $.session.start(START)
  await measure($, 86)

  await complete($, 'Some work.')
  await clock.advance(500)
  expect(seen.submitted.some(t => t.startsWith('Context is getting heavy.'))).toBe(true)

  await complete($, 'Handoff written.')
  await clock.advance(500)
  expect(compacted.length).toBe(1)
  expect(seen.submitted.at(-1)).toBe('Fresh context: read .mission-control/HANDOFF.md and continue.')
})

// ── E. Good morning ─────────────────────────────────────────────────────────
test('after a reset with the owner away, good morning starts an auto run', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on)
  on('session.usage', () => ({ value: { startedAt: T0, context: { window: 200000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 0 }] } }))
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: ZERO } }))
  await $.session.start(START)
  await $.prompt.submit({ text: 'Build the layout lock for the band please' })
  await $.session.measure({
    context: { window: 200000, percent: 30 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: new Date(T0 + 60 * MIN).toISOString() }],
    changed: ['rateLimits'],
  })

  await clock.advance(62 * MIN)

  expect(seen.submitted.some(t => t.startsWith('Good morning — usage has reset.'))).toBe(true)
  expect((await $.command.run({ command: 'midnight', args: 'status' })).text).toMatch(/^Midnight: on/)
})

test('the owner coming back stops the auto run', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'Start')
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: ZERO } }))
  await $.session.start(START)
  await $.command.run({ command: 'midnight', args: '' })
  await clock.advance(500)

  await $.prompt.submit({ text: 'I am back, what did you do?' })

  expect((await $.command.run({ command: 'midnight', args: 'status' })).text).toBe('Midnight: off')
})

// ── F. Split ────────────────────────────────────────────────────────────────
const SPLIT_ROUTE =
  '{"size":"large","kind":"feature","model":"opus","effort":"high","plan":true,"agents":[],"tasks":["Finish the mod layout lock","Queue the Nyx voice idea"]}'

test('a two-topic message runs as two tasks in order', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: SPLIT_ROUTE, usage: ZERO } }))
  await $.session.start(START)

  const r = await $.prompt.submit({ text: 'Finish the mod layout lock, and for the AI queue the voice idea' })
  expect(r.context?.some(c => c.startsWith('[split] This message holds 2 separate tasks. Do task 1 now: Finish the mod layout lock.'))).toBe(true)

  await complete($, 'Layout lock done.')
  await clock.advance(500)
  expect(seen.submitted.at(-1)).toBe('Next task split from your message (2/2): Queue the Nyx voice idea')
})

test('"same chat" keeps it as one task', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  host(on)
  on('model.complete', () => ({ value: { isAnswered: true, text: SPLIT_ROUTE, usage: ZERO } }))
  await $.session.start(START)

  const r = await $.prompt.submit({ text: 'Finish the layout lock and queue the voice idea, same chat please' })

  expect(r.context?.some(c => c.startsWith('[split]'))).toBe(false)
})

// ── G. Leftovers ────────────────────────────────────────────────────────────
test('the moon button asks before starting an 8-hour run', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on, 'Cancel')
  await $.session.start(START)
  const ui = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND })

  await ui.press({ key: 'midnight' })
  await clock.advance(500)

  expect(seen.submitted.some(t => t.startsWith('Midnight: continue'))).toBe(false)
})
