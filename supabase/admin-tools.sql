-- Таблицы игрового прогресса и публичного рейтинга.
create table if not exists public.nomgen_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  game_state jsonb not null default '{"balance":5000,"collection":[],"sales":[],"spins":0,"nextId":1}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.nomgen_players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Игрок',
  rarest_plate text,
  rarest_region text,
  rarest_tier text,
  rarest_value numeric not null default 0,
  rarity_rank integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.nomgen_saves enable row level security;
alter table public.nomgen_players enable row level security;
drop policy if exists "Players can read own save" on public.nomgen_saves;
drop policy if exists "Players can insert own save" on public.nomgen_saves;
drop policy if exists "Players can update own save" on public.nomgen_saves;
create policy "Players can read own save" on public.nomgen_saves for select to authenticated using(user_id=(select auth.uid()));
create policy "Players can insert own save" on public.nomgen_saves for insert to authenticated with check(user_id=(select auth.uid()));
create policy "Players can update own save" on public.nomgen_saves for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists "Public can read leaderboard" on public.nomgen_players;
drop policy if exists "Players can insert own leaderboard row" on public.nomgen_players;
drop policy if exists "Players can update own leaderboard row" on public.nomgen_players;
create policy "Public can read leaderboard" on public.nomgen_players for select to anon,authenticated using(true);
create policy "Players can insert own leaderboard row" on public.nomgen_players for insert to authenticated with check(user_id=(select auth.uid()));
create policy "Players can update own leaderboard row" on public.nomgen_players for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,insert,update on public.nomgen_saves to authenticated;
grant select on public.nomgen_players to anon,authenticated;
grant insert,update on public.nomgen_players to authenticated;

-- Выполни этот файл целиком в Supabase → SQL Editor → New query.
-- Доступ только пользователям, добавленным в public.nomgen_admins.

create table if not exists public.nomgen_player_odds (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weights jsonb not null,
  updated_at timestamptz not null default now(),
  constraint nomgen_player_odds_valid check (
    jsonb_typeof(weights) = 'array'
    and jsonb_array_length(weights) = 5
  )
);
alter table public.nomgen_player_odds enable row level security;
revoke all on public.nomgen_player_odds from anon, authenticated;

drop function if exists public.admin_list_players();
create function public.admin_list_players()
returns table (
  user_id uuid,
  email text,
  display_name text,
  balance numeric,
  weights jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.nomgen_admins a where a.user_id=(select auth.uid())) then
    raise exception 'Недостаточно прав администратора';
  end if;

  return query
  select
    u.id,
    u.email::text,
    coalesce(nullif(p.display_name,''),nullif(u.raw_user_meta_data->>'display_name',''),nullif(u.raw_user_meta_data->>'name',''),'Игрок')::text,
    coalesce((s.game_state->>'balance')::numeric,5000::numeric),
    coalesce(o.weights, st.weights, '[69.5,22,7,1.5,0.5]'::jsonb)
  from auth.users u
  left join public.nomgen_players p on p.user_id=u.id
  left join public.nomgen_saves s on s.user_id=u.id
  left join public.nomgen_player_odds o on o.user_id=u.id
  left join public.nomgen_settings st on st.id=1
  order by u.created_at desc;
end;
$$;

create or replace function public.get_my_rare_weights()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(o.weights, s.weights, '[69.5,22,7,1.5,0.5]'::jsonb)
  from (select (select auth.uid()) as user_id) me
  left join public.nomgen_player_odds o on o.user_id=me.user_id
  left join public.nomgen_settings s on s.id=1;
$$;

