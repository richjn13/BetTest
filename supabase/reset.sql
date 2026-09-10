-- DESTRUCTIVE. Deletes every pick, group, member and game in this database.
--
-- Use this only to start over on a database with nothing in it worth keeping,
-- for example after a half-finished run of 0001_init.sql left the schema in an
-- unclear state. Run this first, then run 0001_init.sql again.
--
-- There is no undo and no confirmation prompt.

drop table if exists admin_actions cascade;
drop table if exists point_adjustments cascade;
drop table if exists picks cascade;
drop table if exists games cascade;
drop table if exists weeks cascade;
drop table if exists users cascade;
drop table if exists groups cascade;
