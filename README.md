# Pick'em

A private, friends-only pick'em pool covering **NFL** and **NCAA** college
football. Members join with a code, pick games against the spread, designate one
lock a week worth double, and follow a season-long leaderboard.

**You can set this up entirely from an iPad, in Safari, with no terminal.** The
guide below is written for that. If you are on a laptop and want a local dev
server, skip to *Running it on a computer* at the end.

## Two competitions

A toggle at the top of the picks page switches between **NFL** and **NCAA**. It
only appears when both have a week open, so a pool running one sport never sees
a control with a single option.

| | NFL | NCAA |
| --- | --- | --- |
| Weeks | 1-18, plus playoffs to 22 | 1-16 |
| Games | Every game on the slate | Saturday only |
| Slate size | The full week | The twenty most interesting games, pulled with AP rankings so you can choose |
| Rankings | None | Shown as **#4** beside a ranked team |

Weeks belong to a sport, so NFL week 3 and NCAA week 3 are separate weeks with
separate picks. The leaderboard carries a column for each, labelled with the
competition.

## Over/unders

**Off by default.** A game has no total until an admin turns one on from the
**Games** tab and pulls the numbers. Members then get an over/under row on that
game alongside the spread.

- A correct over/under is worth **1 point**. It is never the lock, so it cannot
  be doubled.
- A push scores 0, as with the spread.
- The total freezes at kickoff on the same rule as the line.
- Remove it and the row disappears again.

This is deliberately manual. You look the number up and enter it, so the app
never spends an API call on a market you might not use.

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
  so nobody can copy. Once a game starts you see how the group split on it, and
  once it is decided, what share of the group got it right.
- **Spreads move rather than vanish** — the line sits on the pick buttons while
  a game is still live. Once it is settled the buttons show the score instead,
  and the line reappears in the result underneath, named beside the side it
  applied to: "KC won by 3. KC -2.5 covered."
- **Each week says where it stands** — a line at the top tells you whether the
  lines are still to be updated, how many games are still open, or that the week
  is done and its scores are final.

## Stack

| Piece | Choice |
| --- | --- |
| Framework | Next.js 14, App Router, TypeScript |
| Database | Supabase Postgres, reached server-side with the service role key |
| Styling | Tailwind CSS |
| Odds | The Odds API, NFL spreads and scores |
| Scheduling | GitHub Actions for scores during games, Vercel Cron as a daily backstop |
| Hosting | Vercel |

### Who can do what

| Anyone with the link | Join an existing pool with its code, or sign in |
| --- | --- |
| **Whoever has the owner key** | Start a new pool |
| **An admin of a pool** | Everything in that pool's admin panel |

**Starting a pool needs `CREATE_GROUP_SECRET`**, an owner key you set in Vercel
and type on the Start a group tab. The join page is public, so without this
anyone who found the URL could create pools. Leave it unset and nobody can start
one, including you; existing pools carry on as normal.

**Admins are appointed, not fixed.** Whoever creates a pool is its first admin,
and under Admin → Members they can promote or demote anyone. Every change needs
a note and is written to the audit log. The last admin cannot be demoted,
because a pool with no admin has no way back: nobody could regenerate the join
code or promote a replacement.

### Profiles

Each member has a **Profile** tab: an optional real name, an optional email
visible only to admins, and a picture. The picture is shrunk to a 128px square
in the browser before it is sent and stored inline, so a phone photo arrives at
a few kilobytes and there is no storage bucket to configure. Avatars appear
beside names on the leaderboard, and larger in the card at the top of it
alongside your season total and position.

The database refuses an avatar that is not an inline image, so nobody can point
it at a remote address that would see every member loading the page.

### Every week is its own snapshot

A week moves through three states, and nothing can reach backwards past them.

| State | What it means |
| --- | --- |
| **Not opened** | Invisible to members. The odds feed will not create games in it. Next week's lines cannot appear before you pull them. |
| **Open** | Visible, picks accepted, lines refresh until each kickoff |
| **Closed** | Off the app. Members no longer see the week at all: no tab, no games, no picks. Its points stay in the season totals on the leaderboard. Admins still see it, so it can be reopened |

