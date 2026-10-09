import type { Effort, Model } from '../types'

export const REPORT_RULE = '\n\nReport back in ≤80 words: result, files touched, blockers. No recap.'

const SEARCH = /\b(find|search|locate|list|grep)\b/i
const HARD = /\b(architect|design|root cause|hard bug)\b/i
const BUILD = /\b(implement|fix|write|test|review)\b/i

/** The cheapest model that fits the agent's job, or null to ask Haiku. */
export function pickAgent(subagentType: string, prompt: string, preferOpus = false): { model: Model; effort: Effort } | null {
  // The agent's type decides first; words in the prompt only break ties.
  if (subagentType === 'Explore') return { model: 'haiku', effort: 'low' }
  if (subagentType === 'Plan' || HARD.test(prompt)) return { model: 'opus', effort: 'high' }
  if (BUILD.test(prompt)) return { model: preferOpus ? 'opus' : 'sonnet', effort: 'medium' }
  if (SEARCH.test(prompt)) return { model: 'haiku', effort: 'low' }
  if (subagentType === 'general-purpose' || subagentType === 'claude') return { model: preferOpus ? 'opus' : 'sonnet', effort: 'medium' }
  return null
}

export const CLASSIFY_LABELS = ['haiku/low', 'sonnet/medium', 'opus/high'] as const

export function fromLabel(label: string | undefined): { model: Model; effort: Effort } | null {
  if (label === 'haiku/low') return { model: 'haiku', effort: 'low' }
  if (label === 'sonnet/medium') return { model: 'sonnet', effort: 'medium' }
  if (label === 'opus/high') return { model: 'opus', effort: 'high' }
  return null
}
