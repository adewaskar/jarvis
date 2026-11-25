import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { readSecret, safe } from './secrets.mjs'
import { callPhone, normalisePhone, phoneReady, toast } from './phone.mjs'
import { clientSlug, prepareDocs } from './client-docs.mjs'

/**
 * The agency loop: JARVIS working the Agency leads board on a timer.
 *
 * Every N hours inside the working window, a headless JARVIS session runs
 * the conductor brief (the design in <workspace>/agency-system.md): find
 * leads, score them, build demos for approved leads, write pitches. It can
 * never approve anything, because the pipelines server refuses approvals
 * from headless sessions. Steps that need something the user hasn't given
 * yet (hosting, offer, a mail tool) are skipped and reported, not faked.
 *
 * After a run, if new cards are waiting at one of the user's two gates, JARVIS
 * rings the user's phone (Twilio), or shows a Windows notification if no
 * phone line is set up.
 */

const DEFAULTS = {
  enabled: false,
  everyHours: 2,
  from: '08:00',
  to: '20:00',
  country: '',
  towns: [],
  niches: [],
  leadsPerRun: 10,
  offer: '',
  senderName: '',
  senderEmail: '',
  businessAddress: '',
  paymentLink: '',
  ownerPhone: '',
  call: 'new-approvals', // 'new-approvals' | 'every-run' | 'never'
  // Paperwork (templates/agency): who the agency is and its standard terms.
  agencyName: '',
  governingLaw: '', // e.g. "the Province of Manitoba and the federal laws of Canada that apply there"
  depositPercent: 50,
  revisionRounds: 2,
  careFee: '', // e.g. "$29 a month"
  lastRun: null,
  lastNotified: { scored: 0, demo_ready: 0 },
}

const hhmm = () => new Date().toTimeString().slice(0, 5)

