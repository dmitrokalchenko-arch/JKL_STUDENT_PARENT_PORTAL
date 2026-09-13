import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import styles from './StudentPageDemoRoute.module.css';

// /dev/student-page-preview — ЕДИНСТВЕННАЯ цель: дать визуально проверить
// StudentPageContent (shared Student Page shell) через Netlify Deploy
// Preview, не ослабляя production CORS get-student-preview ради этого.
//
// НЕ обращается к Supabase, НЕ использует preview-токен, НЕ использует
// family/trainer auth — только вымышленный student-объект ниже. Не влияет
// ни на один реальный маршрут/поток данных (StudentPreviewPage/
// get-student-preview/FamilyDashboard/TrainerStudentPage не тронуты).
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

export default function StudentPageDemoRoute() {
  if (!isDeployPreviewOrLocalDev()) {
    return <div className={styles.notFound}>404 — Not Found</div>;
  }

  return (
    <StudentPageContent
      accessMode="superadmin"
      student={MOCK_STUDENT}
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
