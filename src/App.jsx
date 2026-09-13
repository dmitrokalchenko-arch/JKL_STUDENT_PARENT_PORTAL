import { useTranslation } from 'react-i18next';
import FamilyDashboard from './pages/family/FamilyDashboard.jsx';
import FamilyLogin from './pages/family/FamilyLogin.jsx';
import FamilyResetPassword from './pages/family/FamilyResetPassword.jsx';
import TrainerDashboard from './pages/trainer/TrainerDashboard.jsx';
import TrainerStudentsScreen from './pages/trainer/TrainerStudentsScreen.jsx';
import TrainerStudentPage from './pages/trainer/TrainerStudentPage.jsx';
import TrainerSettingsPage from './pages/trainer/TrainerSettingsPage.jsx';
import TrainerAuthGuard from './components/trainer/TrainerAuthGuard.jsx';
import StudentPreviewPage from './pages/preview/StudentPreviewPage.jsx';
import { useFamilySession } from './hooks/useFamilySession.js';
import { isSupabaseConfigured } from './services/supabaseClient.js';
import styles from './App.module.css';

// Точный '/trainer' ИЛИ '/trainer/' + что угодно дальше — так будущие
// подстраницы (/trainer/groups и т.п.) тоже попадут в тренерскую область.
// startsWith('/trainer/') сам по себе уже отсекает /trainers, /trainer-old,
// /trainerSomething — после 'trainer' там не идёт '/', разбора пути глубже
// не требуется. Именованная функция вместо инлайн-выражения — чтобы не
// повторять эту логику при появлении реальных вложенных маршрутов.
function isTrainerRoute(pathname) {
  return pathname === '/trainer' || pathname.startsWith('/trainer/');
}

// Разбор под-маршрутов тренерской области — тот же ручной паттерн, что и
// isTrainerRoute (без клиентского роутера). '/trainer' и
// любой нераспознанный под-путь внутри '/trainer/*' попадают в 'dashboard' —
// это новая точка входа после логина вместо прежнего прямого показа
// TrainerPage (см. TrainerAuthGuard ниже).
function parseTrainerView(pathname) {
  const studentMatch = pathname.match(/^\/trainer\/student\/([^/]+)\/?$/);
  if (studentMatch) {
    return { view: 'student', studentId: studentMatch[1] };
  }
  if (pathname === '/trainer/students') {
    return { view: 'students' };
  }
  if (pathname === '/trainer/settings') {
    return { view: 'settings' };
  }
  return { view: 'dashboard' };
}

export default function App() {
  const { t } = useTranslation();
  const { isLoading, isAuthenticated } = useFamilySession();

  // /trainer(/*) защищён Trainer Auth (TrainerAuthGuard) — отдельная
  // Supabase-сессия (trainerSupabaseClient.js, свой storageKey), не
  // связанная с семейной. Семейная логика ниже этой проверки не затронута.
  if (isTrainerRoute(window.location.pathname)) {
    const trainerView = parseTrainerView(window.location.pathname);
    let trainerContent;
    if (trainerView.view === 'students') {
      trainerContent = <TrainerStudentsScreen />;
    } else if (trainerView.view === 'settings') {
      trainerContent = <TrainerSettingsPage />;
    } else if (trainerView.view === 'student') {
      trainerContent = <TrainerStudentPage studentId={trainerView.studentId} />;
    } else {
      trainerContent = <TrainerDashboard />;
    }

    return <TrainerAuthGuard>{trainerContent}</TrainerAuthGuard>;
  }

  // /admin-preview/:token — Super Admin Preview (Block 1, JCL_Gruppen,
  // кнопка «👁 Family-Seite ansehen» → get-student-preview). Проверяется ДО
  // FamilyLogin/FamilyDashboard/useFamilySession и БЕЗ TrainerAuthGuard —
  // здесь намеренно нет ни family-, ни trainer-сессии вовсе, единственный
  // "пропуск" — одноразовый токен из URL (см. StudentPreviewPage.jsx).
  // family_students.status/families.status не проверяются на этом уровне
  // роутинга вообще — активация Familienzugang не является правом на
  // Preview, это отдельная авторизация внутри get-student-preview.
  const previewMatch = window.location.pathname.match(/^\/admin-preview\/([^/]+)\/?$/);
  if (previewMatch) {
    return <StudentPreviewPage token={previewMatch[1]} />;
  }

  // /superadmin(/*) — УДАЛЕНО из публичного routing (безопасный pre-deploy
  // аудит Family Layer, 2026-08-29): маршрут был минимальным каркасом БЕЗ
  // authentication guard, доступным на живом production-сайте кому угодно.
  // Единственная Super Admin панель — JCL_Gruppen Super Admin Control Center
  // (Familienzugänge и остальные разделы) — эта ветка была неиспользуемым,
  // незащищённым дублем. Компоненты (pages/superadmin/*) не удалены с диска —
  // только не подключены к роутингу, маршрут теперь просто не матчится и
  // падает в обычную семейную логику ниже, как любой другой неизвестный путь.

  // Landing-Seite für den Passwort-Wiederherstellung-Link aus
  // manage-family-account (JCL_Gruppen, send_recovery). VOR der
  // Supabase-configured/isLoading/isAuthenticated-Verzweigung geprüft — die
  // Recovery-Sitzung ist ein eigener, transienter Zustand, unabhängig von
  // einer ggf. bereits laufenden normalen Familien-Sitzung.
  if (window.location.pathname === '/family/reset-password') {
    return <FamilyResetPassword />;
  }

  // Supabase не настроен (см. .env.example) — dev mock-режим, экран входа не
  // нужен, Dashboard сразу работает на mock-данных.
  if (!isSupabaseConfigured) {
    return <FamilyDashboard />;
  }

  // Не показывать ни логин, ни Dashboard, пока не завершена проверка сессии —
  // иначе на миг мог бы мелькнуть экран входа для уже авторизованной семьи.
  if (isLoading) {
    return <div className={styles.sessionLoading}>{t('common.loading')}</div>;
  }

  if (!isAuthenticated) {
    return <FamilyLogin />;
  }

  return <FamilyDashboard />;
}