A week opens the moment you pull its lines or add a game by hand. You close it
yourself under **Admin → Week status**, and can reopen one closed by mistake.

**Closing a week hides it from everyone**, so leave it open long enough for
people to read the end-of-week summary on the picks page. That summary goes
with the week; the leaderboard keeps the points and the per-week column either
way.

This is what lets you work a week at a time. Pull Week 2 when you are ready for
Week 2, and nothing about Week 1 moves.

### When the schedule changes

Flex scheduling moves a kickoff, usually about twelve days out. That matters
here because **the stored kickoff is what freezes a pick**: a stale time would
freeze picks at the old slot, potentially hours early.

Three things keep it current, in order of how often they act:

| What | When |
| --- | --- |
| The scores refresh | Every run. Each scores response carries the kickoff time, so keeping it current costs no extra API call |
| A weekly line pull | Whenever you pull a week again. Tuesday is also when flex decisions are announced |
| Games page | By hand, using the date box on a game's row |

A locked line is yours and the feed will not move the number, but it will move
the time, because the schedule belongs to the NFL rather than to your pull.

**Once a game's line freezes at kickoff, its time stops moving too**, and the
admin form refuses to change it. Picks were already settled against it.

Other changes:

- **Postponed or canceled** — set the status on the Games page. The game drops
  out of that week's scoring entirely, for everyone.
- **A game rescheduled into a different week** keeps its original week and its
  picks, since a pick belongs to a game rather than to a date. Keep that week
  open until it is played, or its score will not arrive.
- **A game added to the slate** appears on the next line pull.
- **A game removed from the slate is never deleted automatically**, because
  deleting a game takes every pick on it. Instead a pull names anything it did
  not mention, and that game's row on the Games page is outlined in red saying it
  was not in the latest pull. Delete it yourself once you are sure.

**Moved games are marked in red** wherever they appear: on the picks page a
game whose kickoff has changed says "Time changed" beside its new time, so
nobody turns up expecting the old slot. The mark clears once the game starts.

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

**There are twelve files to run, in order**, all in `supabase/migrations/`:
`0001_init.sql`, `0002_locked_lines.sql`, `0003_one_game_per_matchup.sql`,
`0004_week_snapshots.sql`, `0005_profiles.sql`, `0006_schedule_changes.sql`,
`0007_sports_and_totals.sql`, `0008_totals_await_number.sql`,
`0009_slate_choice.sql`, `0010_ap_poll.sql`, `0011_drop_team_records.sql`,
then `0012_app_state.sql`. Do the first one now and come back for the others.

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

Now repeat the same copy-and-run for the rest: `0002_locked_lines.sql` adds a
column used by the line pull, `0003_one_game_per_matchup.sql` stops the same
game being created twice in a week, `0004_week_snapshots.sql` adds the two
timestamps that make each week its own snapshot, `0005_profiles.sql` adds the
name, email and avatar fields, `0006_schedule_changes.sql` adds the two stamps
that let the app notice a moved or vanished game, `0007_sports_and_totals.sql`
adds college football and the over/under, and `0008_totals_await_number.sql`
lets you turn an over/under on before its number has been pulled, and
`0009_slate_choice.sql` lets you set a game aside without deleting it, and
`0010_ap_poll.sql` stores the AP Top 25 so it is fetched once a week rather
than on every pull. `0011_drop_team_records.sql` removes two columns that a previous version
added, doing nothing if you never ran it, and `0012_app_state.sql` adds the
small table that keeps score checks from being made twice over.

**Running these twice is safe.** Every statement creates its object only if it is
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

## 5. Nothing to do here

This repository has one branch, `claude/nfl-pickem-build-spec-jnc1yo`, and it is
the default branch. There is no `main` to merge into, and nothing to merge.
Vercel deploys the default branch, so pushes land automatically.

If you later add a `main` and want that to be what ships, change **Settings →
Git → Production Branch** in Vercel to match.

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
| `CREATE_GROUP_SECRET` | A password only you know. Required to start a pool |
| `ANTHROPIC_API_KEY` | Your Anthropic API key, from console.anthropic.com. Starts `sk-ant-` |
| `ANTHROPIC_MODEL` | Optional. Leave unset for the Sonnet default |
| `ODDS_API_KEY` | Leave the value empty for now |

