import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLOCK_TAG, clockLine, withClock } from '../bridge/clock.mjs'

const NOON_UTC = new Date('2026-11-18T17:42:00Z')

test('the clock line gives the weekday, date, time and zone', () => {
  assert.equal(
    clockLine(NOON_UTC, 'America/New_York'),
    '[Local time: Wednesday, November 18, 2026 at 12:42 PM EST (America/New_York)]',
  )
})

test('the clock line follows the zone, date included', () => {
  // Already Thursday in Tokyo.
  assert.match(clockLine(NOON_UTC, 'Asia/Tokyo'), /Thursday, November 19, 2026 at 2:42 AM/)
})

test('the clock line defaults to the machine zone', () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  assert.ok(clockLine(NOON_UTC).endsWith(`(${zone})]`))
})

test('withClock puts the line first and keeps the text intact', () => {
  const out = withClock('what time is it?', NOON_UTC, 'UTC')
  const [first, ...rest] = out.split('\n')
  assert.ok(first.startsWith(CLOCK_TAG))
  assert.equal(rest.join('\n'), 'what time is it?')
})
