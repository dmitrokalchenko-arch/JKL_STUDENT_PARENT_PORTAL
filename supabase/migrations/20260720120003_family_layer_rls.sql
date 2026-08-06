-- RLS для families / family_guardians / family_students.
--
-- Модель доступа на этом этапе: семья может только ЧИТАТЬ свои собственные
-- записи. Создание/изменение (привязка ребёнка, добавление опекуна) не
-- выполняется семьёй самостоятельно (memory/UI_RULES.md, memory/BUSINESS_RULES.md
-- правило 5, 25) — только сотрудником клуба через service role, пока не
-- создан административный интерфейс (этап 4 роадмапа, отдельное согласование).
-- Поэтому здесь сознательно нет insert/update/delete policies для authenticated —
-- RLS по умолчанию запрещает эти операции при отсутствии policy.

alter table public.families enable row level security;
alter table public.family_guardians enable row level security;
alter table public.family_students enable row level security;

create policy families_select_own on public.families
  for select
  to authenticated
  using (
    id in (
      select family_id from public.family_guardians where auth_user_id = auth.uid()
    )
  );

create policy family_guardians_select_own_family on public.family_guardians
  for select
  to authenticated
  using (
    family_id in (
      select family_id from public.family_guardians where auth_user_id = auth.uid()
    )
  );

create policy family_students_select_own_family on public.family_students
  for select
  to authenticated
  using (
    family_id in (
      select family_id from public.family_guardians where auth_user_id = auth.uid()
    )
  );

-- anon (неавторизованные запросы) не получает вообще никакого доступа к этим
-- трём таблицам — ни одна policy не выдана роли anon.
