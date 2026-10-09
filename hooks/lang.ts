/** The owner's frequent typos, from the session audit; whole words only. */
export const TYPOS: Readonly<Record<string, string>> = {
  teh: 'the', hte: 'the', yhe: 'the', tje: 'the', adn: 'and', amke: 'make', mkae: 'make', simialr: 'similar',
  wnat: 'want', waht: 'what', taht: 'that', thier: 'their', tehir: 'their', ahve: 'have', liek: 'like',
  wiht: 'with', mroe: 'more', anotehr: 'another', evrything: 'everything', becuase: 'because', recieve: 'receive',
  coudl: 'could', shoudl: 'should', woudl: 'would', teh_: 'the', tehre: 'there', guithub: 'github', giuthub: 'github',
  downlaod: 'download', donwlaod: 'download', redessign: 'redesign', redesgin: 'redesign', optimzie: 'optimize',
  efficently: 'efficiently', ensurre: 'ensure', aalso: 'also', alsoo: 'also', contionue: 'continue', continiue: 'continue',
  finsih: 'finish', fininshed: 'finished', aplly: 'apply', baisc: 'basic', basicall: 'basically', dsign: 'design',
  intergrate: 'integrate', strucutre: 'structure', progam: 'program', makign: 'making', somehwere: 'somewhere',
}

// Spans left untouched: inline code, URLs, Windows and POSIX paths, @mentions.
const PROTECTED = /`[^`]*`|https?:\/\/\S+|[A-Za-z]:[\\/]\S*|(?:^|\s)\/\S+|@\S+|\S+\.(?:ts|tsx|js|py|md|json)\b/g

function fixWord(word: string, map: Readonly<Record<string, string>>): string | null {
  const right = map[word.toLowerCase()]
  if (right === undefined) return null
  if (word === word.toUpperCase() && word.length > 1) return right.toUpperCase()
  if (word[0] === word[0]?.toUpperCase()) return right.charAt(0).toUpperCase() + right.slice(1)
  return right
}

/** Whole-word typo fixes outside code, paths and links. */
export function autocorrect(text: string, extra: Readonly<Record<string, string>> = {}): { text: string; fixes: string[] } {
  const map = { ...TYPOS, ...extra }
  const fixes: string[] = []
  const fixRun = (run: string) =>
    run.replace(/\b[A-Za-z]+\b/g, w => {
      const r = fixWord(w, map)
      if (r === null) return w
      fixes.push(`${w}→${r}`)
      return r
    })
  let out = ''
  let last = 0
  for (const m of text.matchAll(PROTECTED)) {
    const at = m.index ?? 0
    out += fixRun(text.slice(last, at)) + m[0]
    last = at + m[0].length
  }
  out += fixRun(text.slice(last))
  return { text: out, fixes }
}

/** The owner's words for things, and what they mean. */
export const DEFAULT_GLOSSARY: Readonly<Record<string, string>> = {
  'the mod': 'Mission Control, this Claude Code mod',
  'handoff': '.mission-control/HANDOFF.md, the summary written before a context refresh',
  'publish': 'the ship checklist: tests, never-ship and secret checks, commit, push, deploy',
}

/** One context line naming each glossary term the text uses, or null. */
export function glossaryHints(text: string, glossary: Readonly<Record<string, string>>): string | null {
  const lower = text.toLowerCase()
  const hits = Object.entries(glossary).filter(([term]) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower))
  if (hits.length === 0) return null
  return `[glossary] ${hits.map(([t, m]) => `"${t}" = ${m}`).join(' · ')}`
}
