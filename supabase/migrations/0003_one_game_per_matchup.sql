-- One row per matchup per week.
--
-- Games arrive from three places -- the odds feed, a Claude pull, and hand
-- entry -- and nothing stopped two of them creating the same game twice. A
-- duplicated matchup splits a week's picks across two rows, so this makes it
-- impossible rather than merely unlikely.
--
-- Safe to run more than once. If duplicates already exist the index cannot be
-- built; rather than failing the whole script, this reports them and leaves
-- the rest of the schema alone. Merge or delete them under Admin -> Games,
-- then run this file again.

do $$
declare
  duplicate_count int;
begin
  if exists (select 1 from pg_class where relname = 'games_week_matchup_key') then
    raise notice 'games_week_matchup_key already exists, skipping';
    return;
  end if;

  select count(*) into duplicate_count
  from (
    select week_id, home_team, away_team
    from games
    group by week_id, home_team, away_team
    having count(*) > 1
  ) as duplicates;

  if duplicate_count > 0 then
    raise notice
      'Not creating games_week_matchup_key: % matchup(s) appear more than once in a week. Delete the extra copies under Admin -> Games, then run this file again.',
      duplicate_count;
    return;
  end if;

  create unique index games_week_matchup_key on games (week_id, home_team, away_team);
  raise notice 'games_week_matchup_key created';
end $$;
