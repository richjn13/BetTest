-- Each week becomes its own snapshot.
--
-- Safe to run more than once.
--
-- Two timestamps decide what may touch a week:
--
--   opened_at  set the first time lines are pulled or a game is entered by
--              hand. Until then the week does not exist as far as members are
--              concerned, and the odds feed will not create games in it. This
--              is what stops next week's lines appearing before you pull them.
--
--   closed_at  set by an admin when a week is done. Nothing may change after
--              that: no line refresh, no pick, no re-pull. The lines a week
--              was graded against stay exactly as they were.

alter table weeks
  add column if not exists opened_at timestamptz,
  add column if not exists closed_at timestamptz;

comment on column weeks.opened_at is
  'First time lines were pulled or a game entered for this week. Null means the week is not visible to members and the odds feed will not create games in it.';
comment on column weeks.closed_at is
  'Set by an admin when the week is finished. Nothing may modify the week afterwards.';

create index if not exists weeks_opened_idx on weeks (opened_at) where opened_at is not null;

-- Any week that already has games was opened by whatever created them, so
-- backfill rather than hiding a season's work behind a new column.
update weeks
set opened_at = coalesce(
  opened_at,
  (select min(created_at) from games where games.week_id = weeks.id)
)
where opened_at is null
  and exists (select 1 from games where games.week_id = weeks.id);
