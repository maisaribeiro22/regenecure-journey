-- =====================================================================
-- RegeneCure Client Journey — Supabase schema
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement is idempotent.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Administrators (users of the practitioner interface)
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- The first signed-in user becomes administrator while the admins table is empty.
-- After that, only an existing administrator (or SQL) can add others.
create or replace function public.claim_first_admin()
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return false; end if;
  if exists (select 1 from public.admins where user_id = auth.uid()) then return true; end if;
  if exists (select 1 from public.admins) then return false; end if;
  insert into public.admins (user_id) values (auth.uid());
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Global settings (single row)
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  id             int primary key default 1 check (id = 1),
  shop_url       text not null default 'https://www.nurition.com/shop/maisa-ribeiro',
  fitline_url    text,
  auto_reminders boolean not null default true,
  updated_at     timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Clients and their journey
--   data      → written by the practitioner (report, protocol, follow-ups)
--   progress  → written by the client through the server (stage confirmations, badges)
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  name            text not null,
  whatsapp        text,
  lang            text not null default 'pt' check (lang in ('pt', 'en')),
  status          text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  access_token    text not null unique
                  default translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_'),
  data            jsonb not null default '{}'::jsonb,
  progress        jsonb not null default '{}'::jsonb,
  journey_start   date,
  followup_dates  date[] not null default '{}',
  reminders_sent  int[]  not null default '{}',
  published_at    timestamptz,
  last_sent_at    timestamptz,
  last_seen_at    timestamptz
);
create index if not exists clients_status_idx on public.clients (status);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();

-- One row per dose the client ticked. dose_key = 'YYYY-MM-DD|s:<id>|<slot>' or '...|p:<id>|<slot>'
create table if not exists public.dose_logs (
  client_id  uuid not null references public.clients(id) on delete cascade,
  dose_key   text not null,
  created_at timestamptz not null default now(),
  primary key (client_id, dose_key)
);

-- Client login (link + 6-digit WhatsApp code). Server-only tables.
create table if not exists public.otp_codes (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references public.clients(id) on delete cascade,
  code_hash  text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts   int not null default 0,
  used       boolean not null default false
);
create index if not exists otp_codes_client_idx on public.otp_codes (client_id, created_at desc);

create table if not exists public.client_sessions (
  token_hash text primary key,
  client_id  uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);
create index if not exists client_sessions_client_idx on public.client_sessions (client_id);

-- WhatsApp messages sent by the platform
create table if not exists public.message_log (
  id            bigint generated always as identity primary key,
  client_id     uuid references public.clients(id) on delete set null,
  kind          text not null,
  template      text,
  wa_message_id text,
  ok            boolean not null default false,
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists message_log_client_idx on public.message_log (client_id, created_at desc);

-- Dose activity per client since a given date (for the practitioner overview)
create or replace function public.admin_activity(since text, until text)
returns table (client_id uuid, logs bigint, last_log timestamptz)
language sql stable security invoker
set search_path = public
as $$
  select d.client_id, count(*), max(d.created_at)
  from public.dose_logs d
  where d.dose_key >= since and d.dose_key < until
  group by d.client_id;
$$;

-- ---------------------------------------------------------------------
-- Row Level Security: only administrators reach data through the API.
-- Clients never touch the database directly; the Netlify functions do it
-- for them with the secret key after checking their session.
-- ---------------------------------------------------------------------
alter table public.admins          enable row level security;
alter table public.app_settings    enable row level security;
alter table public.clients         enable row level security;
alter table public.dose_logs       enable row level security;
alter table public.otp_codes       enable row level security;
alter table public.client_sessions enable row level security;
alter table public.message_log     enable row level security;

drop policy if exists admins_read_self on public.admins;
create policy admins_read_self on public.admins
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists settings_admin_read on public.app_settings;
create policy settings_admin_read on public.app_settings
  for select to authenticated using (public.is_admin());
drop policy if exists settings_admin_update on public.app_settings;
create policy settings_admin_update on public.app_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists clients_admin_all on public.clients;
create policy clients_admin_all on public.clients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists dose_logs_admin_read on public.dose_logs;
create policy dose_logs_admin_read on public.dose_logs
  for select to authenticated using (public.is_admin());
drop policy if exists dose_logs_admin_delete on public.dose_logs;
create policy dose_logs_admin_delete on public.dose_logs
  for delete to authenticated using (public.is_admin());

drop policy if exists message_log_admin_read on public.message_log;
create policy message_log_admin_read on public.message_log
  for select to authenticated using (public.is_admin());

-- otp_codes and client_sessions: no policies → no API access except the secret key.

-- Explicit privileges (defence in depth on top of RLS)
revoke all on public.admins, public.app_settings, public.clients, public.dose_logs,
              public.otp_codes, public.client_sessions, public.message_log from anon;
revoke all on public.otp_codes, public.client_sessions from authenticated;
grant select                         on public.admins       to authenticated;
grant select, update                 on public.app_settings to authenticated;
grant select, insert, update, delete on public.clients      to authenticated;
grant select, delete                 on public.dose_logs    to authenticated;
grant select                         on public.message_log  to authenticated;
grant all on public.admins, public.app_settings, public.clients, public.dose_logs,
             public.otp_codes, public.client_sessions, public.message_log to service_role;

revoke execute on function public.claim_first_admin() from public, anon;
revoke execute on function public.admin_activity(text, text) from public, anon;
grant  execute on function public.claim_first_admin()  to authenticated;
grant  execute on function public.admin_activity(text, text) to authenticated;
grant  execute on function public.is_admin()           to authenticated, anon;

-- ---------------------------------------------------------------------
-- Private storage for uploaded reports: reports/<client_id>/<file>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

drop policy if exists reports_admin_select on storage.objects;
create policy reports_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'reports' and public.is_admin());
drop policy if exists reports_admin_insert on storage.objects;
create policy reports_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'reports' and public.is_admin());
drop policy if exists reports_admin_update on storage.objects;
create policy reports_admin_update on storage.objects
  for update to authenticated using (bucket_id = 'reports' and public.is_admin());
drop policy if exists reports_admin_delete on storage.objects;
create policy reports_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'reports' and public.is_admin());

-- ---------------------------------------------------------------------
-- v2 (Oct 2026): daily peptide reminders and client time zones
-- ---------------------------------------------------------------------
alter table public.app_settings add column if not exists peptide_alerts boolean not null default true;
alter table public.clients add column if not exists tz text;
alter table public.clients add column if not exists last_pep_alert date;

-- ---------------------------------------------------------------------
-- v3 (Oct 2026): phone notifications (Web Push). Server-only tables.
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  client_id  uuid not null references public.clients(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  user_agent text
);
create index if not exists push_subscriptions_client_idx on public.push_subscriptions (client_id);
create table if not exists public.server_keys (
  name       text primary key,
  value      jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
alter table public.server_keys        enable row level security;
revoke all on public.push_subscriptions, public.server_keys from anon, authenticated;
grant all on public.push_subscriptions, public.server_keys to service_role;
