-- Run once in Supabase → SQL Editor (phone notifications).
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
