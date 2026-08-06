// Клуб, к которому привязан этот экземпляр портала — фиксирован
// конфигурацией, не вводится пользователем.
//
// VITE_PORTAL_CLUB_ID должен точно совпадать с clubs.club_short_name
// (подтверждено сигнатурой public.resolve_family_login_email(
// p_club_short_name text, p_nickname text) перед реализацией — RPC
// принимает именно club_short_name, а не clubs.id/uuid).
//
// Значение клуба — не секрет (аналогично VITE_SUPABASE_ANON_KEY), в него
// нельзя помещать service_role key или другие секретные переменные.
const clubId = import.meta.env.VITE_PORTAL_CLUB_ID;
const clubName = import.meta.env.VITE_PORTAL_CLUB_NAME;

export const isPortalClubConfigured = Boolean(clubId);

if (!isPortalClubConfigured) {
  if (import.meta.env.PROD) {
    throw new Error(
      '[portalClub] Критическая ошибка конфигурации: VITE_PORTAL_CLUB_ID не задан в ' +
        'production-сборке. Fallback на demo-клуб запрещён в production — см. .env.example.'
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[portalClub] VITE_PORTAL_CLUB_ID не задан — используется demo-клуб только для ' +
      'локальной разработки. Не должно происходить в production, см. .env.example.'
  );
}

// Demo-заглушка используется только в dev без конфигурации — это не
// вымышленная запись в базе, а просто текст/технический параметр RPC на
// экране входа (сам вход всё равно не пройдёт без реального клуба в базе).
export const PORTAL_CLUB_ID = clubId || 'demo-club';
export const PORTAL_CLUB_NAME = clubName || 'Demo Club';
