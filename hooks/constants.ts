import type { MissionSettings } from '../types'

export const DEFAULT_SETTINGS: MissionSettings = {
  router: true,
  pin: null,
  agentCap: 3,
  resume: true,
  alerts: true,
  preferOpus: true,
  layout: 'bar',
  layoutLocked: false,
  approvals: 'ask',
  overlay: true,
}

export const STORE = {
  settings: 'mc.settings',
  resumeAt: 'mc.resumeAt',
  alerted: 'mc.alerted',
  typos: 'mc.typos',
  glossary: 'mc.glossary',
  projects: 'mc.projects',
  never: 'mc.never',
  lastMeter: 'mc.lastMeter',
  costDays: 'mc.costDays',
} as const

export const WINDOW_LABEL: Record<string, string> = { five_hour: '5h', seven_day: 'Weekly' }
export const LIMIT_LABEL: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly' }
