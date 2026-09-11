-- Noticing when the schedule moves underneath you.
--
-- Safe to run more than once.
--
--   kickoff_changed_at    stamped whenever a game's kickoff moves after it was
--                         first recorded. Flex scheduling does this, and the
--                         app marks those games so nobody is caught out by a
--                         game starting at a different time than they expected.
--
--   last_seen_in_feed_at  stamped every time a line pull sees the game. A game
--                         in an open week whose stamp is older than that week's
--                         most recent pull has dropped off the slate, which is
--                         otherwise invisible: the app never deletes a game on
--                         the feed's say-so, because deleting one takes every
--                         pick on it too.

alter table games
  add column if not exists kickoff_changed_at timestamptz,
  add column if not exists last_seen_in_feed_at timestamptz;

comment on column games.kickoff_changed_at is
  'When this kickoff last moved. Null means it has never changed since it was first recorded.';
comment on column games.last_seen_in_feed_at is
  'When a line pull last saw this game. Older than the week''s latest pull means it has dropped off the slate.';

create index if not exists games_last_seen_idx on games (week_id, last_seen_in_feed_at);
