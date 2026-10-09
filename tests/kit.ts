import type { AgentInfo, On } from 'claude-code'

/** What the fake engine beneath the plugin recorded. */
export type Seen = {
  statuses: (string | undefined)[]
  toasts: string[]
  logs: string[]
  writes: { path: string; text: string }[]
  pushes: string[]
  submitted: string[]
}

export type FakeOptions = {
  env?: Record<string, string>
  agents?: AgentInfo[]
  /** Answer for the PushNotification tool: 'ok' (default) or a deny text. */
  push?: 'ok' | { deny: string }
}

/**
 * Answers the engine calls the plugin makes that the kit does not, and records
 * what the person would see. Register before the first call on `$`.
 */
export function fakeEngine(on: On, opts: FakeOptions = {}): Seen {
  const seen: Seen = { statuses: [], toasts: [], logs: [], writes: [], pushes: [], submitted: [] }
  on('ui.status', (_, e) => {
    seen.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('env.get', (_, e) => ({ value: opts.env?.[e.name] }))
  on('fs.write', (_, e) => {
    seen.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('agent.list', () => ({ value: opts.agents ?? [] }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'PushNotification' }, (_, e) => {
    if (opts.push !== undefined && opts.push !== 'ok') return opts.push
    seen.pushes.push(e.message)
    return { result: { message: 'sent' } }
  })
  on('prompt.submit', (_, e) => {
    seen.submitted.push(e.text)
    return e.context === undefined ? { text: e.text } : { text: e.text, context: e.context }
  })
  return seen
}

export const RESETS_IN = (nowMs: number, minutes: number) => new Date(nowMs + minutes * 60_000).toISOString()