create or replace function public.admin_get_player_weights(target_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not exists (select 1 from public.nomgen_admins a where a.user_id=(select auth.uid())) then
    raise exception 'Недостаточно прав администратора';
  end if;
  select coalesce(o.weights,s.weights,'[69.5,22,7,1.5,0.5]'::jsonb)
  into result
  from (select target_user_id as user_id) t
  left join public.nomgen_player_odds o on o.user_id=t.user_id
  left join public.nomgen_settings s on s.id=1;
  return coalesce(result,'[69.5,22,7,1.5,0.5]'::jsonb);
end;
$$;

create or replace function public.admin_set_player_weights(target_user_id uuid,new_weights jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.nomgen_admins a where a.user_id=(select auth.uid())) then
    raise exception 'Недостаточно прав администратора';
  end if;
  if jsonb_typeof(new_weights)<>'array' or jsonb_array_length(new_weights)<>5
     or exists(select 1 from jsonb_array_elements_text(new_weights) v where v.value !~ '^[0-9]+(\.[0-9]+)?$')
     or exists(select 1 from jsonb_array_elements_text(new_weights) v where v.value::numeric<0)
     or not exists(select 1 from jsonb_array_elements_text(new_weights) v where v.value::numeric>0) then
    raise exception 'Нужно указать 5 неотрицательных весов, хотя бы один больше нуля';
  end if;
  insert into public.nomgen_player_odds(user_id,weights,updated_at)
  values(target_user_id,new_weights,now())
  on conflict(user_id) do update set weights=excluded.weights,updated_at=now();
end;
$$;

create or replace function public.admin_set_player_balance(target_user_id uuid,new_balance numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.nomgen_admins a where a.user_id=(select auth.uid())) then
    raise exception 'Недостаточно прав администратора';
  end if;
  if new_balance is null or new_balance<0 or new_balance<>trunc(new_balance) then
    raise exception 'Баланс должен быть целым неотрицательным числом';
  end if;
  if not exists(select 1 from auth.users u where u.id=target_user_id) then
    raise exception 'Игрок не найден';
  end if;
  insert into public.nomgen_saves(user_id,game_state,updated_at)
  values(target_user_id,jsonb_build_object('balance',new_balance,'collection','[]'::jsonb,'sales','[]'::jsonb,'spins',0,'nextId',1),now())
  on conflict(user_id) do update
  set game_state=jsonb_set(coalesce(nomgen_saves.game_state,'{}'::jsonb),'{balance}',to_jsonb(new_balance),true),
      updated_at=now();
end;
$$;

revoke all on function public.admin_list_players() from public;
revoke all on function public.get_my_rare_weights() from public;
revoke all on function public.admin_get_player_weights(uuid) from public;
revoke all on function public.admin_set_player_weights(uuid,jsonb) from public;
revoke all on function public.admin_set_player_balance(uuid,numeric) from public;
grant execute on function public.admin_list_players() to authenticated;
grant execute on function public.get_my_rare_weights() to authenticated;
grant execute on function public.admin_get_player_weights(uuid) to authenticated;
grant execute on function public.admin_set_player_weights(uuid,jsonb) to authenticated;
grant execute on function public.admin_set_player_balance(uuid,numeric) to authenticated;


-- Гарантированная выдача администратором конкретного номера выбранному игроку.
create table if not exists public.nomgen_forced_numbers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plate text not null,
  region text not null,
  remaining integer not null check (remaining >= 0),
  updated_at timestamptz not null default now()
);
alter table public.nomgen_forced_numbers enable row level security;

