-- Lines pulled by Claude are locked at the moment of the pull.
--
-- Safe to run more than once, like 0001.
--
-- Three states a spread can be in, in order of increasing permanence:
--
--   loose   -- refreshed freely by the odds feed until kickoff
--   locked  -- set deliberately by a pull; the feed leaves it alone, but
--              another deliberate pull may replace it
--   frozen  -- stamped at kickoff; nothing changes it, ever
--
-- Freezing still wins: once a game kicks off its line is the number picks are
-- graded against, whatever set it.

alter table games
  add column if not exists spread_locked_at timestamptz;

comment on column games.spread_locked_at is
  'Set when a deliberate pull fixed this line. The odds feed skips these; a later pull may replace them, until kickoff freezes the value for good.';
