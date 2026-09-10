# NFL Pick'em

A private, friends-only pick'em pool. Members join with a code, pick every game
against the live spread, designate one lock a week worth double, and follow a
season-long leaderboard.

## How the pool works

- **Picking** — pick a side against the spread in every game on the slate.
- **The lock** — exactly one pick a week can be the lock. A correct lock is
  worth 2 points instead of 1.
- **Locking is per game** — a pick stays changeable until *that* game kicks off,
  even if other games that week have already finished. Once a game starts, the
  pick and its lock status freeze.
- **Scoring** — correct pick 1, correct lock 2, incorrect 0. A push (the final
  margin lands exactly on the number) scores 0 with no lock penalty and no
  bonus. Postponed and canceled games are dropped from the week entirely.
- **Tiebreak** — total points, then most correct non-lock picks.
- **Visibility** — other members' picks stay hidden until each game kicks off,
  so nobody can copy.

## Stack

| Piece | Choice |
| --- | --- |
| Framework | Next.js 14, App Router, TypeScript |
| Database | Supabase Postgres, reached server-side with the service role key |
| Styling | Tailwind CSS |
| Odds | The Odds API, NFL spreads and scores |
| Scheduling | Vercel Cron, every 15 minutes |
| Hosting | Vercel |

### How signing in works

There is no email or password. A member joins with a **join code, a username,
and a 4-8 digit PIN**. The session is a signed, HTTP-only cookie holding the
memberships; the PIN is what proves ownership of a username when signing in on
a second device. One person can belong to several pools, and the header carries
a switcher between them.

Every table has row-level security enabled with no policies, so the anon key
grants nothing. All reads and writes go through server components and server
actions using the service role key, which never reaches the browser.

---

# Get it running on your own machine

Roughly 20 minutes, most of it waiting on a Supabase project to spin up. You do
**not** need the odds feed to get started — step 8 walks through entering a game
by hand, which is enough to see picks, locking and scoring work end to end.

## Before you start