create or replace function public.admin_set_forced_number(
  target_user_id uuid, forced_plate text, forced_region text, spin_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare normalized_plate text := upper(regexp_replace(coalesce(forced_plate,''),'[[:space:]]','','g'));
begin
  if not exists (select 1 from public.nomgen_admins a where a.user_id=(select auth.uid())) then
    raise exception 'Недостаточно прав администратора';
  end if;
  if not exists(select 1 from auth.users u where u.id=target_user_id) then
    raise exception 'Игрок не найден';
  end if;
  if normalized_plate !~ '^[АВЕКМНОРСТУХ][0-9]{3}[АВЕКМНОРСТУХ]{2}$' then
    raise exception 'Номер должен быть в формате А777АА';
  end if;
  if coalesce(forced_region,'') !~ '^[0-9]{2,3}$' then
    raise exception 'Регион должен содержать 2–3 цифры';
  end if;
  if spin_count is null or spin_count < 1 or spin_count > 100 then
    raise exception 'Количество попыток должно быть от 1 до 100';
  end if;
  insert into public.nomgen_forced_numbers(user_id,plate,region,remaining,updated_at)
  values(target_user_id,normalized_plate,forced_region,spin_count,now())
  on conflict(user_id) do update
    set plate=excluded.plate,region=excluded.region,remaining=excluded.remaining,updated_at=now();
end;
$$;

create or replace function public.admin_clear_forced_number(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.nomgen_admins a where a.user_id=(select auth.uid())) then
    raise exception 'Недостаточно прав администратора';
  end if;
  delete from public.nomgen_forced_numbers where user_id=target_user_id;
end;
$$;

create or replace function public.consume_forced_number()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  update public.nomgen_forced_numbers
  set remaining=remaining-1,updated_at=now()
  where user_id=(select auth.uid()) and remaining>0
  returning jsonb_build_object('plate',plate,'region',region) into result;
  return result;
end;
$$;

revoke all on function public.admin_set_forced_number(uuid,text,text,integer) from public;
revoke all on function public.admin_clear_forced_number(uuid) from public;
revoke all on function public.consume_forced_number() from public;
grant execute on function public.admin_set_forced_number(uuid,text,text,integer) to authenticated;
grant execute on function public.admin_clear_forced_number(uuid) to authenticated;
grant execute on function public.consume_forced_number() to authenticated;


-- Новая логика: номер выпадает один раз на указанной по счёту попытке.
alter table public.nomgen_forced_numbers
  add column if not exists spins_until integer not null default 1
  check (spins_until between 1 and 100);

create or replace function public.admin_set_forced_number(
  target_user_id uuid, forced_plate text, forced_region text, spin_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare normalized_plate text := upper(regexp_replace(coalesce(forced_plate,''),'[[:space:]]','','g'));
begin
  if not exists (select 1 from public.nomgen_admins a where a.user_id=(select auth.uid())) then
    raise exception 'Недостаточно прав администратора';
  end if;
  if not exists(select 1 from auth.users u where u.id=target_user_id) then
    raise exception 'Игрок не найден';
  end if;
  if normalized_plate !~ '^[АВЕКМНОРСТУХ][0-9]{3}[АВЕКМНОРСТУХ]{2}$' then
    raise exception 'Номер должен быть в формате А777АА';
  end if;
  if coalesce(forced_region,'') !~ '^[0-9]{2,3}$' then
    raise exception 'Регион должен содержать 2–3 цифры';
  end if;
  if spin_count is null or spin_count < 1 or spin_count > 100 then
    raise exception 'Номер можно назначить на попытку от 1 до 100';
  end if;
  insert into public.nomgen_forced_numbers(user_id,plate,region,remaining,spins_until,updated_at)
  values(target_user_id,normalized_plate,forced_region,1,spin_count,now())
  on conflict(user_id) do update
    set plate=excluded.plate,region=excluded.region,remaining=1,
        spins_until=excluded.spins_until,updated_at=now();
end;
$$;

create or replace function public.consume_forced_number()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  delete from public.nomgen_forced_numbers
  where user_id=(select auth.uid()) and spins_until<=1
  returning jsonb_build_object('plate',plate,'region',region) into result;

  if result is null then
    update public.nomgen_forced_numbers
    set spins_until=spins_until-1,updated_at=now()
    where user_id=(select auth.uid()) and spins_until>1;
  end if;
  return result;
end;
$$;

grant execute on function public.admin_set_forced_number(uuid,text,text,integer) to authenticated;
grant execute on function public.consume_forced_number() to authenticated;
