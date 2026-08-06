# Реестр экранов — JKL Club

Каждый экран проходит процесс из `docs/WORKFLOW.md` последовательно.
Статус экрана обновляется по мере прохождения этапов.

> **Актуальная концепция:** единый семейный аккаунт (Family Account) вместо
> раздельных Student Portal / Parent Portal. Архитектура — в
> `docs/architecture/FAMILY_ACCOUNT_CONCEPT.md`. Старые записи STUDENT-* и
> PARENT-* сохранены ниже для истории и помечены как заменённые — не
> удалены.

## Актуальный реестр — Family Account и Trainer

| ID | Роль | Экран | Файл требований | Дизайн | Код | Тест | Статус |
|----|------|-------|-----------------|--------|-----|------|--------|
| FAMILY-001 | Family | Family Dashboard | prompts/family/dashboard.md | v1 существует (`docs/screenshots/Family_Dashboard_Concept_v1.png`); v2 ожидается (`docs/design/FAMILY_DASHBOARD_V2_ASSET_MANIFEST.md`) | — | — | Готов к созданию визуального макета v2 |
| FAMILY-002 | Family | Моя семья | prompts/family/my_family.md | — | — | — | Включён в visual brief v2 — ожидается изображение |
| FAMILY-003 | Family | Выбор ребёнка | prompts/family/dashboard.md (переключатель ребёнка входит в состав Family Dashboard) | — | — | — | Включено в Family Dashboard |
| FAMILY-004 | Family | Страница выбранного ребёнка | — | — | — | — | Не начато |
| FAMILY-005 | Family | Мои тренировки | prompts/student/trainings.md (требует переоформления) | — | — | — | Не начато |
| FAMILY-006 | Family | Мои достижения | prompts/student/achievements.md (требует переоформления) | — | — | — | Не начато |
| FAMILY-007 | Family | Мои сертификаты | prompts/student/certificates.md (требует переоформления) | — | — | — | Не начато |
| FAMILY-008 | Family | Мои мероприятия | prompts/student/events.md (требует переоформления) | — | — | — | Не начато |
| FAMILY-009 | Family | Необходимые техники | prompts/student/next_exam_techniques.md (требует переоформления) | — | — | — | Не начато |
| FAMILY-010 | Family | Договор и оплата | prompts/family/contracts_and_payments.md | — | — | — | Включён в visual brief v2 — ожидается изображение |
| FAMILY-011 | Family | Управление семейным аккаунтом | — | — | — | — | Не начато |
| FAMILY-012 | Family | Запрос на добавление ребёнка | — | — | — | — | Не начато |
| FAMILY-013 | Family | Добавление родителя или опекуна | — | — | — | — | Не начато |
| TRAINER-001 | Trainer | Вход тренера | — | — | — | — | Не начато |
| TRAINER-002 | Trainer | Список доступных учеников | — | — | — | — | Не начато |
| TRAINER-003 | Trainer | Просмотр страницы ученика | — | — | — | — | Концепция определена, права требуют детализации (используется общая Student Page с тренерским режимом доступа — см. `docs/design/FAMILY_DASHBOARD_TEXT_WIREFRAME.md`, раздел E) |
| TRAINER-004 | Trainer | Просмотр договора и статуса оплаты ученика | — | — | — | — | Не начато |

## Архив — заменено новым решением (сохранено для истории)

Ниже — предыдущий реестр, основанный на разделении Student Portal / Parent
Portal. Каждая строка помечена как заменённая единой концепцией Family
Account (см. `docs/architecture/FAMILY_ACCOUNT_CONCEPT.md`). Строки не
удалены, только помечены.

| ID | Роль | Экран | Файл требований | Дизайн | Код | Тест | Статус |
|----|------|-------|-----------------|--------|-----|------|--------|
| STUDENT-001 | Student | Student Dashboard | prompts/student/dashboard.md | — | — | — | Заменено единой концепцией Family Account |
| STUDENT-002 | Student | Мои тренировки | prompts/student/trainings.md | — | — | — | Заменено единой концепцией Family Account |
| STUDENT-003 | Student | Мои достижения | prompts/student/achievements.md | — | — | — | Заменено единой концепцией Family Account |
| STUDENT-004 | Student | Мои сертификаты | prompts/student/certificates.md | — | — | — | Заменено единой концепцией Family Account |
| STUDENT-005 | Student | Мои мероприятия | prompts/student/events.md | — | — | — | Заменено единой концепцией Family Account |
| STUDENT-006 | Student | Необходимые техники следующего пояса | prompts/student/next_exam_techniques.md | — | — | — | Заменено единой концепцией Family Account |
| STUDENT-007 | Student | Профиль студента | prompts/student/profile.md | — | — | — | Заменено единой концепцией Family Account |
| PARENT-001 | Parent | Parent Dashboard | prompts/parent/dashboard.md | — | — | — | Заменено единой концепцией Family Account |
| PARENT-002 | Parent | Выбор ребенка | prompts/parent/children.md | — | — | — | Заменено единой концепцией Family Account |
| PARENT-003 | Parent | Посещаемость | prompts/parent/attendance.md | — | — | — | Заменено единой концепцией Family Account |
| PARENT-004 | Parent | Договор | prompts/parent/contracts.md | — | — | — | Заменено единой концепцией Family Account |
| PARENT-005 | Parent | Платежи | prompts/parent/payments.md | — | — | — | Заменено единой концепцией Family Account |
| PARENT-006 | Parent | Сообщения клуба | prompts/parent/messages.md | — | — | — | Заменено единой концепцией Family Account |
| PARENT-007 | Parent | Профиль ребенка | prompts/parent/children.md (файл profile.md ещё не создан) | — | — | — | Заменено единой концепцией Family Account |

## Легенда статусов

- Не начато
- Визуальная концепция обсуждается
- Визуальная концепция частично согласована
- Требуется проектирование
- Проектирование
- Текстовое проектирование подготовлено — ожидает согласования
- Текстовое проектирование подготовлено — ожидает визуального согласования
- Готов к созданию визуального макета v2
- Включён в visual brief v2 — ожидается изображение
- Включено в Family Dashboard (не отдельный полноэкранный экран)
- Концепция определена, права требуют детализации
- Ожидает согласования
- Согласовано
- Реализовано
- Проверено
- Заменено единой концепцией Family Account
