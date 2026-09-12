-- Choosing which of a week's games the pool actually plays.
--
-- A college pull returns twenty games so there is something to choose from.
-- Ten or so is a week worth picking, and which ten is a judgement nobody can
-- make for you, so a game can be set aside without being deleted: deleting it
-- would take every pick on it, and a game set aside may well be wanted back.
--
-- Null means the game is in the slate, which is what every existing game is.
--
-- Safe to run more than once.

alter table games
  add column if not exists excluded_at timestamptz;

create index if not exists games_week_included_idx
  on games (week_id) where excluded_at is null;

comment on column games.excluded_at is
  'When an admin took this game out of the slate. Null means it is in.';
