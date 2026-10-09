export type Win = { pct: number; resetsAt?: string }
export type Meter = {
  ctxPct: number | null
  fiveHour: Win | null
  weekly: Win | null
  costUsd: number | null
  at: number
}
export type Zone = 'ok' | 'watch' | 'warn' | 'high' | 'danger'
export type Model = 'haiku' | 'sonnet' | 'opus'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh'
export type RouteAgent = { role: string; model: Model; effort: Effort; why: string }
export type Route = {
  size: 'tiny' | 'small' | 'medium' | 'large'
  kind: string
  model: Model
  effort: Effort
  plan: boolean
  agents: RouteAgent[]
}
export type Limited = { kind: 'five_hour' | 'seven_day'; until: number; resetsAt: string | null; sid?: string }
export type MissionSettings = {
  router: boolean
  pin: Model | null
  agentCap: number
  resume: boolean
  alerts: boolean
  preferOpus: boolean
  layout: 'bar' | 'side' | 'compact'
  layoutLocked: boolean
  approvals: 'ask' | 'auto'
  overlay: boolean
}
export type Midnight = {
  endsAt: number
  budgetPct: number
  ship: boolean
  errorsInRow: number
  turns: number
}
export type God = { endsAt: number }
export type TurnRecord = {
  turnId: string
  outputTokens: number
  words: number
  size: Route['size'] | null
  flag: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'mission-control': {
      meter: Meter | null
      acked: boolean
      pulseOn: boolean
      route: Route | null
      limited: Limited | null
      settings: MissionSettings
      midnight: Midnight | null
      turns: TurnRecord[]
      agentsLive: number
      god: God | null
      godLog: string[]
      progress: { done: number; total: number }
      comms: string[]
      health: { score: number; ctxPct: number }[]
      split: string[]
      proof: string | null
      trend: number[]
      staleMeter: boolean
      notes: string[]
      agentMeta: Record<string, { model: string; effort: string }>
    }
  }
}
