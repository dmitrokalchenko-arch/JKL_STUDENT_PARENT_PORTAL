import { trainerSupabase } from './trainerSupabaseClient.js';
import { isSupabaseConfigured } from './supabaseClient.js';
import { PORTAL_CLUB_ID } from '../config/portalClub.js';

// Тренерский вход: login_name + пароль, тот же фиксированный клуб портала
// (PORTAL_CLUB_ID), что и у семьи. Использует ОТДЕЛЬНЫЙ Supabase-клиент
// (trainerSupabaseClient.js) — семейная сессия (supabaseClient.js) этим
// файлом не затрагивается.

class InvalidTrainerCredentialsError extends Error {
  constructor() {
    super('Неверный логин или пароль.');
    this.name = 'InvalidTrainerCredentialsError';
  }
}

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error('Supabase не настроен (см. .env.example) — вход тренера недоступен в mock-режиме.');
  }
}

export async function signInTrainer(loginName, password) {
  assertConfigured();

  const { data: email, error: resolveError } = await trainerSupabase.rpc('resolve_trainer_login_email', {
    p_club_short_name: PORTAL_CLUB_ID,
    p_login_name: loginName
  });

  if (resolveError) {
    throw new Error(`Не удалось выполнить вход: ${resolveError.message}`);
  }
  if (!email) {
    // Тот же текст ошибки, что и при неверном пароле ниже — не раскрываем,
    // что именно неверно (клуб/логин/пароль).
    throw new InvalidTrainerCredentialsError();
  }

  const { data, error: signInError } = await trainerSupabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new InvalidTrainerCredentialsError();
  }

  return data.session;
}

export async function signOutTrainer() {
  assertConfigured();
  const { error } = await trainerSupabase.auth.signOut();
  if (error) {
    throw new Error(`Не удалось выйти: ${error.message}`);
  }
}

export async function getTrainerSession() {
  if (!isSupabaseConfigured) return null;
  const { data, error } = await trainerSupabase.auth.getSession();
  if (error) {
    throw new Error(`Не удалось получить сессию: ${error.message}`);
  }
  return data.session;
}

export function onTrainerAuthStateChange(callback) {
  if (!isSupabaseConfigured) {
    return { unsubscribe() {} };
  }
  const { data } = trainerSupabase.auth.onAuthStateChange((_event, session) => callback(session));
  return data.subscription;
}

export { InvalidTrainerCredentialsError };
