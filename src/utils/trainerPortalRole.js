// Portal-роль тренера для UI (migration 078). Единственный источник —
// get_current_trainer_profile().portal_role (trainer_accounts.portal_role через
// защищённый RPC). Legacy trainers.rolle, Admin PIN, логин, email, club_id и
// auth metadata НЕ используются.
//
// Это только UX-слой: настоящая граница безопасности — серверные проверки
// migration 078 (club-wide RPC отказывают не-admin независимо от UI).
//
// Fail closed: Admin только при is_active === true И portal_role === 'admin'.
// Отсутствующий профиль, неактивный аккаунт или неизвестное значение роли —
// НЕ admin.
export const PORTAL_ROLE_ADMIN = 'admin';

export function isPortalAdmin(profile) {
  return Boolean(profile) && profile.is_active === true && profile.portal_role === PORTAL_ROLE_ADMIN;
}
