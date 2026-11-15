import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginState, nodeVersionOk } from '../scripts/checks.mjs'

test('nodeVersionOk follows the Vite range, not just the major version', () => {
  for (const v of ['20.19.0', 'v20.19.5', '22.12.0', '22.23.4', '23.0.0', '24.1.0']) {
    assert.equal(nodeVersionOk(v), true, v)
  }
  for (const v of ['18.20.0', '20.0.0', '20.18.9', '21.7.3', '22.11.0', 'garbage', '']) {
    assert.equal(nodeVersionOk(v), false, v)
  }
})

test('loginState reads claude auth status and admits when it cannot', () => {
  assert.equal(loginState('{"loggedIn": true, "authMethod": "oauth_token"}'), 'yes')
  assert.equal(loginState('{"loggedIn": false}'), 'no')
  assert.equal(loginState('error: unknown command "auth"'), 'unknown')
  assert.equal(loginState('{"something": "else"}'), 'unknown')
  assert.equal(loginState(''), 'unknown')
})
