# JARVIS creator suite

JARVIS can run your channels: he makes vertical videos, posts them to YouTube,
TikTok and Instagram, tracks how they perform, works your two pipelines, handles
your products and brand deals, and watches your crypto.

| Piece | What it does | Setup |
|---|---|---|
| **YouTube** | Stats, analytics, comments, uploads, edits, playlists | [YOUTUBE.md](YOUTUBE.md) |
| **TikTok** | Profile stats, video list, posting | [SOCIAL.md](SOCIAL.md) |
| **Instagram** | Profile stats, insights, comments, posting Reels | [SOCIAL.md](SOCIAL.md) |
| **Studio** | Voiceovers, captions, vertical shorts, clips cut from your footage | ffmpeg (already installed). ElevenLabs key for voice and auto-captions |
| **Autopilot** | Makes and posts videos on a schedule, within daily limits | Say "turn on the autopilot" |
| **Pipelines** | Your **Agency leads** and **YouTube** boards | None. Board at <http://localhost:8787/board> |
| **Crypto** | Prices, your wallets (watch-only), payment QR codes, NFT packages | `JARVIS_WALLETS` (below) |

Start JARVIS with writes so he can render, post and run the autopilot:

```powershell
npm start -- --writes
```

---

## Studio

Every video is **1080×1920**, ready for Shorts, Reels and TikTok, and saved in
`~/.jarvis/workspace/studio/`.

- **AI shorts**: JARVIS writes the script, narrates it with ElevenLabs (word-timed
  captions included), generates visuals with whatever image or video server you
  have connected (e.g. Higgsfield), and renders it with slow zooms, bold captions
  and music.
- **Your footage**: drop videos in `~/.jarvis/workspace/footage/`. JARVIS
  transcribes them, picks the strongest moments, and cuts captioned vertical clips.
- **Voiceovers and auto-captions need `ELEVENLABS_API_KEY`.** The free tier is
  fine to start with. Without it, JARVIS can still caption from the script text.
- **Music**: use tracks you have the rights to, e.g. the YouTube Audio Library.
  Put them in `~/.jarvis/workspace/music/`.

Try saying: *"Make a 30-second short about why octopuses are smart."*
Or: *"Cut the three best moments from the podcast in my footage folder."*

## Autopilot

Try saying: *"Turn on the autopilot. Niche: budget travel tips. Post at 9am and
6pm, AI shorts, all three platforms."*

At each scheduled time, JARVIS checks what's working, writes and renders a new
video, and queues it. A publisher posts the queue automatically.

- **Daily cap**: 3 posts per platform per day by default (you can change it, up to
  10). Accounts that post like bots get throttled. The cap is enforced in code.
- Each post is tried 3 times. Failures and links are recorded in the queue: say
  *"what's in the queue?"*
- Paid partnerships and promotions of your own products are labelled the way
  TikTok requires.
- Stop it any time: *"turn off the autopilot"*, or start without `--writes`.

The autopilot only works while JARVIS is running. Leave `npm start -- --writes`
open, and keep the PC awake.

## Pipelines

Two boards, matching the stages you gave:

- **Agency leads**: RESEARCHED → SCORED → **APPROVED LEAD** → DEMO READY →
  **APPROVED TO SEND** → CONTACTED → REPLIED → MEETING → PROPOSAL → WON
- **YouTube**: IDEA → RESEARCH → SOURCES VERIFIED → SCRIPT → **SCRIPT APPROVED** →
  EDITING → UPLOAD DRAFT → PUBLISHED

The **bold stages are your decisions**, and the code holds JARVIS to that:

- He can't create cards in those stages or skip past them.
- The autopilot can never approve anything.
- A card moves into an approval stage only when you say so in conversation, or
  when you click **Approve** on the board.

Open the board at <http://localhost:8787/board>, or ask *"show me the agency
pipeline"*.

Try saying: *"Find 10 dentists in Manila without a decent website, score them,
and add them to the agency pipeline."* Or: *"Give me 5 video ideas for the
channel and add them to the YouTube board."*

To contact leads, JARVIS needs a mail tool. Connect a Gmail MCP server in
`~/.claude.json`, or set `JARVIS_ACCOUNT_CONNECTORS=1`.

## Agency loop

Try saying: *"Run the agency every 2 hours from 8 to 8. Towns: Winnipeg,
Brandon. Niches: plumbers, salons. Call me at 204 555 0100 when leads are
waiting."*

Every few hours inside the working window, an unattended JARVIS run works the
Agency leads board, following the design in `~/.jarvis/workspace/agency-system.md`:

1. **Scout**: searches Google for local businesses in your towns and niches.
   Businesses with no website come first.
2. **Auditor**: scores each one and keeps those with a public email or phone.
3. **Call sheet**: for each scored lead, writes `projects/agency/calls/<slug>.md`
   for **you** to make the call: opener, likely objections, which package fits,
   and the close. JARVIS does not make sales calls itself. In Canada, the CRTC
   bans automated or AI-voice sales calls without the business's consent.
4. **Builder**: builds a one-page demo for each lead, so you have it ready if
   they ask what it would look like. It goes live on Netlify only after you
   approve the lead, and only if `NETLIFY_AUTH_TOKEN` is set.
5. **Copywriter**, **Sender**: write the emails, then send them after you
   approve. Writing them needs an offer, a sender and a business address;
   sending also needs a mail tool.

