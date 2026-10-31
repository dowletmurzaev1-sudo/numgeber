-- Выполни в Supabase → SQL Editor.
create table if not exists public.nomgen_settings (
 id integer primary key check (id=1),
 weights jsonb not null default '[69.5,22,7,1.5,0.5]'::jsonb,
 updated_at timestamptz not null default now(),
 constraint nomgen_weights_array check (jsonb_typeof(weights)='array' and jsonb_array_length(weights)=5)
);
insert into public.nomgen_settings(id,weights) values(1,'[69.5,22,7,1.5,0.5]'::jsonb) on conflict(id) do nothing;
create table if not exists public.nomgen_admins(user_id uuid primary key references auth.users(id) on delete cascade);
alter table public.nomgen_settings enable row level security;
alter table public.nomgen_admins enable row level security;
create policy "Public can read settings" on public.nomgen_settings for select to anon,authenticated using(true);
create policy "Admins can update settings" on public.nomgen_settings for update to authenticated
 using(exists(select 1 from public.nomgen_admins a where a.user_id=auth.uid()))
 with check(exists(select 1 from public.nomgen_admins a where a.user_id=auth.uid()));
create policy "Admins can read own record" on public.nomgen_admins for select to authenticated using(user_id=auth.uid());
create or replace function public.is_nomgen_admin() returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.nomgen_admins where user_id=(select auth.uid())); $$;
revoke all on function public.is_nomgen_admin() from public;
grant execute on function public.is_nomgen_admin() to authenticated;
grant select on public.nomgen_settings to anon,authenticated;
grant update on public.nomgen_settings to authenticated;
grant select on public.nomgen_admins to authenticated;
-- После регистрации аккаунта админа выполни, подставив его UUID из Authentication → Users:
-- insert into public.nomgen_admins(user_id) values ('UUID_АДМИНА');
-- Включи таблицу nomgen_settings в Database → Publications → supabase_realtime.
