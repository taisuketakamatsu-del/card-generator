-- taisk: Supabase schema
-- Run this once in the Supabase SQL editor (Project > SQL Editor > New query).

-- ---------- Shared (public) tasks ----------
-- Anyone with the anon key can read/write these. There is no real login for
-- the shared board (identification is just a typed nickname), so treat this
-- table as fully public within whoever has the app URL.
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  bucket text not null check (bucket in ('today', 'week', 'month', 'later')),
  due_date date,
  pinned boolean not null default false,
  priority integer not null default 0,
  done boolean not null default false,
  completed_at timestamptz,
  owner_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

drop policy if exists "tasks are publicly readable" on public.tasks;
create policy "tasks are publicly readable"
  on public.tasks for select
  using (true);

drop policy if exists "tasks are publicly writable" on public.tasks;
create policy "tasks are publicly writable"
  on public.tasks for all
  using (true)
  with check (true);

alter publication supabase_realtime add table public.tasks;

-- ---------- Private tasks ----------
-- Real per-user privacy: this is only safe because rows are gated by
-- auth.uid(), which requires the person to be genuinely signed in via
-- Supabase Auth (see app.js / private login flow), not just a typed name.
create table if not exists public.private_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  bucket text not null check (bucket in ('today', 'week', 'month', 'later')),
  due_date date,
  pinned boolean not null default false,
  priority integer not null default 0,
  done boolean not null default false,
  completed_at timestamptz,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.private_tasks enable row level security;

drop policy if exists "private tasks are owner-only" on public.private_tasks;
create policy "private tasks are owner-only"
  on public.private_tasks for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

alter publication supabase_realtime add table public.private_tasks;

-- ---------- Notes ----------
-- 1. In Authentication > Settings, you can turn OFF "Confirm email" so
--    signup works instantly without an inbox (private login uses a
--    synthetic "<nickname>@taisk.local" address, nobody actually emails it).
-- 2. Presence (who is viewing now) uses Supabase Realtime Presence and
--    needs no extra table — it just broadcasts nicknames over a channel.
