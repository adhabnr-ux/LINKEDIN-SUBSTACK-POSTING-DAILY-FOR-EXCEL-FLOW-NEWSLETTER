# Excel Flow — Social Media Scheduler

An automated Node.js system that posts your pre-written content to LinkedIn and Substack Notes on schedule. Content is stored in a local SQLite database; a cron scheduler checks every 5 minutes and fires posts at the right time.

---

## Table of Contents

1. [What It Does](#what-it-does)
2. [File Structure](#file-structure)
3. [Step-by-Step Setup](#step-by-step-setup)
4. [Getting Your LinkedIn Token and Person URN](#getting-your-linkedin-token-and-person-urn)
5. [Getting Your Substack Session Cookie](#getting-your-substack-session-cookie)
6. [Running the Scheduler](#running-the-scheduler)
7. [Deploying to Railway (free 24/7 hosting)](#deploying-to-railway)
8. [Using the CLI](#using-the-cli)
9. [Importing a Week of Content](#importing-a-week-of-content)
10. [Supported Platforms and Post Types](#supported-platforms-and-post-types)
11. [Rate Limits](#rate-limits)
12. [Logs and Troubleshooting](#logs-and-troubleshooting)

---

## What It Does

- Reads a queue of posts from `content_queue.db` (SQLite)
- Every 5 minutes, checks for posts whose scheduled time has passed
- Posts up to 3 per check to avoid rate limits
- Posts to LinkedIn (regular posts, polls, group posts)
- Posts to Substack Notes via Substack's internal API
- After each LinkedIn post, waits 30 seconds and posts a first comment (e.g., your Substack link)
- Logs everything to console and `logs/activity.log`
- Has a dry-run mode (`--dry-run`) so you can test without actually posting

> **Note on Substack:** Substack discontinued its email-to-post feature. There is no official publishing API, so this system uses the same internal endpoint the Substack web app calls when you publish a Note. It authenticates with your logged-in session cookie. This works reliably but is unofficial — see [Getting Your Substack Session Cookie](#getting-your-substack-session-cookie) for the caveats.

---

## File Structure

```
excel-flow-scheduler/
  index.js          ← entry point, starts the scheduler
  scheduler.js      ← cron logic and post dispatcher
  linkedin.js       ← LinkedIn API calls
  substack.js       ← Substack Notes via internal API
  cli.js            ← command-line tool for managing the queue
  db.js             ← SQLite setup and query helpers
  logger.js         ← logs to console + logs/activity.log
  groups.json       ← LinkedIn group URNs keyed by name
  sample-week.json  ← example week of content for import
  logs/
    activity.log    ← auto-created on first run
  .env              ← your credentials (never commit this)
  .env.example      ← template for credentials
  package.json
  README.md
```

---

## Step-by-Step Setup

### 1. Clone and install dependencies

```bash
git clone <your-repo-url>
cd excel-flow-scheduler
npm install
```

### 2. Create your `.env` file

```bash
cp .env.example .env
```

Then open `.env` and fill in all three values. See the sections below for how to get each one.

### 3. Test with dry-run

Before putting in real credentials, you can import the sample week and do a dry run:

```bash
node cli.js import-json sample-week.json
node index.js --dry-run
```

You'll see log output showing what would be posted without actually calling any API.

### 4. Run for real

```bash
node index.js
```

---

## Getting Your LinkedIn Token and Person URN

LinkedIn requires an access token that expires every 60 days. Here is how to get one.

### Step 1: Create a LinkedIn Developer App

1. Go to [https://developer.linkedin.com/](https://developer.linkedin.com/)
2. Click **My Apps** in the top right, then **Create app**
3. Fill in:
   - **App name**: Excel Flow Scheduler (or anything)
   - **LinkedIn Page**: Select your personal or company page
   - **App logo**: Upload any image (required)
4. Click **Create app**

### Step 2: Add the required products

In your app dashboard, click the **Products** tab.

Add both of these products:
- **Share on LinkedIn** — gives you the `w_member_social` scope
- **Sign In with LinkedIn using OpenID Connect** — gives you `r_liteprofile`

These may require a short review (usually instant for personal apps).

### Step 3: Configure OAuth redirect URL

1. Click the **Auth** tab
2. Under **OAuth 2.0 settings**, click the pencil icon next to **Authorized redirect URLs**
3. Add: `https://www.linkedin.com/developers/tools/oauth/redirect`
4. Save

### Step 4: Generate your access token

1. Still in the **Auth** tab, scroll down to **OAuth 2.0 tools**
2. Click **OAuth token tools** (or go to Tools → OAuth token generator in the top menu)
3. Select your app
4. Check the scopes: `w_member_social`, `r_liteprofile`
5. Click **Request access token**
6. LinkedIn will ask you to authorize — approve it
7. Copy the **Access Token** — this is your `LINKEDIN_ACCESS_TOKEN`

> **Important**: Tokens expire after 60 days. You must repeat this process every 60 days or set up refresh tokens (advanced). The scheduler will log a clear error when your token expires.

### Step 5: Get your Person URN

With your access token, run this in your terminal (replace `YOUR_TOKEN`):

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "X-Restli-Protocol-Version: 2.0.0" \
     https://api.linkedin.com/v2/me
```

The response will include a field like:

```json
{
  "id": "AbCdEfGhIj",
  ...
}
```

Your `LINKEDIN_PERSON_URN` is `urn:li:person:AbCdEfGhIj` (use your actual `id` value).

Put both values in `.env`:

```
LINKEDIN_ACCESS_TOKEN=AQVb...your-token...
LINKEDIN_PERSON_URN=urn:li:person:AbCdEfGhIj
```

---

## Getting Your Substack Session Cookie

Substack removed the email-to-post feature, and it has no official publishing API. To post Notes automatically, the scheduler reuses your logged-in browser session by sending your `substack.sid` cookie with each request.

### How to copy your `substack.sid` cookie

**Using Chrome or Edge:**

1. Log in to [https://substack.com/](https://substack.com/) in your browser
2. Press **F12** to open Developer Tools
3. Go to the **Application** tab (Chrome) or **Storage** tab (Edge/Firefox)
4. In the left sidebar, expand **Cookies** and click **https://substack.com**
5. Find the row named **`substack.sid`**
6. Double-click its **Value** and copy the entire string (it is long)
7. Paste it into `.env`:

```
SUBSTACK_SID=s%3A....the-long-value....
```

**Using Firefox:**

1. Log in to substack.com
2. Press **F12** → **Storage** tab → **Cookies** → **https://substack.com**
3. Find `substack.sid`, copy its value, paste into `.env`

### Important caveats

- This is an **unofficial** method. It uses the same internal endpoint the Substack web app calls — not a documented, supported API. It works reliably today but could change without notice.
- The `substack.sid` cookie **expires** (roughly every 30 days, or when you log out everywhere). When it expires, the scheduler logs: *"Substack session expired — log in at substack.com, copy a fresh substack.sid cookie value, and update SUBSTACK_SID in .env"*. Just repeat the steps above and restart.
- Do **not** log out of Substack in that browser session — logging out invalidates the cookie.
- Keep this cookie secret. Anyone with it can post as you. It lives only in `.env`, which is gitignored.

---

## Running the Scheduler

### Normal mode (actually posts):

```bash
node index.js
```

The scheduler:
- Runs an immediate check on startup
- Then checks every 5 minutes via cron
- Logs everything to console and `logs/activity.log`
- Never crashes on a single post failure — catches, logs, marks failed, continues

### Dry-run mode (no API calls):

```bash
node index.js --dry-run
```

Use this to verify your queue is set up correctly before letting it run live.

### Keep it running with PM2 (local):

```bash
npm install -g pm2
pm2 start index.js --name excel-flow
pm2 logs excel-flow
pm2 startup   # auto-restart on system reboot
```

---

## Deploying to Railway

Railway gives you free hosting with 500 hours/month on the free tier (enough for one always-on process).

### Step 1: Install Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### Step 2: Initialize Railway project

```bash
cd excel-flow-scheduler
railway init
```

Choose **Empty Project** and give it a name like `excel-flow`.

### Step 3: Add environment variables

In the Railway dashboard ([https://railway.app/](https://railway.app/)), go to your project → **Variables** tab and add:

```
LINKEDIN_ACCESS_TOKEN=...
LINKEDIN_PERSON_URN=...
SUBSTACK_SID=...
TZ=America/Denver
```

### Step 4: Add a Procfile

Create a file called `Procfile` (no extension) in the root:

```
worker: node index.js
```

### Step 5: Deploy

```bash
railway up
```

Railway will detect Node.js, install dependencies, and start your worker. Check logs in the Railway dashboard under the **Deployments** tab.

### Persistent SQLite on Railway

Railway's filesystem is ephemeral by default — the database will reset on each deploy. To persist it:

1. Go to your project → **Add a volume**
2. Mount it at `/app/data`
3. Update `db.js` to use `/app/data/content_queue.db` as the path when `process.env.RAILWAY_VOLUME_MOUNT_PATH` is set

> **Simplest solution**: Import your week's content, deploy, and don't redeploy mid-week. On the next content cycle, redeploy and re-import.

---

## Using the CLI

Run any CLI command with:

```bash
node cli.js <command>
```

### `add-post` — add a single post interactively

```bash
node cli.js add-post
```

Prompts you for:
- Platform (linkedin_post / linkedin_poll / linkedin_group / substack_note)
- Scheduled date/time in MST (automatically converted to UTC for storage)
- Full post content (type `END` on a new line to finish)
- First comment (optional, LinkedIn only)
- Poll options (if platform is linkedin_poll)
- Group name (if platform is linkedin_group)

### `import-json <filepath>` — bulk import from a file

```bash
node cli.js import-json week1.json
```

### `list` — show pending posts

```bash
node cli.js list          # pending only
node cli.js list --all    # all posts
```

Output is a readable table with ID, scheduled time (MST), platform, content preview, and status.

### `cancel <id>` — cancel a post

```bash
node cli.js cancel 12
```

### `retry <id>` — retry a failed post

```bash
node cli.js retry 12
```

Resets status from `failed` or `cancelled` back to `pending`. The next scheduler check will pick it up.

### `logs` — view recent activity

```bash
node cli.js logs
```

Shows the last 50 lines of `logs/activity.log`.

---

## Importing a Week of Content

Create a JSON file (e.g., `week1.json`) with this structure:

```json
[
  {
    "scheduled_at_mst": "2026-05-25 08:30",
    "platform": "linkedin_post",
    "content": "Excel tip of the week: XLOOKUP vs VLOOKUP — here's why you should switch today.\n\n1. Handles both left and right lookups\n2. Returns arrays, not just single cells\n3. Has a built-in not-found value (no more IFERROR hacks)\n\nWhich one are you still using?",
    "first_comment": "Full breakdown in this week's Excel Flow newsletter: https://excelflow.substack.com",
    "poll_options": null,
    "group_name": null
  },
  {
    "scheduled_at_mst": "2026-05-26 09:00",
    "platform": "linkedin_poll",
    "content": "Quick poll: What's your biggest Excel pain point?",
    "first_comment": "I cover all of these in Excel Flow — link in comments.",
    "poll_options": ["VLOOKUP breaking on me", "Pivot tables", "Slow formulas", "Messy data"],
    "group_name": null
  },
  {
    "scheduled_at_mst": "2026-05-27 08:00",
    "platform": "substack_note",
    "content": "Most people use SUM wrong.\n\nThey sum columns when they should sum ranges.\nThey hardcode ranges when they should use dynamic arrays.\n\nNew post dropping Thursday — subscribe so you don't miss it.",
    "first_comment": null,
    "poll_options": null,
    "group_name": null
  }
]
```

For `substack_note` posts, leave `first_comment`, `poll_options`, and `group_name` as `null` — Substack Notes are a single block of text. Each line of `content` becomes its own paragraph in the published Note.

Then import it:

```bash
node cli.js import-json week1.json
node cli.js list
```

Verify everything looks right, then start the scheduler.

---

## Supported Platforms and Post Types

| Platform | `platform` value | Notes |
|---|---|---|
| LinkedIn regular post | `linkedin_post` | Supports first comment |
| LinkedIn poll | `linkedin_poll` | 2–4 options, `poll_options` must be a JSON array |
| LinkedIn group post | `linkedin_group` | `group_name` must match a key in `groups.json` |
| Substack Note | `substack_note` | Posted via Substack's internal API using `SUBSTACK_SID` |

### Adding a LinkedIn group

Edit `groups.json`:

```json
{
  "excel-users": "urn:li:group:12345678",
  "finance-pros": "urn:li:group:87654321"
}
```

Then use `"group_name": "excel-users"` in your JSON imports or when adding a post.

To find a group URN: go to the group's LinkedIn page, the URL will contain the group ID (e.g., `linkedin.com/groups/12345678`). The URN is `urn:li:group:12345678`.

---

## Rate Limits

- **LinkedIn**: ~150 posts/day on free tier. The scheduler adds a 60-second delay between LinkedIn posts in the same batch.
- **LinkedIn comments**: Posted 30 seconds after the main post.
- **Substack**: 30-second delay between Substack notes in the same batch. Substack's internal API is informally rate-limited; avoid posting more than a few Notes per minute.
- The scheduler processes a maximum of 3 posts per 5-minute check.

---

## Logs and Troubleshooting

All activity is logged to `logs/activity.log`. View recent logs:

```bash
node cli.js logs
# or
tail -f logs/activity.log
```

### Common errors

**`LinkedIn token expired`**
Your access token is 60+ days old. Go to [developer.linkedin.com](https://developer.linkedin.com) → OAuth token tools → generate a new token → update `LINKEDIN_ACCESS_TOKEN` in `.env` and restart.

**`LinkedIn rate limit hit`**
You have posted too many times in a short window. Wait a few hours and use `node cli.js retry <id>` to retry failed posts.

**`Group "X" not found in groups.json`**
The `group_name` in your post does not match any key in `groups.json`. Edit `groups.json` to add it.

**`Substack session expired`**
Your `substack.sid` cookie is no longer valid (it expires roughly monthly, or when you log out). Log in to substack.com again, copy a fresh `substack.sid` cookie value, update `SUBSTACK_SID` in `.env`, and restart. See [Getting Your Substack Session Cookie](#getting-your-substack-session-cookie).

**Substack note not appearing**
Confirm `SUBSTACK_SID` is the full cookie value with no extra spaces. Check `logs/activity.log` for the API response. If you recently logged out of Substack in that browser, the cookie is dead — get a fresh one.
