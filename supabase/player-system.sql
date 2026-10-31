-- НомГен: облачные сохранения и публичный лидерборд.
-- Выполни после schema.sql в Supabase → SQL Editor.

create table if not exists public.nomgen_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  game_state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.nomgen_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Игрок' check (char_length(display_name) between 1 and 20),
  rarest_plate text,
  rarest_region text,
  rarest_tier text,
  rarest_value bigint not null default 0 check (rarest_value >= 0),
  rarity_rank integer not null default 0 check (rarity_rank between 0 and 5),
  updated_at timestamptz not null default now()
);

alter table public.nomgen_saves enable row level security;
alter table public.nomgen_players enable row level security;

drop policy if exists "Players can read own save" on public.nomgen_saves;
create policy "Players can read own save"
on public.nomgen_saves for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Players can insert own save" on public.nomgen_saves;
create policy "Players can insert own save"
on public.nomgen_saves for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Players can update own save" on public.nomgen_saves;
create policy "Players can update own save"
on public.nomgen_saves for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Public can read leaderboard" on public.nomgen_players;
create policy "Public can read leaderboard"
on public.nomgen_players for select to anon, authenticated
using (true);

drop policy if exists "Players can create own leaderboard profile" on public.nomgen_players;
create policy "Players can create own leaderboard profile"
on public.nomgen_players for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "Players can update own leaderboard profile" on public.nomgen_players;
create policy "Players can update own leaderboard profile"
on public.nomgen_players for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

grant select, insert, update on public.nomgen_saves to authenticated;
grant select on public.nomgen_players to anon, authenticated;
grant insert, update on public.nomgen_players to authenticated;

create index if not exists nomgen_players_leaderboard_idx
on public.nomgen_players (rarity_rank desc, rarest_value desc);
