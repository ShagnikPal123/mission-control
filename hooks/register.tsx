import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, PromptSubmitInput, Register, SessionMeasureInput } from 'claude-code'

import type { Effort, Limited, Meter, Model, MissionSettings, Win } from '../types'
import { DEFAULT_SETTINGS, LIMIT_LABEL, STORE, WINDOW_LABEL } from './constants'
import { CLASSIFY_LABELS, fromLabel, pickAgent, REPORT_RULE } from './agents'
import { biasRoute, effortUp, isEffort, isModel, isSkippable, MODEL_ID, parseRoute, ROUTER_PROMPT, routeLine, stepUp } from './route'
import { classifyCall, deletesOutside, gitRepoOf, hasSecret, isOwnerOrigin, isPushOrDeploy, midnightStop, parseMidnightArgs, shellCommand } from './risk'
import { BREVITY, flagTurn, tokenReportText, wordCount } from './waste'
import { CORRECTION, healthAction, healthLabel, scoreTurn } from './health'
import { meterBar } from './zones'
import { autocorrect, DEFAULT_GLOSSARY, glossaryHints } from './lang'
import { autoProject, DEFAULT_NEVER, groupNameFor, projectFor, shipText, trackedForbidden } from './projects'
import type { Project } from './projects'
import { proofCard } from './proof'
import type { ToolRecord } from './proof'
import { nextTaskText, parseTasks, splitLine, tasksFromReply, wantsTogether } from './split'
import { bandSegments, formatMeter, formatReset, pace, sparkline, topPct, ZONE_COLOR, zoneOf } from './zones'

// Mission Control. Everything that touches `$` lives in this one module: the
// engine follows `$` only into functions of the same file and allows one
// unmatched hook per event. Pure logic lives beside it (zones.ts, ...).

// ── State ────────────────────────────────────────────────────────────────
const meterAtom = atom({ plugin: 'mission-control', key: 'meter' } as const, null)
const ackedAtom = atom({ plugin: 'mission-control', key: 'acked' } as const, false)
const pulseAtom = atom({ plugin: 'mission-control', key: 'pulseOn' } as const, false)
const routeAtom = atom({ plugin: 'mission-control', key: 'route' } as const, null)
const limitedAtom = atom({ plugin: 'mission-control', key: 'limited' } as const, null)
const midnightAtom = atom({ plugin: 'mission-control', key: 'midnight' } as const, null)
const settingsAtom = atom({ plugin: 'mission-control', key: 'settings' } as const, DEFAULT_SETTINGS)
const turnsAtom = atom({ plugin: 'mission-control', key: 'turns' } as const, [])
const godAtom = atom({ plugin: 'mission-control', key: 'god' } as const, null)
const godLogAtom = atom({ plugin: 'mission-control', key: 'godLog' } as const, [])
const progressAtom = atom({ plugin: 'mission-control', key: 'progress' } as const, { done: 0, total: 0 })
const commsAtom = atom({ plugin: 'mission-control', key: 'comms' } as const, [])
const healthAtom = atom({ plugin: 'mission-control', key: 'health' } as const, [])
const splitAtom = atom({ plugin: 'mission-control', key: 'split' } as const, [])
const proofAtom = atom({ plugin: 'mission-control', key: 'proof' } as const, null)
const trendAtom = atom({ plugin: 'mission-control', key: 'trend' } as const, [])
const staleAtom = atom({ plugin: 'mission-control', key: 'staleMeter' } as const, false)
const notesAtom = atom({ plugin: 'mission-control', key: 'notes' } as const, [])
const agentsLiveAtom = atom({ plugin: 'mission-control', key: 'agentsLive' } as const, 0)

// Module memory: what the owner and the agents are on (rebuilt after a reload).
let lastOwnerPrompt = ''
let currentTodo: string | null = null
const taskSubjects = new Map<string, string>()
let statusFileFailed = false
let pulseTimer: { cancel: () => void } | null = null
let lastOwnerAt: number | null = null // when the owner last typed; null until they do this session
let turnRecords: ToolRecord[] = [] // this turn's tool calls, for the proof card and health
let refreshStage: 'idle' | 'asked' = 'idle'
let nudgeQueued = false // one plugin prompt per turn end: health, then split, then midnight
let splitQueue: string[] = []
let splitTotal = 0
let ownerTypos: Record<string, string> = {}
let projects: Project[] = []
let neverShip: string[] = [...DEFAULT_NEVER]
let sessionCwd = ''
let sorted = false // this chat filed under its project group
let sessionKey = ''
let docs: string[] = ['.mission-control/HANDOFF.md', 'MIDNIGHT_LOG.md']
let ownerGlossary: Record<string, string> = { ...DEFAULT_GLOSSARY }

