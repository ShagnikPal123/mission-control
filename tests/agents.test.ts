import type { AgentInfo, AgentSpawnInput, On, TurnStepInput } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { pickAgent, REPORT_RULE } from '../hooks/agents'
import { fakeEngine } from './kit'

const START = { cwd: 'C:/p', surface: 'terminal', isInteractive: true } as const

const running = (n: number): AgentInfo[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, description: `job ${i}`, type: 'general-purpose', status: 'running' }))

/** The engine's spawn beneath: records what reached it. */
function spawns(on: On) {
  const got: AgentSpawnInput[] = []
  on('agent.spawn', (_, e) => {
    got.push(e)
    return { model: e.model ?? 'inherit', agentId: `a${got.length}` }
  })
  return got
}

test('pickAgent rules', () => {
  expect(pickAgent('Explore', 'look around')).toEqual({ model: 'haiku', effort: 'low' })
  expect(pickAgent('general-purpose', 'search the repo for TODOs')).toEqual({ model: 'haiku', effort: 'low' })
  expect(pickAgent('Plan', 'outline the work')).toEqual({ model: 'opus', effort: 'high' })
  expect(pickAgent('general-purpose', 'implement the login form')).toEqual({ model: 'sonnet', effort: 'medium' })
  expect(pickAgent('custom-x', 'handle the thing')).toBeNull()
  expect(pickAgent('general-purpose', 'implement the parser, find and fix the bug')).toEqual({ model: 'sonnet', effort: 'medium' })
  expect(pickAgent('general-purpose', 'review the diff and find issues')).toEqual({ model: 'sonnet', effort: 'medium' })
})

test('explore gets haiku and the short-report rule', async ($, on) => {
  fakeEngine(on)
  const got = spawns(on)
  await $.session.start(START)

  await $.agent.spawn({ prompt: 'Find where the trader saves state', subagentType: 'Explore', description: 'find state' })

  expect(got[0]?.model).toBe('haiku')
  expect(got[0]?.prompt.endsWith(REPORT_RULE)).toBe(true)
})

test('an explicit model is kept', async ($, on) => {
  fakeEngine(on)
  const got = spawns(on)
  await $.session.start(START)

  await $.agent.spawn({ prompt: 'Review the diff', subagentType: 'general-purpose', model: 'opus' })

  expect(got[0]?.model).toBe('opus')
  expect(got[0]?.prompt.endsWith(REPORT_RULE)).toBe(true)
})

test('the cap refuses a fourth agent', async ($, on) => {
  fakeEngine(on, { agents: running(3) })
  const got = spawns(on)
  await $.session.start(START)

  const r = await $.agent.spawn({ prompt: 'Write tests', subagentType: 'general-purpose' })

  expect(r.deny).toMatch(/^Agent cap reached \(3 running\)\. Wait for one to finish\.$/)
  expect(got.length).toBe(0)
})

test('the cap drops to one near the limit', async ($, on) => {
  fakeEngine(on, { agents: running(1) })
  spawns(on)
  await $.session.start(START)
  await $.session.measure({
    context: { window: 200000, percent: 10 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 86 }],
    changed: ['rateLimits'],
  })

  const r = await $.agent.spawn({ prompt: 'Write tests', subagentType: 'general-purpose' })

  expect(r.deny).toMatch(/^Agent cap reached \(1 running\)/)
})

test('an unclear task asks haiku to classify', async ($, on) => {
  fakeEngine(on)
  const got = spawns(on)
  on('model.classify', () => ({ value: 'opus/high' }))
  await $.session.start(START)

  await $.agent.spawn({ prompt: 'Handle the thing for the owner', subagentType: 'custom-x' })

  expect(got[0]?.model).toBe('opus')
})

test('the chosen effort rides on the agent steps', async ($, on) => {
  fakeEngine(on)
  spawns(on)
  const efforts: TurnStepInput['effort'][] = []
  on('turn.step', async function* (_, e) {
    efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await $.session.start(START)

  await $.agent.spawn({ prompt: 'Find the config loader', subagentType: 'Explore' })
  const s = $.turn.step({ turnId: 'x', index: 0, model: 'claude-haiku-5-5', effort: 'high', messageCount: 1, agentId: 'a1' })
  for await (const _ of s) {
    // drain
  }

  expect(efforts[0]).toBe('low')
})

test('parallel spawns cannot beat the cap', async ($, on) => {
  fakeEngine(on, { agents: running(2) })
  const got = spawns(on)
  await $.session.start(START)

  const results = await Promise.all([
    $.agent.spawn({ prompt: 'Write tests for A', subagentType: 'general-purpose' }),
    $.agent.spawn({ prompt: 'Write tests for B', subagentType: 'general-purpose' }),
  ])

  expect(results.filter(r => r.deny !== undefined).length).toBe(1)
  expect(got.length).toBe(1)
})
