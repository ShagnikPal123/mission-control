import type { Midnight } from '../types'

// git, however it is spelled: `git.exe`, and global options before the verb.
const GIT = String.raw`\bgit(?:\.exe)?(?:\s+(?:-C\s+(?:"[^"]*"|\S+)|-c\s+\S+|--[\w-]+(?:=\S+)?))*`
const PUSH = new RegExp(String.raw`${GIT}\s+push\b|\bvercel\b|\bnpm\s+publish\b|\bgh\s+release\b`, 'i')
const FORCE_PUSH = new RegExp(String.raw`${GIT}\s+push\b[^\n]*(?:--force|\s-[a-z]*f[a-z]*\b|\s\+\S)`, 'i')
const RECURSIVE_DELETE =
  /\brm\b[^\n]*?\s(?:-[a-z]*r[a-z]*|--recursive)\b|\b(?:rd|rmdir)\b[^\n]*\s\/s\b|\bdel\b[^\n]*\s\/s\b|\b(?:Remove-Item|ri)\b[^\n]*\s-r(?:ecurse)?\b/i
const SECRET = /sk-ant-|\bsk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[bpas]-|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|nvapi-/

export const isPushOrDeploy = (cmd: string): boolean => PUSH.test(cmd)
export const hasSecret = (text: string): boolean => SECRET.test(text)

const norm = (p: string) => p.replace(/^["']/, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Where a git command runs: `git -C <dir>` or `cd <dir> &&`; undefined for the session folder. */
export function gitRepoOf(cmd: string): string | undefined {
  const c = /\bgit(?:\.exe)?\s+-C\s+("[^"]+"|\S+)/i.exec(cmd)?.[1] ?? /\bcd\s+(?:\/d\s+)?("[^"]+"|[^\s&;|]+)\s*(?:&&|;)/i.exec(cmd)?.[1]
  return c?.replace(/^"|"$/g, '')
}

/** A recursive delete aimed outside `root`: an absolute path elsewhere, `~`, or a variable. */
export function deletesOutside(cmd: string, root: string): boolean {
  if (!RECURSIVE_DELETE.test(cmd)) return false
  const r = norm(root)
  const tokens = [...cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(m => m[1] ?? m[2] ?? m[3] ?? '')
  return tokens.some(t => {
    if (/^\/[a-z]$/i.test(t)) return false // a cmd switch such as /s or /q
    if (/^[~$%]/.test(t)) return true // home or an environment variable
    if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(t)) return false // relative: inside the project
    const n = norm(t)
    return n !== r && !n.startsWith(`${r}/`)
  })
}

// ── God mode: what still asks, and what gets a second look ────────────────
const HARD_STOP: readonly RegExp[] = [
  /\bformat\s+[a-z]:|\bcipher\s+\/w|\b(diskpart|bcdedit|shutdown|cmdkey)\b/i,
  /\breg\s+(add|delete)\s+HKLM/i,
  /Set-ExecutionPolicy/i,
  /Set-MpPreference|netsh\s+advfirewall\s+set\s+\S+\s+state\s+off/i,
  /(curl|wget|iwr|Invoke-WebRequest)[^|\n]*\|\s*(sh|bash|iex|Invoke-Expression)\b/i,
  FORCE_PUSH,
  /\.ssh[\\/]|Login Data|Credential/i,
]
const MEDIUM: readonly RegExp[] = [
  /curl[^\n]*(-X\s*POST|-T\s|--upload-file|-F\s)|\bscp\s|Invoke-WebRequest[^\n]*-Method\s+Post/i,
  /\b(taskkill|Stop-Process)\b|\bkill\s+-9\b/i,
  /\b(winget|choco)\s+install\b|\bnpm\s+(i|install)\b[^\n]*\s-g\b|\bpip\s+install\b(?![^\n]*--user)/i,
]
const FILE_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit'])
const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
/** Tools from other servers that run a shell command. */
export const SHELL_TOOL = /(?:^|__)(?:start_process|run_in_terminal|run_session_command|interact_with_process)$/
/** Tool names that spend money or publish (spec H.2 "Money"). */
const MONEY_TOOL = /(?:^|_)(?:buy|purchase|pay|transfer|trade|deploy_to|create_deployment|send_message|send)(?:_|$)/

const field = (input: unknown, key: string): string => {
  const v = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
  return typeof v === 'string' ? v : ''
}

/** The command a shell-running tool was asked to run, or null for other tools. */
export function shellCommand(tool: string, input: unknown): string | null {
  if (tool === 'Bash' || tool === 'PowerShell') return field(input, 'command')
  if (SHELL_TOOL.test(tool)) return field(input, 'command') || field(input, 'input')
  return null
}

const inside = (path: string, root: string) => {
  const p = norm(path)
  const r = norm(root)
  return r !== '' && (p === r || p.startsWith(`${r}/`))
}

/** spec H.2/H.3: `hard-stop` keeps the normal prompt, `medium` gets Haiku's look. */
export function classifyCall(tool: string, input: unknown, projectRoot: string): 'hard-stop' | 'medium' | 'normal' {
  if (tool.startsWith('mcp__') && MONEY_TOOL.test(tool.split('__').pop() ?? '')) return 'hard-stop'
  const cmd = shellCommand(tool, input)
  if (cmd !== null) {
    if (HARD_STOP.some(r => r.test(cmd)) || deletesOutside(cmd, projectRoot)) return 'hard-stop'
    if (MEDIUM.some(r => r.test(cmd))) return 'medium'
    return 'normal'
  }
  if (FILE_TOOLS.has(tool)) {
    const path = field(input, 'file_path') || field(input, 'notebook_path')
    if (/\.ssh[\\/]/i.test(path)) return 'hard-stop'
    if (WRITE_TOOLS.has(tool) && path !== '' && !inside(path, projectRoot)) return 'medium'
  }
  return 'normal'
}

/** Only the owner's own hand: typed at the prompt or sent from the phone. */
export const isOwnerOrigin = (kind: string | undefined): boolean => kind === 'composer' || kind === 'bridge'

/** `[hours] [--ship]`, hours 1–24 (default 8), or `off`. */
export function parseMidnightArgs(args: string): { hours: number; ship: boolean } | 'off' {
  const a = args.trim().toLowerCase()
  if (a === 'off') return 'off'
  const n = Number(/\b(\d+)\b/.exec(a)?.[1] ?? 8)
  return { hours: Math.max(1, Math.min(24, n)), ship: /--ship\b/.test(a) }
}

/** Why the run should end now, or null to keep going. */
export function midnightStop(m: Midnight, now: number, weeklyPct: number, answer: string): string | null {
  if (now >= m.endsAt) return 'time up'
  if (weeklyPct >= m.budgetPct) return 'weekly budget reached'
  if (answer.includes('MIDNIGHT_DONE')) return 'work finished'
  if (m.errorsInRow >= 3) return '3 errors in a row'
  return null
}