/** The clock, or the wall clock where a host has none. */
async function nowOr($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

// ── MissionSettings ─────────────────────────────────────────────────────────────
async function loadSettings($: EngineInterface): Promise<MissionSettings> {
  let stored: unknown
  try {
    stored = await $.store.get(STORE.settings)
  } catch {
    stored = undefined
  }
  const merged: MissionSettings = {
    ...DEFAULT_SETTINGS,
    ...(typeof stored === 'object' && stored !== null ? (stored as Partial<MissionSettings>) : {}),
  }
  await update($, settingsAtom, () => merged)
  return merged
}

// ── A. Resource meter ────────────────────────────────────────────────────
function win(e: SessionMeasureInput, kind: string): Win | null {
  const w = e.rateLimits.find(r => r.kind === kind)
  if (w === undefined) return null
  return w.resetsAt === undefined ? { pct: w.percentUsed } : { pct: w.percentUsed, resetsAt: w.resetsAt }
}

function toMeter(e: SessionMeasureInput, at: number): Meter {
  return {
    ctxPct: e.context.percent ?? null,
    fiveHour: win(e, 'five_hour'),
    weekly: win(e, 'seven_day'),
    costUsd: e.cost?.usd ?? null,
    at,
  }
}

/** Shared with the Phase 2 pane and the Phase 5 overlay; never fatal. */
async function writeStatusFile($: EngineInterface): Promise<void> {
  try {
    let agents: AgentInfo[] = []
    try {
      agents = await $.agent.list()
    } catch {
      agents = []
    }
    const live = agents.filter(a => a.status === 'pending' || a.status === 'running' || a.status === 'waiting').length
    await update($, agentsLiveAtom, () => live)
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (home === undefined) return
    const status = {
      meter: await read($, meterAtom),
      route: await read($, routeAtom),
      limited: await read($, limitedAtom),
      midnight: await read($, midnightAtom),
      god: await read($, godAtom),
      settings: await read($, settingsAtom),
      agents,
    }
    await $.fs.write(`${home.replace(/\\/g, '/')}/.claude/mission-control/status.json`, JSON.stringify(status, null, 2))
  } catch (err) {
    if (!statusFileFailed) {
      statusFileFailed = true
      $.ui.log(`mission-control: status.json not written (${String(err).slice(0, 120)})`)
      await update($, notesAtom, n => [...n, 'status.json could not be written (overlay will be blank)'].slice(-5))
    }
  }
}

async function meterOnMeasure($: EngineInterface, e: SessionMeasureInput): Promise<void> {
  const meter = toMeter(e, Date.now())
  await update($, meterAtom, () => meter)
  await update($, staleAtom, () => false)
  if (meter.ctxPct !== null) {
    const c = meter.ctxPct
    await update($, trendAtom, t => (t.at(-1) === c ? t : [...t, c].slice(-12)))
  }
  try {
    await $.store.set(STORE.lastMeter, meter)
    if (meter.costUsd !== null && sessionKey !== '') {
      const day = new Date().toISOString().slice(0, 10)
      const days = ((await $.store.get(STORE.costDays)) ?? {}) as Record<string, Record<string, number>>
      days[day] = { ...(days[day] ?? {}), [sessionKey]: meter.costUsd }
      const keep = Object.keys(days).sort().slice(-14)
      await $.store.set(STORE.costDays, Object.fromEntries(keep.map(k => [k, days[k] ?? {}])))
    }
  } catch {
    // The cache is a convenience.
  }
  $.ui.status(formatMeter(meter))
  await writeStatusFile($)
}

// ── Band pulse ───────────────────────────────────────────────────────────
/** Toggles once a second while in danger and not acknowledged. */
function startPulse($: EngineInterface): void {
  try {
    pulseTimer?.cancel()
    pulseTimer = $.clock.every(1000, () => {
    void (async () => {
      const zone = zoneOf(topPct(await read($, meterAtom)))
      if (zone !== 'danger') {
        if (await read($, ackedAtom)) await update($, ackedAtom, () => false)
        if (await read($, pulseAtom)) await update($, pulseAtom, () => false)
        return
      }
      const acked = await read($, ackedAtom)
      await update($, pulseAtom, lit => (acked ? false : !lit))
    })()
    })
  } catch {
    // No clock (a headless host): the band simply does not pulse.
  }
}

// ── E. Alerts ────────────────────────────────────────────────────────────
function currentTask(): string {
  if (currentTodo !== null) return currentTodo
  if (lastOwnerPrompt !== '') return lastOwnerPrompt.replace(/\s+/g, ' ').slice(0, 40)
  return 'idle'
}

/** The owner's own prompt: typed, from the phone, or with no origin stamped. */
function isOwner(e: PromptSubmitInput): boolean {
  const kind = e.origin?.kind
  return kind === undefined || kind === 'composer' || kind === 'bridge'
}

function noteOwnerPrompt(e: PromptSubmitInput): void {
  if (isOwner(e)) lastOwnerPrompt = e.text
}

/** Once per key (a window and threshold); push to the phone, else a toast. */
async function sendAlert($: EngineInterface, key: string, text: string): Promise<'pushed' | 'toasted' | 'skipped'> {
  const settings = await read($, settingsAtom)
  if (!settings.alerts) return 'skipped'
  let alerted: string[] = []
  try {
    const stored = await $.store.get(STORE.alerted)
    if (Array.isArray(stored)) alerted = stored.filter((k): k is string => typeof k === 'string')
  } catch {
    alerted = []
  }
  if (alerted.includes(key)) return 'skipped'
  try {
    await $.store.set(STORE.alerted, [...alerted, key].slice(-200))
  } catch {
    // Without the store an alert may repeat after a restart; better than none.
  }
  try {
    const ran = await $.tool.call({ tool: 'PushNotification', message: text.slice(0, 200), status: 'proactive' })
    if (ran.deny === undefined) return 'pushed'
  } catch {
    // Fall through to the toast.
  }
  $.ui.toast(text, { timeoutMs: 8000 })
  return 'toasted'
}

async function alertsOnMeasure($: EngineInterface, e: SessionMeasureInput): Promise<void> {
  for (const w of e.rateLimits) {
    const label = WINDOW_LABEL[w.kind]
    if (label === undefined || w.percentUsed < 90) continue
    await sendAlert(
      $,
      `${w.kind}:${w.resetsAt ?? 'none'}:90`,
      `${label} at 90% · resets ${formatReset(w.resetsAt, new Date())} · now: ${currentTask()}`,
    )
  }
}

// ── B. Limit guard and auto-resume ───────────────────────────────────────
const MIN = 60_000
const GOOD_MORNING =
  "Good morning — usage has reset. Continue where you left off, using any messages I sent while you were paused, and keep going on your own until I'm back."
const RESUME_TEXT = 'Auto-resumed after the usage reset. Continue where you left off.'
const RETRY = /^\s*(try again|continue|retry)[.!]?\s*$/i
let resumeTimer: { cancel: () => void } | null = null

const atTime = (ms: number, now: number) => formatReset(new Date(ms).toISOString(), new Date(now))

function limitFrom(kind: string, resetsAt: string | undefined, now: number): Limited {
  const reset = resetsAt === undefined ? Number.NaN : Date.parse(resetsAt)
  return {
    kind: kind === 'seven_day' ? 'seven_day' : 'five_hour',
    until: Number.isNaN(reset) ? now + 15 * MIN : reset + MIN,
    resetsAt: resetsAt ?? null,
  }
}

async function sessionId($: EngineInterface): Promise<string | undefined> {
  try {
    return await $.session.id()
  } catch {
    return undefined
  }
}

async function saveLimit($: EngineInterface, l: Limited | null): Promise<void> {
  await update($, limitedAtom, () => l)
  try {
    if (l === null) await $.store.delete(STORE.resumeAt)
    else await $.store.set(STORE.resumeAt, { ...l, sid: await sessionId($) })
  } catch {
    // The timer still runs this session; only a restart would lose it.
  }
}

async function onLimitHit($: EngineInterface, kind: string, resetsAt: string | undefined): Promise<void> {
  const now = await $.clock.now()
  const l = limitFrom(kind, resetsAt, now)
  const prev = await read($, limitedAtom)
  if (prev !== null && now < prev.until) return
  await saveLimit($, l)
  const when = atTime(l.until, now)
  $.ui.toast(`${LIMIT_LABEL[l.kind]} limit reached · resets ${when} · I'll continue automatically.`, { timeoutMs: 10000 })
  let running = ''
  try {
    running = (await $.agent.list())
      .filter(a => a.status === 'running')
      .map(a => ` · ${a.description}: running`)
      .join('')
  } catch {
    running = ''
  }
  await sendAlert($, `${l.kind}:${l.resetsAt ?? l.until}:limit`, `Limit hit · resumes ${when} · main: ${currentTask()}${running}`)
  await armResume($, l)
}

async function armResume($: EngineInterface, l: Limited): Promise<void> {
  resumeTimer?.cancel()
  const now = await $.clock.now()
  resumeTimer = $.clock.after(Math.max(0, l.until - now), () => {
    void fireResume($)
  })
}

async function fireResume($: EngineInterface): Promise<void> {
  resumeTimer = null
  const l = await read($, limitedAtom)
  if (l === null) return
  const settings = await read($, settingsAtom)
  const midnight = await read($, midnightAtom)
  if (!settings.resume && midnight === null) {
    await saveLimit($, null)
    return
  }
  // No request is made while we wait, so the last reading stays at 100: trust it
  // only while the window's own reset time is still ahead.
  let stillLimited = false
  try {
    const t = await $.clock.now()
    stillLimited = (await $.session.usage()).rateLimits.some(
      r => r.percentUsed >= 100 && r.resetsAt !== undefined && Date.parse(r.resetsAt) > t,
    )
  } catch {
    stillLimited = false
  }
  if (stillLimited) {
    const again: Limited = { ...l, until: (await $.clock.now()) + 15 * MIN }
    await saveLimit($, again)
    await armResume($, again)
    return
  }
  await saveLimit($, null)
  await sendAlert($, `${l.kind}:${l.until}:resumed`, `Resumed after reset · continuing ${currentTask()}`)
  const now = await nowOr($)
  if (lastOwnerAt !== null && now - lastOwnerAt >= 30 * MIN) {
    await $.prompt.submit({ text: GOOD_MORNING })
    await startAutoRun($)
    return
  }
  await $.prompt.submit({ text: RESUME_TEXT })
}

async function guardOnMeasure($: EngineInterface, e: SessionMeasureInput): Promise<void> {
  const hit = e.rateLimits.find(r => r.percentUsed >= 100)
  if (hit !== undefined) {
    await onLimitHit($, hit.kind, hit.resetsAt)
    return
  }
  if (e.rateLimits.length > 0 && (await read($, limitedAtom)) !== null) {
    resumeTimer?.cancel()
    resumeTimer = null
    await saveLimit($, null)
  }
}

async function guardOnError($: EngineInterface): Promise<void> {
  const meter = await read($, meterAtom)
  const near = [
    { kind: 'five_hour', w: meter?.fiveHour },
    { kind: 'seven_day', w: meter?.weekly },
  ].find(x => (x.w?.pct ?? 0) >= 99)
  if (near !== undefined) await onLimitHit($, near.kind, near.w?.resetsAt)
}

async function rearmFromStore($: EngineInterface): Promise<void> {
  let stored: unknown
  try {
    stored = await $.store.get(STORE.resumeAt)
  } catch {
    return
  }
  if (typeof stored !== 'object' || stored === null || typeof (stored as Limited).until !== 'number') return
  const l = stored as Limited
  const sid = await sessionId($)
  if (l.sid !== undefined && sid !== undefined && l.sid !== sid) return
  await update($, limitedAtom, () => l)
  await armResume($, l)
}

/** A bare "try again" while limited would only fail again: hold it. */
async function holdRetry($: EngineInterface, e: PromptSubmitInput): Promise<string | null> {
  if (e.origin?.kind === 'plugin' || !RETRY.test(e.text)) return null
  const l = await read($, limitedAtom)
  const now = await $.clock.now()
  if (l === null || now >= l.until) return null
  return `Still limited until ${atTime(l.until, now)}. Auto-resume is queued.`
}

// ── C. Model/effort router (main agent) ──────────────────────────────────
let turnFails = 0
let streakBumped = false
let modelRaised = false
let turnModel: Model | null = null
let turnPinned = false
let turnEffort: Effort | null = null

/** Context lines for an owner's prompt: the route, then the resources. */
async function routeOnSubmit($: EngineInterface, e: PromptSubmitInput): Promise<string[]> {
  const meter = await read($, meterAtom)
  const resources = `[resources] ${formatMeter(meter)}`
  const settings = await read($, settingsAtom)
  if (!isOwner(e) || !settings.router || isSkippable(e.text)) return [resources]
  const midnight = await read($, midnightAtom)
  const r = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 400,
    timeoutMs: 8000,
    prompt: ROUTER_PROMPT(e.text.slice(0, 4000), formatMeter(meter)),
  })
  const parsed = r.isAnswered ? parseRoute(r.text) : null
  if (parsed === null) {
    await update($, routeAtom, () => null)
    $.ui.toast('router: kept current model', { timeoutMs: 3000 })
    return [resources]
  }
  const route = biasRoute(parsed, meter?.fiveHour?.pct ?? 0, settings.pin, midnight === null ? 80 : 70)
  await update($, routeAtom, () => route)
  const tasks = parseTasks(tasksFromReply(r.isAnswered ? r.text : ''))
  if (tasks.length > 1 && !wantsTogether(e.text)) {
    splitQueue = tasks.slice(1)
    splitTotal = tasks.length
    await update($, splitAtom, () => [...splitQueue])
    await sortChat($, route.kind)
    return [routeLine(route), splitLine(tasks), resources]
  }
  await sortChat($, route.kind)
  return [routeLine(route), resources]
}

