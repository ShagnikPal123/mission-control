import { expect, test } from 'claude-code/testing'

import { autocorrect, DEFAULT_GLOSSARY, glossaryHints } from '../hooks/lang'
import { fakeEngine } from './kit'

test('autocorrect fixes known typos and keeps case', () => {
  expect(autocorrect('Make sure teh band is simialr adn Teh rest too').text).toBe('Make sure the band is similar and The rest too')
  expect(autocorrect('amke it wnat I said').fixes).toEqual(['amke→make', 'wnat→want'])
})

test('autocorrect leaves code, paths and links alone', () => {
  const t = 'fix `teh` in C:/teh/adn.ts and https://x.io/teh but teh word'
  expect(autocorrect(t).text).toBe('fix `teh` in C:/teh/adn.ts and https://x.io/teh but the word')
})

test('extra typos from the store are used', () => {
  expect(autocorrect('cuirits here', { cuirits: 'circuits' }).text).toBe('circuits here')
})

test('glossary hints name what the owner means', () => {
  const mine = { 'second mind': 'the Second Brain panel', 'big kahuna': 'Identity 0' }
  expect(glossaryHints('bring back the second mind and talk to big kahuna', mine)).toBe(
    '[glossary] "second mind" = the Second Brain panel · "big kahuna" = Identity 0',
  )
  expect(glossaryHints('nothing special here', DEFAULT_GLOSSARY)).toBeNull()
})

test('a typed prompt is corrected and carries the glossary', async ($, on) => {
  fakeEngine(on)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })

  const r = await $.prompt.submit({ text: 'amke the mod come back adn test it' })

  expect(r.text).toBe('make the mod come back and test it')
  expect(r.context?.some(c => c.startsWith('[glossary] "the mod"'))).toBe(true)
})

test('the local config adds the owner\'s own words, docs and projects', async ($, on) => {
  fakeEngine(on, { env: { USERPROFILE: 'C:\\Users\\me' } })
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('fs.read', (_, e) => {
    if (!e.path.replace(/\\/g, '/').endsWith('/.claude/mission-control/config.json')) return { deny: 'no such file' }
    return { value: JSON.stringify({ glossary: { 'second mind': 'the Second Brain panel' }, docs: ['AI_HANDOFF/START_HERE.md'] }) }
  })
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })

  const r = await $.prompt.submit({ text: 'bring back the second mind' })

  expect(r.context?.some(c => c === '[glossary] "second mind" = the Second Brain panel')).toBe(true)
})
