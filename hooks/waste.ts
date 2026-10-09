import type { Route, TurnRecord } from '../types'

export const BREVITY = [
  'Answer first. A yes/no question gets yes or no first.',
  'Final reports: 120 words or fewer unless the owner asks for detail.',
  'Do not restate unchanged things or repeat the previous report.',
  'Messages to other agents: terse, facts only.',
].join('\n')

export const wordCount = (text: string): number => text.split(/\s+/).filter(w => w !== '').length

/** Why a turn's report wasted tokens, or null. */
export function flagTurn(rec: { words: number; size: Route['size'] | null }, prevText: string | null, text: string): string | null {
  if (rec.words > 250 && (rec.size === 'tiny' || rec.size === 'small')) return `long report for a ${rec.size} task`
  if (prevText !== null && text.length >= 40 && prevText.slice(0, 200) === text.slice(0, 200)) return 'repeats previous report'
  return null
}

const n = (x: number) => x.toLocaleString('en-US')

/** `/mc tokens`: totals, flagged turns (last 10), estimated waste; ≤25 lines. */
export function tokenReportText(turns: readonly TurnRecord[]): string {
  const total = turns.reduce((sum, t) => sum + t.outputTokens, 0)
  const flagged = turns.filter(t => t.flag !== null)
  const wasted = flagged.reduce((sum, t) => sum + t.outputTokens, 0)
  const lines = [
    `Turns: ${turns.length} · output tokens: ${n(total)}`,
    `Flagged: ${flagged.length} · est. wasted output tokens: ${n(wasted)}`,
    ...flagged.slice(-10).map(t => `  ${t.turnId}: ${t.flag ?? ''} (${t.words} words)`),
  ]
  return lines.join('\n')
}
