// Мок-данные по образцу будущего ответа сервиса/API.
// Единый источник правды: каждая техника — одна запись с полем status
// ('completed' | 'required'). Группировка по строкам блока (выполненные /
// Tachi-waza / Ne-waza) выполняется селектором selectTechniqueGroups()
// (см. src/utils/techniqueProgress.js) — техника не дублируется руками.
//
// imageUrl/videoUrl намеренно оставлены null (реальных ассетов ещё нет) —
// TechniqueCard и TechniqueVideoModal рассчитаны на этот случай и
// показывают нейтральные заглушки без внешних запросов.
export const techniqueProgressMock = {
  leon: {
    featureEnabled: true, // задел под будущую клубную/дочернюю настройку
    bonusRequirement: 8,
    techniques: [
      { id: 'leon-tw-01', name: 'O Soto Gari', category: 'tachi-waza', status: 'completed', imageUrl: null, videoUrl: null, completedAt: '2026-04-02' },
      { id: 'leon-tw-02', name: 'O Goshi', category: 'tachi-waza', status: 'completed', imageUrl: null, videoUrl: null, completedAt: '2026-04-16' },
      { id: 'leon-tw-03', name: 'De Ashi Barai', category: 'tachi-waza', status: 'completed', imageUrl: null, videoUrl: null, completedAt: '2026-05-01' },
      { id: 'leon-nw-01', name: 'Kesa Gatame', category: 'ne-waza', status: 'completed', imageUrl: null, videoUrl: null, completedAt: '2026-05-14' },
      { id: 'leon-nw-02', name: 'Kami Shiho Gatame', category: 'ne-waza', status: 'completed', imageUrl: null, videoUrl: null, completedAt: '2026-06-03' },
      { id: 'leon-tw-04', name: 'Harai Goshi', category: 'tachi-waza', status: 'required', imageUrl: null },
      { id: 'leon-tw-05', name: 'Uchi Mata', category: 'tachi-waza', status: 'required', imageUrl: null },
      { id: 'leon-tw-06', name: 'Seoi Nage', category: 'tachi-waza', status: 'required', imageUrl: null },
      { id: 'leon-tw-07', name: 'Tai Otoshi', category: 'tachi-waza', status: 'required', imageUrl: null },
      { id: 'leon-nw-03', name: 'Juji Gatame', category: 'ne-waza', status: 'required', imageUrl: null },
      { id: 'leon-nw-04', name: 'Yoko Shiho Gatame', category: 'ne-waza', status: 'required', imageUrl: null }
    ]
  },
  anna: {
    featureEnabled: true,
    bonusRequirement: 6,
    techniques: [
      { id: 'anna-tw-01', name: 'De Ashi Barai', category: 'tachi-waza', status: 'completed', imageUrl: null, videoUrl: null, completedAt: '2026-05-20' },
      { id: 'anna-nw-01', name: 'Kesa Gatame', category: 'ne-waza', status: 'completed', imageUrl: null, videoUrl: null, completedAt: '2026-06-10' },
      { id: 'anna-tw-02', name: 'O Goshi', category: 'tachi-waza', status: 'required', imageUrl: null },
      { id: 'anna-tw-03', name: 'O Soto Gari', category: 'tachi-waza', status: 'required', imageUrl: null },
      { id: 'anna-tw-04', name: 'Ko Uchi Gari', category: 'tachi-waza', status: 'required', imageUrl: null },
      { id: 'anna-nw-02', name: 'Yoko Shiho Gatame', category: 'ne-waza', status: 'required', imageUrl: null }
    ]
  }
};
