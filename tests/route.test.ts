import { expect, test } from 'claude-code/testing'

import type { Route } from '../types'
import { biasRoute, effortUp, isSkippable, parseRoute, routeLine, stepUp } from '../hooks/route'

const LARGE: Route = { size: 'large', kind: 'feature', model: 'opus', effort: 'high', plan: true, agents: [] }

test('parseRoute handles fenced json', () => {
  const raw = 'Here you go:\n```json\n{"size":"small","kind":"edit","model":"sonnet","effort":"medium","plan":false,"agents":[]}\n```'
  expect(parseRoute(raw)).toEqual({ size: 'small', kind: 'edit', model: 'sonnet', effort: 'medium', plan: false, agents: [] })
})

test('parseRoute rejects unknown model', () => {
  expect(parseRoute('{"size":"small","kind":"edit","model":"gpt","effort":"low","plan":false,"agents":[]}')).toBeNull()
})

test('parseRoute drops bad agents and caps at five', () => {
  const agents = Array.from({ length: 7 }, (_, i) => ({ role: `r${i}`, model: 'haiku', effort: 'low', why: 'x' }))
  const raw = JSON.stringify({ ...LARGE, agents: [...agents, { role: 'bad', model: 'gpt', effort: 'low', why: 'x' }] })
  expect(parseRoute(raw)?.agents.length).toBe(5)
})

test('bias steps down at 80', () => {
  const r = biasRoute(LARGE, 82, null, 80)
  expect([r.model, r.effort]).toEqual(['sonnet', 'medium'])
})

test('bias leaves a calm window alone', () => {
  expect(biasRoute(LARGE, 40, null, 80)).toEqual(LARGE)
})

test('bias caps at sonnet past 95', () => {
  expect(biasRoute({ ...LARGE, effort: 'xhigh' }, 96, null, 80).model).toBe('sonnet')
  expect(biasRoute({ ...LARGE, model: 'opus' }, 96, null, 99).model).toBe('sonnet')
})

test('pin beats bias', () => {
  expect(biasRoute(LARGE, 97, 'opus', 80).model).toBe('opus')
})

test('steps up never past the top', () => {
  expect(stepUp('haiku')).toBe('sonnet')
  expect(stepUp('opus')).toBe('opus')
  expect(effortUp('high')).toBe('xhigh')
  expect(effortUp('xhigh')).toBe('xhigh')
})

test('short and retry prompts are skippable', () => {
  expect(isSkippable('continue')).toBe(true)
  expect(isSkippable('Try again')).toBe(true)
  expect(isSkippable('ok')).toBe(true)
  expect(isSkippable('Add a dark mode toggle to settings')).toBe(false)
})

test('routeLine reads as one line', () => {
  const r: Route = { ...LARGE, agents: [{ role: 'explorer', model: 'haiku', effort: 'low', why: 'find files' }] }
  expect(routeLine(r)).toBe('[router] large feature → opus/high, plan first; suggested agents: explorer(haiku/low)')
})
