// Единый источник правды — плоский список техник со статусом.
// Группы для UI формируются здесь, а не хранятся отдельными массивами,
// поэтому техника физически не может оказаться одновременно и выполненной,
// и необходимой.
//
// category здесь — ТЕ ЖЕ значения, что public.judo_techniques.main_group в
// production ('Nage-waza'/'Katame-waza', см. миграцию 20260908120041) —
// никакого отдельного сопоставления "Nage-waza -> Tachi-waza" больше нет,
// используем main_group напрямую (согласовано отдельно, замена прежних
// 'tachi-waza'/'ne-waza').
export function selectTechniqueGroups(techniques = []) {
  const completed = techniques.filter((t) => t.status === 'completed');
  const requiredNageWaza = techniques.filter(
    (t) => t.status === 'required' && t.category === 'Nage-waza'
  );
  const requiredKatameWaza = techniques.filter(
    (t) => t.status === 'required' && t.category === 'Katame-waza'
  );

  return { completed, requiredNageWaza, requiredKatameWaza };
}

export function getEmptySlotCount(completedCount, bonusRequirement) {
  return Math.max(bonusRequirement - completedCount, 0);
}

export function isTechniqueProgressVisible(globalFlagEnabled, progressData) {
  return Boolean(globalFlagEnabled) && Boolean(progressData?.featureEnabled);
}
