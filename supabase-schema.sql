-- NMTC Screener — Supabase schema
-- Run this in the Supabase SQL Editor for your project.

-- CDE monthly allocation data (overwritten each upload)
create table if not exists cde_allocations (
  id              uuid default gen_random_uuid() primary key,
  name            text not null,
  remaining_allocation numeric,
  geography       text,
  focus           text,
  nmca_relationship boolean default false,
  data_month      text,        -- e.g. "2025-03"
  upload_date     timestamptz default now()
);

-- Persistent nmca_relationship flags — keyed by normalized CDE name
-- Survives monthly uploads; merged back into cde_allocations on read.
create table if not exists cde_flags (
  id              uuid default gen_random_uuid() primary key,
  cde_name_key    text unique not null,   -- lowercased, trimmed name
  nmca_relationship boolean default false,
  updated_at      timestamptz default now()
);

-- Every address search logged here
create table if not exists search_history (
  id              uuid default gen_random_uuid() primary key,
  address_input   text,
  matched_address text,
  geoid           text,
  eligible        boolean,
  distress_tier   text,   -- 'ineligible' | 'lic' | 'severe' | 'deep'
  oz_status       boolean,
  hubzone_status  boolean,
  geocoded_by     text,
  searched_at     timestamptz default now()
);

-- Row Level Security — anon key can insert search_history and read all tables.
-- Admin writes (cde_allocations, cde_flags) are done via the same anon key
-- since auth is handled in the app layer. Tighten with Supabase Auth if needed.
alter table cde_allocations  enable row level security;
alter table cde_flags        enable row level security;
alter table search_history   enable row level security;

create policy "anon read cde_allocations"  on cde_allocations  for select using (true);
create policy "anon write cde_allocations" on cde_allocations  for insert with check (true);
create policy "anon delete cde_allocations" on cde_allocations for delete using (true);

create policy "anon read cde_flags"        on cde_flags        for select using (true);
create policy "anon upsert cde_flags"      on cde_flags        for insert with check (true);
create policy "anon update cde_flags"      on cde_flags        for update using (true);

create policy "anon insert search_history" on search_history   for insert with check (true);
create policy "anon read search_history"   on search_history   for select using (true);
