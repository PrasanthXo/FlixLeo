-- Run in Supabase SQL Editor. RLS restricts access to the authenticated owner.
create table if not exists public.flixleo_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.flixleo_user_data enable row level security;
revoke all on public.flixleo_user_data from anon;
grant select, insert, update, delete on public.flixleo_user_data to authenticated;
create policy "Users can read own FlixLeo data" on public.flixleo_user_data
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users can create own FlixLeo data" on public.flixleo_user_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Users can update own FlixLeo data" on public.flixleo_user_data
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete own FlixLeo data" on public.flixleo_user_data
  for delete to authenticated using ((select auth.uid()) = user_id);
