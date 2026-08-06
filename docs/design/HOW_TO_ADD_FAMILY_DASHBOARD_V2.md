# Как добавить Family Dashboard Concept v2

Простая инструкция для пользователя — что сделать, чтобы визуальный макет
v2 попал в проект и был проверен.

## Шаги

1. **Получить или создать изображение** Family Dashboard Concept v2 —
   по требованиям из `docs/design/FAMILY_DASHBOARD_V2_VISUAL_BRIEF.md`.

2. **Сохранить его под точным именем:**
   ```
   Family_Dashboard_Concept_v2.png
   ```

3. **Поместить его в:**
   ```
   docs/screenshots/
   ```

4. **Не удалять v1** — файл `Family_Dashboard_Concept_v1.png` должен
   остаться в той же папке для истории.

5. **После добавления попросить Claude Code:**
   - проверить файл (валидность PNG, разрешение, размер);
   - провести review по `docs/design/FAMILY_DASHBOARD_V2_ACCEPTANCE_CHECKLIST.md`;
   - заполнить чек-лист приёмки;
   - обновить `docs/design/FAMILY_DASHBOARD_V2_REVIEW_RESULT.md`;
   - **ничего не программировать** — на этом этапе это по-прежнему
     запрещено.

6. **После утверждения пользователем** перейти к статусу **Design
   Approved** — и только после этого к выбору технического стека.