The run stops at your two approval stages, every time. When it finishes, JARVIS
rings your phone if leads or pitches are waiting. Without a phone line it shows
a Windows notification instead. Say *"launch an agency run now"* to start one
straight away. The log is in `projects/agency/runs.log`.

**Phone line (Twilio).** A free trial works:

1. Sign up at <https://console.twilio.com> and get a trial phone number.
2. Under Phone Numbers > Verified Caller IDs, verify your own mobile. A trial can
   only call verified numbers.
3. Run `npm run phone:connect` and paste the Account SID, Auth Token and Twilio
   number.
4. Restart JARVIS and say *"call me to test the phone line"*.

Trial calls start with a short Twilio notice until you upgrade.

**Standing orders.** What you tell JARVIS to always do is kept in
`~/.jarvis/workspace/memory/core.md`. That file is read into every session,
including unattended runs, so an order you give once applies to the autopilot
and the agency loop as well.

## Selling

- **Your products and affiliate links**: *"Add my preset pack, $15, link
  gumroad.com/…"* JARVIS works the link into captions when it's relevant.
- **Brand deals**: *"Log a deal with Acme, $500, one TikTok, due the 30th."* He
  tracks it from lead to paid and can draft pitches.
- **Crypto payments**: see below.
- **Not supported: buying or selling accounts or followers.** Every platform bans
  it, and accounts that change hands usually get shut down.

## Crypto

Add your **public** receiving addresses before starting JARVIS. Never paste a
private key or seed phrase anywhere.

```powershell
$env:JARVIS_WALLETS = "eth:0xYourAddress,btc:bc1YourAddress,sol:YourSolAddress"
```

Chains: `eth`, `base`, `btc`, `sol`.

- *"What's Bitcoin doing this week?"* Prices and a chart.
- *"What are my wallets worth?"* Watch-only balances in USD.
- *"Make a payment QR for $15 in Solana for the preset pack."* A QR code for your
  own address, converted at the live rate. JARVIS can only use the addresses in
  `JARVIS_WALLETS`, so nothing he reads online can redirect your money.
- *"Did a payment come in?"* Recent incoming transactions.
- *"Turn this video into an NFT."* JARVIS packages the media and metadata. Add
  `PINATA_JWT` and he also uploads them to IPFS. You mint it yourself on Zora or
  OpenSea from your own wallet.

JARVIS holds no keys. He can't send, swap or trade crypto, and he doesn't give
investment advice.

## The brain: cloud or local

Switch it from the **Neural core** panel (top right of the HUD), or just say
*"switch to your local brain"* / *"switch back to the cloud"*. Jarvis restarts
his session in a few seconds; nothing to reload.

| Brain | Model | Cost | Good for |
|---|---|---|---|
| **Cloud** (default) | Claude Opus 5.5 | Included in your Claude subscription | Everything: videos, posting, pipelines, web, crypto |
| Cloud | Claude Fable 5.2 | Needs usage credits on claude.ai | The hardest jobs, when you want to pay for it |
| **Local** | Your Ollama models (qwen3.5:2b, qwen3.5:9b) | Free, offline, private | Laptop control and quick questions |

Local mode only gets the laptop tools: a small model can't drive the whole
creator suite. The first question after switching takes about a minute and a
half while the model reads its instructions. After that, replies take a few
seconds. The 2B model is the default because the 9B is several times slower on
this laptop.

Ollama has to use your **Radeon graphics**, not just the CPU. It's set up with
two user environment variables. Keep them:

```powershell
[Environment]::SetEnvironmentVariable('OLLAMA_IGPU_ENABLE','1','User')
[Environment]::SetEnvironmentVariable('OLLAMA_CONTEXT_LENGTH','32768','User')
```

Quit and reopen the Ollama app after changing them.

**When Claude hits its usage limit**, JARVIS switches to the local brain by
himself, starting Ollama first if it isn't running. He goes back to Claude when
the limit resets. He uses the reset time Claude reports, or tries again after an
hour. Video and agency runs wait until Claude is back: they need the full
toolset. Choosing a brain yourself ends the automatic fallback.

**Account connectors** such as Wix and Higgsfield need
`JARVIS_ACCOUNT_CONNECTORS=1`. It's saved as a user environment variable on this
PC.

## Laptop control

Jarvis runs this PC: *"how's my battery?"*, *"what's open?"*, *"open Spotify"*,
*"close Chrome"*, *"volume 30"*, *"mute"*, *"lock the screen"*, *"go to sleep"*,
*"shut down in two minutes"*, *"restart"*, *"cancel the shutdown"*.

- Shutdown and restart always run on a countdown (60 s by default). Windows
  shows a notice, and *"cancel the shutdown"* stops it.
- Sleep, shutdown and restart only happen when you ask in conversation. The
  autopilot never gets them, so nothing Jarvis reads online can switch the PC off.
- He won't start command shells or kill Windows system processes (or himself).
- Opening and closing apps needs `--writes`.


---

## Turning pieces off

Add the pieces to `JARVIS_DISABLE`, separated by commas:

```powershell
$env:JARVIS_DISABLE = "crypto,autopilot"
```

The names are `youtube`, `tiktok`, `instagram`, `studio`, `crypto`, `autopilot`,
`pipelines` and `system` (laptop control).

## Being realistic about earnings

The tools handle the work: making, posting, tracking, following up. Growth still
depends on the niche, the hooks and consistency. Expect weeks of daily posting
before anything takes off. Check the analytics with JARVIS weekly and adjust.
