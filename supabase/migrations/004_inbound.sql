-- Run once in Supabase → SQL Editor (WhatsApp 24 h window).
alter table public.clients add column if not exists last_inbound_at timestamptz;
alter table public.clients add column if not exists wa_digits text
  generated always as (regexp_replace(coalesce(whatsapp, ''), '[^0-9]', '', 'g')) stored;
create index if not exists clients_wa_digits_idx on public.clients (wa_digits);
