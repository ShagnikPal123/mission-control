/** The owner asked for everything in one place: do not split. */
export const wantsTogether = (text: string): boolean => /\b(together|same chat|in one go|at once|all in one)\b/i.test(text)

/** Two to five non-empty task strings from the router's `tasks`, else none. */
export function parseTasks(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const tasks = raw.map(t => (typeof t === 'string' ? t.trim() : ''))
  if (tasks.length < 2 || tasks.length > 5 || tasks.some(t => t === '')) return []
  return tasks
}

/** The `tasks` array from the router's raw reply, if any. */
export function tasksFromReply(raw: string): unknown {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return (JSON.parse(raw.slice(start, end + 1)) as { tasks?: unknown }).tasks
  } catch {
    return undefined
  }
}

export function splitLine(tasks: readonly string[]): string {
  return `[split] This message holds ${tasks.length} separate tasks. Do task 1 now: ${tasks[0]}. The rest are queued and will be sent one by one.`
}

export function nextTaskText(task: string, k: number, n: number): string {
  return `Next task split from your message (${k}/${n}): ${task}`
}
