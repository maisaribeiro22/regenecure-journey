-- Run once in Supabase → SQL Editor (projects created before the peptide reminders).
alter table public.app_settings add column if not exists peptide_alerts boolean not null default true;
alter table public.clients add column if not exists tz text;
alter table public.clients add column if not exists last_pep_alert date;
