# Individual Student Kyu Program — архитектура

Статус: **реализовано в feature branch `feature/individual-student-kyu-program`,
НЕ применено к production, НЕ задеплоено.** Migration:
`supabase/migrations/20260930100076_create_individual_student_kyu_programs.sql`.

## Утверждённые решения

1. **Индивидуальная программа = FULL SNAPSHOT + IMMUTABLE VERSIONING** (не delta).
   - `student_kyu_programs` — заголовок версии: `student_id` + target `kyu_lookup_id`
     + `version` + `status` (`active` | `superseded` | `reset`) + `source`
     (`club_copy` | `edited`) + кто/когда создал/завершил.
   - `student_kyu_program_items` — полный набор техник версии (`technique_id` →
     `judo_techniques`, `block_type`, `sort_order`). Одна техника может быть в
     разных блоках.
   - Каждый Save: active N → `superseded`, создаётся N+1 со своим набором.
     Строки версий и items не редактируются и не удаляются (триггеры).
   - Не более одной `active` на (ученик, target Kyu) — partial unique index.
   - Изменение программы клуба позже **не** меняет сохранённую индивидуальную
     программу.
   - `based_on_club_program_at` не хранится: у `club_kyu_program_items` нет
     надёжной версии/отметки времени (delete+insert при сохранении), а сервер не
     знает, какое состояние программы клуба было открыто в редакторе. Вместо
     этого `source` честно фиксирует, совпал ли сохранённый набор с программой
     клуба в момент Save.

2. **Доступ тренера — только через назначенные группы.**
   `trainer_accounts` → `trainers.trainer_id` → `trainer_groups` →
   `students.gruppe_id` (существующая `can_trainer_access_student`). Каждый
   READ и WRITE проверяется на сервере; тренер без общей группы с учеником не
   читает и не редактирует его программу; два тренера одной группы оба имеют
   доступ. Права обычного тренера не расширяются до всего клуба.

3. **`trainer_access_after_expiry` = только READ.**
   EDIT (Save / Reset, будущий «Повысить Kyu» и прочие записи) —
   `private.can_trainer_edit_student_page`: группа + тот же клуб + Student Page
   ACTIVE по обычному Family-правилу `get_student_page_access`
   (`familySubscriptionAllowsAccess`). Нет строки `student_page_access` или
   `access_until IS NULL` → страница активна (compatibility rule не меняется);
   `manual_disabled` или истёкшая управляемая подписка → запись запрещена.

4. **Family = только чтение.** `get_family_required_techniques` не менялась и
   автоматически получает effective program (individual, если есть active,
   иначе программа клуба) — только при `familySubscriptionAllowsAccess = true`.
   Никаких кнопок/Save/Reset.

5. **Reset сохраняет историю.** «Вернуть программу клуба» переводит active →
   `reset`; items не удаляются; resolver снова отдаёт текущую программу клуба;
   следующий Save продолжает нумерацию (N+1).

6. **Смена Kyu.** Программа привязана к target `kyu_lookup_id`. После смены
   `students.kyu_grad` resolver ищет программу для нового следующего Kyu;
   старая остаётся историей и не применяется. Save/Reset проверяют, что target
   Kyu совпадает с вычисленным сервером, поэтому устаревший редактор получает
   `target_kyu_changed`, а сданная программа после смены Kyu фактически
   замораживается.

7. **Будущее: «Повысить Kyu» создаёт immutable EXAM SNAPSHOT** (НЕ реализовано).
   Отдельное действие на Trainer Student Page после успешного экзамена, одной
   транзакцией:
   1. определить effective program, которую ученик реально сдавал на target Kyu;
   2. создать immutable exam snapshot этой программы;
   3. по snapshot определить eligible Bonus Techniques;
   4. сохранить историческую экзаменационную информацию;
   5. только после успешной фиксации истории изменить current Kyu ученика.
   Если операция не завершилась полностью — Kyu не меняется. Это также
   закрывает пробел для учеников на программе клуба: программа клуба не
   версионируется, поэтому точный состав сданного экзамена сохраняется только
   exam snapshot'ом. Право на это действие — EDIT (п. 3), не READ-исключение.