function resetTurn(): void {
  turnFails = 0
  streakBumped = false
  modelRaised = false
  turnModel = null
  turnEffort = null
}

function noteToolResult(isError: boolean): void {
  if (isError) {
    turnFails += 1
  } else {
    turnFails = 0
    streakBumped = false
  }
}

/**
 * What the main loop's next request should name, or null to leave it. The
 * model is chosen on the turn's first step only (a switch drops the prompt
 * cache); later steps may only escalate after failures.
 */
async function stepChoice($: EngineInterface, index: number, effort: unknown): Promise<{ model: string; effort?: Effort } | null> {
  if (index === 0) {
    const settings = await read($, settingsAtom)
    if (!settings.router) {
      turnModel = null
      return null
    }
    const route = await read($, routeAtom)
    const base: Model | undefined = settings.pin ?? route?.model
    if (base === undefined) {
      turnModel = null
      return null
    }
    turnModel = base
    turnPinned = settings.pin !== null
    turnEffort = route?.effort ?? (isEffort(effort) ? effort : null)
  } else {
    if (turnModel === null) return null
    if (turnFails >= 3 && !modelRaised && !turnPinned) {
      turnModel = stepUp(turnModel)
      modelRaised = true
    }
    if (turnFails >= 2 && !streakBumped && turnEffort !== null) {
      turnEffort = effortUp(turnEffort)
      streakBumped = true
    }
  }
  const model = MODEL_ID[turnModel]
  return turnEffort === null ? { model } : { model, effort: turnEffort }
}

// ── C2. Subagents: model per job, agent cap, short reports ───────────────
const agentEffort = new Map<string, Effort>()
let spawning = 0
const LIVE = new Set(['pending', 'running', 'waiting'])

async function effectiveCap($: EngineInterface): Promise<number> {
  if ((await read($, midnightAtom)) !== null) return 2
  if (((await read($, meterAtom))?.fiveHour?.pct ?? 0) >= 85) return 1
  return (await read($, settingsAtom)).agentCap
}

async function runningCount($: EngineInterface): Promise<number> {
  try {
    return (await $.agent.list()).filter(a => LIVE.has(a.status)).length
  } catch {
    return 0
  }
}

async function chooseAgent($: EngineInterface, subagentType: string, prompt: string): Promise<{ model: Model; effort: Effort }> {
  const picked = pickAgent(subagentType, prompt, (await read($, settingsAtom)).preferOpus)
  if (picked !== null) return picked
  try {
    const label = await $.model.classify(prompt.slice(0, 2000), CLASSIFY_LABELS)
    const chosen = fromLabel(label)
    if (chosen !== null) return chosen
  } catch {
    // Fall back below.
  }
  return { model: 'sonnet', effort: 'medium' }
}

// ── D. Token waste ───────────────────────────────────────────────────────
let lastAnswer: string | null = null

async function recordTurn($: EngineInterface, turnId: string, answer: string, outputTokens: number): Promise<void> {
  const route = await read($, routeAtom)
  const words = wordCount(answer)
  const size = route?.size ?? null
  const flag = flagTurn({ words, size }, lastAnswer, answer)
  lastAnswer = answer
  await update($, turnsAtom, list => [...list, { turnId, outputTokens, words, size, flag }].slice(-50))
}

// ── G. Midnight mode ─────────────────────────────────────────────────────
const HOUR = 60 * MIN
let midnightOn = false // a sync mirror, so a failed guard can fail closed only while on
const NUDGE_TEXT =
  'Midnight: continue with the next unfinished item. If none is left: optimize and test what was built this run, then write new ideas to MIDNIGHT_LOG.md under Ideas and build the small, safe ones.'

/** Queue a prompt once the current hook has returned (a command cannot wait on its own turn). */
function submitSoon($: EngineInterface, text: string): void {
  $.clock.after(250, () => {
    void $.prompt.submit({ text })
  })
}

function midnightSection(ship: boolean): string {
  return [
    'The owner is away (midnight mode). Do not ask questions: choose the recommended option and keep going.',
    'Log each non-trivial decision as one line in MIDNIGHT_LOG.md at the project root: time, decision, reason.',
    `Do not push, deploy, publish, or delete outside the project${ship ? ' except as allowed by --ship after the secret scan' : ''}.`,
    'When nothing is left to do and optimisation/tests are done, end your message with MIDNIGHT_DONE.',
  ].join('\n')
}

async function startMidnight($: EngineInterface, args: string): Promise<string> {
  const parsed = parseMidnightArgs(args)
  if (parsed === 'off') {
    await stopMidnight($, 'stopped by owner')
    return 'Midnight off.'
  }
  const now = await $.clock.now()
  await update($, midnightAtom, () => ({ endsAt: now + parsed.hours * HOUR, budgetPct: 85, ship: parsed.ship, errorsInRow: 0, turns: 0 }))
  midnightOn = true
  try {
    await $.mcp.call('ccd_host', 'request_keep_awake', {})
  } catch {
    // Keep-awake is best effort; the run still goes while the PC is awake.
  }
  submitSoon($, NUDGE_TEXT)
  return `🌙 Midnight on for ${parsed.hours}h · weekly budget 85%${parsed.ship ? ' · shipping allowed' : ''}.`
}

async function stopMidnight($: EngineInterface, why: string): Promise<void> {
  const m = await read($, midnightAtom)
  midnightOn = false
  if (m === null) return
  await update($, midnightAtom, () => null)
  submitSoon(
    $,
    `Midnight run ended (${why}). Write the morning report at the end of MIDNIGHT_LOG.md: done, failed, decisions, ideas. 120 words max. Then stop.`,
  )
  await sendAlert($, `midnight:${m.endsAt}:done`, `🌙 Midnight done (${why}) · ${m.turns} turns · see MIDNIGHT_LOG.md`)
}

async function midnightOnTurn($: EngineInterface, reason: string, answer: string): Promise<void> {
  const m = await read($, midnightAtom)
  if (m === null || reason === 'aborted') return
  if ((await read($, limitedAtom)) !== null) return // the guard resumes; not an error of the run
  const next = { ...m, turns: m.turns + 1, errorsInRow: reason === 'error' || reason === 'refusal' ? m.errorsInRow + 1 : 0 }
  await update($, midnightAtom, () => next)
  const meter = await read($, meterAtom)
  const why = midnightStop(next, await $.clock.now(), meter?.weekly?.pct ?? 0, answer)
  if (why !== null) {
    await stopMidnight($, why)
    return
  }
  if ((meter?.ctxPct ?? 0) >= 70) {
    try {
      await $.session.compact()
    } catch {
      // Auto-compact still catches it later.
    }
  }
  // A running agent's completion notice starts the next turn; nudging now
  // would only spin empty turns while it works.
  if ((await runningCount($)) > 0 || nudgeQueued) return
  nudgeQueued = true
  submitSoon($, NUDGE_TEXT)
}

