# Рейтинг ученика — архитектурные требования

Статус: **не реализовано.** Сейчас есть точка входа — карточка
«Настройка рейтинга» на Trainer Dashboard (**только Portal Admin**,
`portal_role='admin'`; маршрут защищён `TrainerAdminRoute`) — и **UI-макет** страницы
`/trainer/rating-settings` (`src/pages/trainer/TrainerRatingSettingsPage.jsx`):
карточки 9. Kyu → 1. Kyu с существующими Obi (`KyuBeltImage`), поля
«Минимальный возраст» / «Время в предыдущем Kyu» / «Необходимый рейтинг»,
кнопка DJB и ↺, информационные блоки, disabled «Сохранить настройки» /
«Сбросить к настройкам DJB». Значения — UI-mock
(`src/config/ratingSettingsMock.js`), не официальные требования DJB, нигде не
сохраняются. **DJB preset backend/business logic NOT IMPLEMENTED.**
Формула, расчёт баллов, таблицы Supabase, RPC и UI рейтинга на Student Page —
отдельный следующий этап после утверждения архитектуры рейтинга.

## Будущая логика допуска к градуировке

A. У ученика 4 независимых критерия:
   1. minimum age (минимальный возраст);
   2. minimum preparation time after previous Kyu (минимальное время в предыдущем Kyu);
   3. DJB rolling 365-day graduation limit (максимум 3 учитываемые Kyu-градуировки
      за 365 дней; 8. Kyu не учитывается);
   4. club rating threshold (клубный порог рейтинга).

B. Самая ранняя допустимая дата экзамена определяется календарными
   ограничениями (1–3) — берётся наиболее поздняя из применимых дат. Рейтинг —
   отдельное условие готовности, в дату не входит. Дата не редактируется тренером.

C. Правило 365 дней вычисляется динамически из immutable Kyu graduation history
   ученика (не хранится как отдельное редактируемое поле карточки Kyu).

D. Если за релевантные 365 дней у ученика только две учитываемые градуировки,
   третья не блокируется правилом 365 дней — дату в этом случае определяет,
   например, minimum preparation time после последнего Kyu.

E. После новой градуировки rolling window пересчитывается автоматически.

F. Будущая кнопка «Повысить Kyu» создаёт историческую запись с фактической датой
   градуировки (см. также exam snapshot в
   `docs/architecture/INDIVIDUAL_STUDENT_KYU_PROGRAM.md`).

G. Белый Obi / 9. Kyu присутствует в Rating Settings как обычная карточка, но
   Kihon Judo business logic сейчас OUT OF SCOPE.

DJB preset в будущем управляет только официальными параметрами (возраст,
минимальное время подготовки) и **никогда не меняет «Необходимый рейтинг»** —
рейтинг клубный.

## Обязательное требование к будущему UI

Визуальный блок Rating на Student Page должен быть **одним общим
presentation-компонентом** и использоваться одинаково внутри
`StudentPageContent` для всех трёх режимов:

1. Family / Student (`FamilyDashboard`, `accessMode="family"`);
2. Trainer Student Page (`TrainerStudentPage`, `accessMode="trainer"`);
3. Super Admin Student Preview (`StudentPreviewPage`, `accessMode="superadmin"`).

Три независимые реализации рейтинга не создаются. Компонент получает уже
готовые данные пропами (та же конвенция, что `RequiredTechniquesSection` /
`TechniqueProgressSection`); выбор источника данных (Family RPC / Trainer RPC /
Edge Function Preview) и проверка доступа остаются на уровне страницы и
сервера, не внутри компонента.

Сегодня на этом месте в `StudentPageContent` стоит read-only placeholder
(`SectionToggleCard`, `studentPage.futureRatingBlock.*`), видимость которого
управляется club-wide `config.sections.ratingEligibility` — будущий общий
компонент заменяет именно его.

## Вне текущего этапа

Формула рейтинга, расчёт баллов, Supabase-таблицы/RPC, настройки рейтинга,
Rating UI на Student Page (Family / Trainer / Super Admin).
