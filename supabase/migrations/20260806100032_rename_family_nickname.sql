-- rename_family_nickname — контролируемая смена families.nickname (+
-- пересчёт normalized_nickname) для действия "Login ändern" в
-- manage-family-account. families.normalized_nickname — ОБЫЧНАЯ колонка
-- (не GENERATED ALWAYS, в отличие от trainer_accounts.normalized_login_name,
-- migration 011) — изначально заполняется вручную create-family-account.
-- Без контролируемого пути смены прямой UPDATE легко рассинхронизировал бы
-- nickname/normalized_nickname (ту же категорию бага уже нашёл live-тест на
-- тренерской стороне для email/login_name, migration manage-trainer-account
-- строки 238-280) — здесь закрывается сразу через immutability-триггер +
-- эту функцию, а не задним числом.
create or replace function public.enforce_families_nickname_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.nickname <> old.nickname
     and coalesce(current_setting('families.allow_nickname_rename', true), 'false') <> 'true' then
    raise exception 'families.nickname is immutable; use rename_family_nickname() instead'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_families_nickname_immutable
  before update on public.families
  for each row execute function public.enforce_families_nickname_immutable();

-- SECURITY DEFINER, владелец — postgres: внутренний вызов
-- normalize_family_nickname() (revoke all from public, migration 002)
-- выполняется с правами владельца этой функции, отдельный grant
-- service_role не нужен (в отличие от generated-колонки на тренерской
-- стороне, см. комментарий migration 029) — только сама эта функция должна
-- быть выдана service_role явно (см. grant ниже, тот же паттерн, что
-- migration 023 нашла для rename_trainer_login).
create or replace function public.rename_family_nickname(
  p_family_id uuid,
  p_new_nickname text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  perform set_config('families.allow_nickname_rename', 'true', true);

  update public.families
  set nickname = p_new_nickname,
      normalized_nickname = public.normalize_family_nickname(p_new_nickname)
  where id = p_family_id;

  v_updated := found;

  perform set_config('families.allow_nickname_rename', 'false', true);

  if not v_updated then
    raise exception 'families.id % not found', p_family_id;
  end if;
end;
$$;

comment on function public.rename_family_nickname(uuid, text) is
  'Единственный контролируемый способ изменить families.nickname (пересчитывает normalized_nickname согласованно). Вызывается только manage-family-account Edge Function (service_role). Уникальность (club_id, normalized_nickname) обеспечена существующим constraint (migration 001) — попытка занятого nickname падает unique_violation.';

revoke all on function public.rename_family_nickname(uuid, text) from public;
grant execute on function public.rename_family_nickname(uuid, text) to service_role;
