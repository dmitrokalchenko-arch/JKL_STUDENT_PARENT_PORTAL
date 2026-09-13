import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import styles from './StudentPageDemoRoute.module.css';

// /dev/student-page-preview — ЕДИНСТВЕННАЯ цель: дать визуально проверить
// ТОЧНО ТО, ЧТО ПОКАЖЕТ РЕАЛЬНЫЙ Super Admin Preview (StudentPreviewPage,
// /admin-preview/:token) — те же пропы StudentPageContent, то же
// production-safe состояние секций без backend — через Netlify Deploy
// Preview, не ослабляя production CORS get-student-preview ради этого.
//
// REAL SUPER ADMIN STUDENT PAGE — STEP 1/2: nav-карточки урезаны до того
// же набора пропов, что передаёт реальный StudentPreviewPage (нейтральное
// "подключим позже" вместо mock ContentArea — см. STEP 1).
//
// STEP 2 (аудит технического прогресса — см. итоговый отчёт задачи):
// блок "Прогресс техник" НАРОЧНО показан здесь как MOCK — это единственное
// место, где ему разрешено быть mock. Причина не показывать его в реальном
// StudentPreviewPage — не забывчивость, а результат аудита:
//   - старая семейная схема прогресса (club_belts/
//     club_technique_progress_settings/club_belt_techniques/
//     student_technique_progress, миграции 20260720120004-007) НИКОГДА не
//     была применена к production (подтверждено живым запросом — PGRST205
//     "table not found" в комментарии миграции 20260908120041) — именно
//     оттуда взяты понятия bonusRequirement/tachi-waza/ne-waza required;
//   - реальная (задеплоенная) тренерская система — judo_techniques
//     (глобальный каталог, 8 IJF-категорий, main_group Nage-waza/
//     Katame-waza) + student_technique_records (club-scoped, ТОЛЬКО
//     completed, без belt/required/bonus вообще) — использует другую
//     таксономию и не содержит bonus/required источника;
//   - TechniqueProgressSection требует нефиктивный bonusRequirement, чтобы
//     не показать сломанный/вводящий в заблуждение текст — придумывать
//     число запрещено заданием, а менять сам компонент — тоже запрещено.
// Итог: пока club-scoped конфигурация бонуса/требуемых техник не
// реализована (отдельный будущий этап), реальный StudentPreviewPage не
// передаёт techniqueProgress вообще — секция отсутствует, а НЕ показывает
// придуманные цифры. Здесь, в Deploy-Preview-only демонстрации, mock
// оставлен ТОЛЬКО чтобы визуально показать, как раздел будет выглядеть
// после появления реального источника.
//
// НЕ обращается к Supabase, НЕ использует preview-токен, НЕ использует
// family/trainer auth. Не влияет ни на один реальный маршрут/поток данных
// (StudentPreviewPage/get-student-preview/FamilyDashboard/
// TrainerStudentPage не тронуты — этот route их не импортирует).
//
// GUARD (двойной, оба условия обязательны — "и", не "или"):
//   1) __NETLIFY_DEPLOY_CONTEXT__ === 'deploy-preview' — build-time
//      константа (см. vite.config.js define), задаётся ТОЛЬКО Netlify на
//      его build-машинах для PR-деплоев; "запекается" в JS-бандл при
//      сборке — в браузере её нельзя подменить постфактум. Локальный
//      `npm run dev` (import.meta.env.DEV) тоже разрешён — это то же
//      самое "не production", просто без сборки на Netlify.
//   2) hostname ТОЧНО НЕ равен production-домену — defense-in-depth на
//      случай, если что-то пойдёт не так с (1).
// Если любое из условий не выполняется — рендерится обычный текст "404",
// НЕ redirect на что-либо и НЕ сам demo-контент.
const PRODUCTION_HOSTNAME = 'jkl-student-parent-portal.netlify.app';

function isDeployPreviewOrLocalDev() {
  const contextFlag =
    typeof __NETLIFY_DEPLOY_CONTEXT__ !== 'undefined' && __NETLIFY_DEPLOY_CONTEXT__ === 'deploy-preview';
  const isLocalDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true;

  if (!contextFlag && !isLocalDev) return false;

  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  if (hostname === PRODUCTION_HOSTNAME) return false;

  return true;
}

// Полностью вымышленные данные — не связаны ни с одним реальным студентом.
// Форма объекта в точности повторяет то, что реально возвращает
// get-student-preview (studentId/firstName/lastName/sportName/groupName/
// beltLabel) — те же поля, только вымышленные значения.
const MOCK_STUDENT = {
  id: 'demo-000',
  firstName: 'Max',
  lastName: 'Mustermann',
  sportName: 'Judo',
  groupName: 'Judo_Mo_19:00_Mi_18:30',
  beltLabel: 'weiß · 9. Kyu'
};

// MOCK, только здесь. category использует литералы 'tachi-waza'/'ne-waza',
// которых требует TechniqueProgressSection/selectTechniqueGroups — это НЕ
// реальная таксономия judo_techniques (8 IJF-категорий, main_group
// Nage-waza/Katame-waza), а форма, которую понимает существующий
// компонент. bonusRequirement = 30 — очевидно тестовое число, реального
// источника для него в production пока нет (см. комментарий выше).
const MOCK_BONUS_REQUIREMENT = 30;
const MOCK_COMPLETED_COUNT = 12;
const MOCK_TECHNIQUE_PROGRESS = {
  featureEnabled: true,
  bonusRequirement: MOCK_BONUS_REQUIREMENT,
  bonusPoints: null,
  belt: null,
  techniques: [
    ...Array.from({ length: MOCK_COMPLETED_COUNT }, (_, i) => ({
      id: `demo-completed-${i + 1}`,
      name: `Demo-Technik ${i + 1}`,
      category: i % 2 === 0 ? 'tachi-waza' : 'ne-waza',
      status: 'completed',
      imageUrl: null,
      hasVideo: false,
      videoPath: null,
      completedAt: '2026-01-01',
      trainerComment: null
    })),
    {
      id: 'demo-required-tachi-1',
      name: 'Demo Tachi-Waza (erforderlich)',
      category: 'tachi-waza',
      status: 'required',
      imageUrl: null,
      hasVideo: false,
      videoPath: null,
      completedAt: null,
      trainerComment: null
    },
    {
      id: 'demo-required-ne-1',
      name: 'Demo Ne-Waza (erforderlich)',
      category: 'ne-waza',
      status: 'required',
      imageUrl: null,
      hasVideo: false,
      videoPath: null,
      completedAt: null,
      trainerComment: null
    }
  ]
};

export default function StudentPageDemoRoute() {
  if (!isDeployPreviewOrLocalDev()) {
    return <div className={styles.notFound}>404 — Not Found</div>;
  }

  return (
    <StudentPageContent
      accessMode="superadmin"
      student={MOCK_STUDENT}
      techniqueProgress={MOCK_TECHNIQUE_PROGRESS}
      isTechniqueProgressLoading={false}
      techniqueProgressError={null}
      showNavigationCards
      header={
        <div className={styles.devHeader}>
          <span className={`${styles.brand} ltr-isolate`}>
            <span className={styles.logo}>JKL</span>
            <span className={styles.logoSub}>CLUB</span>
          </span>
          <span className={styles.devBadge}>DEV PREVIEW — mock data</span>
        </div>
      }
    />
  );
}