**The two API keys look nothing alike, so don't mix them up.** The Anthropic key
starts `sk-ant-`. The Odds API key is a plain string of letters and digits with
no prefix at all, roughly 32 characters. Paste each one bare: no quotes, no
`Bearer`, no `apiKey=` in front, and nothing after it. `/setup` checks the shape
of both and says so if they are swapped.
| `ODDS_API_BOOKMAKERS` | Type `draftkings,fanduel`, or skip this one entirely |

`ODDS_API_BOOKMAKERS` is **not** something you fetch from anywhere. It is your
own preference for whose line to use, and you just type it. Skipping it works
fine. There is more on it under step 9 if you care which sportsbook the numbers
come from.

Watch for a trailing space when pasting on iPadOS — it sometimes tacks one on.
Tap at the end of the field and check.

5. Tap **Deploy** and wait 1-2 minutes.

When it finishes you get a URL like `bettest-abc123.vercel.app`. Open it. You
should land on the join screen.

**If anything goes wrong, add `/setup` to that URL.** The setup check tells you
which environment variables are missing, whether you pasted the anon key instead
of the service role key, whether a value picked up a stray space, and whether all
seven database tables are there. It never shows a secret value, and it works even
when the rest of the app is throwing. It is faster than reading Vercel's logs,
and much faster on an iPad.

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

### The admin page

Everything is closed until you open it. Each header carries one line of its own
state -- "3 weeks open", "Join code 7KQ2M", "471 calls left" -- so a closed page
still tells you where things stand, and opening one drawer leaves the others
alone. Games sits at the top as a link rather than a drawer, because that is
where a week is actually run.

**Arrange**, at the top right, puts a pair of arrows on every header so you can
put the ones you use first. The order and which drawers you left open are
remembered in that browser, per pool. Reset order puts it back.

### Two admin pages

The admin area is split in two, and the split matters.

**Games** is the slate: scores, kickoff times, statuses, over/under toggles,
adding a game, deleting one. It holds both competitions, with tabs for NFL and
NCAA and a week list under each. This is the page in constant use during a
weekend, and every edit on it reloads it.

Every game is a closed drawer. The row you see carries who is playing, the
kickoff, the line, the status, the over/under if there is one, and the On/Off
switch, since that is the control you reach for most. Tap the row for the score
form, the kickoff box, the over/under controls and the rest. Forty college
games read as forty lines rather than forty forms.

**Admin** is everything that is decided once: pulling a week's games, pulling
totals, opening and closing weeks, the join code, invites, members, pick
corrections, points adjustments and the audit log.

They were one page, which meant a typo in a score reloaded the pull buttons
too, and the button that spends an API call sat a thumb's width from the one
that fixes a final score. Keeping them apart is what makes both safe to use
quickly.

### Pulling a week's games

**Admin → Pull games** is the on-demand path. Choose the competition, the season
and the week, then press **Pull games**.

**How many calls you have left** is printed in each pull box, under "Where
from", before you press anything. Reading it is free: the feed's own listing
endpoint is not billed and every reply carries the counters. Each pull, games or
totals, spends exactly one call, and the result message says what is left
afterwards. The free plan is 500 a month.

**Where the numbers come from** is a choice on that form, and the odds feed is
the default. The feed answers with exact team names, exact kickoff times and a
current spread for one request against your monthly quota, and nothing in it can
be misremembered. Claude web search is the other option and spends no
odds-feed calls at all: it costs Anthropic credit instead, a fraction of a
dollar a pull. It is slower, and its numbers are a model's reading of a betting
page rather than a sportsbook's own field, so check the slate afterwards. Use
it when the feed has not posted a week yet, or when you would rather not spend
a call. Adding games by hand on the Games page spends nothing at all.

