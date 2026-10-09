import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { expect, mock, test } from 'claude-code/testing'

import { fakeEngine } from './kit'

const START = { cwd: 'C:/p', surface: 'terminal', isInteractive: true } as const

function commands(on: On) {
  const names: string[] = []
  on('command.register', (_, e) => {
    names.push(e.name)
    return { value: { command: e.name } }
  })
  return names
}

async function mc($: Engine, args: string) {
  return (await $.command.run({ command: 'mc', args })).text ?? ''
}

test('/mc is registered at start', async ($, on) => {
  fakeEngine(on)
  const names = commands(on)
  await $.session.start(START)
  expect(names).toContain('mc')
})

test('/mc with no args shows the state', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  commands(on)
  await $.session.start(START)

  const text = await mc($, '')

  expect(text).toContain('Context')
  expect(text).toContain('Router: on (auto)')
  expect(text).toContain('Agents: 0/3')
  expect(text).toContain('Auto-resume: on')
  expect(text).toContain('Alerts: on')
  expect(text).toContain('Midnight: off')
})

test('/mc model pin and auto', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  commands(on)
  await $.session.start(START)

  expect(await mc($, 'model pin opus')).toBe('Pinned opus.')
  expect(await mc($, '')).toContain('Router: pinned opus')
  expect(await mc($, 'model auto')).toBe('Router choosing automatically.')
  expect(await mc($, 'model pin gpt')).toMatch(/^Usage: /)
})

test('/mc agents sets the cap', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  commands(on)
  await $.session.start(START)

  expect(await mc($, 'agents 5')).toBe('Agent cap 5.')
  expect(await mc($, '')).toContain('Agents: 0/5')
  expect(await mc($, 'agents 99')).toMatch(/^Usage: /)
})

test('/mc resume and alerts toggle', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  commands(on)
  await $.session.start(START)

  expect(await mc($, 'resume off')).toBe('Auto-resume off.')
  expect(await mc($, 'alerts off')).toBe('Alerts off.')
  const text = await mc($, '')
  expect(text).toContain('Auto-resume: off')
  expect(text).toContain('Alerts: off')
})

test('/mc tokens reports the ledger', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  commands(on)
  await $.session.start(START)

  expect(await mc($, 'tokens')).toContain('Turns: 0 · output tokens: 0')
})

test('/mc settings persist to the store', async ($, on) => {
  const stored: Record<string, unknown> = {}
  on('store.set', (_, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('store.get', (_, e) => ({ value: stored[e.key] }))
  fakeEngine(on)
  commands(on)
  await $.session.start(START)

  await mc($, 'model pin opus')

  expect((stored['mc.settings'] as { pin: string }).pin).toBe('opus')
})

test('/mc rejects unknown input with usage', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  commands(on)
  await $.session.start(START)

  expect(await mc($, 'banana')).toMatch(/^Usage: \/mc /)
})

test('/mc router off stops the router rewriting anything', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  commands(on)
  await $.session.start(START)

  expect(await mc($, 'router off')).toBe('Router off.')
  expect(await mc($, '')).toContain('Router: off')
  expect(await mc($, 'router on')).toBe('Router on.')
})

test('/mc panel opens the side panel and says when it cannot', async ($, on) => {
  mock.store(on)
  fakeEngine(on)
  commands(on)
  let placed = true
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'no room beside the chat' } }
  })
  await $.session.start(START)

  expect(await mc($, 'panel')).toBe('Side panel opened.')
  expect(opened).toEqual(['mc-side'])
  placed = false
  expect(await mc($, 'panel')).toBe('The side panel could not open: no room beside the chat. Use the Side layout, or widen the window.')
})
