-- IMPI CCTV IP & Diagram Register — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Database > SQL Editor > New query).

create extension if not exists "pgcrypto";

create table if not exists sites (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled site',
  client text default '',
  address text default '',
  survey_date date,
  surveyor text default '',
  notes text default '',
  floorplan_url text,
  floorplan_w int,
  floorplan_h int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists cameras (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  label text default '',
  location text default '',
  ip text default '',
  mac text default '',
  model text default '',
  channel text default '',
  power text default 'PoE',
  status text default 'planned',
  notes text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists pins (
  camera_id uuid primary key references cameras(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  x numeric not null,
  y numeric not null,
  updated_at timestamptz default now()
);

-- Row Level Security: only signed-in IMPI accounts (admin + the shared
-- technician login) may read or write. Only the admin account may delete
-- a site (technicians can still delete individual devices).
alter table sites enable row level security;
alter table cameras enable row level security;
alter table pins enable row level security;

-- Replace with your own admin email before running.
-- This must match VITE_ADMIN_EMAIL in your .env file.
create or replace function is_impi_admin() returns boolean as $$
  select auth.jwt() ->> 'email' = 'shane@impi-secure.co.za';
$$ language sql stable;

create policy "read sites" on sites for select using (auth.role() = 'authenticated');
create policy "write sites" on sites for insert with check (auth.role() = 'authenticated');
create policy "update sites" on sites for update using (auth.role() = 'authenticated');
create policy "delete sites (admin only)" on sites for delete using (is_impi_admin());

create policy "read cameras" on cameras for select using (auth.role() = 'authenticated');
create policy "write cameras" on cameras for insert with check (auth.role() = 'authenticated');
create policy "update cameras" on cameras for update using (auth.role() = 'authenticated');
create policy "delete cameras" on cameras for delete using (auth.role() = 'authenticated');

create policy "read pins" on pins for select using (auth.role() = 'authenticated');
create policy "write pins" on pins for insert with check (auth.role() = 'authenticated');
create policy "update pins" on pins for update using (auth.role() = 'authenticated');
create policy "delete pins" on pins for delete using (auth.role() = 'authenticated');

-- Storage bucket for floor plan photos.
insert into storage.buckets (id, name, public)
values ('floorplans', 'floorplans', true)
on conflict (id) do nothing;

create policy "public read floorplans" on storage.objects for select using (bucket_id = 'floorplans');
create policy "authenticated upload floorplans" on storage.objects for insert with check (bucket_id = 'floorplans' and auth.role() = 'authenticated');
create policy "authenticated update floorplans" on storage.objects for update using (bucket_id = 'floorplans' and auth.role() = 'authenticated');