/** Why a shell command is refused during midnight, or null. */
async function midnightGuard($: EngineInterface, command: string): Promise<string | null> {
  const m = await read($, midnightAtom)
  if (m === null) return GIT_PUSH.test(command) ? await shipCheck($, command, false) : null
  if (isPushOrDeploy(command)) {
    if (!m.ship) return 'Midnight: push/deploy needs --ship.'
    const refused = await shipCheck($, command, true)
    if (refused !== null) return refused
  }
  if (deletesOutside(command, await $.session.root())) return 'Midnight: delete outside the project refused.'
  return null
}

// ── Q. Local config: the owner's own words, docs and projects ────────────
/** `~/.claude/mission-control/config.json`: never part of the published mod. */
async function loadLocalConfig($: EngineInterface): Promise<void> {
  try {
    const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    if (home === undefined) return
    const raw = await $.fs.read(`${home.replace(/\\/g, '/')}/.claude/mission-control/config.json`)
    const c = JSON.parse(raw) as { glossary?: Record<string, string>; docs?: string[]; projects?: Project[] }
    if (c.glossary !== undefined) ownerGlossary = { ...ownerGlossary, ...c.glossary }
    if (Array.isArray(c.docs)) docs = [...new Set([...c.docs, ...docs])]
    if (Array.isArray(c.projects)) projects = [...c.projects, ...projects.filter(p => !c.projects?.some(q => q.name === p.name))]
  } catch {
    // No local config: the generic defaults stand.
  }
}

// ── P. Overlay: the top-centre pill outside Claude (Windows) ──────────────
async function launchOverlay($: EngineInterface): Promise<void> {
  try {
    if (!(await read($, settingsAtom)).overlay) return
    if ((await $.env.get('OS')) !== 'Windows_NT') return
    const script = `${$.plugin.root.replace(/\//g, '\\')}\\overlay\\mc_overlay.py`
    // `start` detaches it; the overlay keeps a single instance itself.
    await $.process.run(['cmd', '/c', 'start', '', 'pythonw', script])
  } catch {
    await update($, notesAtom, n => [...n, 'overlay did not start (is Python on PATH?)'].slice(-5))
  }
}

// ── O. Projects, chat sorting, and the ship check ─────────────────────────
const GIT_PUSH = /\bgit(?:\.exe)?\b[^\n]*\bpush\b/i

async function loadProjects($: EngineInterface): Promise<void> {
  try {
    const p = await $.store.get(STORE.projects)
    if (Array.isArray(p)) projects = p as Project[]
    const n = await $.store.get(STORE.never)
    if (Array.isArray(n)) neverShip = [...new Set([...DEFAULT_NEVER, ...(n as string[])])]
  } catch {
    // Defaults only.
  }
}

/** Why a push must not go out, or null. `failClosed` refuses when git cannot answer. */
async function shipCheck($: EngineInterface, command: string, failClosed: boolean): Promise<string | null> {
  const repo = gitRepoOf(command)
  const at = repo === undefined ? [] : ['-C', repo]
  const cannot = failClosed ? 'Midnight: could not verify the push (git check failed); refused.' : null
  try {
    const tracked = await $.process.run(['git', ...at, 'ls-files'])
    if (tracked.exitCode !== 0) return cannot
    const bad = trackedForbidden(tracked.stdout.split('\n'), neverShip)
    if (bad.length > 0) {
      return `Ship check: ${bad.slice(0, 3).join(', ')} is tracked and must never be pushed. Untrack it (git rm --cached) first.`
    }
    const outgoing = await $.process.run(['git', ...at, 'log', '-p', 'HEAD', '--not', '--remotes'])
    if (outgoing.exitCode !== 0) return cannot
    if (hasSecret(outgoing.stdout)) return 'Ship check: a secret-like string is in the commits to push; push refused.'
    return null
  } catch {
    return cannot
  }
}

function mcpText(r: { content: readonly { type: string; text?: string }[] }): string {
  return r.content.map(c => c.text ?? '').join('')
}

/** File this chat under "<project> · Updates|Questions", once per session; best effort. */
async function sortChat($: EngineInterface, kind: string): Promise<void> {
  if (sorted || sessionCwd === '') return
  sorted = true
  const project = projectFor(sessionCwd, projects) ?? autoProject(sessionCwd)
  const name = groupNameFor(project.name, kind)
  try {
    const groups = JSON.parse(mcpText(await $.mcp.call('ccd_sidebar', 'list_groups', {})) || '[]') as { id: string; name: string }[]
    let id = groups.find(g => g.name === name)?.id
    if (id === undefined) id = (JSON.parse(mcpText(await $.mcp.call('ccd_sidebar', 'create_group', { name }))) as { id: string }).id
    await $.mcp.call('ccd_sidebar', 'move_sessions', { session_ids: ['self'], group_id: id })
  } catch {
    await update($, notesAtom, n => [...n, `chat not filed under "${name}" (no sidebar here)`].slice(-5))
  }
}

async function shipCommand($: EngineInterface, args: string): Promise<string> {
  const a = args.trim()
  const never = /^never\s+(\S+)$/.exec(a)
  if (never?.[1] !== undefined) {
    neverShip = [...new Set([...neverShip, never[1]])]
    try {
      await $.store.set(STORE.never, neverShip.filter(p => !DEFAULT_NEVER.includes(p)))
    } catch {
      // Kept for this session.
    }
    return `Never shipping: ${never[1]}`
  }
  if (a === 'never') return `Never shipped: ${neverShip.join(', ')}`
  if (a !== '') return 'Usage: /ship | /ship never <pattern> | /ship never'
  submitSoon($, shipText(neverShip))
  return 'Ship checklist queued.'
}

async function projectCommand($: EngineInterface, args: string): Promise<string> {
  const add = /^add\s+(.+?)\s*=\s*(.+)$/.exec(args.trim())
  if (add?.[1] !== undefined && add[2] !== undefined) {
    projects = [...projects.filter(p => p.name !== add[1]), { name: add[1], path: add[2] }]
    try {
      await $.store.set(STORE.projects, projects)
    } catch {
      // Kept for this session.
    }
    return `Project "${add[1]}" = ${add[2]}`
  }
  const here = projectFor(sessionCwd, projects) ?? autoProject(sessionCwd)
  return [`This chat: ${here.name}`, ...projects.map(p => `• ${p.name} — ${p.path}`), 'Add one: /project add <name> = <folder>'].join('\n')
}

// ── H. God mode ──────────────────────────────────────────────────────────
let godTimer: { cancel: () => void } | null = null

function callSummary(tool: string, input: unknown): string {
  const o = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const pick = o.command ?? o.file_path ?? o.url ?? o.pattern
  return `${tool} ${typeof pick === 'string' ? pick : JSON.stringify(input) ?? ''}`.replace(/\s+/g, ' ').slice(0, 80)
}

/** Only after the owner says "Turn on" in the pop-up. */
async function startGod($: EngineInterface, minutes: number): Promise<string> {
  const m = Math.max(1, Math.min(480, Math.round(minutes)))
  let answer = ''
  try {
    answer = await $.ui.ask(`Turn on God mode for ${m} min? Claude will run tools without asking. Hard stops still ask.`, ['Turn on', 'Cancel'])
  } catch {
    answer = ''
  }
  if (answer !== 'Turn on') return 'God mode stays off.'
  const now = await $.clock.now()
  await update($, godAtom, () => ({ endsAt: now + m * MIN }))
  godTimer?.cancel()
  godTimer = $.clock.after(m * MIN, () => {
    void stopGod($, 'time up')
  })
  $.ui.toast(`⚡ God mode on for ${m} min. Hard stops still ask.`, { timeoutMs: 6000 })
  return `⚡ God mode on for ${m} min.`
}

async function stopGod($: EngineInterface, why: string): Promise<void> {
  godTimer?.cancel()
  godTimer = null
  if ((await read($, godAtom)) === null) return
  await update($, godAtom, () => null)
  $.ui.toast(`⚡ God mode off (${why}).`, { timeoutMs: 6000 })
}

