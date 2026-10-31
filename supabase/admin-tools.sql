-- Выполни этот файл целиком в Supabase → SQL Editor → New query.
-- Функции доступны только аккаунтам, добавленным в public.nomgen_admins.

create or replace function public.admin_list_players()
returns table (
  user_id uuid,
  email text,
  display_name text,
  balance numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.nomgen_admins a
    where a.user_id = (select auth.uid())
  ) then
    raise exception 'Недостаточно прав администратора';
  end if;

  return query
  select
    u.id,
    u.email::text,
    coalesce(nullif(p.display_name, ''), nullif(u.raw_user_meta_data->>'display_name', ''), nullif(u.raw_user_meta_data->>'name', ''), 'Игрок')::text,
    coalesce((s.game_state->>'balance')::numeric, 5000::numeric)
  from auth.users u
  left join public.nomgen_players p on p.user_id = u.id
  left join public.nomgen_saves s on s.user_id = u.id
  order by u.created_at desc;
end;
$$;

create or replace function public.admin_set_player_balance(
  target_user_id uuid,
  new_balance numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.nomgen_admins a
    where a.user_id = (select auth.uid())
  ) then
    raise exception 'Недостаточно прав администратора';
  end if;

  if new_balance is null or new_balance < 0 or new_balance <> trunc(new_balance) then
    raise exception 'Баланс должен быть целым неотрицательным числом';
  end if;

  if not exists (select 1 from auth.users u where u.id = target_user_id) then
    raise exception 'Игрок не найден';
  end if;

  insert into public.nomgen_saves(user_id, game_state, updated_at)
  values (
    target_user_id,
    jsonb_build_object('balance', new_balance, 'collection', '[]'::jsonb, 'sales', '[]'::jsonb, 'spins', 0, 'nextId', 1),
    now()
  )
  on conflict (user_id) do update
  set game_state = jsonb_set(coalesce(public.nomgen_saves.game_state, '{}'::jsonb), '{balance}', to_jsonb(new_balance), true),
      updated_at = now();
end;
$$;

revoke all on function public.admin_list_players() from public;
revoke all on function public.admin_set_player_balance(uuid, numeric) from public;
grant execute on function public.admin_list_players() to authenticated;
grant execute on function public.admin_set_player_balance(uuid, numeric) to authenticated;
