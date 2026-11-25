/**
 * Save Twilio credentials so JARVIS can ring your phone.
 *
 *   npm run phone:connect
 *
 * You need, from https://console.twilio.com (a free trial works):
 *   - Account SID and Auth Token (Account Info on the console home page)
 *   - a Twilio phone number (Phone Numbers > Buy a number; trial credit covers it)
 * On a trial, also verify your own mobile under Phone Numbers > Verified Caller IDs.
 */
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { saveSecret } from '../bridge/secrets.mjs'
import { normalisePhone } from '../bridge/phone.mjs'

const rl = createInterface({ input, output })
console.log('\nConnect a phone line for JARVIS (Twilio).\n')
const sid = (await rl.question('Account SID (starts with AC): ')).trim()
const token = (await rl.question('Auth Token: ')).trim()
const from = normalisePhone((await rl.question('Your Twilio phone number: ')).trim())
rl.close()

if (!/^AC[0-9a-f]{32}$/i.test(sid) || !token || !from.startsWith('+')) {
  console.error('\nThat does not look right. Check the SID, token and number and run it again.')
  process.exit(1)
}
const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
  headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
})
if (!res.ok) {
  console.error(`\nTwilio rejected those credentials (${res.status}). Nothing was saved.`)
  process.exit(1)
}
saveSecret('twilio', { sid, token, from })
console.log('\nSaved. Restart JARVIS, then say "call me to test the phone line".')
