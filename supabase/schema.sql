-- Space Mission: Beyond Limits — Supabase schema.
-- Apply once in the Supabase SQL editor (step-by-step guide: docs/04 Tech/Multiplayer.md).
-- Applied and checked on a real project (2026-11-15); same contract as src/net/supabase.ts.
--
-- Rooms: the host upserts the full room state (every 10 versions and on every stage / player /
-- host change); a client reads it when it rejoins, a new host after migration keeps writing it.

create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  state jsonb not null,
  version integer not null default 0,
  host_id text,
  updated_at timestamptz not null default now()
);

-- Never roll a room back: an upsert with an older version than the stored one is ignored.
create or replace function public.rooms_keep_newest() returns trigger
language plpgsql as $$
begin
  if new.version < old.version then
    return null; -- skip this update silently
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists rooms_keep_newest on public.rooms;
create trigger rooms_keep_newest before update on public.rooms
  for each row execute function public.rooms_keep_newest();

-- RLS by room code. The client sends the code in the `x-room-code` header (src/net/supabase.ts);
-- a request only sees / writes the row with that code, so rooms can't be listed or guessed in bulk.
-- An educational co-op game without stakes: knowing the code is enough (no accounts).
alter table public.rooms enable row level security;

create or replace function public.request_room_code() returns text
language sql stable as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-room-code', '')
$$;

drop policy if exists "rooms read" on public.rooms;
drop policy if exists "rooms write" on public.rooms;
drop policy if exists "rooms update" on public.rooms;
create policy "rooms read"   on public.rooms for select to anon using (code = public.request_room_code());
create policy "rooms write"  on public.rooms for insert to anon with check (code = public.request_room_code());
create policy "rooms update" on public.rooms for update to anon
  using (code = public.request_room_code()) with check (code = public.request_room_code());
-- Explicit grants: new Supabase projects may not expose new tables to the Data API automatically.
grant usage on schema public to anon;
grant select, insert, update on public.rooms to anon;
-- No delete policy: anon can't delete rooms. Old rooms are cleaned up by the job below.

-- Realtime: broadcast + presence on channel `room:<CODE>` need no table (public channels).

-- Agency progress (Mission Credits, unlocks) — P1, not used by the client yet.
create table if not exists public.agencies (
  id text primary key,
  credits integer not null default 0 check (credits >= 0),
  unlocked text[] not null default array['titan'],
  upgrades text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.agencies enable row level security;
drop policy if exists "agency rw" on public.agencies;
create policy "agency rw" on public.agencies for all to anon using (true) with check (true);
grant select, insert, update on public.agencies to anon;

-- Optional: delete rooms idle for a day (Database → Extensions → enable pg_cron first).
-- select cron.schedule('rooms-gc', '0 * * * *', $$delete from public.rooms where updated_at < now() - interval '1 day'$$);
