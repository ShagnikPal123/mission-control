import { expect, test } from 'claude-code/testing'

import { pickAgent } from '../hooks/agents'
import { ROUTER_PROMPT } from '../hooks/route'

test('the router rubric splits haiku, sonnet and opus', () => {
  const p = ROUTER_PROMPT('x', 'y')
  expect(p).toMatch(/tiny: .*haiku/)
  expect(p).toMatch(/medium: .*sonnet/)
  expect(p).toMatch(/large: .*opus/)
  expect(p).toMatch(/big projects/i)
})

test('with the opus preference, build work goes to opus', () => {
  expect(pickAgent('general-purpose', 'implement the login form', true)).toEqual({ model: 'opus', effort: 'medium' })
  expect(pickAgent('general-purpose', 'implement the login form', false)).toEqual({ model: 'sonnet', effort: 'medium' })
  expect(pickAgent('Explore', 'look around', true)).toEqual({ model: 'haiku', effort: 'low' })
})
