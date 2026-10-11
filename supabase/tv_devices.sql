-- FlixLeo approved TV registry. Apply in Supabase SQL Editor before enabling TV pairing.
create table if not exists public.flixleo_tv_devices (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 label text not null default 'FlixLeo TV',
 approved_at timestamptz not null default now(),
 last_seen_at timestamptz,
 revoked_at timestamptz
);
create index if not exists flixleo_tv_devices_user on public.flixleo_tv_devices(user_id, approved_at desc);
alter table public.flixleo_tv_devices enable row level security;
revoke all on public.flixleo_tv_devices from anon, authenticated;
-- Only trusted Render server service-role can manage devices.
