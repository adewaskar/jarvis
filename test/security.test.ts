import { describe, it } from 'node:test'
import assert from 'node:assert'
import { SecurityManager } from '../src/lib/security.ts'

describe('Security & Permissions Manager Tests', () => {
  it('should allow reads and writes by default', () => {
    const sec = new SecurityManager()
    assert.strictEqual(sec.canWrite(), true)
    assert.doesNotThrow(() => sec.assertPermission('files', 'read'))
    assert.doesNotThrow(() => sec.assertPermission('shell', 'write'))
  })

  it('should block writes when read-only mode is enabled', () => {
    const sec = new SecurityManager()
    sec.setReadOnly(true)

    assert.strictEqual(sec.canWrite(), false)
    assert.doesNotThrow(() => sec.assertPermission('files', 'read'))
    assert.throws(() => sec.assertPermission('files', 'write'), /READ-ONLY mode/)
    assert.throws(() => sec.assertPermission('shell', 'execute'), /READ-ONLY mode/)
  })

  it('should block specific capabilities when configured', () => {
    const sec = new SecurityManager()
    sec.setBlocked('shell', true)

    assert.strictEqual(sec.isBlocked('shell'), true)
    assert.throws(() => sec.assertPermission('shell', 'read'), /BLOCKED/)
    assert.doesNotThrow(() => sec.assertPermission('files', 'read'))
  })
})
