import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import { trainingsMock } from '../../mocks/trainingsMock.js';
import { contractMock } from '../../mocks/contractMock.js';
import { familyAccountMock } from '../../mocks/familyAccountMock.js';
import styles from './StudentPageDemoRoute.module.css';

// /dev/student-page-preview — ЕДИНСТВЕННАЯ цель: дать визуально проверить
// StudentPageContent (shared Student Page shell) ПОЛНОСТЬЮ — с той же
// визуальной структурой, что у существующего FamilyDashboard (карточка
// ученика, прогресс техник, ряд навигационных карточек) — через Netlify
// Deploy Preview, не ослабляя production CORS get-student-preview ради
// этого.
//
// НЕ обращается к Supabase, НЕ использует preview-токен, НЕ использует
// family/trainer auth — только вымышленные данные ниже (student — целиком
// выдуман; trainings/contract/familyAccount — те же mock-фикстуры проекта,
// что уже использует сам FamilyDashboard, см. src/mocks/, не новые данные).
// Не влияет ни на один реальный маршрут/поток данных (StudentPreviewPage/
// get-student-preview/FamilyDashboard/TrainerStudentPage не тронуты — этот
// route их не импортирует и не использует).
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
const MOCK_STUDENT = {
  id: 'demo-000',
  firstName: 'Max',
  lastName: 'Mustermann',
  sportName: 'Judo',
  groupName: 'Judo_Mo_19:00_Mi_18:30',
  beltLabel: 'weiß · 9. Kyu'
};

// 12 / 30 — очевидно тестовый прогресс (не реальные техники каталога 100
// техник, не связано с judo_techniques/student_technique_records — та
// система отдельная, см. TrainerStudentPage). Форма объекта в точности
// повторяет то, что реально возвращает get_student_technique_progress
// (см. techniqueProgressService.js) — те же поля, только вымышленные
// значения, чтобы TechniqueProgressSection рендерился без единой правки.
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

// Те же mock-фикстуры, что уже использует FamilyDashboard (src/mocks/) —
// ключ 'leon' выбран произвольно, просто чтобы получить непустой пример.
const MOCK_TRAININGS = trainingsMock.leon;
const MOCK_CONTRACT = contractMock.leon;
const MOCK_FAMILY_CHILDREN = [
  { id: 'demo-000', firstName: 'Max', lastName: 'Mustermann', age: 8 }
];

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
      trainings={MOCK_TRAININGS}
      contract={MOCK_CONTRACT}
      familyAccount={familyAccountMock}
      familyChildren={MOCK_FAMILY_CHILDREN}
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