**NFL pulls the whole slate. NCAA pulls a pool of forty.** College plays sixty
or more games a week, which is nobody's idea of a pick sheet, but the obvious
cut -- ranked teams first -- gives a list of top ten sides winning by forty,
which is the least interesting pick sheet imaginable. So the pool is drawn from
two orderings in turn: the ranked games, best ranking first, and the closest
lines whoever is playing. Games from every day the week plays are included,
Thursday night through Saturday night. Rankings come from the poll stored for that week, and a
pull shows them for nothing; without one the games still arrive, just without
rankings, which affect what the pool is drawn from but never scoring.

**A pull spends no Claude tokens.** Both competitions pull from the odds feed:
one HTTP request, no model, a second or two. Earlier versions fetched the AP
poll with a web search on every college pull, which is what made an NCAA pull
slow and expensive next to an instant NFL one.

**Rankings are stored once a week**, in the Rankings box under Pull NCAA, and
neither way of getting them costs a token. **Read them from ncaa.com** fetches
the AP rankings page and parses it here. **Paste the Top 25** takes a poll
copied from anywhere: each line needs a number and a school, and records, vote
totals and brackets are ignored.

If the rankings page moves, set `AP_POLL_URL` in Vercel to another one. The
parser does not depend on that page's markup -- it strips the tags and reads
the numbered lines -- so most rankings pages will work. It refuses anything
that yields fewer than ten teams rather than storing nonsense.

**A warning about Claude web search.** It is the one expensive thing in this
app, and not obviously so: the pages it reads land in its context. One bounded
single-search run was measured here at 231,056 tokens, and it came back with
nothing. That is why nothing uses it automatically any more. The "Claude web
search" option under Where from is the only remaining use, it is there for a
week the odds feed has not posted, and it stops itself at
`CLAUDE_PULL_TOKEN_BUDGET` tokens (120,000 by default) rather than running on.

**College week numbers.** College football plays a Week 0 in late August, so the
app numbers its weeks the way the sport does: Week 1 is the weekend that ends on
Labor Day, and the late August openers are Week 0. Pull Week 0 by typing 0.

**The scheduled refresh will not add college games.** A curated slate is a
selection you made; the feed refreshing behind it would put the other forty
games in front of everyone. It still updates kickoff times and scores on the
games you did pull.

### The picks page

Across the top: **All · NCAA · NFL**. NCAA is where you land, since its weekend
comes first. **All** stacks both open weeks in one scroll, college above the
NFL, with a labelled rule between them. Each competition keeps its own board,
its own picked count and its own lock, because they are separate weeks with
separate rules. Games stay in kickoff order throughout.

Switching tabs is immediate: both competitions arrive with the page and the tab
only decides what is on screen. The URL keeps up without a navigation, so a
reload lands where you were.

**College cards name the school, not the mascot.** "Indiana" reads to everybody;
"Hoosiers" does not, and there are a dozen Bulldogs. The mascot moves to the
line underneath, and a top 25 ranking sits in front of the name: **#5 Indiana**,
then *Hoosiers*, then *vs Ohio State*. Result sentences and the consensus row
use the school too, since a college abbreviation is built from the mascot and
says nothing. The NFL is unchanged, because everyone knows the Chiefs.

The spread and the over/under stay on a card for the life of the game. While it
is on, the line sits above the live score; when it is over, the line is the
number the pick was graded against, sitting beside the final. The over/under
row shows its number and the combined score next to it.

### Score updates, and what they cost

Scores update two ways, and neither involves Claude or costs a token.

**While anyone is watching, the page brings them current itself.** Opening the
picks page checks the scores when a game kicked off in the last six hours and
has no final score yet, and when nobody has checked in the last ten minutes.
Six hours is a game and its overrun; a game that never resolved beyond that is
for an admin to fix, not something to spend a call on at every page view. The interval is
claimed in the database, so ten people watching at once still spend one call,
and nobody watching spends none at all. The page says when it last looked.

**A GitHub Actions workflow also calls in every half hour** during game
windows, which covers the times nobody has the app open. Treat it as a backstop
rather than the mechanism: GitHub's scheduler is best-effort and drops runs
under load -- three were due in one hour here and one arrived.

