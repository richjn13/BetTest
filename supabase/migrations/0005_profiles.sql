-- Member profiles: a display name, an email, and a small avatar.
--
-- Safe to run more than once.
--
-- The avatar is stored inline as a data URL rather than in object storage.
-- The browser downsamples it to 128x128 before upload, so a picture lands at a
-- few kilobytes -- small enough that a column is the simpler answer than a
-- storage bucket with its own access rules to get wrong.

alter table users
  add column if not exists display_name text,
  add column if not exists email text,
  add column if not exists avatar_url text;

alter table users
  drop constraint if exists users_display_name_length;
alter table users
  add constraint users_display_name_length
  check (display_name is null or length(trim(display_name)) between 1 and 40);

alter table users
  drop constraint if exists users_email_shape;
alter table users
  add constraint users_email_shape
  check (email is null or (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and length(email) <= 200));

-- Roughly 45KB of image once base64 is decoded. A 128x128 JPEG is far smaller;
-- this only exists so a bad client cannot push a megabyte into a row.
alter table users
  drop constraint if exists users_avatar_size;
alter table users
  add constraint users_avatar_size
  check (avatar_url is null or (avatar_url like 'data:image/%' and length(avatar_url) <= 60000));

comment on column users.display_name is 'Optional real name. The username stays the identity; this is only shown alongside it.';
comment on column users.avatar_url is 'Data URL of a downsampled square image, or null.';
