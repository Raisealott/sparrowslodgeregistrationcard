-- =============================================================
-- Sparrows Lodge / Holiday House — Registration Card Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- =============================================================

-- ─── Extensions ───────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── Properties ───────────────────────────────────────────────
create table if not exists properties (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  slug        text not null unique,   -- sparrows-lodge | holiday-house
  address     text,
  phone       text,
  email       text,
  website     text,
  created_at  timestamptz not null default now()
);

-- ─── Staff ────────────────────────────────────────────────────
-- Links Supabase auth.users → a specific property
create table if not exists staff (
  id          uuid primary key references auth.users on delete cascade,
  property_id uuid not null references properties on delete restrict,
  full_name   text,
  role        text not null default 'staff' check (role in ('admin', 'staff')),
  created_at  timestamptz not null default now()
);

-- Signup/access requests
create table if not exists signup_requests (
  id                    uuid primary key default uuid_generate_v4(),
  full_name             text not null,
  email                 text not null,
  requested_property_id uuid references properties on delete set null,
  note                  text,
  status                text not null default 'pending'
                          check (status in ('pending', 'approved', 'rejected')),
  requested_at          timestamptz not null default now(),
  reviewed_at           timestamptz,
  reviewed_by           uuid references auth.users on delete set null,
  reviewer_note         text
);

create unique index if not exists signup_requests_pending_email_idx
  on signup_requests (lower(email))
  where status = 'pending';

-- ─── Registrations ────────────────────────────────────────────
create table if not exists registrations (
  id                  text primary key,   -- reg_<timestamp>_<random> (JS generated)
  property_id         uuid not null references properties on delete restrict,
  status              text not null default 'current'
                        check (status in ('current', 'previous', 'deleted')),

  -- Guest fields
  guest_name          text,
  confirmation_number text,
  arrival_date        text,
  departure_date      text,
  room_type           text,
  nightly_rate        text,
  adults              text,
  email               text,
  phone               text,
  car_make            text,
  car_model           text,
  car_color           text,
  resort_fee_consent  text,

  -- Structured data
  rate_lines          jsonb,   -- Array<{ startDate, endDate, rate }>
  signature           jsonb,   -- Array of strokes: Array<Array<{x,y}>>

  -- Timestamps
  created_at          timestamptz not null default now(),
  completed_at        timestamptz,
  deleted_at          timestamptz,
  last_modified_at    timestamptz not null default now(),

  -- Soft-delete helper
  pre_delete_status   text check (pre_delete_status in ('current', 'previous')),

  -- Audit
  created_by          uuid references auth.users on delete set null
);

-- Auto-update last_modified_at on every row change
create or replace function set_last_modified()
returns trigger language plpgsql as $$
begin
  new.last_modified_at = now();
  return new;
end;
$$;

drop trigger if exists trg_registrations_modified on registrations;
create trigger trg_registrations_modified
  before update on registrations
  for each row execute function set_last_modified();

-- ─── Row Level Security ───────────────────────────────────────
alter table properties    enable row level security;
alter table staff         enable row level security;
alter table registrations enable row level security;
alter table signup_requests enable row level security;

-- Make migration re-runnable by dropping policies before re-creating them
drop policy if exists "authenticated can read properties" on properties;
drop policy if exists "anon can read properties" on properties;
drop policy if exists "staff read own record" on staff;
drop policy if exists "staff read own property registrations" on registrations;
drop policy if exists "staff insert own property registrations" on registrations;
drop policy if exists "staff update own property registrations" on registrations;
drop policy if exists "staff delete own property registrations" on registrations;
drop policy if exists "public can create signup requests" on signup_requests;
drop policy if exists "admins can read signup requests" on signup_requests;
drop policy if exists "admins can update signup requests" on signup_requests;

-- Any authenticated user can read the properties list (needed for login flow)
create policy "authenticated can read properties"
  on properties for select
  to authenticated
  using (true);

-- Allow anonymous property read so login/signup request can show property choices
create policy "anon can read properties"
  on properties for select
  to anon
  using (true);

-- Staff can only read their own record
create policy "staff read own record"
  on staff for select
  to authenticated
  using (id = auth.uid());

-- Registrations: staff can only see their own property's records
create policy "staff read own property registrations"
  on registrations for select
  to authenticated
  using (
    property_id = (select property_id from staff where id = auth.uid())
  );

create policy "staff insert own property registrations"
  on registrations for insert
  to authenticated
  with check (
    property_id = (select property_id from staff where id = auth.uid())
  );

create policy "staff update own property registrations"
  on registrations for update
  to authenticated
  using (
    property_id = (select property_id from staff where id = auth.uid())
  );

create policy "staff delete own property registrations"
  on registrations for delete
  to authenticated
  using (
    property_id = (select property_id from staff where id = auth.uid())
  );

-- Signup requests
create policy "public can create signup requests"
  on signup_requests for insert
  to anon, authenticated
  with check (
    status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
  );

create policy "admins can read signup requests"
  on signup_requests for select
  to authenticated
  using (
    exists (
      select 1 from staff s
      where s.id = auth.uid() and s.role = 'admin'
    )
  );

create policy "admins can update signup requests"
  on signup_requests for update
  to authenticated
  using (
    exists (
      select 1 from staff s
      where s.id = auth.uid() and s.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from staff s
      where s.id = auth.uid() and s.role = 'admin'
    )
  );

-- ─── Seed Data ────────────────────────────────────────────────
insert into properties (name, slug, address, phone, email, website) values
  (
    'Sparrows Lodge',
    'sparrows-lodge',
    '1330 E Palm Canyon Dr, Palm Springs, CA 92264',
    '(760) 327-2300',
    'hello@sparrowslodge.com',
    'https://sparrowslodge.com'
  ),
  (
    'Holiday House',
    'holiday-house',
    '200 W Arenas Rd, Palm Springs, CA 92262',
    '(760) 320-8866',
    'hello@holidayhouseps.com',
    'https://holidayhouseps.com'
  )
on conflict (slug) do update set
  name = excluded.name,
  address = excluded.address,
  phone = excluded.phone,
  email = excluded.email,
  website = excluded.website;
