import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import styles from './StudentPageDemoRoute.module.css';

// /dev/student-page-preview — ЕДИНСТВЕННАЯ цель: дать визуально проверить
// ТОЧНО ТО, ЧТО ПОКАЖЕТ РЕАЛЬНЫЙ Super Admin Preview (StudentPreviewPage,
// /admin-preview/:token) — те же пропы StudentPageContent, то же
// production-safe состояние секций без backend — через Netlify Deploy
// Preview, не ослабляя production CORS get-student-preview ради этого.
//
// REAL SUPER ADMIN STUDENT PAGE — STEP 1/2/3: nav-карточки урезаны до того
// же набора пропов, что передаёт реальный StudentPreviewPage.
//
// STEP 3 (bonus technique program refinement — см. миграцию
// 20260914100054 и итоговый отчёт задачи): "Бонусные техники" — НЕ
// "техники, которые ученик знает", а подтверждённые на соревнованиях
// техники ИЗ ПРОГРАММЫ УЖЕ ПОЛУЧЕННОГО Kyu, с видео, отмеченные тренером.
// Пул здесь — 5 РЕАЛЬНЫХ официальных техник дзюдо (O-soto-gari/Uchi-mata/
// Seoi-nage/O-uchi-gari — Nage-waza; Kesa-gatame — Katame-waza,
// классификация верна для реального каталога), НЕ "Demo-Technik N" —
// только status/hasVideo здесь mock (в production это решает тренер через
// уже существующий video-workflow, не эта страница).
//
// Реальный StudentPreviewPage передаёt techniqueProgress ТОЛЬКО если клуб
// включил club_technique_program_settings.bonus_program_enabled — иначе
// блок отсутствует ПОЛНОСТЬЮ (не "0/0", не "не настроено"). Здесь это
// можно проверить визуально через query-параметр (ТОЛЬКО в этом
// Deploy-Preview-only файле, production-код этот параметр не читает
// вообще):
//   /dev/student-page-preview            -> bonus_program_enabled = true
//   /dev/student-page-preview?bonus=disabled -> блок полностью отсутствует
//
// SHARED TRAINER STUDENT PAGE: тот же приём для accessMode — ?mode=trainer
// показывает ровно то, что видит Trainer после useTrainerStudentProfile
// (accessMode="trainer", БЕЗ nav-карточек — их сегодня нет ни у одного
// реального trainer backend-источника — и БЕЗ Бонусных техник — этот блок
// для Trainer сознательно НЕ подключён на этом шаге, см. итоговый отчёт
// задачи). Реальные CompletedTechniquesList/JudoTechniquePicker сюда НЕ
// подключаются — им нужна настоящая trainer-сессия (trainerSupabaseClient,
// get_current_trainer_write_context), которой в анонимном demo нет и не
// будет; они уже проверяются на реальном /trainer/student/:id под
// TrainerAuthGuard. Демо показывает только сам shared presentation-каркас
// (header/badge/StudentProfileCard), не trainer-only виджеты.
//   /dev/student-page-preview?mode=trainer    -> accessMode="trainer"
//   /dev/student-page-preview?mode=family     -> accessMode="family"
//   /dev/student-page-preview (без mode)      -> accessMode="superadmin" (как раньше)
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

// dev-only — читает ?bonus=disabled ТОЛЬКО в этом файле, никогда в
// production-коде (StudentPreviewPage не читает query-параметры вообще).
function isBonusDisabledForDemo() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('bonus') === 'disabled';
}

// dev-only — читает ?mode=family|trainer|superadmin ТОЛЬКО в этом файле.
// Неизвестное/отсутствующее значение -> 'superadmin' (прежнее поведение
// без параметра не меняется).
function getDemoAccessMode() {
  if (typeof window === 'undefined') return 'superadmin';
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === 'family' || mode === 'trainer' ? mode : 'superadmin';
}

// Полностью вымышленные данные — не связаны ни с одним реальным студентом.
// Форма объекта в точности повторяет то, что реально возвращает
// get-student-preview (studentId/firstName/lastName/sportName/groupName/
// kyuGrade/beltColorName/...) — те же поля, только вымышленные значения.
// kyuGrade/beltColorName вместо прежнего единого beltLabel — задача
// "student-profile-data-pipeline-audit" сделала Kyu/цвет пояса
// независимыми полями и на реальном get-student-preview.
const MOCK_STUDENT = {
  id: 'demo-000',
  firstName: 'Max',
  lastName: 'Mustermann',
  sportName: 'Judo',
  groupName: 'Judo_Mo_19:00_Mi_18:30',
  kyuGrade: '5. Kyu',
  beltColorName: 'weiß'
};

