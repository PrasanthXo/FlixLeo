-- Execute in the Supabase SQL editor with database owner privileges.
create table if not exists public.app_update_policies (
  app_id text primary key check (app_id in ('flixleo-android','flixleo-windows','sabdham-android','sri-tunnel-android')),
  latest_version_code integer not null default 0 check (latest_version_code >= 0),
  min_version_code integer not null default 0 check (min_version_code >= 0 and min_version_code <= latest_version_code),
  latest_version_name text not null default '',
  force_update boolean not null default false,
  maintenance boolean not null default false,
  update_url text not null default '',
  release_notes text not null default '',
  maintenance_message text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists public.app_update_notices (
  id uuid primary key default gen_random_uuid(),
  app_id text not null references public.app_update_policies(app_id),
  title text not null,
  body text not null,
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.app_update_policies enable row level security;
alter table public.app_update_notices enable row level security;
revoke all on public.app_update_policies from anon, authenticated;
revoke all on public.app_update_notices from anon, authenticated;
insert into public.app_update_policies(app_id,latest_version_code,min_version_code,update_url) values
 ('flixleo-android',1,0,'https://flixleo.cyou/'),
 ('flixleo-windows',1,0,'https://flixleo.cyou/'),
 ('sabdham-android',1,0,'https://sabdham.cyou/'),
 ('sri-tunnel-android',1,0,'https://flixleo.cyou/')
on conflict (app_id) do nothing;
