/**
 * What time it is, for the model.
 *
 * The model has no clock. Nothing in the session tells it the date or the
 * time, so "what time is it?" gets "I have no clock access" and "remind me of
 * tomorrow's meetings" has to guess what tomorrow is.
 *
 * The line goes on each user message rather than into the system prompt. A
 * session lasts as long as the page is open, and a time fixed at startup would
 * be hours stale by the evening; the system prompt also stays byte-identical
 * across turns, which keeps it cacheable. The persona is told what the line is
 * (PROMPT_CORE), so it is read as context and not answered as speech.
 *
 * The bridge's own clock and time zone are used: it runs on the user's
 * machine, next to the browser that heard them.
 */

export const CLOCK_TAG = '[Local time:'

/** "[Local time: Wednesday, November 18, 2026 at 1:42 PM EST (America/New_York)]" */
export function clockLine(now = new Date(), timeZone) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(now)
  return `${CLOCK_TAG} ${when} (${zone})]`
}

/** The user's text with the clock line in front of it. */
export function withClock(text, now = new Date(), timeZone) {
  return `${clockLine(now, timeZone)}\n${text}`
}
