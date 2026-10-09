import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fakeEngine } from './kit'

const T0 = Date.parse('2026-10-08T23:00:00-05:00')
const HOUR = 3_600_000
const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
const NUDGE = /^Midnight: continue with the next unfinished item\./
const ASK = {
  tool: 'AskUserQuestion',
  questions: [
    {
      question: 'Which layout?',
      header: 'Layout',
      options: [
        { label: 'A', description: 'a' },
        { label: 'B', description: 'b' },
      ],
      multiSelect: false,
    },
  ],
} as const

function host(on: On, gitTracked = '', exitCode = 0) {
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.root', () => ({ value: 'C:/proj' }))
  on('mcp.call', () => ({ deny: 'no keep-awake here' }))
  on('process.run', (_, e) => ({
    value: { exitCode, stdout: e.argv.includes('ls-files') ? gitTracked : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.compose', () => ({ sections: [] }))
  const bash: string[] = []
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    bash.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return bash
}

type Clock = { advance: (ms: number) => Promise<void> }

async function answer($: Engine, clock: Clock, text: string, reason: 'answer' | 'error' = 'answer') {
  await $.turn.complete({ reason, answer: text, durationMs: 5, isAborted: false, turnId: `t${Math.random()}` })
  await clock.advance(500)
}

async function midnight($: Engine, clock: Clock, args: string) {
  const text = (await $.command.run({ command: 'midnight', args })).text ?? ''
  await clock.advance(500)
  return text
}

test('midnight starts, says so, and nudges the first task', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on)
  await $.session.start(START)

  expect(await midnight($, clock, '3 --ship')).toBe('🌙 Midnight on for 3h · weekly budget 85% · shipping allowed.')
  expect(seen.submitted.some(t => NUDGE.test(t))).toBe(true)
})

test('the system prompt says the owner is away', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on)
  await $.session.start(START)
  await midnight($, clock, '')

  const r = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })

  expect(r.sections.find(x => x.id === 'mission-control:midnight')?.text).toMatch(/^The owner is away \(midnight mode\)\./)
})

test('questions are refused while the owner is away', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on)
  await $.session.start(START)
  await midnight($, clock, '')

  const r = await $.tool.call(ASK)

  expect(r.deny).toBe('Owner away: pick the recommended option and log it.')
})

test('push is refused without --ship', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  const bash = host(on)
  await $.session.start(START)
  await midnight($, clock, '')

  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(r.deny).toBe('Midnight: push/deploy needs --ship.')
  expect(bash.length).toBe(0)
})

test('push is refused with --ship when AI_HANDOFF is tracked', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on, 'AI_HANDOFF/01_GOALS.md\n')
  await $.session.start(START)
  await midnight($, clock, '--ship')

  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(r.deny).toMatch(/AI_HANDOFF/)
})

test('push goes through with --ship when the checks are clean', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  const bash = host(on)
  await $.session.start(START)
  await midnight($, clock, '--ship')

  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(r.deny).toBeUndefined()
  expect(bash).toEqual(['git push origin main'])
})

test('a delete outside the project is refused', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  const bash = host(on)
  await $.session.start(START)
  await midnight($, clock, '')

  expect((await $.tool.call({ tool: 'Bash', command: 'rm -rf C:/Users/me/Documents' })).deny).toBe(
    'Midnight: delete outside the project refused.',
  )
  await $.tool.call({ tool: 'Bash', command: 'rm -rf C:/proj/build' })
  expect(bash).toEqual(['rm -rf C:/proj/build'])
})

test('nothing is refused when midnight is off', async ($, on) => {
  mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  const bash = host(on)
  await $.session.start(START)

  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(bash).toEqual(['git push origin main'])
})

test('an answered turn gets the next nudge', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on)
  await $.session.start(START)
  await midnight($, clock, '')
  const before = seen.submitted.length

  await answer($, clock, 'Finished the parser.')

  expect(seen.submitted.slice(before).some(t => NUDGE.test(t))).toBe(true)
})

