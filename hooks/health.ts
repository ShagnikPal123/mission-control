/** Context health: is the session getting meaningfully worse as context fills? */

export type TurnSignals = { toolErrors: number; editMisses: number; corrected: boolean; wasted: boolean }
export type ScoredTurn = { score: number; ctxPct: number }

/** 1.0 for a clean turn; each sign of struggle takes some off. */
export function scoreTurn(s: TurnSignals): number {
  const score = 1 - Math.min(0.4, 0.1 * s.toolErrors) - 0.15 * s.editMisses - (s.corrected ? 0.3 : 0) - (s.wasted ? 0.1 : 0)
  return Math.max(0, Math.round(score * 1000) / 1000)
}

/** The owner pushing back on the last answer. */
export const CORRECTION = /^\s*(no\b|wrong|that'?s not|try again|you (didn'?t|forgot))/i

/** Mean of the first five turns scored while context was under 40%; null until there are five. */
export function healthBaseline(turns: readonly ScoredTurn[]): number | null {
  const early = turns.filter(t => t.ctxPct < 40).slice(0, 5)
  if (early.length < 5) return null
  return early.reduce((sum, t) => sum + t.score, 0) / early.length
}

export function ema(values: readonly number[], alpha = 0.3): number {
  let e = values[0] ?? 1
  for (const v of values.slice(1)) e = alpha * v + (1 - alpha) * e
  return e
}

/** Least-squares slope per turn. */
export function trendSlope(values: readonly number[]): number {
  const n = values.length
  if (n < 2) return 0
  const mx = (n - 1) / 2
  const my = values.reduce((a, b) => a + b, 0) / n
  let cov = 0
  let varx = 0
  values.forEach((y, x) => {
    cov += (x - mx) * (y - my)
    varx += (x - mx) ** 2
  })
  return cov / varx
}

const DROP = 0.25

/**
 * `refresh` only for a significant drop, or one the trend says is three turns
 * away; a small dip is `none`. Past 85% context it always refreshes.
 */
export function healthAction(turns: readonly ScoredTurn[]): 'none' | 'refresh' {
  const last = turns.at(-1)
  if (last === undefined) return 'none'
  if (last.ctxPct >= 85) return 'refresh'
  const base = healthBaseline(turns)
  if (base === null) return 'none'
  const scores = turns.map(t => t.score)
  const now = ema(scores)
  if (last.ctxPct >= 60 && now <= base - DROP) return 'refresh'
  if (last.ctxPct >= 50 && now + 3 * trendSlope(scores.slice(-4)) <= base - DROP) return 'refresh'
  return 'none'
}

/** `▰▰▰▱▱ steady` / `falling` for the side pane. */
export function healthLabel(turns: readonly ScoredTurn[]): string {
  if (turns.length === 0) return 'no data yet'
  const scores = turns.map(t => t.score)
  const now = ema(scores)
  const cells = Math.max(0, Math.min(5, Math.round(now * 5)))
  const slope = trendSlope(scores.slice(-4))
  return `${'▰'.repeat(cells)}${'▱'.repeat(5 - cells)} ${slope < -0.03 ? 'falling' : slope > 0.03 ? 'rising' : 'steady'}`
}
