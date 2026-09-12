-- Win-loss records for ranked college teams.
--
-- The odds feed carries no records, but the AP rankings page does, beside each
-- school. They are read from the poll at pull time and stored on the game, the
-- same way the ranking is, so a card can say "#5 Indiana (10-1)" without
-- anything being fetched to render it.
--
-- Null for every unranked team and every NFL game.
--
-- Safe to run more than once.

alter table games
  add column if not exists home_record text,
  add column if not exists away_record text;

comment on column games.home_record is
  'Win-loss record at pull time, e.g. 10-1. Ranked college teams only.';