8. **Будущее: Bonus Techniques строятся из exam snapshot** (НЕ реализовано,
   PR #19 не трогается). В eligible Bonus Techniques попадают ТОЛЬКО техники
   `judo_techniques`, реально входившие в программу успешно сданного экзамена.
   Kihon, ukemi, стойки, перемещения, координационные упражнения и прочие
   элементы без `judo_techniques.id` — не Bonus Techniques.

9. **Будущее: рабочий Bonus-блок может редактироваться тренером.**
   Редактирование Bonus-блока ученика никогда не меняет immutable exam snapshot:
   exam snapshot — история того, что реально сдавал ученик; Bonus-блок — рабочий
   редактируемый блок.

10. **PR #19 (`feature/trainer-bonus-techniques-v2`) не затрагивается.**

## Backend

| Объект | Роль |
|---|---|
| `public.student_kyu_programs`, `public.student_kyu_program_items` | RLS включён, policy нет, `REVOKE ALL` у `public`/`anon`/`authenticated`, `SELECT` только `service_role` |
| `private.can_trainer_edit_student_page(bigint)` | EDIT-проверка; EXECUTE ни у одной клиентской роли |
| `public.get_required_techniques_for_student(bigint)` | effective program: individual → club; + `source`, `version`, `nextKyuLookupId`; EXECUTE только `service_role` |
| `public.get_trainer_required_techniques(bigint)` | READ как раньше (`can_trainer_access_student_page`) + `canEdit` |
| `public.get_family_required_techniques(bigint)` | без изменений |
| `public.save_trainer_student_kyu_program(bigint, bigint, jsonb, integer)` | Save; `authenticated`, без `anon` |
| `public.reset_trainer_student_kyu_program(bigint, bigint, integer)` | Reset; `authenticated`, без `anon` |

Ответ Save/Reset: `{ok: true, version}` или `{ok: false, reason}`, где `reason` —
`not_allowed` (нет тренера/нет связи с учеником — один общий ответ, существование
ученика не раскрывается) | `page_inactive` | `target_kyu_changed` |
`invalid_items` | `version_conflict`. `club_id` с клиента не принимается.

**Concurrency:** `p_expected_version` = версия, открытая в редакторе (`NULL` —
индивидуальной не было). Любое расхождение с текущей active → `version_conflict`
без изменений в БД. `pg_advisory_xact_lock` на (ученик, target Kyu) сериализует
одновременные Save/Reset; partial unique index — вторая линия защиты.

## Frontend

- `RequiredTechniquesSection`: Trainer-only строка заголовка —
  «Настроить индивидуально» (source = club) или бейдж «Индивидуальная программа»
  + «Изменить» (source = individual); при `canEdit = false` вместо кнопки —
  «Редактирование недоступно: страница ученика не активна.». Family этот проп
  (`onEdit`) не получает — ничего не рендерится.
- `/trainer/student/:studentId/required-techniques` →
  `TrainerStudentKyuProgramPage`: заголовок «Индивидуальная программа — {имя} —
  {Kyu}», три блока, каталог и поиск, Save / Отменить изменения, «Вернуть
  программу клуба» (с подтверждением). Target Kyu берётся только из ответа
  сервера. До Save в БД ничего не создаётся. «Назад» возвращает на страницу
  ученика с открытым разделом «Необходимые техники» (`?section=techniques`).
- Переиспользованы без изменений: `KyuProgramBlocks`, `SelectedTechniquesStrip`,
  `SelectedTechniqueChip`, `TrainerKyuTechniqueGrid`, `TechniqueSelectCard`,
  `KyuBeltImage`, `TrainerHeader`, `useJudoTechniques`, `utils/kyuProgram.js`,
  `TrainerKyuProgramPage.module.css`. Клубный редактор не менялся.

## Вне объёма

Promote Kyu, exam snapshot, Bonus Techniques, Technique Progress, legacy
`public.students` (Security Migration Block 1), legacy PIN-вход, Family Account
architecture, Trainer статус `page_inactive` для read-пути.
