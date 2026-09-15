-- Two tables for the dog camera: who is online, and the short conversation two
-- browsers have while they work out how to talk to each other directly.
--
-- No video is ever stored here. Once the camera and the viewer have connected,
-- the picture flows between the two devices and never touches the database or
-- the server, which is what makes running this cost nothing.
--
-- Safe to run more than once.

create table if not exists dogcam_cameras (
  slug text primary key,
  name text not null default '',
  -- Updated by the camera device every half minute while its page is open.
  -- Nothing else writes it, so "online" is simply "beat within the minute".
  last_seen_at timestamptz not null default now(),
  -- What the camera last reported about itself: whether it is streaming or
  -- paused, which lens it is using, battery if the browser will say.
  status jsonb not null default '{}'::jsonb
);

alter table dogcam_cameras enable row level security;

comment on table dogcam_cameras is
  'One row per camera device. last_seen_at is a heartbeat, not a login.';

-- The signalling mailbox. Each row is one message from one browser to another:
-- an offer, an answer, or a network candidate. They are read once and swept
-- after a couple of minutes -- a candidate that old is no use to anybody.
create table if not exists dogcam_signals (
  id bigserial primary key,
  room text not null,
  -- 'camera', or the random id a viewer made up for this visit.
  recipient text not null,
  sender text not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table dogcam_signals enable row level security;

create index if not exists dogcam_signals_inbox
  on dogcam_signals (room, recipient, id);

create index if not exists dogcam_signals_age on dogcam_signals (created_at);

comment on table dogcam_signals is
  'Short-lived WebRTC handshake messages. Swept after two minutes.';
