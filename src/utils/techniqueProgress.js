// Единый источник правды — плоский список техник со статусом.
// Группы для UI формируются здесь, а не хранятся отдельными массивами,
// поэтому техника физически не может оказаться одновременно и выполненной,
// и необходимой.
export function selectTechniqueGroups(techniques = []) {
  const completed = techniques.filter((t) => t.status === 'completed');
  const requiredTachiWaza = techniques.filter(
    (t) => t.status === 'required' && t.category === 'tachi-waza'
  );
  const requiredNeWaza = techniques.filter(
    (t) => t.status === 'required' && t.category === 'ne-waza'
  );

  return { completed, requiredTachiWaza, requiredNeWaza };
}

export function getEmptySlotCount(completedCount, bonusRequirement) {
  return Math.max(bonusRequirement - completedCount, 0);
}

export function isTechniqueProgressVisible(globalFlagEnabled, progressData) {
  return Boolean(globalFlagEnabled) && Boolean(progressData?.featureEnabled);
}
