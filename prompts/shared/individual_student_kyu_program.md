# Индивидуальная программа «Необходимых техник» ученика (Stage 2)

Архитектура и утверждённые решения: `docs/architecture/INDIVIDUAL_STUDENT_KYU_PROGRAM.md`.

## 1. Назначение

Тренер может задать конкретному ученику индивидуальную программу «Необходимых
техник» для его следующего Kyu (три блока), не меняя программу клуба.

## 2. Роль пользователя

- Trainer — читает и (при EDIT-праве) создаёт/меняет/сбрасывает программу.
- Family/Student — только читает effective program.

## 3. Пользовательский сценарий

1. Trainer открывает ученика → «Необходимые техники для 6. Kyu».
2. Нажимает «Настроить индивидуально» (или «Изменить»).
3. Редактор открывается с текущей effective program (программа клуба, если
   индивидуальной нет).
4. Добавляет/удаляет техники в трёх блоках → «Сохранить».
5. При необходимости — «Вернуть программу клуба» (с подтверждением).

## 4. Доступные данные

Target Kyu, техники трёх блоков (изображение, название, category, видео),
источник программы (клуб/индивидуальная) и версия — только Trainer.

## 5. Запрещенные данные

Family не видит кнопок, источника, версии и не может вызвать Save/Reset. Тренер
не видит учеников вне своих групп.

## 6. Структура интерфейса

- Student Page (Trainer): одна кнопка рядом с заголовком раздела; бейдж
  «Индивидуальная программа» при source = individual.
- Редактор: заголовок, «Целевой Kyu», бейдж источника, счётчик и статус,
  Вернуть программу клуба / Отменить изменения / Сохранить, три блока, поиск,
  каталог.

## 7. Кнопки и действия

«Настроить индивидуально» / «Изменить», «Сохранить», «Отменить изменения»,
«Вернуть программу клуба», «Назад».

## 8. Состояния

Загрузка; ошибка загрузки (Повторить); нет доступа; max_level / unmapped_kyu;
редактирование недоступно (страница ученика не активна); несохранённые
изменения; сохранено; программа клуба восстановлена; version_conflict
(«Программа была изменена другим тренером. Обновите страницу.»);
target_kyu_changed; invalid_items; общая ошибка.

## 9. Адаптивность

На узком экране бейдж/кнопка переносятся под заголовок, кнопки редактора
переносятся без горизонтальной прокрутки.

## 10. Бизнес-правила

См. решения 1–10 в `docs/architecture/INDIVIDUAL_STUDENT_KYU_PROGRAM.md`
(full snapshot, группы, trainer_access_after_expiry = READ only, Family read
only, Reset сохраняет историю, смена Kyu, будущие exam snapshot и Bonus).

## 11. Необходимые общие компоненты

KyuProgramBlocks, SelectedTechniquesStrip, SelectedTechniqueChip,
TrainerKyuTechniqueGrid, TechniqueSelectCard, KyuBeltImage, TrainerHeader,
useJudoTechniques, utils/kyuProgram.js, RequiredTechniquesSection.

## 12. Зависимости

Migration 20260930100076 (после 074/075); существующие can_trainer_access_student,
can_trainer_access_student_page, get_student_page_access, resolve_next_kyu_lookup_id.

## 13. Критерии готовности

- SQL verification plan (`docs/database/INDIVIDUAL_STUDENT_KYU_PROGRAM_SQL_VERIFICATION.md`)
  выполнен: группы A–H и versioning 1–10 — PASS.
- Trainer / Family / Super Admin Preview проверены; RU/DE; мобильная версия.

## 14. Что не входит в текущую задачу

Promote Kyu, exam snapshot, Bonus Techniques (PR #19), Technique Progress,
legacy public.students, legacy PIN-вход.

## 15. Статус согласования

Согласовано пользователем (задание Stage 2). Реализовано в feature branch;
production не применён.
