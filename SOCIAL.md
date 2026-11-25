# Connecting TikTok, Instagram and Facebook

JARVIS posts through each platform's **official API**, signed in as you. Both
platforms make you register a free "developer app" first. Only you can do that,
because it's tied to your own account. Allow about 15 minutes for each platform.

You'll need a **redirect URI** for both. Use this one unless the console rejects it:

```
https://localhost:8443/callback
```

Nothing needs to be running there. After you approve, your browser lands on that
address and shows an error page. That's expected: you copy the address and
paste it back into the terminal.

---

## TikTok

### Steps you do yourself
1. Go to <https://developers.tiktok.com>, log in with your TikTok account, then
   **Manage apps → Connect an app**. Choose **Individual** if asked.
2. **App details**: add an icon, a name (e.g. `JARVIS Studio`), a category and a
   short description. Under **Platforms**, choose **Web** and enter any website
   you own. TikTok also asks for **Terms of Service** and **Privacy Policy** URLs.
   A public Notion page or GitHub Pages page works.
3. **Add products**:
   - **Login Kit**: add the redirect URI above.
   - **Content Posting API**: turn on **Direct Post**.
4. **Scopes**: tick `user.info.basic`, `user.info.profile`, `user.info.stats`,
   `video.list`, `video.publish` and `video.upload`.
5. **Sandbox** (top of the app page): create a sandbox and add **your own TikTok
   account** as a target user. This lets you use the app before TikTok reviews it.
6. Copy the **Client key** and **Client secret** from the app's credentials page.
7. Connect JARVIS:
   ```powershell
   npm run social:connect -- tiktok
   ```
   Paste the key, the secret and the redirect URI when asked. Approve in the
   browser, then paste the address you land on.

### Going public
Until TikTok audits your app, **every API post is private (only visible to
you)**. That's TikTok's rule. To post publicly, use **Submit for review** in the
developer portal and attach a short screen recording of JARVIS posting. Review
takes from a few days to a few weeks. Until then, JARVIS still uploads, and you
can make each video public from the TikTok app in one tap.

---

## Instagram

### Steps you do yourself
1. In the Instagram app, go to **Settings → Account type and tools → Switch to
   professional account** and choose **Creator** or **Business**. It's free, and
   API posting needs it.
2. Go to <https://developers.facebook.com>, then **My Apps → Create app**.
   Pick the use case **"Manage messaging & content on Instagram"**, and choose
   **Business** if asked for an app type.
3. In the app dashboard: **Instagram → API setup with Instagram login**.
   - Copy the **Instagram app ID** and **Instagram app secret**. These are the
     Instagram ones, *not* the Facebook App ID at the top of the page.
   - Under **Set up Instagram business login → Business login settings**, add
     the redirect URI above to **OAuth redirect URIs** and save.
4. **App roles → Roles → Instagram testers**: add your Instagram username.
   Then accept the invite in Instagram, at **Settings → Website permissions →
   Apps and websites → Tester invites**, or at
   <https://www.instagram.com/accounts/manage_access/>.
5. Leave the app in **Development** mode. That's enough for your own account,
   so you don't need App Review.
6. Connect JARVIS:
   ```powershell
   npm run social:connect -- instagram
   ```
   Paste the app ID, the secret and the redirect URI. Approve, then paste the
   address you land on.

The sign-in lasts 60 days. JARVIS renews it automatically whenever he uses it
in the last week before it expires. If it lapses anyway, run the connect
command again.

---

## Facebook Page

JARVIS posts Reels to a Facebook **Page** (not a personal profile).

### Steps you do yourself
1. Make a Page if you don't have one: <https://www.facebook.com/pages/create>.
2. At <https://developers.facebook.com>, **My Apps → Create app**. Pick the use
   case **"Manage everything on your Page"** (or add **Facebook Login for
   Business** to an existing app).
3. In **App settings → Basic**, copy the **App ID** and **App secret**.
4. In **Facebook Login → Settings**, add the redirect URI above to **Valid
   OAuth Redirect URIs** and save.
5. Leave the app in **Development** mode. It works for Pages you manage without
   App Review.
6. Connect JARVIS:
   ```powershell
   npm run social:connect -- facebook
   ```
   Paste the App ID, the secret and the redirect URI. On Facebook's screen, tick
   the Page and allow posting. If you manage several Pages, the terminal asks
   which one.

The Page sign-in doesn't expire while you stay an admin of the Page and keep the
app. Reels are labelled as AI-generated, as Meta asks.

---

## More than one channel

The autopilot can run up to **5 channels**, each with its own niche and its own
accounts. You make the accounts and channels yourself: JARVIS can't, and
platforms ban accounts that bots create.

- **YouTube**: one Google account can own several channels. Make one at
  <https://www.youtube.com/account> → **Add or manage your channel(s)** →
  **Create a channel**.
- **TikTok**: in the app, tap your profile name → **Add account**.
- **Instagram**: **Settings → Add account**, then switch it to Professional.
- **Facebook**: make another Page at <https://www.facebook.com/pages/create>.

Then connect each one under the channel's name. The same developer apps work for
every account:

```powershell
npm run youtube:connect -- --account cooking
npm run social:connect -- tiktok --account cooking
npm run social:connect -- instagram --account cooking
npm run social:connect -- facebook --account cooking
```

On TikTok and Instagram, use an account you added as a tester (or make it the
one you're signed in as). On YouTube, pick the right channel on Google's screen.

Finally tell JARVIS: *"Add a channel called cooking: ten-minute dinners, post at
10am on all four platforms."* The `cooking` channel posts with the accounts
connected as `cooking`, and the bridge log lists them as
`[jarvis] extra channel accounts: ...`.

---

## Restart JARVIS

```powershell
npm start -- --writes
```

The bridge log shows which platforms are connected:
`[jarvis] creator: youtube connected · tiktok connected · instagram connected · facebook connected`.

To start over with different app details, run `npm run social:connect -- tiktok --reset`.