**The cost is odds-feed calls.** Each run that finds a game waiting on a score
spends one call per sport. The windows in `.github/workflows/scores.yml` come
to about 68 runs a week, which lands near 300 to 400 calls a month with both
sports in play. That fits the free tier of 500, but without much room, since
pulling lines and totals comes out of the same allowance.

Three things keep that from becoming a surprise:

- A run spends nothing when no game in an open week is actually waiting on a
  score, which is most runs at the edges of a window.
- The endpoint refuses to spend once the month's balance falls below
  `ODDS_API_MIN_REMAINING`, 50 by default, so you can always still pull next
  week's lines. It says so in the workflow log rather than failing.
- Each pull box on the admin page prints the balance before you spend it.

**To chase one week by hand**, use Admin → Update a week. Pick the week, then
**Pull scores** or **Update odds**. Each spends one call, on that week alone.
Pull scores also freezes any line whose kickoff has passed and regrades what
resolved; Update odds moves loose spreads and brings a flexed kickoff current,
while a locked line keeps its number.

To update more often, change every `*/30` in that workflow. `*/15` doubles the
calls and needs watching on the free tier; `*/5` is six times them and needs a
paid Odds API plan, where the $30 tier covers it many times over.

**Nothing else strains at this cadence.** GitHub Actions has no run limit that
this approaches, the app writes only rows that actually changed, and each run
reads the week's games once rather than once per game.

### Choosing the slate

Ten or so games is a week worth picking, and which ten is nobody's judgement
but yours.

A college pull offers forty games from across the week -- ranked teams and
close lines in equal measure, Thursday night through Saturday night -- so the
choosing is yours.

On the **Games** tab each game has an **On / Off** switch. Off takes it out of
the week without deleting it: members stop seeing it, and it keeps its line if
you switch it back on. The count beside the week heading reads "8 of 10 in the
slate", so you can see where you are. Ten is a target, not a limit -- run
twelve or six if you would rather.

Deleting a game is a separate thing, folded away under **Remove permanently**,
because it takes every pick on the game with it and cannot be undone. Switching
off is what you want almost every time.

A game that somebody has already picked cannot be set aside. Excluding it would
either void their pick or keep scoring one they can no longer see, so the app
refuses and says how many picks are on it. Delete the game if you really mean
to take those picks with it.

### Over/unders

Over/unders are off by default and never appear until you turn one on.

1. On the **Games** tab, press **Over/under on** for each game that should
   have one. The game is flagged; it has no number yet, and members see nothing.
2. Under **Admin → Pull totals**, press **Pull totals**. That fetches the
   current numbers and writes them onto every flagged game in the week. One
   request, however many games you flagged.
3. The over/under row appears for members only once the number lands.

If a book has not posted a total for one of your games, the result says which,
and you can type a number into that game by hand. **Over/under off** takes the
market off a game and drops its number with it. Like a spread, a total freezes
at kickoff.

**The pull locks each line.** A locked line is left alone by the odds feed, so
nothing overwrites it behind your back. Pull the same week again whenever you
like and the numbers are replaced. There are three states a spread moves
through, in order of permanence:

| State | What it means |
| --- | --- |
| Loose | The odds feed refreshes it freely, right up to kickoff |
| Locked | A pull fixed it. The feed skips it; another pull may replace it |
| Frozen | Kickoff passed. Nothing changes it, ever |

Freezing still wins. Once a game kicks off, its line is the number picks are
graded against, and no pull can move it. Re-pulling a week that has already
started updates only the games still to come, and says how many it left alone.

**Check the slate after a Claude pull.** Those numbers come from a model reading
a betting page rather than from a sportsbook's own field, and the honest failure
mode is a misread half point that then freezes and mis-scores everyone. The app
rejects what it can catch: a name that is not an NFL team, a spread that is not
a half point, one large enough to be a moneyline misread as a spread, a kickoff
in the wrong weekend, a duplicated matchup. Anything dropped is named in the
result, and every pull is written to the audit log with its source. What it
cannot catch is a plausible number that happens to be wrong, which is why the
slate list underneath is worth a glance before anyone picks. A feed pull needs
none of this: the sportsbook's own numbers arrive as they were posted.

