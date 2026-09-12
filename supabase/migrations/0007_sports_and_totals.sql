-- Two sports, team rankings, and optional over/unders.
--
-- Safe to run more than once.

-- ------------------------------------------------------------------ sport
-- A week belongs to a sport. Weeks are shared across groups, so without this
-- an NCAA week 3 and an NFL week 3 would be the same row.

alter table weeks
  add column if not exists sport text not null default 'nfl';

alter table weeks drop constraint if exists weeks_sport_known;
alter table weeks
  add constraint weeks_sport_known check (sport in ('nfl', 'ncaaf'));

-- Week numbers repeat across sports, so the old key has to include it.
alter table weeks drop constraint if exists weeks_season_year_week_number_key;
create unique index if not exists weeks_sport_season_week_key
  on weeks (sport, season_year, week_number);

-- --------------------------------------------------------------- rankings
-- Poll position at the time the week was pulled, for choosing games. Null for
-- an unranked team, and for every NFL game.

alter table games
  add column if not exists home_rank int,
  add column if not exists away_rank int;

alter table games drop constraint if exists games_rank_range;
alter table games
  add constraint games_rank_range check (
    (home_rank is null or home_rank between 1 and 25) and
    (away_rank is null or away_rank between 1 and 25)
  );

-- ----------------------------------------------------------------- totals
-- Over/unders are off unless an admin turns them on for a game and types the
-- number. Like the spread, the total freezes at kickoff.

alter table games
  add column if not exists total_points numeric(4,1),
  add column if not exists frozen_total numeric(4,1),
  add column if not exists totals_enabled boolean not null default false;

alter table games drop constraint if exists games_total_needs_number;
alter table games
  add constraint games_total_needs_number
  check (not totals_enabled or total_points is not null);

-- ------------------------------------------------------------------ picks
-- A pick now names its market. A game may carry one pick of each.

alter table picks
  add column if not exists market text not null default 'spread';

alter table picks drop constraint if exists picks_market_known;
alter table picks
  add constraint picks_market_known check (market in ('spread', 'total'));

alter table picks drop constraint if exists picks_picked_side_check;
alter table picks
  add constraint picks_picked_side_check check (
    (market = 'spread' and picked_side in ('home', 'away')) or
    (market = 'total' and picked_side in ('over', 'under'))
  );

alter table picks drop constraint if exists picks_user_id_game_id_key;
create unique index if not exists picks_user_game_market_key
  on picks (user_id, game_id, market);

-- The lock is a spread pick. A total cannot be the lock.
drop index if exists picks_one_lock_per_week;
create unique index if not exists picks_one_lock_per_week
  on picks (user_id, week_id) where is_lock;

comment on column weeks.sport is 'nfl or ncaaf. Weeks are per sport.';
comment on column games.totals_enabled is 'Whether members may pick over/under on this game.';
comment on column picks.market is 'spread (home/away) or total (over/under).';