- **Node.js 20 or newer.** Check with `node -v`. If that errors or shows an
  older version, install from [nodejs.org](https://nodejs.org).
- **A [Supabase](https://supabase.com) account.** Free tier is fine.
- **A [The Odds API](https://the-odds-api.com) key.** Free, and only needed from
  step 9 onward. Skip it for now if you want.

## 1. Get the code

```bash
git clone https://github.com/richjn13/BetTest.git
cd BetTest
git checkout claude/nfl-pickem-build-spec-jnc1yo
```

## 2. Install the dependencies

```bash
npm install
```

Takes a minute or two. Warnings about deprecated packages are normal and safe to
ignore.

## 3. Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and click
   **New project**.
2. Name it anything. Pick a region near you.
3. Set a database password. You will not need it again for this app, but save it
   somewhere anyway.
4. Click **Create new project**, then wait. It takes 1-2 minutes to provision.

## 4. Create the database tables

1. In your new project, open **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open the file `supabase/migrations/0001_init.sql` from this repo, copy its
   entire contents, and paste it into the editor.
4. Click **Run** (or press Ctrl/Cmd + Enter).

You should see *Success. No rows returned*. That is what success looks like for
a script that only creates tables.

To confirm, open **Table Editor** in the sidebar. You should see seven tables:
`groups`, `users`, `weeks`, `games`, `picks`, `point_adjustments`, and
`admin_actions`.

## 5. Copy your two Supabase credentials

In the same project, open **Project Settings** (the gear icon), then the **API**
section. Some projects show this as **API Keys** — Supabase moves it around, so
look for whichever of the two is there.

You need two values:

| What to copy | Where it is | Looks like |
| --- | --- | --- |
| Project URL | Top of the API page | `https://abcdefgh.supabase.co` |
| `service_role` key | Under Project API keys, marked **secret** | A very long string starting `eyJ...` |

**Copy the `service_role` key, not the `anon` key.** They sit next to each other
and look similar. The anon key will not work here, because every table has
row-level security on with no policies — the service role key is the only way in.

Treat the service role key like a password. It bypasses all database security.
It only ever lives in your `.env.local` file and in Vercel's environment
settings, never in code you commit.

## 6. Create your environment file

In the project folder:

```bash
cp .env.example .env.local
```

Now open `.env.local` in a text editor. You will fill in five values.

**First, generate the two secrets.** Run this twice and keep both outputs:

```bash
openssl rand -base64 32
```

On Windows without `openssl`, use this instead:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

**Then fill in the file** so it looks like this, with your own values:

```bash
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...            # the long secret key from step 5
SESSION_SECRET=oV3k...                             # first openssl output
CRON_SECRET=9Xf2...                                # second openssl output
ODDS_API_KEY=                                      # leave blank for now
ODDS_API_BOOKMAKERS=draftkings,fanduel
```

No quotes around the values, and no spaces around the `=`.

`SESSION_SECRET` signs the login cookie. Changing it later signs everyone out,
which is harmless — they sign back in with their join code, username and PIN.

## 7. Start it

```bash
npm run dev
```

Open **http://localhost:3000**. You should land on the join screen.

## 8. Your first five minutes

This is the part worth doing carefully. It proves the whole loop works before
you involve the odds feed.

**Create your pool.** On the join screen, click **Start a group**. Enter a group
name, a username for yourself, and a 4-8 digit PIN. You become the group admin.

You will land on the Picks tab showing *"No games yet."* That is correct — the
database has no NFL schedule in it.

**Add a game by hand.** Click the **Admin** tab, then find *Add a game by hand*:

- Season: `2026`
- Week: `1`
- Away team and Home team: pick any two
- Kickoff: **pick a time about 10 minutes from now**
- Home spread: `-3.5`

The spread is always written from the home team's side. `-3.5` means the home
team is favored by 3.5 and must win by 4 to cover. `+3.5` means the home team is
getting 3.5 points. Leave it blank if there is no line yet.

Click **Add game**. Add two or three more the same way so the week has something
in it.

**Make your picks.** Back on the **Picks** tab you will see your games. Click
either team to pick that side. Click **Make this my lock** on one of them — try
it on a second game and watch the first one release, because only one lock is
allowed per week.

**Watch a game lock.** Wait for the kickoff time you set to pass, then reload.
That game now reads **LOCKED**, its buttons stop responding, and the other games
still take changes. That is the per-game locking rule, which is the single most
important behavior in the app.

**Score it.** Go to **Admin**, find that game in the slate list, set its status
to `final`, type in scores where the home team wins by 7, add a note like
`testing`, and click **Save**.

Now check the **Leaderboard**. If you took the home team you have 1 point, or 2
if it was your lock. If you took the away team, 0. The Picks tab shows the same
result on the game row.

If that all worked, the core of the app is running correctly.

## 9. Turn on the live odds feed

1. Sign up at [the-odds-api.com](https://the-odds-api.com). The free tier gives
   you an API key immediately.
2. Put the key in `.env.local` as `ODDS_API_KEY=...`.
3. Stop the server (Ctrl+C) and run `npm run dev` again. **Environment changes
   only take effect on restart.**
4. Go to **Admin → Odds feed** and click **Refresh odds and scores now**.

You should see a line like *"14 new games, 14 spreads, 0 scores, 0 lines frozen,
0 picks graded."* Check the Picks tab — the real NFL slate is now there, with
live spreads.

If it reports a problem instead, the message names the cause. Nothing is
damaged either way: a failed fetch changes no stored data, so whatever spreads
you already had stay exactly as they were.

**Read the quota section below before setting this to run on a schedule.** The
free tier is much smaller than 15-minute polling needs.

---

# Going live on Vercel

## 1. Push your branch

```bash
git push -u origin claude/nfl-pickem-build-spec-jnc1yo
```

## 2. Import the project

1. Go to [vercel.com/new](https://vercel.com/new) and import the `BetTest`
   repository.
2. Under **Environment Variables**, add all five from your `.env.local`, one at
   a time, with the same names and values.
3. Click **Deploy**.

Use the same Supabase project, or create a second one for production and repeat
steps 4 and 5 above against it. A separate production database is the safer
habit, since it keeps your test groups out of the real pool.

## 3. Check the cron job

`vercel.json` already schedules `/api/cron/refresh` every 15 minutes. After the
first deploy, open your project's **Settings → Cron Jobs** to confirm Vercel
picked it up.

**Vercel's Hobby plan only allows one cron run per day.** The schedule in
`vercel.json` needs the Pro plan. On Hobby you have two options: upgrade, or
leave the endpoint in place and call it from a free external scheduler such as
cron-job.org, sending the header `Authorization: Bearer <your CRON_SECRET>`.

## The odds feed and its quota

Each cron run makes **two** calls to The Odds API, one for spreads and one for
scores. That adds up faster than people expect:

| Schedule | Runs per month | API calls per month |
| --- | --- | --- |
| Every 15 minutes, always | 2,880 | 5,760 |
| Every 15 minutes, game days only | ~1,240 | ~2,480 |
| Every hour, always | 720 | 1,440 |

The Odds API's free tier is 500 calls a month, so **none of these fit inside
it**. Check their current pricing page for tier sizes before you pick a
schedule; they change it periodically.

Two ways to stay cheap:

- **Manual refresh only.** Delete the `crons` block from `vercel.json` and press
  the Admin refresh button yourself on game days. A handful of calls a week.
  Spreads then only freeze when you press it, so press it before kickoff.
- **Narrow the schedule.** Change the cron expression in `vercel.json` to
  `*/15 * * * 0,1,4` for Sunday, Monday and Thursday only. That is the middle
  row above.

## What the scheduled refresh does

1. Pulls current spreads and any newly scheduled games.
2. Pulls scores for games in progress or recently finished.
3. Freezes the line on every game past kickoff, then regrades affected picks.

**Spread freezing is the part that matters.** The line shown to members is
whatever was last fetched, right up to kickoff. At kickoff the current value is
copied to `frozen_home_spread` and `spread_frozen_at` is stamped. Every later
run skips a frozen game, so a revision in the feed's historical data can never
move the number a pick was graded against.

If the odds feed is unreachable, the run reports the failure and changes
nothing: the last known spread stays on screen rather than erroring out.
Freezing and grading still run, because they only need data already stored.

---

# Troubleshooting

| What you see | What it means |
| --- | --- |
| `Missing required environment variable SUPABASE_URL` | `.env.local` is missing, misnamed, or the server was not restarted after you edited it. The file must be `.env.local`, not `.env.local.txt`, in the project root. |
| The join screen loads but creating a group hangs or errors | Usually the `anon` key was copied instead of `service_role`. Recheck step 5. |
| `relation "groups" does not exist` | The SQL from step 4 did not run. Open Table Editor in Supabase and confirm the seven tables are there. |
| Picks tab says "No games yet" | Expected on a fresh database. Add a game by hand (step 8) or run the odds refresh (step 9). |
| A game will not accept a pick | Its kickoff time has passed. That is the rule working. Use Admin → Picks to edit a pick after kickoff. |
| Odds refresh says `401` or `Usage quota` | The API key is wrong, or the monthly quota is spent. See the quota table above. |
| Leaderboard shows 0 after a game is final | Grading runs on the cron pass or when an admin saves a score override. Press Admin → Refresh odds and scores now. |
| Everyone got signed out | `SESSION_SECRET` changed. Harmless — sign back in with join code, username and PIN. |

---

# Admin panel

The group's creator is its admin. The panel can:

- regenerate the join code, invalidating the old one,
- add games and spreads by hand,
- override a game's score or status when the feed lags, which marks the game so
  the feed stops touching it and immediately regrades every pick on it,
- edit any member's picks, ignoring kickoff, to fix entry mistakes,
- adjust a member's points, positive or negative,
- remove a member,
- trigger an odds refresh on demand.

Every one of these writes to an audit log with the actor, a timestamp, and a
required note. The panel's last section shows that log.

One thing to know: games and weeks are league-wide, not per-group, because
every pool picks the same NFL slate. A score override by one group's admin
therefore applies everywhere. That is the right call for a handful of friendly
pools sharing an instance; it would need per-group overrides before this ran as
a multi-tenant service.

# Layout

```
src/lib/          scoring, grading, odds parsing, session, database access
src/app/join      create a group, join one, or sign in
src/app/g/[id]    picks board, leaderboard, admin panel
src/app/api/cron  the scheduled refresh endpoint
supabase/         the schema
```

The rules worth trusting are pure functions with tests: `scoring.ts` for
grading and standings, `nfl-week.ts` for turning a kickoff time into a week
number, `odds-parse.ts` for reading the feed.

```bash
npm test        # 31 tests
npm run build
```

# Known gaps

- No automated tests touch the database layer; the pure logic is covered, the
  Supabase calls are not.
- Week numbers are derived from the calendar (Week 1 opens the Tuesday after
  Labor Day, weeks roll over Tuesday 08:00 UTC) because the odds feed does not
  supply them. Set `NFL_WEEK1_TUESDAY` to a date like `2026-09-08` to override a
  season that breaks the rule.
- Kickoff reminders and push notifications are not built.
