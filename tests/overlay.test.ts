import { expect, mock, test } from 'claude-code/testing'

import { fakeEngine } from './kit'

test('the overlay starts with the session on Windows', async ($, on) => {
  mock.store(on)
  fakeEngine(on, { env: { OS: 'Windows_NT' } })
  const runs: string[][] = []
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })

  expect(runs.some(a => a.join(' ').includes('mc_overlay.py') && a.includes('pythonw'))).toBe(true)
})

test('the overlay stays off when switched off', async ($, on) => {
  mock.store(on, { 'mc.settings': { overlay: false } })
  fakeEngine(on, { env: { OS: 'Windows_NT' } })
  const runs: string[][] = []
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: 'C:/p', surface: 'terminal', isInteractive: true })

  expect(runs.length).toBe(0)
})
