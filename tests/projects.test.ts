import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { autoProject, groupNameFor, projectFor, trackedForbidden } from '../hooks/projects'

const PROJECTS = [
  { name: 'Nyx Ichos', path: 'C:/Users/me/code/Ai Dev Folder' },
  { name: 'Mission Control', path: 'C:/Users/me/code/claude-mods' },
]
import { fakeEngine } from './kit'

const ZERO = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

test('the project is found by folder, deepest match first', () => {
  const nyx = projectFor('C:\\Users\\me\\code\\Ai Dev Folder\\frontend', PROJECTS)
  expect(nyx?.name).toBe('Nyx Ichos')
  expect(projectFor('C:/Users/me/code/claude-mods/mission-control', PROJECTS)?.name).toBe('Mission Control')
  expect(projectFor('D:/elsewhere', PROJECTS)).toBeNull()
  expect(autoProject('D:/work/my-app/')).toEqual({ name: 'my-app', path: 'D:/work/my-app' })
})

test('chats sort into an updates or questions group', () => {
  expect(groupNameFor('Nyx Ichos', 'feature')).toBe('Nyx Ichos · Updates')
  expect(groupNameFor('Nyx Ichos', 'question')).toBe('Nyx Ichos · Questions')
  expect(groupNameFor('Nyx Ichos', 'research')).toBe('Nyx Ichos · Questions')
  expect(groupNameFor('Nyx Ichos', 'debug')).toBe('Nyx Ichos · Updates')
})

test('never-ship patterns catch tracked files', () => {
  const files = ['src/a.ts', 'AI_HANDOFF/START_HERE.md', '.env', 'config/prod.key', 'README.md']
  expect(trackedForbidden(files, ['AI_HANDOFF/', '.env', '*.key'])).toEqual(['AI_HANDOFF/START_HERE.md', '.env', 'config/prod.key'])
  expect(trackedForbidden(['src/env.ts'], ['.env'])).toEqual([])
})

function git(on: On, tracked: string) {
  on('process.run', (_, e) => ({
    value: { exitCode: 0, stdout: e.argv.includes('ls-files') ? tracked : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.root', () => ({ value: 'C:/proj' }))
  const pushed: string[] = []
  on('tool.call', { tool: 'Bash' }, (_, e) => {
    pushed.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })
  return pushed
}

test('a push that would publish a never-ship file is refused, even outside midnight', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  const pushed = git(on, 'src/a.ts\n.env\n')
  await $.session.start({ cwd: 'C:/proj', surface: 'terminal', isInteractive: true })

  const r = await $.tool.call({ tool: 'Bash', command: 'git push origin main' })

  expect(r.deny).toMatch(/^Ship check: \.env is tracked and must never be pushed/)
  expect(pushed.length).toBe(0)
})

test('/ship never remembers a pattern', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  const pushed = git(on, 'notes/private.txt\n')
  await $.session.start({ cwd: 'C:/proj', surface: 'terminal', isInteractive: true })

  expect((await $.command.run({ command: 'ship', args: 'never notes/' })).text).toBe('Never shipping: notes/')
  expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).deny).toMatch(/notes\/private\.txt/)
  expect(pushed.length).toBe(0)
})

test('/ship queues the full ship checklist', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const seen = fakeEngine(on)
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: 'C:/proj', surface: 'terminal', isInteractive: true })

  await $.command.run({ command: 'ship', args: '' })
  await clock.advance(500)

  expect(seen.submitted.at(-1)).toMatch(/^Ship it: /)
  expect(seen.submitted.at(-1)).toMatch(/AI_HANDOFF\//)
})

test('the first routed prompt files this chat under its project group', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  const calls: string[] = []
  on('mcp.call', (_, e) => {
    calls.push(`${e.server}.${e.tool}`)
    if (e.tool === 'list_groups') return { value: { content: [{ type: 'text', text: '[]' }], isError: false } }
    if (e.tool === 'create_group') return { value: { content: [{ type: 'text', text: '{"id":"g1"}' }], isError: false } }
    return { value: { content: [{ type: 'text', text: 'ok' }], isError: false } }
  })
  on('model.complete', () => ({
    value: { isAnswered: true, text: '{"size":"small","kind":"feature","model":"sonnet","effort":"medium","plan":false,"agents":[]}', usage: ZERO },
  }))
  await $.session.start({ cwd: 'C:/Users/me/code/Ai Dev Folder', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({ text: 'Add a settings page to the app please' })

  expect(calls).toEqual(['ccd_sidebar.list_groups', 'ccd_sidebar.create_group', 'ccd_sidebar.move_sessions'])
})