export function createAgency({ workspace, allowWrites, runAgent, pipelines }) {
  const dir = join(workspace, 'projects', 'agency')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'settings.json')
  const logFile = join(dir, 'runs.log')

  const settings = () => {
    try {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) }
    } catch {
      return structuredClone(DEFAULTS)
    }
  }
  const save = (s) => {
    writeFileSync(file + '.tmp', JSON.stringify(s, null, 2))
    renameSync(file + '.tmp', file)
  }
  const log = (line) => appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)

  const hosting = () => Boolean(process.env.NETLIFY_AUTH_TOKEN || readSecret('netlify')?.token)
  const gateCounts = () => {
    const st = pipelines?.summary('agency')?.stages ?? []
    const n = (k) => st.find((x) => x.stage === k)?.count ?? 0
    return { scored: n('scored'), demo_ready: n('demo_ready') }
  }

  /** What is configured, and so which agents can run. */
  function readiness(s = settings()) {
    return {
      scout: Boolean(s.towns.length && s.niches.length),
      builder: true,
      hosting: hosting(),
      copywriter: Boolean(s.offer && s.senderName && s.businessAddress),
      closer: Boolean(s.offer && s.paymentLink),
      phone: phoneReady() && Boolean(s.ownerPhone),
      documents: Boolean((s.agencyName || s.senderName) && s.businessAddress && s.senderEmail && s.governingLaw),
    }
  }

  function brief(s) {
    const r = readiness(s)
    const design = join(workspace, 'agency-system.md')
    return `AGENCY RUN: nobody is listening. Work quietly through the tools.

You are the Conductor of the agency system${existsSync(design) ? ` designed in ${design} (read it first)` : ''}.
Board: jarvis_pipelines, board "agency". Working folder: ${dir}

Settings:
- Country: ${s.country || 'not set'} · Towns: ${s.towns.join(', ') || 'not set'} · Niches: ${s.niches.join(', ') || 'not set'}
- New leads this run: at most ${s.leadsPerRun}
- Offer / price sheet: ${s.offer || 'NOT SET'}
- Sender: ${s.senderName || 'NOT SET'} <${s.senderEmail || 'not set'}> · Address: ${s.businessAddress || 'NOT SET'}
- Payment link: ${s.paymentLink || 'NOT SET'}
- Demo hosting (Netlify token in NETLIFY_AUTH_TOKEN): ${r.hosting ? 'ready' : 'NOT SET'}
- Client paperwork (agency name, address, email, governing law): ${r.documents ? 'ready' : 'NOT SET'}

Do, in order, only what the settings allow:
1. SCOUT${r.scout ? '' : ' (skip: no towns/niches)'}: Search Google (WebSearch: "<niche> <town>", Google Maps and directory results, Facebook pages) for real, operating local businesses in those niches and towns. Businesses with NO website at all come first; then Facebook-only or directory-only; then clearly outdated sites. Rotate niches and towns across runs so all of them get covered. Skip chains, closed businesses, and any company already on the board. create_pipeline_card in "researched" with company, website ("none" if none), phone, niche, location, source.
2. AUDITOR: for every card in "researched", check the site (WebFetch; curl via Bash for HTTPS and speed), find a PUBLIC business email and phone, and score 0-100 by the design's weights. Score >= 60 with a public email or phone: move to "scored" with score, a one-sentence why, email and/or phone and the page each came from. Otherwise move to "lost" with the reason.
3. CALL SHEET: for every card in "scored" without one, write ${join(dir, 'calls')}\\<slug>.md for the OWNER to make the call: business, phone, best time to call, who to ask for, a 20-second opener in plain words that names one real gap you found, the three likely objections with honest answers, which package fits and its published price, and the close (book a 15-minute look at their demo; the owner confirms the price and signs, never you). Put callSheet and the path on the card. You never place sales calls yourself: automated or AI-voice sales calls without consent are not allowed under Canada's CRTC telemarketing rules.
4. STOP at APPROVED LEAD. Never move a card into approved_lead or approved_to_send.
5. BUILDER + CRITIC: for every card in "scored" or "approved_lead" without a demo, build a one-page, mobile-first demo site in ${join(dir, 'demos')}\\<slug>\\ that looks like a business paid for it:
   a. VIDEO FIRST: make 3-5 pictures with create_image (1920x1080) that set the mood of the trade (tools, materials, the finished result, the town's feel), with no people, no faces, no storefronts, no logos and no text, so nothing pretends to be the real business. Then render_hero_video with outDir set to the demo folder, and use its snippet as the hero background.
   b. The page (index.html): hero with the business name, one clear line about what they do and where, and a call/book button with their real phone; services; why choose them (only facts you found); hours, area served and a map link; contact. Real facts only: no invented prices, reviews, awards, staff or years in business. Clean typography, strong contrast, fast (no frameworks).
   c. Footer: the short demo notice from prepare_client_documents (stage "before"), so the business can see who made it and how to have it removed.
   Put demoPath on the card so the owner can show it on a call. ${r.hosting ? 'Only for cards in approved_lead, deploy it with `npx --yes netlify-cli deploy --prod --dir <folder> --site <slug>-demo` (create the site first if needed) and put the live URL in demoUrl.' : 'Hosting is not set up: leave the card where it is with the note "demo built locally, waiting for hosting".'} Check it like the Critic: correct name, phone, hours, no placeholder text, works on mobile.
6. COPYWRITER${r.copywriter ? '' : ' (skip: offer, sender or address not set)'}: for cards with a live demoUrl, run prepare_client_documents (stage "before") with the card's facts, so the proposal and terms, the full demo notice and the outreach privacy notice exist. Then write the subject, first email (under 120 words), follow-up 1 (day 3) and follow-up 2 (day 7), with the sender's name, the business address, an opt-out line and the demo notice. Save them and the documents folder (documentsBefore) on the card and move it to "demo_ready". If prepare_client_documents reports anything missing, say what in the card note and do not move it. STOP at APPROVED TO SEND.
7. SENDER and CLOSER: only if a mail tool is connected in this session. Send exactly what was approved for cards in "approved_to_send". If there is no mail tool, do nothing here.
8. AFTER SIGNING: for every card in "won" without documentsAfter, run prepare_client_documents (stage "after", with the card id and the agreed package, price, domain and contact). Put documentsAfter on the card and note what the owner must do: get the service agreement signed and the deposit paid, then work through launch-checklist.md. You never sign, e-sign or accept terms for anyone. Copy privacy.html and terms.html into the client's site folder and link them in the footer only after the owner confirms the agreement is signed.
9. Log one line per action to ${logFile}.

Finish with exactly one line starting "SUMMARY:" saying what moved and what is waiting for the user.`
  }

  async function notify(summary, force = false) {
    const s = settings()
    const counts = gateCounts()
    const fresh = counts.scored > (s.lastNotified?.scored ?? 0) || counts.demo_ready > (s.lastNotified?.demo_ready ?? 0)
    const want = force || s.call === 'every-run' || (s.call === 'new-approvals' && fresh)
    s.lastNotified = counts
    save(s)
    if (!want || s.call === 'never') return { notified: false, counts }
    const waiting = []
    if (counts.scored) waiting.push(`${counts.scored} new lead${counts.scored === 1 ? '' : 's'} to call or approve`)
    if (counts.demo_ready) waiting.push(`${counts.demo_ready} pitch${counts.demo_ready === 1 ? '' : 'es'} ready to send`)
    const say = `Hello, this is Jarvis. The agency run is finished. ${waiting.length ? `You have ${waiting.join(' and ')}. Open the board when you can.` : 'Nothing needs you right now.'} Goodbye.`
    if (readiness(s).phone) {
      try {
        const r = await callPhone(s.ownerPhone, say)
        log(`called owner: ${r.sid}`)
        return { notified: 'call', sid: r.sid, counts }
      } catch (e) {
        log(`call failed: ${e.message}`)
      }
    }
    await toast('JARVIS', waiting.length ? waiting.join(' · ') : String(summary ?? 'Agency run finished').slice(0, 180))
    return { notified: 'notification', counts }
  }

  let running = false
  async function runNow(reason = 'schedule') {
    if (running) return { started: false, why: 'a run is already going' }
    running = true
    const s = settings()
    s.lastRun = new Date().toISOString()
    save(s)
    log(`run started (${reason})`)
    console.log(`[agency] run started (${reason})`)
    try {
      const out = String(await runAgent(brief(s)))
      const summary = out.match(/SUMMARY:.*$/m)?.[0] ?? out.slice(-300)
      log(summary)
      console.log(`[agency] ${summary}`)
      await notify(summary)
      return { started: true, summary }
    } catch (e) {
      log(`run failed: ${e.message}`)
      console.warn(`[agency] run failed: ${e.message}`)
      return { started: true, error: e.message }
    } finally {
      running = false
    }
  }

  function due(s = settings()) {
    if (!s.enabled) return false
    const now = hhmm()
    if (now < s.from || now >= s.to) return false
    return !s.lastRun || Date.now() - new Date(s.lastRun).getTime() >= s.everyHours * 3600e3 - 60e3
  }

  let timer = null
  function start() {
    if (!allowWrites || timer) return
    timer = setInterval(() => {
      if (due()) void runNow()
    }, 60_000)
    timer.unref?.()
  }

  const reads = [
    tool(
      'get_agency_settings',
      'The agency loop: whether it runs, how often, working hours, targeting, offer, sender, phone, what is ready and what is missing, last run and the recent log.',
      {},
      safe(async () => {
        const s = settings()
        let recent = []
        try {
          recent = readFileSync(logFile, 'utf8').trim().split('\n').slice(-8)
        } catch {
          /* no runs yet */
        }
        return { ...s, ready: readiness(s), running, waitingAtGates: gateCounts(), recent }
      }),
    ),
  ]

  const writes = [
    tool(
      'update_agency_settings',
      'Turn the agency loop on or off and set: everyHours, working window (from/to HH:MM), country, towns, niches, leadsPerRun, offer (packages, prices, hosting fee, max discount, turnaround), senderName, senderEmail, businessAddress, paymentLink, ownerPhone, call (new-approvals, every-run or never), and the paperwork terms: agencyName, governingLaw (e.g. "the Province of Manitoba and the federal laws of Canada that apply there"), depositPercent, revisionRounds, careFee.',
      {
        enabled: z.boolean().optional(),
        everyHours: z.number().min(1).max(24).optional(),
        from: z.string().regex(/^\d\d:\d\d$/).optional(),
        to: z.string().regex(/^\d\d:\d\d$/).optional(),
        country: z.string().max(80).optional(),
        towns: z.array(z.string().max(80)).max(30).optional(),
        niches: z.array(z.string().max(80)).max(30).optional(),
        leadsPerRun: z.number().int().min(1).max(25).optional(),
        offer: z.string().max(3000).optional(),
        senderName: z.string().max(100).optional(),
        senderEmail: z.string().max(200).optional(),
        businessAddress: z.string().max(300).optional(),
        paymentLink: z.string().max(500).optional(),
        ownerPhone: z.string().max(30).optional(),
        call: z.enum(['new-approvals', 'every-run', 'never']).optional(),
        agencyName: z.string().max(120).optional(),
        governingLaw: z.string().max(200).optional(),
        depositPercent: z.number().int().min(0).max(100).optional(),
        revisionRounds: z.number().int().min(0).max(10).optional(),
        careFee: z.string().max(100).optional(),
      },
      safe(async (patch) => {
        const s = { ...settings(), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) }
        if (patch.ownerPhone) s.ownerPhone = normalisePhone(patch.ownerPhone)
        save(s)
        return { saved: true, ...s, ready: readiness(s) }
      }),
    ),
    tool(
      'prepare_client_documents',
      `Fill in the agency's paperwork for one business, from templates. stage "before" (while pitching):
proposal-and-terms, demo-notice (its short version goes in the demo footer) and outreach-privacy.
stage "after" (only once the client has signed; the card must be in "won"): service-agreement,
care-plan, the client site's privacy policy and terms (also as privacy.html and terms.html) and the
launch checklist. Returns the files and anything still missing; never send a document with a gap.
The owner signs and sends; you never sign or accept anything for anyone.`,
      {
        company: z.string().min(1).max(120),
        stage: z.enum(['before', 'after']),
        cardId: z.string().optional(),
        facts: z
          .object({
            contact: z.string().max(120).optional().describe("Client's signer, e.g. 'Maria Lopez, owner'"),
            address: z.string().max(300).optional(),
            email: z.string().max(200).optional(),
            phone: z.string().max(40).optional(),
            domain: z.string().max(120).optional(),
            package: z.string().max(120).optional(),
            packageDetails: z.string().max(600).optional(),
            price: z.string().max(60).optional(),
            turnaround: z.string().max(60).optional(),
            demoUrl: z.string().max(300).optional(),
            analytics: z.string().max(300).optional().describe('One sentence on analytics/cookies; default: none used'),
          })
          .optional(),
        carePlan: z.boolean().optional().describe('Include the hosting and care plan (default: when a care fee is set)'),
      },
      safe(async ({ company, stage, cardId, facts = {}, carePlan }) => {
        const s = settings()
        if (stage === 'after') {
          const c = cardId && pipelines?.card ? pipelines.card(cardId) : null
          if (!c) throw new Error('Give the card id: after-signing documents are only made for a card in "won".')
          if (c.stage !== 'won') throw new Error(`That card is in "${c.stage}". Move it to "won" once the client has signed, then try again.`)
        }
        const values = {
          AGENCY_NAME: s.agencyName || s.senderName,
          AGENCY_ADDRESS: s.businessAddress,
          AGENCY_EMAIL: s.senderEmail,
          AGENCY_SIGNER: s.senderName,
          GOVERNING_LAW: s.governingLaw,
          DATE: new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }),
          DEPOSIT_PERCENT: s.depositPercent,
          REVISION_ROUNDS: s.revisionRounds,
          CARE_FEE: s.careFee,
          PAYMENT_LINK: s.paymentLink,
          CLIENT_BUSINESS: company,
          CLIENT_CONTACT: facts.contact,
          CLIENT_ADDRESS: facts.address,
          CLIENT_EMAIL: facts.email,
          CLIENT_PHONE: facts.phone,
          DOMAIN: facts.domain,
          PACKAGE: facts.package,
          PACKAGE_DETAILS: facts.packageDetails,
          PRICE: facts.price,
          TURNAROUND: facts.turnaround,
          DEMO_URL: facts.demoUrl,
          ANALYTICS_SENTENCE: facts.analytics || 'We do not use analytics or advertising cookies.',
        }
        const out = await prepareDocs({
          stage,
          outDir: join(dir, 'clients', clientSlug(company), stage),
          values,
          includeCarePlan: carePlan ?? Boolean(s.careFee),
        })
        log(`documents (${stage}) for ${company}: ${out.files.length} files${Object.keys(out.missing).length ? ', missing ' + JSON.stringify(out.missing) : ''}`)
        return {
          ...out,
          ready: Object.keys(out.missing).length === 0,
          note: Object.keys(out.missing).length
            ? 'Some details are missing (shown as [[MISSING: ...]] in the files). Fill them in before anything is sent.'
            : 'Ready for the owner to review. These are templates: the owner should have a lawyer look at them once before first use.',
        }
      }),
    ),
    tool(
      'launch_agency_run',
      'Start an agency run now instead of waiting for the next slot. It runs in the background; JARVIS calls or notifies the user when it finishes.',
      {},
      safe(async () => {
        if (running) return { started: false, why: 'a run is already going' }
        void runNow('asked')
        return { started: true, note: 'Running in the background. The user gets a call or notification when it is done.' }
      }),
    ),
    tool(
      'call_owner',
      "Ring the user's phone and say a short message (Twilio). Only when the user asked for a call or a finished job warrants it.",
      { message: z.string().min(1).max(600) },
      safe(async ({ message }) => {
        const s = settings()
        if (!s.ownerPhone) throw new Error('No phone number saved. Set ownerPhone with update_agency_settings.')
        if (!phoneReady()) throw new Error('No phone line yet: Twilio is not set up (npm run phone:connect; see CREATOR.md).')
        const r = await callPhone(s.ownerPhone, message)
        return { calling: s.ownerPhone, sid: r.sid }
      }),
    ),
  ]

  // Unattended runs (live: false) get only the paperwork: they must not start
  // another run, change the settings or ring the phone.
  const makeServer = ({ live = true } = {}) =>
    createSdkMcpServer({
      name: 'jarvis_agency',
      version: '1.0.0',
      instructions: 'The agency loop that works the Agency leads board on a timer, its client paperwork, and calling the user when a run needs them.',
      tools: !allowWrites ? reads : live ? [...reads, ...writes] : [...reads, ...writes.filter((t) => t.name === 'prepare_client_documents')],
    })

  return { makeServer, start, runNow, settings, readiness }
}
