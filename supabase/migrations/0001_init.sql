-- NFL Pick'em -- initial schema.
--
-- Safe to run more than once: every object is created only if it is missing,
-- so re-running after a partial failure fills in the gaps instead of erroring
-- on the tables that already exist.
--
-- All access goes through the Next.js server using the service role key, so
-- RLS is enabled with no permissive policies: anon/authenticated clients get
-- nothing, the service role bypasses RLS entirely.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- groups

create table if not exists groups (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 60),
  join_code     text not null unique check (join_code ~ '^[A-Z0-9]{6,10}$'),
  admin_user_id uuid,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------- users
-- A row is a membership: one person in one group. The same person joining a
-- second pool gets a second row. The session cookie carries the ids.

create table if not exists users (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  username   text not null check (length(trim(username)) between 2 and 24),
  pin_hash   text not null,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists users_group_username_key on users (group_id, lower(username));
create index if not exists users_group_idx on users (group_id);

-- Postgres has no "add constraint if not exists", so check the catalog first.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'groups_admin_fk'
  ) then
    alter table groups
      add constraint groups_admin_fk
      foreign key (admin_user_id) references users(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------- weeks
-- Weeks and games are league-wide, not per-group: every pool picks the same
-- NFL slate, and a spread frozen at kickoff is a fact about the game.

create table if not exists weeks (
  id          uuid primary key default gen_random_uuid(),
  season_year int not null check (season_year between 2000 and 2100),
  week_number int not null check (week_number between 1 and 22),
  season_type text not null default 'regular' check (season_type in ('regular', 'postseason')),
  label       text not null,
  created_at  timestamptz not null default now(),
  unique (season_year, week_number)
);

-- ---------------------------------------------------------------- games

create table if not exists games (
  id                uuid primary key default gen_random_uuid(),
  week_id           uuid not null references weeks(id) on delete cascade,
  home_team         text not null,
  away_team         text not null,
  kickoff_time      timestamptz not null,
  -- Point spread from the home team's perspective: -3.5 means home favored by
  -- 3.5. Null until a line is available.
  home_spread       numeric(4,1),
  spread_source     text,
  spread_updated_at timestamptz,
  -- Set once at kickoff. Picks are graded against frozen_home_spread, which
  -- must never change afterwards even if the odds feed revises history.
  spread_frozen_at  timestamptz,
  frozen_home_spread numeric(4,1),
  final_home_score  int,
  final_away_score  int,
  -- Set when an admin enters a score or status by hand. The odds feed skips
  -- these games so a slow API cannot undo a manual correction.
  score_overridden_at timestamptz,
  status            text not null default 'scheduled'
                      check (status in ('scheduled', 'live', 'final', 'postponed', 'canceled')),
  odds_api_event_id text unique,
  created_at        timestamptz not null default now(),
  check (home_team <> away_team)
);

create index if not exists games_week_idx on games (week_id, kickoff_time);
create index if not exists games_kickoff_idx on games (kickoff_time);

-- ---------------------------------------------------------------- picks

create table if not exists picks (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  game_id        uuid not null references games(id) on delete cascade,
  -- week_id is denormalized so "one lock per user per week" is a database
  -- constraint rather than an application promise.
  week_id        uuid not null references weeks(id) on delete cascade,
  picked_side    text not null check (picked_side in ('home', 'away')),
  is_lock        boolean not null default false,
  locked_at      timestamptz,
  points_awarded numeric(3,1),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, game_id)
);

create unique index if not exists picks_one_lock_per_week on picks (user_id, week_id) where is_lock;
create index if not exists picks_game_idx on picks (game_id);
create index if not exists picks_week_idx on picks (week_id, user_id);

-- ------------------------------------------------------- point adjustments

create table if not exists point_adjustments (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  week_id    uuid references weeks(id) on delete set null,
  points     numeric(4,1) not null,
  note       text not null check (length(trim(note)) > 0),
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists point_adjustments_user_idx on point_adjustments (user_id);

-- ------------------------------------------------------------ audit log

create table if not exists admin_actions (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups(id) on delete cascade,
  actor_user_id  uuid references users(id) on delete set null,
  actor_username text not null,
  action         text not null,
  target_user_id uuid references users(id) on delete set null,
  game_id        uuid references games(id) on delete set null,
  note           text,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists admin_actions_group_idx on admin_actions (group_id, created_at desc);

-- ---------------------------------------------------------------- lockdown

alter table groups            enable row level security;
alter table users             enable row level security;
alter table weeks             enable row level security;
alter table games             enable row level security;
alter table picks             enable row level security;
alter table point_adjustments enable row level security;
alter table admin_actions     enable row level security;