**The model.** Pulls use Claude Sonnet 5 by default, which is quicker and
several times cheaper than Opus for what this does: reading numbers off a page
rather than reasoning hard about them. Set `ANTHROPIC_MODEL` in Vercel to try
another one without a code change.

**The time limit.** A search-backed pull can take a few minutes, so the admin
page asks Vercel for 300 seconds. **That needs a Pro plan.** Hobby allows at
most 60 seconds, and a deploy asking for more than the plan permits is
rejected. If a deploy fails naming `maxDuration`, change the `maxDuration`
export in `src/app/g/[groupId]/admin/page.tsx` and
`src/app/api/cron/refresh/route.ts` from 300 to 60.

Cost is small either way. A weekly pull runs on the order of well under a dollar
a month on Sonnet.

### How a pulled game gets scored

Games can arrive from three places: the Claude pull, the odds feed, and hand
entry on the Games page. Scores arrive from one, the odds feed, and it
recognizes a game by the event id it assigned. A game created by a Claude pull
has no such id.

So the feed **adopts** rather than duplicates. When it sees a game it does not
recognize, it looks for the same matchup already sitting in that week without an
event id, and links the two. From then on that game receives scores normally,
and its line is left alone because the pull locked it. The refresh summary says
how many it linked.

The practical consequence: **if you use the Claude pull, keep `ODDS_API_KEY` set
too.** The pull gives you the lines you want and the feed quietly supplies the
results. Without the feed nothing scores automatically, and you enter finals by
hand on the Games page, which regrades that game's picks immediately.

### Which sportsbook the spreads come from

The Odds API returns the same game priced by a dozen or more sportsbooks, and
they rarely agree exactly. One might have the home team at &minus;3, another at
&minus;3.5. Your pool needs one number, so the app picks one.

`ODDS_API_BOOKMAKERS` is how you say whose line you prefer. It is a plain list
you type yourself, not a credential and not something you look up in your
account. It works like a ranked choice: the app walks your list in order and
takes the first book that has posted a spread for that game. If none of them
have, it falls back to whichever book the feed listed first, so you always get a
line when one exists.

**Leaving it blank is a perfectly good choice.** The app then just takes the
first book the feed returns. For a friends' pool the difference between
DraftKings and FanDuel on a given game is half a point on the occasional game,
and it applies to everyone equally.

If you do want to set it, these are the common keys, all lowercase, separated by
commas with no spaces:

```
draftkings, fanduel, betmgm, betrivers, espnbet, fanatics, bovada, betonlineag
```

Sportsbooks come and go and occasionally rebrand, so that list ages. The
authoritative version is the one in your own data: The Odds API returns a `key`
for every book it prices a game with, and their documentation lists the current
set. An unrecognized key is not an error — it simply never matches, and the app
falls back as described above.

One thing worth knowing: **changing this later does not rewrite history.** A
spread that has already frozen at kickoff keeps the number it was graded
against, whichever book supplied it.

### Lines by hand, scores on their own

The two halves of the feed are on different footings, deliberately.

**Lines are pulled manually**, once a week, whenever you choose, from
**Admin → Pull games**. Nothing polls for spreads, so a line cannot move under a
week you have already opened.

**Scores are polled**, because The Odds API has no webhooks — there is no way
for it to push to you, so something has to ask. Two schedules do the asking:

| What | Where it runs | When |
| --- | --- | --- |
| Every 15 minutes while games are on | GitHub Actions | Sunday afternoon and evening, and the three night games |
| Once daily as a backstop | Vercel Cron | 08:00 UTC |

Both call `/api/cron/scores`, which costs **one** Odds API call per run.

## Setting up 15-minute score updates

Vercel's Hobby plan allows one cron run a day, which cannot keep a Sunday
current. GitHub Actions has no such limit and you already have the repository,
so the workflow lives at `.github/workflows/scores.yml` and needs two secrets.

On github.com, open your repository → **Settings** → **Secrets and variables** →
**Actions** → **New repository secret**, and add both:

| Name | Value |
| --- | --- |
| `APP_URL` | `https://your-app.vercel.app`, with no trailing slash |
| `CRON_SECRET` | The same value you set in Vercel |