test('midnight stops on MIDNIGHT_DONE with a morning report', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on)
  await $.session.start(START)
  await midnight($, clock, '')

  await answer($, clock, 'Everything is done and tested. MIDNIGHT_DONE')

  expect(seen.submitted.at(-1)).toMatch(/^Midnight run ended \(work finished\)\. Write the morning report/)
  expect(seen.pushes.at(-1)).toMatch(/^🌙 Midnight done \(work finished\)/)
  expect(await midnight($, clock, 'status')).toMatch(/off/)
})

test('midnight stops at the weekly budget', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on)
  await $.session.start(START)
  await midnight($, clock, '')
  await $.session.measure({
    context: { window: 200000, percent: 10 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 86 }],
    changed: ['rateLimits'],
  })

  await answer($, clock, 'Did a thing.')

  expect(seen.submitted.at(-1)).toMatch(/^Midnight run ended \(weekly budget reached\)/)
})

test('midnight stops when time is up', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on)
  await $.session.start(START)
  await midnight($, clock, '1')

  await clock.advance(HOUR + 1000)
  await answer($, clock, 'Did a thing.')

  expect(seen.submitted.at(-1)).toMatch(/^Midnight run ended \(time up\)/)
})

test('three errors in a row stop midnight', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on)
  await $.session.start(START)
  await midnight($, clock, '')

  await answer($, clock, '', 'error')
  await answer($, clock, '', 'error')
  await answer($, clock, '', 'error')

  expect(seen.submitted.at(-1)).toMatch(/^Midnight run ended \(3 errors in a row\)/)
})

test('/midnight off stops it', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on)
  host(on)
  await $.session.start(START)
  await midnight($, clock, '')

  await midnight($, clock, 'off')

  expect(seen.submitted.at(-1)).toMatch(/^Midnight run ended \(stopped by owner\)/)
})

test('no nudge while a background agent is still running', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const seen = fakeEngine(on, { agents: [{ id: 'r1', description: 'final review', type: 'general-purpose', status: 'running' }] })
  host(on)
  await $.session.start(START)
  await midnight($, clock, '')
  const before = seen.submitted.length

  await answer($, clock, 'Waiting on the reviewer.')

  expect(seen.submitted.slice(before).some(t => NUDGE.test(t))).toBe(false)
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`midnight nudges are one dim line on ${surface}`, async ($, on) => {
    fakeEngine(on)
    const nudge = 'Midnight: continue with the next unfinished item. If none is left: optimize and test.'
    const ui = await $.ui.mount({
      plugin: 'mission-control',
      surface,
      component: 'UserMessage',
      props: { text: nudge, origin: { kind: 'plugin', name: 'mission-control' }, isExpanded: false },
    })
    const rows = await ui.find({ type: 'Text', text: /🌙/ })
    expect(rows?.text).toBe('🌙 midnight · continuing')
    expect(rows?.props.dimColor).toBe(true)
    expect(await ui.find({ text: /optimize and test/ })).toBeUndefined()
    await ui.unmount()
  })
}

test('a push whose check cannot run is refused', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  const bash = host(on, '', 128)
  await $.session.start(START)
  await midnight($, clock, '--ship')

  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(r.deny).toMatch(/could not verify the push/)
  expect(bash.length).toBe(0)
})

test('git global options do not hide a push', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  host(on)
  await $.session.start(START)
  await midnight($, clock, '')

  for (const c of ['git -C "Ai Dev Folder" push origin main', 'git.exe push', 'git -c core.x=1 push']) {
    expect((await $.tool.call({ tool: 'Bash', command: c })).deny, c).toBe('Midnight: push/deploy needs --ship.')
  }
})

test('deleting inside the project by a relative path is fine', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  fakeEngine(on)
  const bash = host(on)
  await $.session.start(START)
  await midnight($, clock, '')

  await $.tool.call({ tool: 'Bash', command: 'rm -rf ./dist node_modules/.cache' })
  await $.tool.call({ tool: 'Bash', command: 'rm -rf "C:/proj/Ai Dev Folder/build"' })

  expect(bash.length).toBe(2)
})
