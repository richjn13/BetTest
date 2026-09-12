-- Lets the over/under be turned on before its number arrives.
--
-- The flow an admin actually wants is: mark the games that should have an
-- over/under, then pull the numbers for all of them at once. The original
-- constraint made that impossible -- a game could not be flagged until someone
-- had already typed a total into it -- so the flag and the number are now
-- independent. A game with totals_enabled and no total_points is a game
-- waiting for the next totals pull; members cannot pick it until the number
-- lands, which the application enforces.

alter table games drop constraint if exists games_total_needs_number;

comment on column games.totals_enabled is
  'Whether this game should carry an over/under. The number may still be pending.';
comment on column games.total_points is
  'The over/under, once pulled or entered. Null while a flagged game awaits one.';

-- College football plays a Week 0 in late August, so the week number has to
-- reach below 1. The check was written when this was an NFL-only app.
alter table weeks drop constraint if exists weeks_week_number_check;
alter table weeks
  add constraint weeks_week_number_check check (week_number between 0 and 22);