That is the whole setup. The workflow starts running on its own schedule.

**To check it, or to force an update:** open the **Actions** tab, pick
*Update scores*, and use **Run workflow**. That button works from a phone
browser too, which is handy if a score looks stale mid-afternoon. Every run is
logged there with what it returned, so the Actions tab doubles as the record of
whether scores are current.

### What it costs

**A scheduled run only spends an API call when a game is actually waiting on a
score.** Before fetching, it asks the database whether any game in an open week
has kicked off and is not yet final. If none has, the run does nothing and costs
nothing. That covers the whole off-season, every weekday, the part of a Sunday
window before the first kickoff, and the part after the last game goes final.

So the schedule's ceiling is far above what it actually spends:

| Item | Ceiling, if every run fetched |
| --- | --- |
| Every 15 min during game windows | ~380 in a five-Sunday month |
| Daily backstop at 08:00 UTC | 31 |
| Manual line pulls, 2 calls each | ~10 |
| **Ceiling** | **~420 against a free tier of 500** |

In practice it lands well below that, because a Sunday window is only partly
occupied by unfinished games. **Check the real number** on `/setup`, which
reports calls used and remaining straight from the API's own headers.

The allowance is **per month**, not per year or one-off, and resets on your
billing date. If `/setup` shows fewer than 50 calls left it flags the row, which
gives you time to narrow the windows in `.github/workflows/scores.yml` before
anything stops working.

The windows matter. Polling every 15 minutes around the clock would spend about
2,900 calls a month and blow the free tier five times over. Restricting it to
the roughly 19 hours a week when NFL games are actually being played is what
brings it inside.

GitHub Actions bills about 330 minutes a month for this, against 2,000 free on
a private repository.

**Two caveats.** GitHub runs scheduled workflows on a best-effort basis and can
be a few minutes late when it is busy, which does not matter for scores. And
GitHub disables scheduled workflows on a repository with no activity for 60
days; a single commit re-enables them, and the daily Vercel run keeps working
regardless.

### Scores on the free plan### Scores on the free plan

Spreads and scores are two different endpoints, and they are not restricted the
same way. Looking up games that have already finished counts as historical data,
which The Odds API limits to paid plans. The app asks for three days of results,
falls back to a plain request when that is refused, and reports the two pulls
separately, so a free-plan restriction on scores never presents as a failure to
fetch spreads.

The practical effect on a free plan: **spreads work, results may lag.** Enter a
final score by hand on the Games page when they do. Saving a score there
regrades every pick on that game immediately, so the leaderboard is correct
either way.

## 10. Check the weekly job

Open your Vercel project → **Settings** → **Cron Jobs**. You should see one
entry for `/api/cron/refresh`. It runs itself from here on; there is nothing to
maintain.

Details of what it does and when are in *The weekly refresh* below.

---

# Changing things later, from the iPad

**Two kinds of change, and they behave differently.** This trips people up:

| What changed | What you do |
| --- | --- |
| Code | Nothing. The push deploys itself in a minute or two. |
| An environment variable | Redeploy by hand: Deployments tab → **⋯** on the newest one → **Redeploy**. A variable change does not trigger a deploy on its own. |

Environment variables live in Vercel under Settings → Environment Variables.

**To change the code**, you have two options:

- **Ask Claude.** Describe what you want in a Claude Code session on this
  repository. Changes are pushed to the branch Vercel deploys, so a new version
  goes live on its own within a couple of minutes. Nothing to merge.
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

**Start here: open your app's URL with `/setup` on the end.** It checks every
environment variable, every database table, and the odds feed itself, and names
what is wrong. Checking the odds key costs nothing: it uses an endpoint that
does not count against your monthly allowance, and it reports how many calls
you have left. Most of
the rows below are things it will find for you.