/** Haiku's yes/no: does this medium-risk call match what the owner asked for? */
async function fishyOk($: EngineInterface, tool: string, input: unknown): Promise<boolean> {
  const o = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const r = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 5,
    timeoutMs: 6000,
    prompt: [
      `The owner asked: ${lastOwnerPrompt.slice(0, 1500) || '(nothing recorded)'}`,
      `The assistant wants to run: ${callSummary(tool, input)}`,
      `Its stated purpose: ${typeof o.description === 'string' ? o.description : '(none)'}`,
      'Does this action match what the owner asked for? Answer yes or no.',
    ].join('\n'),
  })
  return r.isAnswered && /^\s*yes\b/i.test(r.text)
}

/** God mode's verdict for a tool call, or null to leave it to the normal decision. */
async function godVerdict($: EngineInterface, tool: string, input: unknown): Promise<'allow' | null> {
  const g = await read($, godAtom)
  if (g === null) return null
  const now = await $.clock.now()
  if (now >= g.endsAt) {
    await stopGod($, 'time up')
    return null
  }
  let root = ''
  try {
    root = await $.session.root()
  } catch {
    root = ''
  }
  const risk = classifyCall(tool, input, root)
  if (risk === 'hard-stop') return null
  if (risk === 'medium' && !(await fishyOk($, tool, input))) return null
  const stamp = new Date(now).toISOString().slice(11, 16)
  await update($, godLogAtom, log => [...log, `${stamp} ${callSummary(tool, input)}`].slice(-200))
  return 'allow'
}

async function godCommand($: EngineInterface, args: string, ownerKind: string | undefined): Promise<string> {
  const a = args.trim().toLowerCase()
  if (a === 'off') {
    await stopGod($, 'stopped by owner')
    return 'God mode off.'
  }
  if (a === 'log') {
    const log = await read($, godLogAtom)
    return log.length === 0 ? 'God mode log is empty.' : log.slice(-20).join('\n')
  }
  if (!isOwnerOrigin(ownerKind)) return 'God mode can only be turned on by the owner.'
  const minutes = Number(/^\d+$/.test(a) ? a : 60)
  return startGod($, minutes)
}

// ── F. /mc ───────────────────────────────────────────────────────────────
const MC_USAGE = 'Usage: /mc [model pin <haiku|sonnet|opus> | model auto | agents <1-10> | resume on|off | alerts on|off | tokens]'

async function saveSettings($: EngineInterface, s: MissionSettings): Promise<void> {
  await update($, settingsAtom, () => s)
  try {
    await $.store.set(STORE.settings, s)
  } catch {
    // Holds for this session; it just will not survive a restart.
  }
}

async function mcStatus($: EngineInterface): Promise<string> {
  const settings = await read($, settingsAtom)
  const route = await read($, routeAtom)
  const limited = await read($, limitedAtom)
  const midnight = await read($, midnightAtom)
  const god = await read($, godAtom)
  const now = await $.clock.now().catch(() => Date.now())
  const router = !settings.router ? 'off' : settings.pin !== null ? `pinned ${settings.pin}` : 'on (auto)'
  const lines = [
    formatMeter(await read($, meterAtom)),
    `Router: ${router}${route !== null && settings.router ? ` · ${routeLine(route)}` : ''}`,
    `Agents: ${await read($, agentsLiveAtom)}/${await effectiveCap($)}`,
    `Auto-resume: ${settings.resume ? 'on' : 'off'}${limited !== null ? ` · limited until ${atTime(limited.until, now)}` : ''}`,
    `Alerts: ${settings.alerts ? 'on' : 'off'}`,
    `Midnight: ${midnight === null ? 'off' : `on · ${Math.max(0, Math.round((midnight.endsAt - now) / MIN))}m left`}`,
    `God mode: ${god === null ? 'off' : `on · ${Math.max(0, Math.round((god.endsAt - now) / MIN))}m left`}`,
  ]
  return lines.join('\n')
}

async function mcCommand($: EngineInterface, args: string): Promise<string> {
  const a = args.trim().toLowerCase()
  const settings = await read($, settingsAtom)
  if (a === '') return mcStatus($)
  let m = /^model pin (haiku|sonnet|opus)$/.exec(a)
  if (m?.[1] !== undefined && isModel(m[1])) {
    await saveSettings($, { ...settings, pin: m[1], router: true })
    return `Pinned ${m[1]}.`
  }
  const ty = /^typo (\S+) (\S+)$/.exec(args.trim())
  if (ty?.[1] !== undefined && ty[2] !== undefined) {
    ownerTypos = { ...ownerTypos, [ty[1].toLowerCase()]: ty[2] }
    await saveWords($)
    return `Will correct "${ty[1]}" to "${ty[2]}".`
  }
  const gl = /^glossary (.+?)\s*=\s*(.+)$/.exec(args.trim())
  if (gl?.[1] !== undefined && gl[2] !== undefined) {
    ownerGlossary = { ...ownerGlossary, [gl[1].toLowerCase()]: gl[2] }
    await saveWords($)
    return `Glossary: "${gl[1]}" = ${gl[2]}.`
  }
  const ov = /^overlay (on|off)$/.exec(a)
  if (ov !== null) {
    await saveSettings($, { ...settings, overlay: ov[1] === 'on' })
    if (ov[1] === 'on') await launchOverlay($)
    return `Overlay ${ov[1]}.`
  }
  const o = /^opus (on|off)$/.exec(a)
  if (o !== null) {
    await saveSettings($, { ...settings, preferOpus: o[1] === 'on' })
    return `Opus preference ${o[1]}.`
  }
  const r = /^router (on|off)$/.exec(a)
  if (r !== null) {
    await saveSettings($, { ...settings, router: r[1] === 'on' })
    return `Router ${r[1]}.`
  }
  if (a === 'model auto') {
    await saveSettings($, { ...settings, pin: null, router: true })
    return 'Router choosing automatically.'
  }
  m = /^agents (\d+)$/.exec(a)
  const cap = Number(m?.[1])
  if (m !== null && cap >= 1 && cap <= 10) {
    await saveSettings($, { ...settings, agentCap: cap })
    return `Agent cap ${cap}.`
  }
  m = /^(resume|alerts) (on|off)$/.exec(a)
  if (m !== null) {
    const on = m[2] === 'on'
    if (m[1] === 'resume') {
      await saveSettings($, { ...settings, resume: on })
      return `Auto-resume ${on ? 'on' : 'off'}.`
    }
    await saveSettings($, { ...settings, alerts: on })
    return `Alerts ${on ? 'on' : 'off'}.`
  }
  if (a === 'tokens') return tokenReportText(await read($, turnsAtom))
  return MC_USAGE
}

async function registerCommands($: EngineInterface): Promise<void> {
  try {
    await $.command.register({
      name: 'god',
      description: 'God mode: run tools without asking, for a while (confirmation first)',
      argumentHint: '[minutes] | off | log',
    })
  } catch {
    // A host without slash commands.
  }
  try {
    await $.command.register({
      name: 'ship',
      description: 'Ship: tests, build, never-ship check, secret scan, commit, push, deploy',
      argumentHint: '| never <pattern> | never',
    })
    await $.command.register({
      name: 'project',
      description: 'Projects: which project this chat is in; add one',
      argumentHint: '| add <name> = <folder>',
    })
    await $.command.register({
      name: 'midnight',
      description: 'Unattended run: AI decides, keeps working, watches budget',
      argumentHint: '[hours] [--ship] | off | status',
    })
  } catch {
    // A host without slash commands.
  }
  try {
    await $.command.register({
      name: 'mc',
      description: 'Mission Control: meters, router, agent cap, resume, alerts, tokens',
      argumentHint: '[model pin <m>|model auto|agents <n>|resume on|off|alerts on|off|tokens]',
      immediate: true,
    })
  } catch {
    // A host without slash commands: everything else still runs.
  }
}

// ── N. The owner's words: typos and glossary ─────────────────────────────
async function loadWords($: EngineInterface): Promise<void> {
  try {
    const t = await $.store.get(STORE.typos)
    if (typeof t === 'object' && t !== null) ownerTypos = t as Record<string, string>
    const g = await $.store.get(STORE.glossary)
    if (typeof g === 'object' && g !== null) ownerGlossary = { ...DEFAULT_GLOSSARY, ...(g as Record<string, string>) }
  } catch {
    // Defaults only.
  }
}

