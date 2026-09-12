-- A tiny key-value table for things the app needs to remember between requests.
--
-- Its first use is the timestamp of the last score check. Scheduled runs from
-- GitHub are best-effort and get dropped under load -- three were due in the
-- hour this was written and one arrived -- so the app also checks scores when
-- somebody looks at a page, and this is what stops every viewer triggering a
-- fetch of their own.
--
-- Safe to run more than once.

create table if not exists app_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table app_state enable row level security;

comment on table app_state is
  'Small named values with a timestamp. Used to rate-limit work across requests.';
