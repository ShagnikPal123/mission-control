export type Project = { name: string; path: string }

/** What a ship must never push unless the owner adds more (`/ship never <pattern>`). */
export const DEFAULT_NEVER: readonly string[] = ['AI_HANDOFF/', '.env', '.env.*', '*.pem', '*.key', 'secrets/']

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** The registered project that holds `cwd`, the deepest path winning; null when none. */
export function projectFor(cwd: string, projects: readonly Project[]): Project | null {
  const c = norm(cwd)
  const hits = projects.filter(p => c === norm(p.path) || c.startsWith(`${norm(p.path)}/`))
  return hits.sort((a, b) => norm(b.path).length - norm(a.path).length)[0] ?? null
}

/** An unregistered folder is its own project, named after the folder. */
export function autoProject(cwd: string): Project {
  const path = cwd.replace(/\\/g, '/').replace(/\/+$/, '')
  return { name: path.split('/').pop() || path, path }
}

/** Chats sort into "<project> · Questions" or "<project> · Updates". */
export function groupNameFor(project: string, kind: string): string {
  return `${project} · ${kind === 'question' || kind === 'research' ? 'Questions' : 'Updates'}`
}

function matches(file: string, pattern: string): boolean {
  const f = file.replace(/\\/g, '/')
  const base = f.split('/').pop() ?? f
  if (pattern.endsWith('/')) return f.startsWith(pattern) || f.includes(`/${pattern}`)
  if (pattern.startsWith('*.')) return base.endsWith(pattern.slice(1))
  if (pattern.endsWith('.*')) return base.startsWith(pattern.slice(0, -1))
  return base === pattern || f === pattern
}

/** Tracked files that a never-ship pattern forbids. */
export function trackedForbidden(files: readonly string[], patterns: readonly string[]): string[] {
  return files.filter(f => f.trim() !== '' && patterns.some(p => matches(f.trim(), p))).map(f => f.trim())
}

export function shipText(never: readonly string[]): string {
  return [
    "Ship it: 1) run the project's tests and build;",
    `2) check git status and never commit or push: ${never.join(', ')};`,
    '3) scan for secrets (the push guard checks too);',
    '4) commit with a clear message; 5) push; 6) deploy the site if the project has one;',
    '7) end with the proof card. Stop at the first failure and say why.',
  ].join(' ')
}
