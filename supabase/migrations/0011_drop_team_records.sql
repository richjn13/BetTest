-- Removes the win-loss record columns.
--
-- They were added with the rankings and were not wanted: the ranking is the
-- useful part, and a record pulled from a poll page is a snapshot that goes
-- stale the moment a game finishes.
--
-- Safe to run whether or not the columns were ever created, and safe to run
-- more than once.

alter table games
  drop column if exists home_record,
  drop column if exists away_record;
