-- MoneyTrack Supabase schema
-- Run in Supabase SQL Editor.

create extension if not exists "uuid-ossp";

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  email text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_transactions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists app_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table app_transactions enable row level security;
alter table app_accounts enable row level security;
alter table app_settings enable row level security;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own" on profiles
for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles
for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on profiles;
create policy "profiles_delete_own" on profiles
for delete using (auth.uid() = id);

drop policy if exists "app_transactions_select_own" on app_transactions;
create policy "app_transactions_select_own" on app_transactions
for select using (auth.uid() = user_id);

drop policy if exists "app_transactions_upsert_own" on app_transactions;
create policy "app_transactions_upsert_own" on app_transactions
for insert with check (auth.uid() = user_id);

drop policy if exists "app_transactions_update_own" on app_transactions;
create policy "app_transactions_update_own" on app_transactions
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "app_transactions_delete_own" on app_transactions;
create policy "app_transactions_delete_own" on app_transactions
for delete using (auth.uid() = user_id);

drop policy if exists "app_accounts_select_own" on app_accounts;
create policy "app_accounts_select_own" on app_accounts
for select using (auth.uid() = user_id);

drop policy if exists "app_accounts_upsert_own" on app_accounts;
create policy "app_accounts_upsert_own" on app_accounts
for insert with check (auth.uid() = user_id);

drop policy if exists "app_accounts_update_own" on app_accounts;
create policy "app_accounts_update_own" on app_accounts
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "app_accounts_delete_own" on app_accounts;
create policy "app_accounts_delete_own" on app_accounts
for delete using (auth.uid() = user_id);

drop policy if exists "app_settings_select_own" on app_settings;
create policy "app_settings_select_own" on app_settings
for select using (auth.uid() = user_id);

drop policy if exists "app_settings_upsert_own" on app_settings;
create policy "app_settings_upsert_own" on app_settings
for insert with check (auth.uid() = user_id);

drop policy if exists "app_settings_update_own" on app_settings;
create policy "app_settings_update_own" on app_settings
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "app_settings_delete_own" on app_settings;
create policy "app_settings_delete_own" on app_settings
for delete using (auth.uid() = user_id);