async function saveWords($: EngineInterface): Promise<void> {
  try {
    await $.store.set(STORE.typos, ownerTypos)
    await $.store.set(STORE.glossary, ownerGlossary)
  } catch {
    // Kept for this session.
  }
}

// ── I. Layout: bar, side panel, compact; lock ─────────────────────────────
const LAYOUTS = ['bar', 'side', 'compact'] as const
const LAYOUT_NAME: Record<(typeof LAYOUTS)[number], string> = { bar: 'Bar', side: 'Side', compact: 'Compact' }
const nextLayout = (l: (typeof LAYOUTS)[number]) => LAYOUTS[(LAYOUTS.indexOf(l) + 1) % LAYOUTS.length] ?? 'bar'
const SIDE = 'mc-side'

async function openSide($: EngineInterface): Promise<void> {
  try {
    await $.ui.open({ id: SIDE, title: 'Mission Control' })
  } catch {
    // A surface without panes keeps the band.
  }
}

async function cycleLayout($: EngineInterface): Promise<void> {
  const s = await read($, settingsAtom)
  if (s.layoutLocked) return
  const layout = nextLayout(s.layout)
  await saveSettings($, { ...s, layout })
  if (layout === 'side') await openSide($)
  else if (s.layout === 'side') {
    try {
      await $.ui.close({ id: SIDE })
    } catch {
      // Already closed.
    }
  }
}

/** The owner's choice in a pop-up, or '' when there is no one to ask. */
async function askOwner($: EngineInterface, question: string, options: string[]): Promise<string> {
  try {
    return await $.ui.ask(question, options)
  } catch {
    return ''
  }
}

// ── J. Approvals for new agents ──────────────────────────────────────────
async function approveSpawn($: EngineInterface, what: string): Promise<boolean> {
  const s = await read($, settingsAtom)
  if (s.approvals === 'auto' || (await read($, midnightAtom)) !== null || (await read($, godAtom)) !== null) return true
  const answer = await askOwner($, `Start a new agent: ${what}?`, ['Approve', 'Deny', 'Auto-approve'])
  if (answer === 'Deny') return false
  if (answer === 'Auto-approve') await saveSettings($, { ...(await read($, settingsAtom)), approvals: 'auto' })
  return true
}

// ── K. Context health ────────────────────────────────────────────────────
const HANDOFF_ASK =
  'Context is getting heavy. Write a handoff summary to .mission-control/HANDOFF.md in the project: goal, done, in progress, next, decisions, file paths. 150 words max. Then stop.'
const FRESH = 'Fresh context: read .mission-control/HANDOFF.md and continue.'

async function healthOnTurn($: EngineInterface, reason: string): Promise<void> {
  if (refreshStage === 'asked') {
    refreshStage = 'idle'
    try {
      await $.session.compact({ instructions: 'Use the handoff in .mission-control/HANDOFF.md as the summary; keep file paths, decisions and next steps.' })
    } catch {
      // Auto-compact will still catch it.
    }
    await update($, healthAtom, () => [])
    nudgeQueued = true
    submitSoon($, FRESH)
    return
  }
  if (reason !== 'answer') return
  const ctxPct = (await read($, meterAtom))?.ctxPct ?? 0
  const toolErrors = turnRecords.filter(r => r.isError).length
  const editMisses = turnRecords.filter(r => r.tool === 'Edit' && r.isError && /not found|did not match|no match/i.test(r.text)).length
  const wasted = ((await read($, turnsAtom)).at(-1)?.flag ?? null) !== null
  const score = scoreTurn({ toolErrors, editMisses, corrected: false, wasted })
  const list = [...(await read($, healthAtom)), { score, ctxPct }].slice(-40)
  await update($, healthAtom, () => list)
  if (healthAction(list) === 'refresh' && !nudgeQueued) {
    refreshStage = 'asked'
    nudgeQueued = true
    submitSoon($, HANDOFF_ASK)
  }
}

/** The owner's push-back counts against the answer it pushes back on. */
async function noteCorrection($: EngineInterface, text: string): Promise<void> {
  if (!CORRECTION.test(text)) return
  await update($, healthAtom, list => {
    const last = list.at(-1)
    return last === undefined ? list : [...list.slice(0, -1), { ...last, score: Math.max(0, last.score - 0.3) }]
  })
}

// ── L. Split ─────────────────────────────────────────────────────────────
async function splitOnTurn($: EngineInterface, reason: string): Promise<void> {
  if (reason !== 'answer' || splitQueue.length === 0 || nudgeQueued) return
  const task = splitQueue.shift() ?? ''
  const k = splitTotal - splitQueue.length
  await update($, splitAtom, () => [...splitQueue])
  nudgeQueued = true
  submitSoon($, nextTaskText(task, k, splitTotal))
}

// ── M. Good morning: an auto run after a reset ───────────────────────────
async function startAutoRun($: EngineInterface): Promise<void> {
  const now = await nowOr($)
  await update($, midnightAtom, () => ({ endsAt: now + 8 * 60 * MIN, budgetPct: 85, ship: false, errorsInRow: 0, turns: 0 }))
  midnightOn = true
}