| What you see | What it means |
| --- | --- |
| `Application error: a server-side exception has occurred` with a digest number | Something threw on the server. Open `/setup` first — on a new deployment this is nearly always a missing or mistyped variable. If `/setup` is clean, search the digest in your Vercel project's Logs tab for the real message. |
| The Vercel build failed | Open the deployment and read the log. A missing environment variable does not fail the build, so it is usually something else. |
| `This deployment is missing ...` on the join form | Exactly what it says. Those variables are unset in Vercel, or have a stray space. Nothing was saved. Fix them, redeploy, try again. |
| The app loads but creating a group hangs or errors | Almost always the `anon` key was pasted instead of `service_role`. `/setup` decodes the key and tells you which one you pasted. |
| The join screen works, then everything breaks after you create a group | Usually a missing `SESSION_SECRET`. The join screen does not read it, but every page does once you have a session cookie. `/setup` will show it. |
| The same game appears twice in a week | Delete the extra on the Games page, then run `0003_one_game_per_matchup.sql` again. It refuses to build its index while duplicates exist and tells you so. |
| A pulled game never gets a score | It was never linked to the odds feed. Set `ODDS_API_KEY` and press refresh, which adopts it, or enter the final by hand on the Games page. |
| `/setup` says The Odds API returned 404 | Fixed. The setup probe was asking for a path that does not exist; your actual refresh was unaffected. Pull the latest and redeploy. |
| Odds refresh fails right after you add the key | Check you pasted the Odds API key and not the Anthropic one. `/setup` names this directly. The Odds API key has no `sk-` prefix. |
| A Claude pull says the key was rejected | `ANTHROPIC_API_KEY` is wrong, or was set in Vercel without redeploying. |
| A page 500s instantly, with no outgoing requests in the Vercel log | The page's module failed to load, so nothing ran. Read the Vercel log for the reason. One cause is a `"use server"` file exporting anything other than an async function, which `npm test` now checks for. |
| The Vercel deploy fails naming `maxDuration` | You are on Hobby, which caps a function at 60 seconds. Change both `maxDuration` exports from 300 to 60, or upgrade to Pro. |
| "That didn't get through", or "Load failed" | The browser's request never completed: a dropped connection, a phone switching networks, or a deploy landing mid-request. Nothing is wrong with the pool. Reload and check whether the work happened before pressing the button again. |
| A button shows an error, but the work actually happened | A timeout, not a failure. The job finished server-side after the response gave up. Reload and check before pressing again. Vercel's default is 10 seconds on Hobby; the admin page now asks for 60, its ceiling. A search-backed Claude pull can still exceed that, in which case pull one week at a time or move to Pro. |
| `Missing required environment variable ...` | That variable is not set in Vercel, or you added it and did not redeploy. |
| `relation "groups" does not exist` | The SQL from step 2 did not run. Open Supabase's Table Editor and confirm the seven tables are there. |
| The SQL ran but only some tables appeared | The run stopped partway. Run `supabase/reset.sql`, then `0001_init.sql` again. Reset deletes everything, so only on a database with nothing worth keeping. |
| Picks tab says "No games yet" | Expected on a fresh database. Add a game by hand (step 8) or run the odds refresh (step 9). |
| A game will not accept a pick | Its kickoff has passed. That is the rule working. Use Admin → Picks to edit a pick after kickoff. |
| Odds refresh says `401` | The key is wrong, or it was set in Vercel without redeploying afterwards. `/setup` checks the key directly and says which. |
| Odds refresh mentions scores but the spreads came through | Expected on the free plan. The scores endpoint restricts finished-game lookups to paid plans, so results can lag. Enter a final score by hand on the Games page, or upgrade. The spreads are unaffected. |
| Odds refresh says `Usage quota` | The monthly allowance is spent. `/setup` shows how many calls remain. |
| Leaderboard shows 0 after a game is final | Grading runs on the weekly pass or when an admin saves a score override. Press Admin → Refresh odds and scores now. |
| Cron job never appears in Vercel | `vercel.json` has to be on the deployed branch. Cron jobs register on deploy, not on save. |
| A fix was pushed but the app has not changed | Check the Deployments tab. Code pushes deploy on their own; if the newest deployment is older than the push, open it and read the build log. |
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
npm test        # 75 tests
npm run build
```

# Layout

```
src/lib/            scoring, grading, odds parsing, session, database access
src/lib/refresh.ts  the maintenance pass shared by cron and the admin button
src/app/setup       configuration check, reachable without signing in
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
