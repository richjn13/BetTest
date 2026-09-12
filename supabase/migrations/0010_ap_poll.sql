-- The AP Top 25, stored once a week.
--
-- The rankings are the only thing about a college pull that the odds feed does
-- not carry, and fetching them was costing a model call on every single pull --
-- which is what made an NCAA pull slow and expensive while the NFL one was
-- instant and free. Stored here, a week's poll is fetched or pasted once and
-- then reused by every pull of that week for nothing.
--
-- Safe to run more than once.

create table if not exists ap_poll (
  season_year int not null,
  week_number int not null,
  -- [{ "rank": 1, "team": "Ohio State" }, ...]
  entries jsonb not null,
  -- 'pasted' or 'claude', for the audit trail.
  source text not null default 'pasted',
  updated_at timestamptz not null default now(),
  primary key (season_year, week_number)
);

alter table ap_poll enable row level security;

comment on table ap_poll is
  'AP Top 25 by week. Written once, read by every college pull of that week.';
