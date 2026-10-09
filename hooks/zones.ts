import type { Meter, Zone } from '../types'

export const ZONE_COLOR: Record<Zone, string> = {
  ok: 'green',
  watch: 'yellow',
  warn: '#ff8700',
  high: 'red',
  danger: 'red',
}

export function zoneOf(pct: number): Zone {
  if (pct >= 95) return 'danger'
  if (pct >= 90) return 'high'
  if (pct >= 80) return 'warn'
  if (pct >= 60) return 'watch'
  return 'ok'
}

export function topPct(m: Meter | null): number {
  if (m === null) return 0
  return Math.max(0, m.ctxPct ?? 0, m.fiveHour?.pct ?? 0, m.weekly?.pct ?? 0)
}

function dayKey(d: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function clock(d: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(d)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('hour')}:${get('minute')}${get('dayPeriod').toLowerCase().startsWith('p') ? 'p' : 'a'}`
}

/** `10:20p` today, `Sat 10:20p` on another day, `soon` when unknown. */
export function formatReset(iso: string | undefined, now: Date, timeZone?: string): string {
  if (iso === undefined) return 'soon'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return 'soon'
  if (dayKey(at, timeZone) === dayKey(now, timeZone)) return clock(at, timeZone)
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(at)
  return `${day} ${clock(at, timeZone)}`
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${Math.round(n)}%`)

/** `Context 42% · 5h 63% ↻10:20p · Week 31%`; a missing figure is `–`. */
export function formatMeter(m: Meter | null, now: Date = new Date(), timeZone?: string): string {
  const five = m?.fiveHour
  const fiveText = five ? `${pct(five.pct)}${five.resetsAt ? ` ↻${formatReset(five.resetsAt, now, timeZone)}` : ''}` : '–'
  return `Context ${pct(m?.ctxPct)} · 5h ${fiveText} · Week ${pct(m?.weekly?.pct)}`
}

/** Five cells, one per 20%: `▰▰▱▱▱`. */
export function meterBar(p: number | null, cells = 5): string {
  const filled = p === null ? 0 : Math.max(0, Math.min(cells, Math.round(p / (100 / cells))))
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

export type BandSegment = { label: string; pct: number | null; bar: string; note?: string }

/** The band's three meters, labelled plainly, each with its bar. */
export function bandSegments(m: Meter | null, now: Date = new Date(), timeZone?: string): BandSegment[] {
  const seg = (label: string, p: number | null | undefined, resetsAt?: string): BandSegment => {
    const value = p ?? null
    const base = { label, pct: value, bar: meterBar(value) }
    return resetsAt === undefined ? base : { ...base, note: `resets ${formatReset(resetsAt, now, timeZone)}` }
  }
  return [
    seg('Context', m?.ctxPct),
    seg('5-hour limit', m?.fiveHour?.pct, m?.fiveHour?.resetsAt),
    seg('Weekly limit', m?.weekly?.pct, m?.weekly?.resetsAt),
  ]
}

const SPARK = '▁▂▃▄▅▆▇█'

/** One cell per value (0–100), eight levels. */
export function sparkline(values: readonly number[]): string {
  return values.map(v => SPARK[Math.max(0, Math.min(7, Math.floor((v / 100) * 7.999)))] ?? '▁').join('')
}

/**
 * How far usage runs ahead (+) or behind (−) the clock in a window: percent
 * used minus percent of the window elapsed. Null without a reset time.
 */
export function pace(pct: number, resetsAt: string | undefined, now: number, windowMs = 5 * 3600_000): number | null {
  if (resetsAt === undefined) return null
  const left = Date.parse(resetsAt) - now
  if (Number.isNaN(left)) return null
  const elapsed = Math.max(0, Math.min(1, 1 - left / windowMs)) * 100
  return Math.round(pct - elapsed)
}
