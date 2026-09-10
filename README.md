# NFL Pick'em

A private, friends-only pick'em pool. Members join with a code, pick every game
against the live spread, designate one lock a week worth double, and follow a
season-long leaderboard.

**You can set this up entirely from an iPad, in Safari, with no terminal.** The
guide below is written for that. If you are on a laptop and want a local dev
server, skip to *Running it on a computer* at the end.

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
| Scheduling | Vercel Cron, weekly on Tuesday evening |
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

# Setting it up from an iPad

Everything happens in Safari across four websites. Nothing is installed, no code
runs on the iPad, and the app itself is hosted by Vercel.

| Site | What it does | Account needed |
| --- | --- | --- |
| [supabase.com](https://supabase.com) | The database | Free |
| [github.com](https://github.com) | Holds the code | You already have one |
| [vercel.com](https://vercel.com) | Runs the app | Free, sign in with GitHub |
| [the-odds-api.com](https://the-odds-api.com) | NFL spreads and scores | Free |

Budget about 30 minutes. Two tips before you start:

- **Open each site in its own Safari tab** and leave them open. You will be
  copying values between Supabase and Vercel and it is much easier than
  navigating back and forth.
- **If a dashboard looks cramped or a button will not tap**, use the **aA** menu
  in Safari's address bar and choose **Request Desktop Website**. Supabase's SQL
  editor in particular behaves better that way.

You do not need the odds feed to finish setup. Step 8 walks through entering a
game by hand, which is enough to see picks, locking and scoring work end to end.

## 1. Create the Supabase project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and sign in.
2. Tap **New project**.
3. Name it anything. Pick a region near you.
4. Set a database password. You will not need it again for this app, but save it
   in your Notes or password manager anyway.
5. Tap **Create new project**, then wait. It takes 1-2 minutes.

## 2. Create the database tables

**First, copy the SQL.** Open this file on GitHub:

`supabase/migrations/0001_init.sql`

Tap the **copy icon** in the toolbar above the file contents (it looks like two
overlapping squares, and its tooltip says *Copy raw file*). That puts the whole
script on your clipboard, which is far easier than trying to select 150 lines by
hand on a touchscreen.

**Then run it.** Back in Supabase:

1. Open **SQL Editor** in the left sidebar.
2. Tap **New query**.
3. Tap in the editor and paste.
4. Tap **Run**.

You should see *Success. No rows returned*. That is what success looks like for
a script that only creates tables.

To confirm, open **Table Editor** in the sidebar. You should see seven tables:
`groups`, `users`, `weeks`, `games`, `picks`, `point_adjustments`, and
`admin_actions`.

**Running this twice is safe.** Every statement creates its object only if it is
missing, so a second run does nothing rather than failing.

If the seven tables are not all there, the first run stopped partway. Start
clean: copy and run `supabase/reset.sql` the same way, which drops all seven
tables, then run `0001_init.sql` again. **`reset.sql` deletes everything in the
database and cannot be undone**, so only use it on a project with nothing in it
you want to keep.

## 3. Generate your two secrets

The app needs two long random strings. On a computer you would use `openssl`.
You have no terminal, but you have a database, and the database can do it.

In the same **SQL Editor**, tap **New query**, paste this, and tap **Run**:

```sql
select
  encode(gen_random_bytes(32), 'base64') as session_secret,
  encode(gen_random_bytes(32), 'base64') as cron_secret;
```

Two 44-character strings come back, ending in `=`. **Copy both into your Notes
app now**, labelled, because you cannot get these exact values back — running the
query again gives you different ones.

They are not interchangeable, so keep track of which is which:

- **`session_secret`** signs the login cookie. Changing it later signs everyone
  out, which is harmless. They sign back in with join code, username and PIN.
- **`cron_secret`** is the password the weekly refresh job uses to prove it is
  allowed to run.

## 4. Copy your two Supabase credentials

Still in Supabase, open **Project Settings** (the gear icon), then the **API**
section. Some projects show this as **API Keys** — Supabase moves it around, so
look for whichever of the two is there.

You need two values. Each has a copy button next to it; use it rather than
selecting by hand.

| What to copy | Where it is | Looks like |
| --- | --- | --- |
| Project URL | Top of the API page | `https://abcdefgh.supabase.co` |
| `service_role` key | Under Project API keys, marked **secret** | A very long string starting `eyJ...` |

**Copy the `service_role` key, not the `anon` key.** They sit next to each other
and look almost identical. The anon key will not work here, because every table
has row-level security on with no policies — the service role key is the only way
in. Getting this wrong produces an app that loads fine and then fails the moment
you try to create a group, which is miserable to diagnose.

Paste both into your Notes alongside the two secrets. You now have four values.

Treat the service role key like a password. It bypasses all database security.
It should only ever live in Vercel's environment settings, never in a file you
commit to GitHub.

## 5. Put the code on your main branch

The app was built on a branch. Vercel deploys your `main` branch by default, so
merge the branch in first. All of this is on github.com in Safari:

1. Open the repository, then tap **Pull requests** → **New pull request**.
2. Set **base** to `main` and **compare** to
   `claude/nfl-pickem-build-spec-jnc1yo`.
3. Tap **Create pull request**, then **Create pull request** again to confirm.
4. Tap **Merge pull request**, then **Confirm merge**.

Future changes land on that same branch, and you repeat this merge to publish
them.

*Alternative, if you would rather not merge:* deploy the branch directly by
setting Vercel's **Settings → Git → Production Branch** to the branch name after
step 6, then redeploying. Merging is simpler to live with, because `main` then
always means what is live.

## 6. Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and sign in with GitHub.
2. Find **BetTest** in the list and tap **Import**. If it is not listed, tap
   **Adjust GitHub App Permissions** and grant access to the repository.
3. Leave the framework and build settings exactly as Vercel detects them. It
   knows Next.js.
4. Expand **Environment Variables** and add these six, one at a time. Tap the
   name field, type the name, tap the value field, paste the value, then **Add**.

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | The Project URL from step 4 |
| `SUPABASE_SERVICE_ROLE_KEY` | The `service_role` key from step 4 |
| `SESSION_SECRET` | `session_secret` from step 3 |
| `CRON_SECRET` | `cron_secret` from step 3 |
| `ODDS_API_KEY` | Leave the value empty for now |
| `ODDS_API_BOOKMAKERS` | `draftkings,fanduel` |

Watch for a trailing space when pasting on iPadOS — it sometimes tacks one on.
Tap at the end of the field and check.

5. Tap **Deploy** and wait 1-2 minutes.

When it finishes you get a URL like `bettest-abc123.vercel.app`. Open it. You
should land on the join screen.

## 7. Add it to your Home Screen

The app is built mobile-first, and it is much nicer as an icon than a tab.

With the app open in Safari, tap the **Share** button, scroll down, and tap
**Add to Home Screen**. Do the same on your phone. Tell your friends to do it
when you send them the join code.

## 8. Your first five minutes

Worth doing carefully. It proves the whole loop works before the odds feed is
involved.

**Create your pool.** On the join screen, tap **Start a group**. Enter a group
name, a username for yourself, and a 4-8 digit PIN. You become the group admin.

You will land on the Picks tab showing *"No games yet."* That is correct — the
database has no NFL schedule in it.

**Add a game by hand.** Tap the **Admin** tab, then find *Add a game by hand*:

- Season: `2026`
- Week: `1`
- Away team and Home team: pick any two
- Kickoff: **about 10 minutes from now.** The picker uses your iPad's own clock,
  so just set the time you see now plus ten minutes.
- Home spread: `-3.5`

The spread is always written from the home team's side. `-3.5` means the home
team is favored by 3.5 and must win by 4 to cover. `+3.5` means the home team is
getting 3.5 points. Leave it blank if there is no line yet.

Tap **Add game**. Add two or three more so the week has something in it.

**Make your picks.** Back on the **Picks** tab, tap either team to pick that
side. Tap **Make this my lock** on one of them, then try it on a second game and
watch the first release. Only one lock is allowed per week.

**Watch a game lock.** Wait for the kickoff time you set to pass, then pull down
to reload. That game now reads **LOCKED**, its buttons stop responding, and the
other games still take changes. That is the per-game locking rule, which is the
most important behavior in the app.

**Score it.** Go to **Admin**, find that game in the slate list, set its status
to `final`, enter scores where the home team wins by 7, add a note like
`testing`, and tap **Save**.

Now check the **Leaderboard**. If you took the home team you have 1 point, or 2
if it was your lock. If you took the away team, 0.

If that all worked, the app is running correctly.

## 9. Turn on the live odds feed

1. Sign up at [the-odds-api.com](https://the-odds-api.com). The free tier gives
   you a key immediately, by email.
2. In Vercel, open your project → **Settings** → **Environment Variables**.
3. Find `ODDS_API_KEY`, tap **Edit**, paste the key, and save.
4. Go to the **Deployments** tab, tap the **⋯** menu on the most recent
   deployment, and tap **Redeploy**. **Environment changes only take effect on a
   new deploy** — this step is easy to skip and nothing will work until you do it.
5. When it finishes, open the app → **Admin** → **Refresh odds and scores now**.

You should see something like *"14 new games, 14 spreads, 0 scores, 0 lines
frozen, 0 picks graded."* Check the Picks tab — the real NFL slate is there with
live spreads.

If it reports a problem instead, the message names the cause. Nothing is damaged
either way: a failed fetch changes no stored data, so whatever spreads you
already had stay exactly as they were.

## 10. Check the weekly job

Open your Vercel project → **Settings** → **Cron Jobs**. You should see one
entry for `/api/cron/refresh`. It runs itself from here on; there is nothing to
maintain.

Details of what it does and when are in *The weekly refresh* below.

---

# Changing things later, from the iPad

**To change settings**, use the Vercel dashboard. Environment variables live in
Settings → Environment Variables, and every change needs a redeploy from the
Deployments tab.

**To change the code**, you have two options:

- **Ask Claude.** Describe what you want in a Claude Code session on this
  repository. Changes get pushed to the working branch, and you merge them the
  same way as step 5.
- **Edit on GitHub.** Open a file on github.com, tap the pencil icon, edit, and
  tap **Commit changes**. Fine for a one-line tweak like a cron schedule.
  Committing to `main` deploys automatically within a couple of minutes.

**To watch a deploy**, open the Vercel project's Deployments tab. A red entry
means the build failed; tap it to read the log.

---

# The weekly refresh

`vercel.json` schedules `/api/cron/refresh` for **Tuesday evening Eastern**, once
a week.

The schedule reads `0 2 * * 3`, which is Wednesday 02:00 UTC. Vercel Cron only
speaks UTC, so an Eastern evening time lands on the next UTC day:

| Part of the season | What `0 2 * * 3` means locally |
| --- | --- |
| November to February (EST) | Tuesday 9:00 PM Eastern |
| September and October (EDT) | Tuesday 10:00 PM Eastern |

Nothing in the app cares about the one-hour drift, and it never moves off
Tuesday. To pin 9:00 PM during the early season instead, change it to
`0 1 * * 3` and accept 8:00 PM for the rest.

Tuesday evening is a good slot: Monday Night Football is over, the new week has
begun, and the books have posted lines for the coming Sunday.

## What each run does

1. Freezes the line on every game whose kickoff has passed.
2. Pulls current spreads and any newly scheduled games.
3. Pulls scores for games in progress or recently finished.
4. Regrades every pick on a resolved game.

**Freezing comes first on purpose.** It stamps the line on every game past
kickoff, and the odds pull then skips those games because they are frozen.
Pulling first would let a revised line overwrite the number a pick should be
graded against, in the window between kickoff and the next run. On a weekly
schedule that window is a week wide.

**Spread freezing is the point of the whole job.** The line shown to members is
whatever was last fetched, right up to kickoff. At kickoff the current value is
stored permanently, and every later run skips that game, so a revision in the
feed's historical data can never move the number a pick was graded against.

If the odds feed is unreachable, the run reports the failure and changes nothing:
the last known spread stays on screen rather than erroring out. Freezing and
grading still run, because they only need data already stored.

## The one consequence of a weekly pull

Scores and grading ride on the same run, so a game finishing on Sunday will not
show points on the leaderboard until Tuesday night. Three ways to handle it:

- **Press the button.** Admin → Odds feed → *Refresh odds and scores now* does
  the identical work on demand. Press it Sunday night and the leaderboard is
  current. This is the easiest answer and costs two API calls.
- **Add a second run for scoring.** Edit `vercel.json` on GitHub and add a second
  entry to the `crons` list:

  ```json
  { "path": "/api/cron/refresh", "schedule": "0 6 * * 2" }
  ```

  That is Tuesday 06:00 UTC, which is Monday 1:00 AM Eastern in winter, after
  Sunday's games and before Monday night's.
- **Leave it.** If nobody minds the leaderboard settling on Tuesday, this is
  genuinely fine and the cheapest option.

Picks lock on schedule regardless. Whether a game accepts a change is decided by
comparing its kickoff time to the clock every time the page loads, not by the
cron job, so a game kicking off Sunday at 1:00 PM stops taking picks at 1:00 PM
whether or not anything ran that week.

**Vercel's Hobby plan allows one cron run per day**, which a weekly schedule sits
comfortably inside. The second scoring run above is also fine. Only a sub-daily
schedule needs the Pro plan.

## The odds feed and its quota

Each run makes **two** calls to The Odds API, one for spreads and one for scores.
The weekly schedule is cheap:

| Schedule | Runs per month | API calls per month |
| --- | --- | --- |
| **Weekly, as shipped** | ~4 | **~9** |
| Weekly, plus a Monday scoring run | ~9 | ~18 |
| Every hour | 720 | 1,440 |
| Every 15 minutes | 2,880 | 5,760 |

The Odds API's free tier is 500 calls a month, so the shipped schedule uses under
2% of it. Manual presses of the admin refresh button count too, at two calls
each, and you would need roughly 240 of them in a month to run out. Check their
current pricing page before moving to anything hourly, since tier sizes change.

---

# Troubleshooting

| What you see | What it means |
| --- | --- |
| The Vercel build failed | Open the deployment and read the log. A missing environment variable does not fail the build, so it is usually something else. |
| The app loads but creating a group hangs or errors | Almost always the `anon` key was pasted instead of `service_role`. Recheck step 4, then redeploy. |
| `Missing required environment variable ...` | That variable is not set in Vercel, or you added it and did not redeploy. |
| `relation "groups" does not exist` | The SQL from step 2 did not run. Open Supabase's Table Editor and confirm the seven tables are there. |
| The SQL ran but only some tables appeared | The run stopped partway. Run `supabase/reset.sql`, then `0001_init.sql` again. Reset deletes everything, so only on a database with nothing worth keeping. |
| Picks tab says "No games yet" | Expected on a fresh database. Add a game by hand (step 8) or run the odds refresh (step 9). |
| A game will not accept a pick | Its kickoff has passed. That is the rule working. Use Admin → Picks to edit a pick after kickoff. |
| Odds refresh says `401` or `Usage quota` | The key is wrong, was set without redeploying, or the monthly quota is spent. |
| Leaderboard shows 0 after a game is final | Grading runs on the weekly pass or when an admin saves a score override. Press Admin → Refresh odds and scores now. |
| Cron job never appears in Vercel | `vercel.json` has to be on the deployed branch. Cron jobs register on deploy, not on save. |
| Everyone got signed out | `SESSION_SECRET` changed. Harmless — sign back in with join code, username and PIN. |
| A Supabase button will not tap | Safari's **aA** menu → **Request Desktop Website**. |

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

One thing to know: games and weeks are league-wide, not per-group, because every
pool picks the same NFL slate. A score override by one group's admin therefore
applies everywhere. That is the right call for a handful of friendly pools
sharing an instance; it would need per-group overrides before this ran as a
multi-tenant service.

---

# Running it on a computer

Only needed if you want a local dev server. The iPad path above never requires
this.

```bash
git clone https://github.com/richjn13/BetTest.git
cd BetTest
npm install
cp .env.example .env.local     # fill in the same six values
npm run dev                    # http://localhost:3000
```

Generate the two secrets with `openssl rand -base64 32`, or use the SQL from
step 3. Apply the schema by pasting
`supabase/migrations/0001_init.sql` into the Supabase SQL editor, exactly as
step 2 describes.

```bash
npm test        # 31 tests
npm run build
```

# Layout

```
src/lib/            scoring, grading, odds parsing, session, database access
src/lib/refresh.ts  the maintenance pass shared by cron and the admin button
src/app/join        create a group, join one, or sign in
src/app/g/[id]      picks board, leaderboard, admin panel
src/app/api/cron    the scheduled refresh endpoint
supabase/           the schema, plus a destructive reset script
```

The rules worth trusting are pure functions with tests: `scoring.ts` for grading
and standings, `nfl-week.ts` for turning a kickoff time into a week number,
`odds-parse.ts` for reading the feed.

# Known gaps

- No automated tests touch the database layer; the pure logic is covered, the
  Supabase calls are not.
- Week numbers are derived from the calendar (Week 1 opens the Tuesday after
  Labor Day, weeks roll over Tuesday 08:00 UTC) because the odds feed does not
  supply them. Set `NFL_WEEK1_TUESDAY` to a date like `2026-09-08` to override a
  season that breaks the rule.
- Kickoff reminders and push notifications are not built.
