import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { PORTAL_CLUB_ID } from '../config/portalClub.js';

// Этот экземпляр портала привязан к одному клубу (PORTAL_CLUB_ID —
// clubs.club_short_name, см. src/config/portalClub.js) — клуб больше не
// вводится пользователем на форме входа, только nickname + пароль.

class InvalidCredentialsError extends Error {
  constructor() {
    super('Неверный клуб, ник или пароль.');
    this.name = 'InvalidCredentialsError';
  }
}

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase не настроен (см. .env.example) — вход семьи недоступен в mock-режиме.');
  }
}

export async function signInFamily(nickname, password) {
  assertConfigured();

  const { data: email, error: resolveError } = await supabase.rpc('resolve_family_login_email', {
    p_club_short_name: PORTAL_CLUB_ID,
    p_nickname: nickname
  });

  if (resolveError) {
    throw new Error(`Не удалось выполнить вход: ${resolveError.message}`);
  }
  if (!email) {
    // Намеренно тот же текст ошибки, что и при неверном пароле ниже —
    // не раскрываем, что именно неверно (клуб/ник/пароль).
    throw new InvalidCredentialsError();
  }

  const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new InvalidCredentialsError();
  }

  return data.session;
}

export async function signOutFamily() {
  assertConfigured();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(`Не удалось выйти: ${error.message}`);
  }
}

// ENFORCE FAMILY DEACTIVATION ON ACTIVE SESSIONS: одноразовая пометка "эта
// сессия была закрыта из-за деактивированного/пустого family-доступа" —
// сама причина закрытия (suspended семья ИЛИ, теоретически, семья без
// активных детей — RPC намеренно не различает эти случаи, тот же
// anti-enumeration принцип, что уже применён в signInFamily) НЕ раскрывается
// нигде дальше сообщения. sessionStorage, не localStorage — переживает
// редирект на тот же экран логина, но не переживает и не должна переживать
// закрытие вкладки/новую сессию браузера.
const FAMILY_ACCESS_DEACTIVATED_KEY = 'jkl_family_access_deactivated_notice';

export function markFamilyAccessDeactivated() {
  try {
    sessionStorage.setItem(FAMILY_ACCESS_DEACTIVATED_KEY, '1');
  } catch {
    // Заметка — не критичная часть sign-out, тихо игнорируем.
  }
}

// Читает и стирает флаг РОВНО ОДИН РАЗ — на уровне модуля, не внутри
// React-хука. Причина: consumeFamilyAccessDeactivatedNotice() имеет побочный
// эффект (очищает sessionStorage), а FamilyLogin.jsx читает его через
// useState(() => …) lazy-инициализатор — React StrictMode (main.jsx) в dev
// вызывает такие инициализаторы ДВАЖДЫ; второй вызов увидел бы уже
// очищенное значение и вернул бы false, из-за чего сообщение никогда бы не
// показалось (проверено локально). Модульный код выполняется ровно один
// раз при первой загрузке модуля вне зависимости от StrictMode/повторных
// рендеров — результат кэшируется здесь и просто возвращается ниже сколько
// угодно раз. try/catch — sessionStorage может бросить в некоторых
// приватных режимах браузера.
const familyAccessDeactivatedAtLoad = (() => {
  try {
    const wasSet = sessionStorage.getItem(FAMILY_ACCESS_DEACTIVATED_KEY) === '1';
    if (wasSet) sessionStorage.removeItem(FAMILY_ACCESS_DEACTIVATED_KEY);
    return wasSet;
  } catch {
    return false;
  }
})();

export function consumeFamilyAccessDeactivatedNotice() {
  return familyAccessDeactivatedAtLoad;
}

export async function getFamilySession() {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new Error(`Не удалось получить сессию: ${error.message}`);
  }
  return data.session;
}

export function onFamilyAuthStateChange(callback) {
  if (!isSupabaseConfigured) {
    return { unsubscribe() {} };
  }
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}

// Für den Passwort-Wiederherstellung-Link aus manage-family-account
// (generateLink({type:'recovery'})): der geteilte supabase-Client ist bewusst
// mit detectSessionInUrl:false konfiguriert (supabaseClient.js) — der
// Recovery-Link liefert access_token/refresh_token im URL-Hash, die hier
// EXPLIZIT übernommen werden, statt die globale Client-Konfiguration für
// alle Seiten zu ändern.
export async function establishRecoverySession(accessToken, refreshToken) {
  assertConfigured();
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });
  if (error) {
    throw new Error(`Der Wiederherstellungslink ist ungültig oder abgelaufen: ${error.message}`);
  }
  return data.session;
}

// Setzt ein neues Passwort für die AKTUELL etablierte (Recovery-)Sitzung.
// Liest das aktuelle Passwort nirgends — reine Admin-API-Semantik von
// Supabase Auth, dieselbe Garantie wie bei manage-family-account.
export async function updateFamilyPassword(newPassword) {
  assertConfigured();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    throw new Error(`Passwort konnte nicht gesetzt werden: ${error.message}`);
  }
}

export { InvalidCredentialsError };
