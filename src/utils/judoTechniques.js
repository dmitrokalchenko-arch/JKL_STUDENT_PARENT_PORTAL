// Порядок отображения категорий/групп в UI — константа, НЕ каталог (см.
// задание, этап 9: "допустимы только UI-константы порядка категорий, это не
// копирование каталога"). Название/видео/принадлежность категории каждой
// техники по-прежнему приходят только из public.judo_techniques.
export const CATEGORY_ORDER = [
  'Te-waza',
  'Koshi-waza',
  'Ashi-waza',
  'Ma-sutemi-waza',
  'Yoko-sutemi-waza',
  'Osaekomi-waza',
  'Shime-waza',
  'Kansetsu-waza'
];

export const MAIN_GROUP_ORDER = ['Nage-waza', 'Katame-waza'];

const CATEGORY_INDEX = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
const MAIN_GROUP_INDEX = new Map(MAIN_GROUP_ORDER.map((group, index) => [group, index]));

/**
 * Группирует плоский список техник в [{ mainGroup, categories: [{ category, techniques }] }],
 * в фиксированном UI-порядке (CATEGORY_ORDER/MAIN_GROUP_ORDER) — не в
 * алфавитном порядке SQL ORDER BY, который используется в запросе только
 * как стабильный базовый порядок, не как порядок отображения.
 * @param {import('../services/judoTechniquesService.js').JudoTechnique[]} techniques
 */
export function groupTechniquesByCategory(techniques) {
  const byGroup = new Map();

  for (const technique of techniques) {
    if (!byGroup.has(technique.main_group)) {
      byGroup.set(technique.main_group, new Map());
    }
    const byCategory = byGroup.get(technique.main_group);
    if (!byCategory.has(technique.category)) {
      byCategory.set(technique.category, []);
    }
    byCategory.get(technique.category).push(technique);
  }

  const mainGroups = [...byGroup.keys()].sort(
    (a, b) => (MAIN_GROUP_INDEX.get(a) ?? 99) - (MAIN_GROUP_INDEX.get(b) ?? 99)
  );

  return mainGroups.map((mainGroup) => ({
    mainGroup,
    categories: [...byGroup.get(mainGroup).keys()]
      .sort((a, b) => (CATEGORY_INDEX.get(a) ?? 99) - (CATEGORY_INDEX.get(b) ?? 99))
      .map((category) => ({
        category,
        techniques: byGroup.get(mainGroup).get(category)
      }))
  }));
}

// Поиск по названию, регистронезависимый substring-match — задание требует
// только "поиск по названию техники", без fuzzy-логики.
export function searchTechniques(techniques, query) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return techniques;
  return techniques.filter((technique) => technique.name.toLowerCase().includes(trimmed));
}

// Безопасный lookup по id для будущих потребителей (например, отображение
// уже сохранённой technique_id-ссылки из student_technique_records после
// применения соответствующей миграции) — возвращает null, а не бросает
// исключение, если техника деактивирована/удалена/ещё не загружена (см.
// задание, этап 8: "technique_id, который больше не найден").
export function findTechniqueById(techniques, technique_id) {
  return techniques.find((technique) => technique.id === technique_id) ?? null;
}
