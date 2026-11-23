# Connecting JARVIS to your YouTube channel

JARVIS talks to YouTube through Google's official APIs, signed in as **you**.
Steps 1–6 need your own Google account, so you have to do them yourself in the
browser. They take about 10 minutes, and you only do them once.

---

## Steps you do yourself (one time)

### 1. Create a Google Cloud project
1. Go to <https://console.cloud.google.com/> and sign in with the **same Google
   account that owns your YouTube channel**.
2. Use the project picker at the top, then **New Project**. Name it `jarvis` and click **Create**.
3. Make sure the new project is selected in the top bar.

### 2. Turn on the two YouTube APIs
In **APIs & Services → Library**, search for each of these and click **Enable**:
- **YouTube Data API v3**
- **YouTube Analytics API**

### 3. Set up the consent screen
1. **APIs & Services → OAuth consent screen**. (On newer consoles this is **Google Auth Platform → Branding**.)
2. User type: **External**. App name: `JARVIS`. Enter your email for the support and developer contact fields.
3. Skip scopes. They get requested at sign-in.
4. **Audience / Test users**: click **Add users** and add **your own Gmail**.
   *(This step matters. Without it Google will block the sign-in.)*
5. Leave the app in **Testing**. Don't publish it.

### 4. Create the OAuth client
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name: `jarvis`. Click **Create**.
3. Click **Download JSON**. You'll get a file like
   `client_secret_1234-abc.apps.googleusercontent.com.json`.
   Keep it private: **don't** put it in the jarvis folder or on GitHub.

### 5. Sign JARVIS in
In a terminal in the jarvis folder:

```powershell
npm run youtube:connect -- "$HOME\Downloads\client_secret_XXXX.json"
```

Your browser opens. Choose the account and pick your **channel** if it asks
(brand accounts show up here). Google will warn that the app "hasn't been
verified". Click **Continue**: it's your own app. Then tick every permission.
The terminal should print `Connected: <your channel>`.

The token is saved to `~/.jarvis/secrets/youtube.json`. JARVIS's own file tools
can't read that folder.

### 6. Start JARVIS
Read-only mode lets him look at stats, videos, comments and analytics, and search:

```powershell
npm start
```

Full mode also lets him edit videos, upload, reply to comments and manage playlists:

```powershell
npm start -- --writes
```

The bridge log should show `[jarvis] youtube connected`.

> **Tokens expire after 7 days while the app is in "Testing".** That's Google's
> rule for unverified apps. When JARVIS says the sign-in expired, just run
> `npm run youtube:connect` again (no arguments needed after the first time).

---

## What you can say

| Ask | What JARVIS does |
|---|---|
| "How's my channel doing?" | Subscribers, views and video count, shown on a blade |
| "How did my last video do?" | Views, likes and comments for your latest upload |
| "Show my views for the last 30 days" | Draws a daily chart from YouTube Analytics |
| "What are my top videos this month?" | Ranks your videos by views |
| "Read me the latest comments" | Pulls recent comments from across your channel |
| "What's trending in [your niche]?" | Searches YouTube and compares the results with your videos |
| "Give me 10 video ideas / titles / a script" | Bases them on what's already working for you |
| *(writes)* "Change the title of my last video to …" | Updates the video |
| *(writes)* "Make it public" | Changes the privacy setting |
| *(writes)* "Reply to that comment saying thanks" | Replies as your channel |
| *(writes)* "Upload `intro.mp4` from my workspace" | Uploads it as **private** so you can review it first |
| *(writes)* "Set this image as the thumbnail" | Sets a custom thumbnail. Your channel has to be verified for this |
| *(writes)* "Make a playlist called Shorts and add my last 5 videos" | Creates the playlist and adds the videos |

Files to upload go in `~/.jarvis/workspace`, or in a folder listed in
`JARVIS_FILE_ROOTS`, for example `JARVIS_FILE_ROOTS=C:\Users\you\Videos`.

## Making the videos themselves

The YouTube API can manage your channel, but it can't edit footage. To produce
content, JARVIS uses whatever generation tools you've connected in
`~/.claude.json`, for example `higgsfield` for images and video and
`elevenlabs` for voiceovers. Those are on the read-only allowlist, so they work
in either mode. A typical flow:

1. "Give me a script for a 60-second short about X."
2. "Generate a thumbnail for it." The image lands in the workspace.
3. You record or edit the video, and save it to the workspace.
4. "Upload it as private with that title and description, and set the thumbnail."

## Turning it off

- Turn YouTube off temporarily: `JARVIS_DISABLE=youtube`.
- Disconnect completely: delete `~/.jarvis/secrets/youtube.json`, then remove
  access at <https://myaccount.google.com/permissions>.

## Limits

- **Daily quota.** The API gives 10,000 units a day. Reads cost about 1 unit
  each, a search costs 100 and an upload costs about 1,600, so that's roughly
  6 uploads a day.
- **No video editing, Shorts remixing, community posts or live streaming.**
  YouTube's API doesn't offer them.
