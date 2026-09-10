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

### Auth

There is no email or password. A member joins with a **join code, a username,
and a 4-8 digit PIN**. The session is a signed, HTTP-only cookie holding the
memberships; the PIN is what proves ownership of a username when signing in on
a second device. One person can belong to several pools, and the header carries
a switcher between them.

Every table has row-level security enabled with no policies, so the anon key
grants nothing. All reads and writes go through server components and server
actions using the service role key, which never reaches the browser.

## Setup

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev
```

Apply the schema to your Supabase project by running
`supabase/migrations/0001_init.sql` in the SQL editor, or with the Supabase CLI:

```bash
supabase db push
```

Environment variables are documented in `.env.example`. Generate the two
secrets with `openssl rand -base64 32`.

## Scheduled refresh

`vercel.json` runs `GET /api/cron/refresh` every 15 minutes. The route requires
`Authorization: Bearer $CRON_SECRET`, which Vercel Cron sends automatically. It:

1. pulls current spreads and any newly scheduled games,
2. pulls scores for games in progress or recently finished,
3. freezes the line on every game past kickoff, then regrades affected picks.

**Spread freezing is the part that matters.** The line shown to members is
whatever was last fetched, right up to kickoff. At kickoff the current value is
copied to `frozen_home_spread` and `spread_frozen_at` is stamped. Every later
run skips a frozen game, so a revision in the feed's historical data can never
move the number a pick was graded against.

If the odds feed is unreachable, the run reports the failure and changes
nothing: the last known spread stays on screen rather than erroring out.
Freezing and grading still run, because they only need data already stored.

On Vercel's Hobby plan cron is limited to one run per day. Either move to Pro
for the 15-minute schedule, or drive the same endpoint from an external
scheduler with the same bearer token.

## Admin panel

The group's creator is its admin. The panel can:

- regenerate the join code, invalidating the old one,
- add games and spreads by hand (which is all Phase 1 needed),
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

## Layout

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

## Known gaps

- No automated tests touch the database layer; the pure logic is covered, the
  Supabase calls are not.
- Week numbers are derived from the calendar (Week 1 opens the Tuesday after
  Labor Day, weeks roll over Tuesday 08:00 UTC) because the odds feed does not
  supply them. `NFL_WEEK1_TUESDAY` overrides a season that breaks the rule.
- Kickoff reminders and push notifications are not built.
