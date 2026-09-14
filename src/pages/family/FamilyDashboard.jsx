import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import StudentPageContent from '../../components/student/StudentPageContent.jsx';
import FamilyHeader from '../../components/family/FamilyHeader.jsx';
import ChildSelector from '../../components/family/ChildSelector.jsx';
import AgeIndicator from '../../components/family/AgeIndicator.jsx';
import RatingIndicator from '../../components/family/RatingIndicator.jsx';

import { useFamilyData } from '../../hooks/useFamilyData.js';
import { useFamilySession } from '../../hooks/useFamilySession.js';
import { useSelectedChild } from '../../hooks/useSelectedChild.js';
import { useActiveSection } from '../../hooks/useActiveSection.js';
import { useTechniqueProgress } from '../../hooks/useTechniqueProgress.js';

import { signOutFamily, markFamilyAccessDeactivated } from '../../services/familyAuthService.js';
import { isSupabaseConfigured } from '../../services/supabaseClient.js';

import styles from './FamilyDashboard.module.css';

export default function FamilyDashboard() {
  const { t } = useTranslation();
  const { isAuthenticated } = useFamilySession();
  const {
    family,
    children,
    loading: isFamilyLoading,
    error: familyError,
    reload: reloadFamily
  } = useFamilyData();
  const { selectedChild, selectedId, selectChild } = useSelectedChild(children);
  const { activeSection, selectSection } = useActiveSection();
  const {
    data: techniqueProgress,
    isLoading: isTechniqueProgressLoading,
    error: techniqueProgressError,
    refetch: refetchTechniqueProgress
  } = useTechniqueProgress(selectedChild?.id);

  // Ошибка выхода намеренно проглатывается здесь: сама сессия проверяется
  // заново при следующей загрузке (useFamilySession), пользователю нечего
  // сделать с деталями сбоя signOut на этом этапе задачи.
  const handleLogout = () => {
    signOutFamily().catch(() => {});
  };

  // ENFORCE FAMILY DEACTIVATION ON ACTIVE SESSIONS: get_current_family_children()
  // теперь фильтрует по families.status='active' (миграция
  // 20260914110055_enforce_family_status_in_access_checks.sql) — уже
  // существующий, ещё не истёкший access token суспендированной семьи
  // больше не получает ни одной строки от этого RPC. С точки зрения
  // фронтенда это неотличимо от "у семьи правда нет ни одного активного
  // family_students" (то же намеренное анти-enumeration поведение, что и в
  // signInFamily — причина не раскрывается) — оба случая сегодня приводят
  // сюда с children=[]. Реально достижим сегодня только первый: manage-
  // family-account создаёт семью всегда СРАЗУ с одной активной привязкой,
  // отдельного действия "отвязать всех детей у активной семьи" в Block 1
  // не существует. Поэтому: полностью загруженная (не loading, без
  // familyError) authenticated-сессия с children.length===0 трактуется как
  // "доступ закрыт" — сессия завершается, а не тихо показывает пустой
  // Dashboard, в котором остаётся ещё активный (хоть и бесполезный) токен.
  const deactivationHandledRef = useRef(false);
  const isEmptyAfterRealLoad =
    isSupabaseConfigured && isAuthenticated && !isFamilyLoading && !familyError && children.length === 0;

  useEffect(() => {
    if (!isEmptyAfterRealLoad || deactivationHandledRef.current) return;
    deactivationHandledRef.current = true;
    markFamilyAccessDeactivated();
    signOutFamily().catch(() => {});
  }, [isEmptyAfterRealLoad]);

  if (isFamilyLoading) {
    return <div className={styles.emptyState}>{t('common.loading')}</div>;
  }

  if (familyError) {
    return (
      <div className={styles.emptyState}>
        <div>{t('errors.familyLoadError')}</div>
        <button type="button" className={styles.retryButton} onClick={reloadFamily}>
          {t('techniqueProgress.retry')}
        </button>
      </div>
    );
  }

  if (!selectedChild) {
    // Реальный режим (isSupabaseConfigured): sign-out уже запущен эффектом
    // выше (isEmptyAfterRealLoad) — на миг до переключения App.jsx на
    // FamilyLogin показываем common.loading, а не errors.noChildrenLinked
    // (сообщение не про эту ситуацию). Mock-режим (dev без Supabase):
    // childrenMock всегда непустой, поэтому сюда попасть нельзя — ветка
    // оставлена только как честный fallback, sign-out в mock-режиме не
    // запускается вовсе (см. isEmptyAfterRealLoad).
    return (
      <div className={styles.emptyState}>
        {isSupabaseConfigured ? t('common.loading') : t('errors.noChildrenLinked')}
      </div>
    );
  }

  // REAL FAMILY LOGIN — CONNECT TO SHARED STUDENT PAGE: тот же
  // presentation-каркас, что уже использует Super Admin Preview
  // (StudentPreviewPage, accessMode="superadmin") и демо-стенд —
  // StudentProfileCard/TechniqueProgressSection/DashboardButtons/
  // ContentArea больше не дублируются здесь отдельной разметкой.
  //
  // trainings/familyAccount/contract сюда намеренно НЕ передаются — для
  // family, как и для Super Admin Preview, реальных данных для секций под
  // навигационными карточками ещё нет (mock trainingsMock/contractMock/
  // familyAccountMock, которые раньше подставлялись здесь, — не реальные
  // данные конкретной семьи). StudentPageContent сам покажет нейтральное
  // "подключим позже" вместо выдуманных тренировок/договора/аккаунта.
  // techniqueProgress — БЕЗ изменений, тот же уже существующий
  // useTechniqueProgress(selectedChild?.id), что был здесь и раньше.
  return (
    <StudentPageContent
      accessMode="family"
      header={
        <FamilyHeader
          familyName={family.displayName}
          onLogout={handleLogout}
        />
      }
      selector={
        <ChildSelector
          children={children}
          selectedId={selectedId}
          onSelect={selectChild}
        />
      }
      student={selectedChild}
      techniqueProgress={techniqueProgress}
      isTechniqueProgressLoading={isTechniqueProgressLoading}
      techniqueProgressError={techniqueProgressError}
      onRetryTechniqueProgress={refetchTechniqueProgress}
      showNavigationCards
      activeSection={activeSection}
      onSelectSection={selectSection}
    >
      {/* ageEligibility/rating — реальный family-loader (familyDataService.js)
          их сегодня не возвращает вовсе (только mock-режим их задаёт), поэтому
          для реальной семьи это условие всегда false — честно ничего не
          показывает, а не мигрирует выдуманные данные в production UI. */}
      {selectedChild.ageEligibility && <AgeIndicator eligibility={selectedChild.ageEligibility} />}
      {selectedChild.rating && <RatingIndicator rating={selectedChild.rating} />}
    </StudentPageContent>
  );
}
