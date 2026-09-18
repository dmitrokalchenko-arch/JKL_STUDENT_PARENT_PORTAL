-- ⚠️ ПРЕДЛОЖЕНИЕ — НЕ ПРИМЕНЕНО К PRODUCTION без отдельного явного
-- разрешения пользователя.
--
-- НАЗНАЧЕНИЕ: точечный фикс существующего, независимого от задачи
-- "Club Kyu Technique Program"/"Required Techniques" бага в
-- public.get_current_trainer_groups() — НЕ создан миграциями 060/061 и
-- никак с ними не связан, найден при реальном ручном E2E тренера
-- (Trainer → «Найти ученика» → блок «Мои группы» падал с ошибкой).
--
-- ТОЧНАЯ ПРИЧИНА (подтверждена read-only перед этой миграцией):
-- функция объявляет RETURNS TABLE(..., is_active boolean), но её тело
-- делает `g.aktiv as is_active`, где public.groups.aktiv — text (реальное
-- значение в production — 'JA', других значений в таблице сейчас нет —
-- проверено `select distinct aktiv from public.groups` непосредственно
-- перед написанием этой миграции). PostgreSQL не приводит text к boolean
-- неявно внутри RETURN QUERY — любой реальный вызов с непустым
-- результатом падает с 42804 "structure of query does not match function
-- result type". Воспроизведено эмпирически (безопасная симуляция
-- auth.uid() реального активного тренера, без пароля, тот же приём, что
-- уже использовался и был одобрен ранее в этой сессии).
--
-- МИНИМАЛЬНОСТЬ ИЗМЕНЕНИЯ: правится ТОЛЬКО одно выражение в SELECT —
-- `g.aktiv as is_active` заменяется на `(g.aktiv = 'JA') as is_active`
-- (явное сравнение, а не небезопасный `g.aktiv::boolean`, который упал бы
-- на строке 'JA', т.к. это не PostgreSQL boolean literal). Сигнатура,
-- RETURNS TABLE, SECURITY DEFINER, search_path, вся логика резолва
-- тренера (private.current_active_trainer_account_id() ->
-- trainer_accounts -> trainers -> trainer_id) и JOIN с
-- trainer_groups/groups — БЕЗ ИЗМЕНЕНИЙ, побайтовая копия текущего
-- definition, кроме этой одной строки. public.groups САМА не меняется —
-- ни тип колонки aktiv, ни её данные.
--
-- CREATE OR REPLACE (не DROP+CREATE): форма RETURNS TABLE не меняется
-- (те же 4 колонки, те же типы) — Postgres допускает REPLACE без смены
-- формы результата, поэтому существующие grants (authenticated: EXECUTE,
-- без anon — проверено перед написанием этой миграции) сохраняются
-- автоматически, без необходимости их перечислять заново.
create or replace function public.get_current_trainer_groups()
returns table(group_id text, group_name text, category text, is_active boolean)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_trainer_account_id uuid;
  v_trainer_row_id bigint;
  v_club_id text;
  v_trainer_text_id text;
begin
  v_trainer_account_id := private.current_active_trainer_account_id();

  if v_trainer_account_id is null then
    return;
  end if;

  select ta.trainer_row_id, ta.club_id
    into v_trainer_row_id, v_club_id
  from public.trainer_accounts ta
  where ta.id = v_trainer_account_id;

  select t.trainer_id into v_trainer_text_id
  from public.trainers t
  where t.id = v_trainer_row_id;

  if v_trainer_text_id is null then
    return;
  end if;

  return query
  select
    g.gruppe_id::text as group_id,
    g.gruppenname as group_name,
    g.alter as category,
    (g.aktiv = 'JA') as is_active
  from public.trainer_groups tg
  join public.groups g on g.gruppe_id = tg.gruppe_id
  where tg.trainer_id = v_trainer_text_id
    and tg.club_id = v_club_id
    and g.club_id = v_club_id;
end;
$$;