// MOCK, только здесь. Пул из 5 реальных техник программы "уже полученного"
// 5. Kyu (в production пул определяется best-effort сопоставлением
// club_required_techniques.belt_key с students.kyu_grad — см.
// get-student-preview/buildTechniqueProgress). category — реальная
// main_group этих техник в официальной IJF-классификации.
// bonusRequirement = 4 — очевидно тестовое число (в production —
// club_technique_program_settings.bonus_requirement, может быть NULL,
// если клуб его не задал).
const MOCK_BONUS_REQUIREMENT = 4;
const MOCK_TECHNIQUE_PROGRESS = {
  featureEnabled: true,
  bonusRequirement: MOCK_BONUS_REQUIREMENT,
  bonusPoints: null,
  belt: null,
  techniques: [
    {
      id: 'demo-o-soto-gari',
      name: 'O-soto-gari',
      category: 'Nage-waza',
      status: 'completed',
      imageUrl: null,
      // false намеренно (не "забыто выставить true") — см. комментарий в
      // get-student-preview/buildTechniqueProgress: просмотр видео из
      // Super Admin Preview сознательно НЕ реализуется на этом шаге,
      // hasVideo=true без рабочего плеера дал бы "зависшую" загрузку.
      hasVideo: false,
      videoPath: null,
      completedAt: '2026-08-01',
      trainerComment: null
    },
    {
      id: 'demo-seoi-nage',
      name: 'Seoi-nage',
      category: 'Nage-waza',
      status: 'completed',
      imageUrl: null,
      hasVideo: false,
      videoPath: null,
      completedAt: '2026-08-15',
      trainerComment: null
    },
    {
      id: 'demo-uchi-mata',
      name: 'Uchi-mata',
      category: 'Nage-waza',
      status: 'required',
      imageUrl: null,
      hasVideo: false,
      videoPath: null,
      completedAt: null,
      trainerComment: null
    },
    {
      id: 'demo-o-uchi-gari',
      name: 'O-uchi-gari',
      category: 'Nage-waza',
      status: 'required',
      imageUrl: null,
      hasVideo: false,
      videoPath: null,
      completedAt: null,
      trainerComment: null
    },
    {
      id: 'demo-kesa-gatame',
      name: 'Kesa-gatame',
      category: 'Katame-waza',
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

  const accessMode = getDemoAccessMode();
  const bonusEnabled = !isBonusDisabledForDemo();
  // Trainer: Бонусные техники сегодня для этого accessMode сознательно не
  // подключены (см. комментарий в шапке файла) — techniqueProgress здесь
  // всегда undefined независимо от ?bonus=, ровно как у реального
  // TrainerStudentPage.jsx. nav-карточки по той же причине тоже скрыты.
  const showBonusSection = accessMode !== 'trainer';

  return (
    <StudentPageContent
      accessMode={accessMode}
      student={MOCK_STUDENT}
      // undefined, когда bonus_program_enabled=false в demo (или accessMode
      // не поддерживает бонус пока) — та же семантика, что
      // buildTechniqueProgress возвращает null: секция полностью
      // отсутствует, не "0/0", не "не настроено".
      techniqueProgress={showBonusSection && bonusEnabled ? MOCK_TECHNIQUE_PROGRESS : undefined}
      isTechniqueProgressLoading={false}
      techniqueProgressError={null}
      showNavigationCards={accessMode !== 'trainer'}
      header={
        <div className={styles.devHeader}>
          <span className={`${styles.brand} ltr-isolate`}>
            <span className={styles.logo}>JKL</span>
            <span className={styles.logoSub}>CLUB</span>
          </span>
          <span className={styles.devBadge}>
            DEV PREVIEW — mock data ({accessMode}
            {showBonusSection ? `, ${bonusEnabled ? 'bonus enabled' : 'bonus disabled'}` : ''})
          </span>
        </div>
      }
    />
  );
}
