-- A third state for a week: hidden.
--
-- Open accepts picks. Closed is finished but still there to read -- the scores,
-- the picks, who took what. Hidden is neither: the week is off the app
-- entirely, its column is gone from the leaderboard and its points count for
-- nobody. It is for a week pulled by mistake, or one the pool has decided not
-- to play, and it is reversible: an admin still sees it under Week status.
--
-- Null means the week is not hidden, which is every week there is now.
--
-- Safe to run more than once.

alter table weeks
  add column if not exists hidden_at timestamptz;

create index if not exists weeks_visible_idx
  on weeks (sport, season_year, week_number) where hidden_at is null;

comment on column weeks.hidden_at is
  'When an admin took the week off the app. Null means it is visible.';
