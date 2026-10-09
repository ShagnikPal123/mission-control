import { expect, test } from 'claude-code/testing'

import type { TurnRecord } from '../types'
import { BREVITY, flagTurn, tokenReportText, wordCount } from '../hooks/waste'
import { fakeEngine } from './kit'

const START = { cwd: 'C:/p', surface: 'terminal', isInteractive: true } as const
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

test('long report flagged for a small task', () => {
  expect(flagTurn({ words: 300, size: 'small' }, null, words(300))).toBe('long report for a small task')
  expect(flagTurn({ words: 300, size: 'large' }, null, words(300))).toBeNull()
  expect(flagTurn({ words: 100, size: 'tiny' }, null, words(100))).toBeNull()
})

test('a repeated report is flagged', () => {
  const text = `Done. ${words(60)}`
  expect(flagTurn({ words: 61, size: 'medium' }, text, text)).toBe('repeats previous report')
})

test('wordCount counts words', () => {
  expect(wordCount('  one two\nthree  ')).toBe(3)
  expect(wordCount('')).toBe(0)
})

test('token report lists flagged turns and estimated waste', () => {
  const turns: TurnRecord[] = [
    { turnId: 'a', outputTokens: 900, words: 300, size: 'small', flag: 'long report for a small task' },
    { turnId: 'b', outputTokens: 200, words: 60, size: 'large', flag: null },
  ]
  const text = tokenReportText(turns)
  expect(text).toContain('Turns: 2 · output tokens: 1,100')
  expect(text).toContain('Flagged: 1 · est. wasted output tokens: 900')
  expect(text).toContain('a: long report for a small task (300 words)')
  expect(text.split('\n').length).toBeLessThanOrEqual(25)
})

test('the brevity rules join the system prompt', async ($, on) => {
  fakeEngine(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }] }))
  await $.session.start(START)

  const r = await $.prompt.compose({
    model: 'claude-sonnet-5-5',
    promptModel: 'claude-sonnet-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })

  const mine = r.sections.find(x => x.id === 'mission-control:brevity')
  expect(mine?.text).toBe(BREVITY)
  expect(mine?.scope).toBe('session')
})

test('main-loop turns are recorded with their output tokens', async ($, on) => {
  fakeEngine(on)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  const writes: unknown[] = []
  on('state.set', (_, e, next) => {
    if (e.key === 'turns') writes.push(e.value)
    return next(e)
  })
  await $.session.start(START)

  const answer = `Done. ${words(40)}`
  const usage = { model: 'claude-sonnet-5-5', input_tokens: 10, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  await $.turn.complete({ reason: 'answer', answer, durationMs: 5, isAborted: false, turnId: 't1', usage })
  await $.turn.complete({ reason: 'answer', answer, durationMs: 5, isAborted: false, turnId: 't2', usage })

  const last = writes.at(-1) as TurnRecord[]
  expect(last.length).toBe(2)
  expect(last[0]).toEqual({ turnId: 't1', outputTokens: 120, words: 41, size: null, flag: null })
  expect(last[1]?.flag).toBe('repeats previous report')
})