// ── Wiring: one hook per event ───────────────────────────────────────────
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadSettings($)
    startPulse($)
    await loadWords($)
    sessionCwd = e.cwd
    sessionKey = (await sessionId($)) ?? `s${Date.now()}`
    if ((await read($, meterAtom)) === null) {
      try {
        const last = await $.store.get(STORE.lastMeter)
        if (typeof last === 'object' && last !== null) {
          await update($, meterAtom, () => last as Meter)
          await update($, staleAtom, () => true)
        }
      } catch {
        // Nothing cached yet.
      }
    }
    await loadProjects($)
    await loadLocalConfig($)
    await launchOverlay($)
    midnightOn = (await read($, midnightAtom)) !== null
    if ((await read($, settingsAtom)).layout === 'side') await openSide($)
    await rearmFromStore($)
    await registerCommands($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await meterOnMeasure($, e)
    await alertsOnMeasure($, e)
    await guardOnMeasure($, e)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const held = await holdRetry($, e)
    if (held !== null) return { drop: held }
    noteOwnerPrompt(e)
    if (isOwner(e)) {
      lastOwnerAt = await nowOr($)
      await noteCorrection($, e.text)
      if ((await read($, midnightAtom)) !== null) await stopMidnight($, 'owner is back')
    }
    const fixed = isOwner(e) ? autocorrect(e.text, ownerTypos).text : e.text
    const hint = isOwner(e) ? glossaryHints(fixed, ownerGlossary) : null
    const lines = await routeOnSubmit($, { ...e, text: fixed })
    return next({ ...e, text: fixed, context: [...(e.context ?? []), ...lines, ...(hint === null ? [] : [hint])] })
  }).catch(($, e, next) => next(e))

  on('turn.start', ($, e, next) => {
    resetTurn()
    turnRecords = []
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      const effort = agentEffort.get(e.agentId)
      return yield* next(effort === undefined ? e : { ...e, effort })
    }
    const choice = await stepChoice($, e.index, e.effort)
    if (choice === null) return yield* next(e)
    return yield* next({ ...e, ...choice })
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.workflow !== undefined) return next(e)
    const ahead = spawning // spawns of this same message still being decided
    spawning += 1
    try {
    const cap = await effectiveCap($)
    const live = (await runningCount($)) + ahead
    if (live >= cap) return { deny: `Agent cap reached (${live} running). Wait for one to finish.` }
    if (!(await approveSpawn($, e.description || e.prompt.slice(0, 50)))) return { deny: 'The owner denied starting this agent.' }
    if (e.fork) return next(e)
    const prompt = e.prompt.endsWith(REPORT_RULE) ? e.prompt : e.prompt + REPORT_RULE
    if (e.model !== undefined) return next({ ...e, prompt })
    const chosen = await chooseAgent($, e.subagentType, e.prompt)
    const started = await next({ ...e, prompt, model: chosen.model })
    if (started.agentId !== undefined) agentEffort.set(started.agentId, chosen.effort)
    return started
    } finally {
      spawning -= 1
    }
  }).catch(($, e, next) => next(e))

  // Every tool result of the main loop: failures in a row drive escalation.
  on('tool.call', async ($, e, next) => {
    // Midnight: the owner is away, so a question would stall the run.
    if (String(e.tool) === 'AskUserQuestion' && (await read($, midnightAtom)) !== null) {
      return { deny: 'Owner away: pick the recommended option and log it.' }
    }
    if (String(e.tool).startsWith('mcp__')) {
      const cmd = shellCommand(String(e.tool), e)
      const refused = cmd === null ? null : await midnightGuard($, cmd)
      if (refused !== null) return { deny: refused }
    }
    const ran = await next(e)
    if (e.agentId === undefined && ran.deny === undefined) noteToolResult(ran.isError === true)
    if (e.agentId === undefined) {
      const tool = String(e.tool)
      turnRecords.push({ tool, command: shellCommand(tool, e) ?? undefined, isError: ran.isError === true, text: ran.text ?? '' })
    }
    if (String(e.tool) === 'SendMessage') {
      const o = e as unknown as Record<string, unknown>
      const line = `${String(o.to ?? '?')}: ${String(o.summary ?? o.message ?? '').replace(/\s+/g, ' ').slice(0, 60)}`
      await update($, commsAtom, list => [...list, line].slice(-6))
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    nudgeQueued = false
    if (e.reason === 'error') await guardOnError($)
    if (e.reason === 'answer') await recordTurn($, e.turnId, e.answer, e.usage?.output_tokens ?? 0)
    await healthOnTurn($, e.reason)
    await splitOnTurn($, e.reason)
    await midnightOnTurn($, e.reason, e.answer)
    const card = e.reason === 'answer' ? proofCard(turnRecords) : null
    turnRecords = []
    const r = await next(e)
    if (card === null) return r
    await update($, proofAtom, () => card)
    return { ...r, text: card }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const m = await read($, midnightAtom)
    const mine = [{ id: 'mission-control:brevity', text: BREVITY, scope: 'session' as const }]
    if (m !== null) mine.push({ id: 'mission-control:midnight', text: midnightSection(m.ship), scope: 'session' as const })
    return { sections: [...composed.sections, ...mine] }
  })

  on('command.run', { command: 'mc' }, async ($, e) => ({ text: await mcCommand($, e.args) }))

  on('command.run', { command: 'ship' }, async ($, e) => ({ text: await shipCommand($, e.args) }))

  on('command.run', { command: 'project' }, async ($, e) => ({ text: await projectCommand($, e.args) }))

  on('command.run', { command: 'god' }, async ($, e) => ({ text: await godCommand($, e.args, e.origin?.kind) }))

  on('tool.check', async ($, e, next) => {
    const verdict = await godVerdict($, e.tool, e.input)
    if (verdict !== 'allow') return next(e)
    const normal = await next(e)
    return normal.decision === 'ask' ? { ...normal, decision: 'allow', reason: 'God mode' } : normal
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await stopGod($, 'session ended')
    return next(e)
  })

  on('command.run', { command: 'midnight' }, async ($, e) => {
    if (e.args.trim().toLowerCase() === 'status') {
      const m = await read($, midnightAtom)
      return { text: m === null ? 'Midnight: off' : `Midnight: on · ${Math.max(0, Math.round((m.endsAt - (await $.clock.now())) / MIN))}m left` }
    }
    return { text: await startMidnight($, e.args) }
  })

  // tsc hits its instantiation limit (TS2589) on the engine's types at whichever
  // hook lands here; the engine's own validate and the tests cover this hook.
  // @ts-expect-error TS2589
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const refused = await midnightGuard($, e.command)
    if (refused !== null) return { deny: refused }
    return next(e)
  }).catch(($, e, next) => {
    if (!next.called && midnightOn) return { deny: 'Midnight guard failed; command refused.' }
    return next(e)
  })

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const refused = await midnightGuard($, e.command)
    if (refused !== null) return { deny: refused }
    return next(e)
  }).catch(($, e, next) => {
    if (!next.called && midnightOn) return { deny: 'Midnight guard failed; command refused.' }
    return next(e)
  })

  // Task-list tools: what is in progress, for alerts.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    currentTodo = e.todos.find(t => t.status === 'in_progress')?.content ?? null
    const done = e.todos.filter(t => t.status === 'completed').length
    await update($, progressAtom, () => ({ done, total: e.todos.length }))
    return next(e)
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = /#?(\d+)/.exec(ran.text ?? '')?.[1]
    if (id !== undefined) taskSubjects.set(id, e.subject)
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, ($, e, next) => {
    const subject = e.subject ?? taskSubjects.get(e.taskId)
    if (e.status === 'in_progress' && subject !== undefined) currentTodo = subject
    if ((e.status === 'completed' || e.status === 'deleted') && subject === currentTodo) currentTodo = null
    return next(e)
  })

  // The band above the chat box: zone badge, three labelled meters with bars,
  // agents against the cap, cost, the router's choice, and the danger ack.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const meter = await read($, meterAtom)
    const zone = zoneOf(topPct(meter))
    const color = ZONE_COLOR[zone]
    const pulse = await read($, pulseAtom)
    const acked = await read($, ackedAtom)
    const route = await read($, routeAtom)
    const limited = await read($, limitedAtom)
    const settings = await read($, settingsAtom)
    const live = await read($, agentsLiveAtom)
    const cap = await effectiveCap($)
    const midnight = await read($, midnightAtom)
    const god = await read($, godAtom)
    const nowMs = midnight === null && god === null ? Date.now() : await $.clock.now()
    const minutesLeft = midnight === null ? 0 : Math.max(0, Math.round((midnight.endsAt - nowMs) / MIN))
    const godLeft = god === null ? 0 : Math.max(0, Math.round((god.endsAt - nowMs) / MIN))
    const trend = await read($, trendAtom)
    const stale = await read($, staleAtom)
    const paceNow = pace(meter?.fiveHour?.pct ?? 0, meter?.fiveHour?.resetsAt, Date.now())
    const routeChip =
      settings.pin !== null ? `pinned: ${settings.pin}` : route === null ? null : `auto: ${route.model}·${route.effort}`
    const layoutControls = (
      <Box key="layout-controls" flexDirection="row">
        {settings.layout !== 'side' && <Button key="peek" label="▤ panel" hotkey="1" onPress={async () => await openSide($)} />}
        {!settings.layoutLocked && (
          <Button key="layout" label={`⇄ ${LAYOUT_NAME[nextLayout(settings.layout)]}`} onPress={async () => await cycleLayout($)} />
        )}
        <Button key="lock" label={settings.layoutLocked ? '🔒' : '🔓'} onPress={async () => await saveSettings($, { ...(await read($, settingsAtom)), layoutLocked: !(await read($, settingsAtom)).layoutLocked })} />
      </Box>
    )

    if (settings.layout === 'side') {
      return (
        <Box key="frame" flexDirection="row">
          <Box key="side-chip">
            <Text color={color}>{`● ${zone} · Mission Control is in the side panel `}</Text>
          </Box>
          {layoutControls}
        </Box>
      )
    }
    if (settings.layout === 'compact') {
      return (
        <Box key="frame" flexDirection="row">
          <Box key="compact">
            <Text color={color} dimColor={zone === 'ok'}>{formatMeter(meter)}</Text>
          </Box>
          {layoutControls}
        </Box>
      )
    }

    return (
      <Box key="frame" borderStyle="round" borderColor={pulse ? 'red' : color} flexDirection="row" flexWrap="wrap">
        <Box key="zone">
          <Text bold color={color} inverse={pulse}>{` ${zone.toUpperCase()} `}</Text>
        </Box>
        <Box key="meter" flexDirection="row" flexWrap="wrap">
          {bandSegments(meter).map(seg => (
            <Box flexDirection="row">
              <Text dimColor>{`  ${seg.label} `}</Text>
              <Text color={ZONE_COLOR[zoneOf(seg.pct ?? 0)]}>{seg.bar}</Text>
              <Text bold dimColor={stale}>{` ${seg.pct === null ? '–' : `${Math.round(seg.pct)}%`}`}</Text>
              {seg.label === 'Context' && trend.length > 1 && (
                <Box key="trend">
                  <Text dimColor>{sparkline(trend)}</Text>
                </Box>
              )}
              {seg.label === '5-hour limit' && paceNow !== null && Math.abs(paceNow) >= 5 && (
                <Box key="pace">
                  <Text color={paceNow > 0 ? '#ff8700' : 'green'}>{paceNow > 0 ? ` ▲ ${paceNow} ahead` : ` ▼ ${-paceNow} under`}</Text>
                </Box>
              )}
              {seg.note !== undefined && <Text dimColor>{` ${seg.note}`}</Text>}
            </Box>
          ))}
          {stale && (
            <Box key="stale">
              <Text dimColor>{' (last known)'}</Text>
            </Box>
          )}
        </Box>
        <Box key="agents">
          <Text dimColor>{'  │ '}</Text>
          <Text>{`${live}/${cap} agents`}</Text>
        </Box>
        {meter?.costUsd !== null && meter?.costUsd !== undefined && (
          <Box key="cost">
            <Text dimColor>{`  │ $${meter.costUsd.toFixed(2)}`}</Text>
          </Box>
        )}
        {routeChip !== null && <Text dimColor>{`  │ ${routeChip}`}</Text>}
        {god !== null ? (
          <Box key="god-chip">
            <Text bold color="red">{` ⚡ GOD MODE · ${godLeft}m left`}</Text>
          </Box>
        ) : (
          <Button
            key="god"
            label="⚡ God mode"
            onPress={async () => {
              await startGod($, 60)
            }}
          />
        )}
        {god !== null && (
          <Button
            key="god-stop"
            label="Stop"
            onPress={async () => {
              await stopGod($, 'stopped by owner')
            }}
          />
        )}
        {midnight !== null ? (
          <Box key="midnight-chip">
            <Text color="magenta">{` 🌙 midnight · ${Math.floor(minutesLeft / 60)}h${minutesLeft % 60}m left`}</Text>
          </Box>
        ) : (
          <Button
            key="midnight"
            label="🌙 Midnight"
            onPress={async () => {
              if ((await askOwner($, 'Start an 8-hour midnight run? Claude keeps working on its own and decides without asking.', ['Start', 'Cancel'])) === 'Start') {
                await startMidnight($, '')
              }
            }}
          />
        )}
        {limited !== null && (zone === 'high' || zone === 'danger') && <Text color={color}>{'  │ auto-resume armed'}</Text>}
        {layoutControls}
        {zone === 'danger' && !acked && (
          <Button
            key="ack"
            label="Got it"
            onPress={async () => {
              await update($, ackedAtom, () => true)
              await update($, pulseAtom, () => false)
            }}
          />
        )}
      </Box>
    )
  })

  // Our own midnight prompts (nudges, the morning-report ask) as one dim line,
  // so an overnight run does not flood the chat. ctrl+o still shows the full text.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const o = e.props.origin
    const ours = o.kind === 'plugin' && o.name === 'mission-control' && /^Midnight( run ended)?[: (]/.test(e.props.text)
    if (!ours || e.props.isExpanded) return next(e)
    const { Text } = $.ui.resolve(e)
    const ended = e.props.text.startsWith('Midnight run ended')
    return <Text dimColor>{ended ? '🌙 midnight · wrapping up' : '🌙 midnight · continuing'}</Text>
  })

  // The side panel: the vertical layout, everything stacked.
  on('ui.render', { component: 'Pane', requestId: SIDE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const meter = await read($, meterAtom)
    const zone = zoneOf(topPct(meter))
    const color = ZONE_COLOR[zone]
    const settings = await read($, settingsAtom)
    let agents: AgentInfo[] = []
    try {
      agents = (await $.agent.list()).filter(a => a.status === 'pending' || a.status === 'running' || a.status === 'waiting')
    } catch {
      agents = []
    }
    const progress = await read($, progressAtom)
    const comms = await read($, commsAtom)
    const split = await read($, splitAtom)
    const proof = await read($, proofAtom)
    const health = await read($, healthAtom)
    const route = await read($, routeAtom)
    const pct = progress.total === 0 ? null : (progress.done / progress.total) * 100
    const notes = await read($, notesAtom)
    let costLine = ''
    try {
      const days = ((await $.store.get(STORE.costDays)) ?? {}) as Record<string, Record<string, number>>
      const totals = Object.keys(days).sort().map(d => Object.values(days[d] ?? {}).reduce((a, b) => a + b, 0))
      const max = Math.max(1, ...totals)
      if (totals.length > 0) costLine = `Cost today   $${(totals.at(-1) ?? 0).toFixed(2)}  ${sparkline(totals.map(t => (t / max) * 100))}`
    } catch {
      costLine = ''
    }

    return (
      <Box flexDirection="column">
        <Box key="side-meters" flexDirection="column">
          <Text bold color={color}>{` ${zone.toUpperCase()} `}</Text>
          {bandSegments(meter).map(seg => (
            <Text>
              <Text dimColor>{`${seg.label.padEnd(13)}`}</Text>
              <Text color={ZONE_COLOR[zoneOf(seg.pct ?? 0)]}>{seg.bar}</Text>
              <Text bold>{` ${seg.pct === null ? '–' : `${Math.round(seg.pct)}%`}`}</Text>
            </Text>
          ))}
          {meter?.costUsd !== null && meter?.costUsd !== undefined && <Text dimColor>{`Session cost $${meter.costUsd.toFixed(2)}`}</Text>}
          {costLine !== '' && <Text dimColor>{costLine}</Text>}
          <Text dimColor>{`Model        ${settings.pin !== null ? `pinned ${settings.pin}` : route === null ? 'session default' : `${route.model}·${route.effort}`}`}</Text>
          <Text dimColor>{`Quality      ${healthLabel(health)}`}</Text>
        </Box>
        <Box key="side-agents" flexDirection="column">
          <Text bold>{`Agents ${agents.length}/${await effectiveCap($)} · approvals ${settings.approvals}`}</Text>
          {agents.length === 0 && <Text dimColor>none running</Text>}
          {agents.map(a => (
            <Text>{`• ${a.description} · ${a.type} · ${a.status}`}</Text>
          ))}
        </Box>
        <Box key="side-progress" flexDirection="column">
          <Text bold>Progress</Text>
          <Text>{progress.total === 0 ? 'no task list yet' : `${meterBar(pct)} ${progress.done}/${progress.total}`}</Text>
        </Box>
        {split.length > 0 && (
          <Box key="side-split" flexDirection="column">
            <Text bold>Queued from your message</Text>
            {split.map((t, i) => (
              <Text>{`${i + 2}. ${t}`}</Text>
            ))}
          </Box>
        )}
        {comms.length > 0 && (
          <Box key="side-comms" flexDirection="column">
            <Text bold>Agent messages</Text>
            {comms.map(c => (
              <Text dimColor>{c}</Text>
            ))}
          </Box>
        )}
        {proof !== null && (
          <Box key="side-proof" flexDirection="column">
            <Text bold>Last proof</Text>
            <Text>{proof}</Text>
          </Box>
        )}
        {notes.length > 0 && (
          <Box key="side-notes" flexDirection="column">
            <Text bold>Notes</Text>
            {notes.map(n => (
              <Text dimColor>{`· ${n}`}</Text>
            ))}
          </Box>
        )}
        <Box key="side-docs" flexDirection="row" flexWrap="wrap">
          {docs.slice(0, 4).map((d, i) => (
            <Button key={`doc-${i}`} label={`@ ${d.split('/').pop() ?? d}`} onPress={async () => void (await $.prompt.fill({ text: `@${d} `, mode: 'insert' }))} />
          ))}
          <Button
            key="approvals"
            label={settings.approvals === 'ask' ? 'Approvals: ask' : 'Approvals: auto'}
            onPress={async () => {
              const s = await read($, settingsAtom)
              await saveSettings($, { ...s, approvals: s.approvals === 'ask' ? 'auto' : 'ask' })
            }}
          />
          <Button key="side-layout" label="⇄ Back to bar" onPress={async () => {
            const s = await read($, settingsAtom)
            if (s.layoutLocked) return
            await saveSettings($, { ...s, layout: 'bar' })
            try {
              await $.ui.close({ id: SIDE })
            } catch {
              // Already closed.
            }
          }} />
        </Box>
      </Box>
    )
  })

  // The hint line below the chat box.
  on('ui.render', { component: 'PromptHint' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const zone = zoneOf(topPct(await read($, meterAtom)))
    return (
      <Box flexDirection="row">
        <Text dimColor>{e.props.hint}</Text>
        {e.props.tail !== undefined && <Text dimColor>{` ${e.props.tail}`}</Text>}
        <Box key="zone-dot">
          <Text color={ZONE_COLOR[zone]}>{`● ${zone}`}</Text>
        </Box>
      </Box>
    )
  })
}
