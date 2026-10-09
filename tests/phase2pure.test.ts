import { expect, test } from 'claude-code/testing'

import { healthAction, healthBaseline, scoreTurn, trendSlope, ema } from '../hooks/health'
import { proofCard } from '../hooks/proof'
import { wantsTogether, parseTasks } from '../hooks/split'

test('proof card lists what the turn actually checked', () => {
  const card = proofCard([
    { tool: 'Edit', isError: false, text: '' },
    { tool: 'Bash', command: 'claude plugin test .', isError: false, text: ' 114 pass\n 0 fail' },
    { tool: 'Bash', command: 'npm run build', isError: false, text: 'ok' },
    { tool: 'Bash', command: 'git commit -m x', isError: false, text: '' },
  ])
  expect(card).toBe('✓ tests 114 pass · ✓ build · ✗ not browser-checked · ✓ committed · – not pushed')
})

test('proof card shows a failing test run and stays quiet without edits', () => {
  expect(
    proofCard([
      { tool: 'Write', isError: false, text: '' },
      { tool: 'Bash', command: 'pytest -q', isError: true, text: '3 failed, 10 passed' },
    ]),
  ).toBe('✗ tests 3 failed · – no build · ✗ not browser-checked · – not committed · – not pushed')
  expect(proofCard([{ tool: 'Read', isError: false, text: '' }])).toBeNull()
})

test('proof card counts a browser check', () => {
  expect(proofCard([{ tool: 'Edit', isError: false, text: '' }, { tool: 'mcp__Claude_Browser__read_page', isError: false, text: '' }])).toContain('✓ browser-checked')
})

test('turn score falls with failures and corrections', () => {
  expect(scoreTurn({ toolErrors: 0, editMisses: 0, corrected: false, wasted: false })).toBe(1)
  expect(Math.abs(Number(scoreTurn({ toolErrors: 6, editMisses: 0, corrected: false, wasted: false })) - 0.6) < 1e-3).toBe(true)
  expect(Math.abs(Number(scoreTurn({ toolErrors: 1, editMisses: 1, corrected: true, wasted: true })) - 0.35) < 1e-3).toBe(true)
})

test('baseline uses the first five early turns', () => {
  const turns = [1, 0.9, 1, 0.8, 0.9, 0.2].map((s, i) => ({ score: s, ctxPct: 10 + i * 5 }))
  expect(Math.abs(Number(healthBaseline(turns)) - 0.92) < 1e-3).toBe(true)
  expect(healthBaseline(turns.slice(0, 3))).toBeNull()
})

test('ema and slope', () => {
  expect(Math.abs(Number(ema([1, 1, 0])) - 0.7) < 1e-3).toBe(true)
  expect(Math.abs(Number(trendSlope([1, 0.9, 0.8, 0.7])) - -0.1) < 1e-3).toBe(true)
})

test('a small dip does not refresh, a real drop does', () => {
  const early = [1, 1, 1, 1, 1].map(s => ({ score: s, ctxPct: 20 }))
  const slightly = [...early, ...[0.9, 0.85, 0.9].map(s => ({ score: s, ctxPct: 65 }))]
  expect(healthAction(slightly)).toBe('none')
  const badly = [...early, ...[0.6, 0.5, 0.45, 0.4].map(s => ({ score: s, ctxPct: 66 }))]
  expect(healthAction(badly)).toBe('refresh')
})

test('a falling trend refreshes before it gets there', () => {
  const early = [1, 1, 1, 1, 1].map(s => ({ score: s, ctxPct: 20 }))
  const falling = [...early, ...[0.95, 0.88, 0.82, 0.76].map(s => ({ score: s, ctxPct: 55 }))]
  expect(healthAction(falling)).toBe('refresh')
  expect(healthAction([...early, { score: 1, ctxPct: 86 }])).toBe('refresh')
})

test('split respects "together"', () => {
  expect(wantsTogether('do both of these in the same chat please')).toBe(true)
  expect(wantsTogether('fix the band. also add a dark mode')).toBe(false)
})

test('parseTasks keeps two to five real tasks', () => {
  expect(parseTasks(['Finish the mod layout lock', 'Queue the Nyx voice idea'])).toEqual(['Finish the mod layout lock', 'Queue the Nyx voice idea'])
  expect(parseTasks(['only one'])).toEqual([])
  expect(parseTasks(['a', '', 'b'])).toEqual([])
  expect(parseTasks('nope')).toEqual([])
})
