/** One tool call of a turn, as the proof card reads it. */
export type ToolRecord = { tool: string; command?: string; isError: boolean; text: string }

const EDITS = new Set(['Edit', 'Write', 'NotebookEdit'])
const TEST = /pytest|npm (run )?test|plugin test|vitest|jest|cargo test|go test/i
const BUILD = /npm run build|\btsc\b|vite build|cargo build/i

const runs = (records: readonly ToolRecord[], pattern: RegExp) => records.filter(r => r.command !== undefined && pattern.test(r.command))

/** `✓ tests 114 pass · ✓ build · …` for a turn that changed files; null otherwise. */
export function proofCard(records: readonly ToolRecord[]): string | null {
  if (!records.some(r => EDITS.has(r.tool))) return null

  const test = runs(records, TEST).at(-1)
  let tests = '– no tests'
  if (test !== undefined) {
    const failed = Number(/(\d+)\s+fail/i.exec(test.text)?.[1] ?? 0)
    const passed = /(\d+)\s+pass/i.exec(test.text)?.[1]
    tests =
      test.isError || failed > 0
        ? `✗ tests ${failed > 0 ? `${failed} failed` : 'failed'}`
        : `✓ tests${passed === undefined ? '' : ` ${passed} pass`}`
  }

  const build = runs(records, BUILD).at(-1)
  const buildText = build === undefined ? '– no build' : build.isError ? '✗ build' : '✓ build'
  const browser = records.some(r => r.tool.startsWith('mcp__Claude_Browser__')) ? '✓ browser-checked' : '✗ not browser-checked'
  const committed = runs(records, /\bgit\s+commit\b/).some(r => !r.isError) ? '✓ committed' : '– not committed'
  const pushed = runs(records, /\bgit\b[^\n]*\bpush\b/).some(r => !r.isError) ? '✓ pushed' : '– not pushed'

  return [tests, buildText, browser, committed, pushed].join(' · ')
}
