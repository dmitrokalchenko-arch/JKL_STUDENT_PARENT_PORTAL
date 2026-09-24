import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FamilyDashboard from './pages/family/FamilyDashboard.jsx';
import FamilyResetPassword from './pages/family/FamilyResetPassword.jsx';
import UnifiedLogin from './pages/auth/UnifiedLogin.jsx';
import AccountRoleChoice from './pages/auth/AccountRoleChoice.jsx';
import TrainerDashboard from './pages/trainer/TrainerDashboard.jsx';
import TrainerStudentsScreen from './pages/trainer/TrainerStudentsScreen.jsx';
import TrainerStudentPage from './pages/trainer/TrainerStudentPage.jsx';
import TrainerSettingsPage from './pages/trainer/TrainerSettingsPage.jsx';
import TrainerKyuProgramPage from './pages/trainer/TrainerKyuProgramPage.jsx';
import TrainerKyuBonusProgramPage from './pages/trainer/TrainerKyuBonusProgramPage.jsx';
import TrainerAuthGuard from './components/trainer/TrainerAuthGuard.jsx';
import StudentPreviewPage from './pages/preview/StudentPreviewPage.jsx';
import StudentPageDemoRoute from './pages/dev/StudentPageDemoRoute.jsx';
import { useFamilySession } from './hooks/useFamilySession.js';
import { useTrainerSession } from './hooks/useTrainerSession.js';
import { isSupabaseConfigured } from './services/supabaseClient.js';
import styles from './App.module.css';

// UNIFIED LOGIN (см. итоговый отчёт задачи): корневой '/' раньше
// монтировал только FamilyLogin.jsx напрямую — теперь этот файл больше не
// импортируется из App.jsx (сам файл НЕ удалён, задание явно запрещает
// удалять существующие рабочие экраны без необходимости; его JSX/CSS
// просто больше ни откуда не рендерится, а его auth-логика — signInFamily —
// переиспользуется БЕЗ ИЗМЕНЕНИЙ внутри services/unifiedAuthService.js).
// TrainerLogin.jsx НЕ трогается вовсе — /trainer без сессии по-прежнему
// показывает его напрямую через TrainerAuthGuard (задание, п.15: явный
// safety fallback на этом этапе, отдельный будущий шаг решит его судьбу).
//
// Сессия при отсутствии Trainer — тот же паттерн, что уже был для family
// (isLoading -> loading text, только после — решение показывать
// Login/redirect). Разница здесь: ДВА независимых источника
// (useFamilySession/useTrainerSession), и до завершения ОБОИХ
// (isFamilyLoading || isTrainerLoading) решение не принимается вообще —
// именно так закрывается класс race condition, который уже дважды находили
// и исправляли для одиночного family-случая в этой же сессии (PR #4/#5).
function TrainerSessionRedirect() {
  const { t } = useTranslation();
  useEffect(() => {
    window.location.href = '/trainer';
  }, []);
  return <div className={styles.sessionLoading}>{t('common.loading')}</div>;
}

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
  if (pathname === '/trainer/kyu-program') {
    return { view: 'kyu-program' };
  }
  if (pathname === '/trainer/kyu-bonus-program') {
    return { view: 'kyu-bonus-program' };
  }
  return { view: 'dashboard' };
}

export default function App() {
  const { t } = useTranslation();
  const { isLoading: isFamilyLoading, isAuthenticated: isFamilyAuthenticated } = useFamilySession();
  const { isLoading: isTrainerLoading, isAuthenticated: isTrainerAuthenticated } = useTrainerSession();
  // Ставится ТОЛЬКО UnifiedLogin'ом через onBothSucceeded, когда
  // signInUnified() реально вернул BOTH — см. комментарий у AccountRoleChoice.
  const [pendingRoleChoice, setPendingRoleChoice] = useState(false);

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
    } else if (trainerView.view === 'kyu-program') {
      trainerContent = <TrainerKyuProgramPage />;
    } else if (trainerView.view === 'kyu-bonus-program') {
      trainerContent = <TrainerKyuBonusProgramPage />;
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

  // /dev/student-page-preview — ТОЛЬКО для визуальной проверки
  // StudentPageContent через Netlify Deploy Preview, mock-данные, никакого
  // backend. Сам компонент решает, показать ли реальный контент или "404" —
  // см. guard (__NETLIFY_DEPLOY_CONTEXT__ + hostname) в
  // StudentPageDemoRoute.jsx; здесь роутинг ничего дополнительно не
  // проверяет, чтобы не дублировать источник истины про "не production".
  if (window.location.pathname === '/dev/student-page-preview') {
    return <StudentPageDemoRoute />;
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

  // Не показывать ни один из вариантов ниже, пока не завершены ОБЕ
  // независимые проверки сессии (family И trainer) — иначе на миг мог бы
  // мелькнуть Unified Login для уже авторизованного пользователя, либо
  // решение принялось бы по тому, какой из двух хуков успел резолвиться
  // первым (тот самый класс race condition, что уже дважды находили и
  // исправляли для одиночного family-случая, PR #4/#5 — здесь источников
  // два, ждём оба явно).
  if (isFamilyLoading || isTrainerLoading) {
    return <div className={styles.sessionLoading}>{t('common.loading')}</div>;
  }

  // Редкий edge case (см. аудит Unified Login): signInUnified() реально
  // вернул BOTH — обе сессии уже валидны прямо сейчас. Проверяется ДО
  // веток isFamilyAuthenticated/isTrainerAuthenticated ниже: раз обе уже
  // true, без этой проверки страница молча провалилась бы в
  // FamilyDashboard, ни разу не спросив пользователя, что запрещено
  // заданием (п.9) — это НЕ обычный предварительный role selector, он
  // может появиться только после реально успешного входа в оба аккаунта.
  if (pendingRoleChoice) {
    return <AccountRoleChoice onChooseFamily={() => setPendingRoleChoice(false)} />;
  }

  // Family — приоритет при восстановлении УЖЕ существующих сессий (задание,
  // п.14): `/` исторически family route. Детерминированно и без гонки —
  // оба isLoading уже false на этой строке.
  if (isFamilyAuthenticated) {
    return <FamilyDashboard />;
  }

  // Только Trainer — не заставляем вводить credentials повторно, тихо
  // переходим на /trainer (задание, п.13). TrainerLogin.jsx/TrainerAuthGuard
  // не менялись — сама тренерская сессия уже валидна к этому моменту,
  // TrainerAuthGuard сразу пропустит на TrainerDashboard.
  if (isTrainerAuthenticated) {
    return <TrainerSessionRedirect />;
  }

  return <UnifiedLogin onBothSucceeded={() => setPendingRoleChoice(true)} />;
}
