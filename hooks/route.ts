import type { Effort, Model, Route, RouteAgent } from '../types'

const MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus']
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh']
const SIZES: readonly Route['size'][] = ['tiny', 'small', 'medium', 'large']

/** Full ids for model requests; aliases stay internal. */
export const MODEL_ID: Record<Model, string> = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
}

export const isModel = (m: unknown): m is Model => typeof m === 'string' && (MODELS as readonly string[]).includes(m)
export const isEffort = (x: unknown): x is Effort => typeof x === 'string' && (EFFORTS as readonly string[]).includes(x)

export function ROUTER_PROMPT(text: string, meterLine: string): string {
  return [
    "You route a coding request to the right model for the job; opus is the owner's preferred model for big work. Reply with JSON only:",
    '{"size":"tiny|small|medium|large","kind":"question|edit|feature|debug|research|release",',
    ' "model":"haiku|sonnet|opus","effort":"low|medium|high|xhigh","plan":true|false,',
    ' "agents":[{"role":"...","model":"haiku|sonnet|opus","effort":"low|medium|high","why":"..."}],"tasks":["..."]}',
    'tiny: reading, a question, or a one-line change -> haiku/low, no agents.',
    'small: an everyday edit in one file -> sonnet/medium.',
    'medium: several files or a bug to find -> sonnet/high, or opus/high if it touches the owner\'s big projects (Nyx, mission-control).',
    'large: a feature, redesign or anything in the owner\'s big projects -> opus/high, plan true, suggest at most 3 agents.',
    'Use agents only when parts can run in parallel. Searchers are haiku/low.',
    'tasks: list 2-5 separate requests only when the message clearly holds unrelated work (for example one for the mod and one for the AI); otherwise [].',
    `Resources now: ${meterLine}`,
    'Request:',
    text,
  ].join('\n')
}

function parseAgent(a: unknown): RouteAgent | null {
  if (typeof a !== 'object' || a === null) return null
  const o = a as Record<string, unknown>
  if (typeof o.role !== 'string' || !isModel(o.model) || !isEffort(o.effort)) return null
  return { role: o.role, model: o.model, effort: o.effort, why: typeof o.why === 'string' ? o.why : '' }
}

/** The first {...} in the reply (fences allowed); null when it is not a valid route. */
export function parseRoute(raw: string): Route | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
  if (!(SIZES as readonly unknown[]).includes(o.size) || !isModel(o.model) || !isEffort(o.effort)) return null
  const agents = Array.isArray(o.agents)
    ? o.agents.map(parseAgent).filter((a): a is RouteAgent => a !== null).slice(0, 5)
    : []
  return {
    size: o.size as Route['size'],
    kind: typeof o.kind === 'string' ? o.kind : 'task',
    model: o.model,
    effort: o.effort,
    plan: o.plan === true,
    agents,
  }
}

export const stepUp = (m: Model): Model => MODELS[Math.min(MODELS.indexOf(m) + 1, MODELS.length - 1)] ?? m
const stepDown = (m: Model): Model => MODELS[Math.max(MODELS.indexOf(m) - 1, 0)] ?? m
export const effortUp = (x: Effort): Effort => EFFORTS[Math.min(EFFORTS.indexOf(x) + 1, EFFORTS.length - 1)] ?? x
const effortDown = (x: Effort): Effort => EFFORTS[Math.max(EFFORTS.indexOf(x) - 1, 0)] ?? x

/** Cheaper as the 5-hour window fills; a pin always wins. */
export function biasRoute(r: Route, fivePct: number, pin: Model | null, cheapFrom: number): Route {
  if (pin !== null) return { ...r, model: pin }
  let { model, effort } = r
  if (fivePct >= cheapFrom) {
    model = stepDown(model)
    effort = effortDown(effort)
  }
  if (fivePct >= 95 && model === 'opus') model = 'sonnet'
  return model === r.model && effort === r.effort ? r : { ...r, model, effort }
}

export function isSkippable(text: string): boolean {
  const t = text.trim()
  return t.length < 15 || /^(continue|try again|yes|y|ok|go|retry)\b/i.test(t)
}

export function routeLine(r: Route): string {
  const plan = r.plan ? ', plan first' : ''
  const agents = r.agents.length > 0 ? `; suggested agents: ${r.agents.map(a => `${a.role}(${a.model}/${a.effort})`).join(', ')}` : ''
  return `[router] ${r.size} ${r.kind} → ${r.model}/${r.effort}${plan}${agents}`
}
