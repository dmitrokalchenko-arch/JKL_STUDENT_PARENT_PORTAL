// Edge Function: потребление одноразового Super Admin Preview токена
// (выдан create-student-preview-token, Block 1) и возврат МИНИМАЛЬНОГО
// read-only набора данных ученика для Block 3 (/admin-preview/:token).
//
// НАМЕРЕННО вызывается АНОНИМНО — в новой вкладке Block 3 на этом этапе нет
// и не должно быть НИКАКОЙ Supabase-сессии (ни family, ни trainer, ни
// super admin): единственный "пропуск" — сам токен в теле запроса. Именно
// поэтому авторизация здесь НЕ через can_family_access_student и НЕ через
// can_trainer_access_student (обе требуют auth.uid() соответствующей
// сессии, которой тут нет) — а через одноразовое обладание валидным
// токеном, выданным ТОЛЬКО реальному Super Admin (см.
// create-student-preview-token).
//
// Одноразовость обеспечена АТОМАРНО одним UPDATE ... WHERE used_at IS NULL
// AND expires_at > now() — при гонке двух параллельных запросов с одним и
// тем же токеном ровно один получит непустой результат, второй — 0 строк
// (тот же generic invalid_or_expired_token, что при истёкшем/неверном
// токене — анти-enumeration, не различаем причину отказа).
//
// НЕ зависит от family_students.status/families.status — работает
// одинаково для not_set_up/active/suspended ученика (сама Preview-
// авторизация никогда не читает эти таблицы).
//
// CLUB-SCOPED BONUS TECHNIQUE PROGRESS (см. миграции
// 20260913120053_create_club_technique_program_schema.sql и
// 20260914100054_refine_bonus_technique_program_model.sql): после
// разрешения claimed.student_id/club_id ТЕМ ЖЕ токеном — если клуб включил
// bonus_program_enabled — читает club_required_techniques/
// student_bonus_technique_overrides/student_technique_records СТРОГО по
// club_id/student_id ЭТОГО студента (никогда не с клиента) — клуб A
// никогда не может повлиять на то, что увидит студент клуба B. "completed"
// здесь означает "подтверждённая бонусная техника" (студент выполнил её на
// соревнованиях, тренер отметил видео), не "любая изученная техника" — см.
// buildTechniqueProgress. Все новые таблицы читаются best-effort: если
// миграция ещё не применена (таблиц физически нет) или клуб не включил
// бонусную систему, techniqueProgress просто отсутствует в ответе.
//
// ⚠️ Деплой требует отключённой JWT-проверки на уровне Supabase API Gateway
// (verify_jwt = false) — как и остальные пока-анонимные функции проекта
// (admin-pin-login/super-admin-pin-login), эта функция вызывается ДО
// появления какой-либо сессии, значит Authorization-заголовка с реальным
// Supabase JWT не будет вовсе.
//
// CORS: вызывается ТОЛЬКО с Block 3 (jkl-student-parent-portal.netlify.app)
// — первый Edge Function этого проекта с таким origin (все остальные
// вызываются с jcl-gruppen.netlify.app).

import { createClient } from 'npm:@supabase/supabase-js@2';

interface RequestBody {
  token: string;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://jkl-student-parent-portal.netlify.app',
  'Access-Control-Allow-Headers': 'apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS }
  });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400);
  }

  const token = (body.token ?? '').trim();
  if (!token) {
    return jsonResponse({ error: 'missing_token' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'server_misconfigured' }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const tokenHash = await sha256Hex(token);
  const nowIso = new Date().toISOString();

  // ── Одноразовое атомарное потребление токена — ОДИН UPDATE, не
  // SELECT-затем-UPDATE (исключает гонку двух параллельных запросов с
  // одним и тем же токеном). ─────────────────────────────────────────────
  const { data: claimedRows, error: claimError } = await supabaseAdmin
    .from('student_preview_tokens')
    .update({ used_at: nowIso })
    .eq('token_hash', tokenHash)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('student_id, club_id')
    .limit(1);

  if (claimError) {
    return jsonResponse({ error: 'token_claim_failed', details: claimError.message }, 500);
  }

  const claimed = claimedRows?.[0];
  if (!claimed) {
    // Неверный / уже использованный / истёкший токен — один и тот же
    // ответ на все три причины, анти-enumeration.
    return jsonResponse({ error: 'invalid_or_expired_token' }, 401);
  }

  const { data: clubRow, error: clubLookupError } = await supabaseAdmin
    .from('clubs')
    .select('active')
    .eq('club_id', claimed.club_id)
    .maybeSingle();

  if (clubLookupError) {
    return jsonResponse({ error: 'club_lookup_failed', details: clubLookupError.message }, 500);
  }
  if (!clubRow || !clubRow.active) {
    return jsonResponse({ error: 'student_club_invalid' }, 403);
  }

  const { data: studentRow, error: studentError } = await supabaseAdmin
    .from('students')
    .select('id, vorname, nachname, sport_id, gruppe_id, guertelfarbe, kyu_grad')
    .eq('id', claimed.student_id)
    .maybeSingle();

  if (studentError) {
    return jsonResponse({ error: 'student_lookup_failed', details: studentError.message }, 500);
  }
  if (!studentRow) {
    return jsonResponse({ error: 'student_not_found' }, 404);
  }

  // LEFT JOIN-Äquivalent — dieselben Felder/Tabellen wie
  // get_current_family_children (migration 20260901100040): sports.name
  // über sport_id, groups.gruppenname über gruppe_id, beide global unique,
  // fehlende Zuordnung ist kein Fehler (Karte zeigt das Feld dann einfach
  // nicht, siehe StudentProfileCard).
  const [{ data: sportRow }, { data: groupRow }] = await Promise.all([
    studentRow.sport_id
      ? supabaseAdmin.from('sports').select('name').eq('sport_id', studentRow.sport_id).maybeSingle()
      : Promise.resolve({ data: null }),
    studentRow.gruppe_id
      ? supabaseAdmin.from('groups').select('gruppenname').eq('gruppe_id', studentRow.gruppe_id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  const beltLabel = [studentRow.guertelfarbe, studentRow.kyu_grad].filter(Boolean).join(' · ') || null;

  // ── Club-scoped technique progress — best-effort, никогда не роняет
  // основной ответ. club_id берётся ИЗ УЖЕ ПРОВЕРЕННОГО claimed.club_id
  // (тот же club_id, что и у claimed.student_id — целостность гарантирует
  // create-student-preview-token, который резолвит club_id из самой
  // students-строки, не принимает его отдельным параметром). ──────────────
  const techniqueProgress = await buildTechniqueProgress(
    supabaseAdmin,
    claimed.club_id,
    studentRow.id,
    studentRow.kyu_grad
  );

  return jsonResponse(
    {
      studentId: String(studentRow.id),
      firstName: studentRow.vorname,
      lastName: studentRow.nachname,
      sportName: sportRow?.name ?? null,
      groupName: groupRow?.gruppenname ?? null,
      beltLabel,
      ...(techniqueProgress ? { techniqueProgress } : {})
    },
    200
  );
});

// BONUS TECHNIQUES (не "техники, которые ученик знает вообще") — см.
// миграцию 20260914100054. Бонусный пул ученика = club_required_techniques
// клуба для belt_key ПРЕДЫДУЩЕГО (уже полученного) Kyu, best-effort
// сопоставленного с students.kyu_grad (см. BLOCKING ARCHITECTURE ISSUE в
// той же миграции — известное ограничение, не новый риск), плюс/минус
// student_bonus_technique_overrides этого конкретного ученика. "completed"
// = есть строка в student_technique_records (canonical, единственная
// таблица завершений — новая таблица completion НЕ создаётся).
//
// Если club_technique_program_settings.bonus_program_enabled = false (или
// строки нет вовсе) — возвращает null НАМЕРЕННО: блок должен ПОЛНОСТЬЮ
// отсутствовать у Family/Trainer/Super Admin, не показывать "0/0" и не
// показывать "не настроено".
//
// Форма объекта при enabled — ТОТ ЖЕ контракт, что уже потребляет
// TechniqueProgressSection/selectTechniqueGroups (не менялся):
// { featureEnabled, bonusRequirement, bonusPoints, belt,
//   techniques: [{id, name, category, status, imageUrl, hasVideo,
//   videoPath, completedAt, trainerComment}] }. category — main_group
// judo_techniques напрямую ('Nage-waza'/'Katame-waza'). hasVideo — только
// признак наличия (student_video_path IS NOT NULL), САМ путь/подписанная
// ссылка НИКОГДА не возвращается этой функцией — просмотр видео из Super
// Admin Preview НЕ реализуется на этом шаге (см. задание, п.19).
//
// Возвращает null при ЛЮБОЙ ошибке (включая "таблицы ещё нет" —
// PGRST205/42P01 до применения миграции, или "колонки ещё нет", если
// student_video_path из миграции 20260911090048 тоже не применена) —
// вызывающий код просто не добавляет techniqueProgress в ответ.
async function buildTechniqueProgress(
  supabaseAdmin: ReturnType<typeof createClient>,
  clubId: string,
  studentId: number,
  studentKyuGrad: string | null
): Promise<Record<string, unknown> | null> {
  try {
    const { data: settingsRow, error: settingsError } = await supabaseAdmin
      .from('club_technique_program_settings')
      .select('bonus_requirement, bonus_program_enabled')
      .eq('club_id', clubId)
      .maybeSingle();

    if (settingsError) {
      console.error('[get-student-preview] bonus settings unavailable', settingsError);
      return null;
    }
    if (!settingsRow?.bonus_program_enabled) {
      // Клуб не включил бонусную систему (или строки настроек нет вовсе) —
      // блок должен полностью отсутствовать, это НЕ ошибка.
      return null;
    }

    // Best-effort определение belt_key ПРЕДЫДУЩЕГО Kyu ученика — см.
    // BLOCKING ARCHITECTURE ISSUE в миграции 20260914100054.
    const normalizedKyu = (studentKyuGrad ?? '').trim().toLowerCase();

    const [{ data: requiredRows, error: requiredError }, { data: completedRows, error: completedError }, { data: overrideRows, error: overrideError }] =
      await Promise.all([
        normalizedKyu
          ? supabaseAdmin
              .from('club_required_techniques')
              .select('technique_id, belt_key, judo_techniques(id, name, main_group, image_path)')
              .eq('club_id', clubId)
          : Promise.resolve({ data: [], error: null }),
        supabaseAdmin
          .from('student_technique_records')
          .select('technique_id, completed_at, trainer_comment, student_video_path, judo_techniques(id, name, main_group, image_path)')
          .eq('student_id', studentId),
        supabaseAdmin
          .from('student_bonus_technique_overrides')
          .select('technique_id, action, judo_techniques(id, name, main_group, image_path)')
          .eq('student_id', studentId)
      ]);

    if (requiredError || completedError || overrideError) {
      console.error(
        '[get-student-preview] technique progress unavailable',
        requiredError,
        completedError,
        overrideError
      );
      return null;
    }

    // belt_key-фильтрация — сравнение регистронезависимое, тот же приём,
    // что resolve_student_current_belt() (см. миграцию). Пустой pool —
    // валидный результат (не совпало ни одного belt_key), не ошибка.
    const bonusPoolRows = (requiredRows ?? []).filter(
      (row) => (row.belt_key ?? '').trim().toLowerCase() === normalizedKyu
    );

    const buildImageUrl = (imagePath: string | null) =>
      imagePath
        ? `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/judo-techniques/${imagePath}`
        : null;

    type CatalogRef = { id: string; name: string; main_group: string; image_path: string | null };
    type CompletedRow = { technique_id: string; completed_at: string; trainer_comment: string | null; student_video_path: string | null; judo_techniques: CatalogRef | null };

    const completedByTechniqueId = new Map<string, CompletedRow>();
    for (const row of (completedRows ?? []) as CompletedRow[]) {
      completedByTechniqueId.set(row.technique_id, row);
    }

    // Пул: club-программа для belt_key ученика, скорректированная
    // point-in-time overrides (include добавляет технику, даже если её нет
    // в club-программе; exclude убирает, даже если она там есть).
    const poolMap = new Map<string, CatalogRef>();
    for (const row of bonusPoolRows) {
      const catalog = row.judo_techniques as CatalogRef | null;
      if (catalog) poolMap.set(row.technique_id, catalog);
    }
    for (const row of overrideRows ?? []) {
      const catalog = row.judo_techniques as CatalogRef | null;
      if (!catalog) continue;
      if (row.action === 'exclude') {
        poolMap.delete(row.technique_id);
      } else if (row.action === 'include') {
        poolMap.set(row.technique_id, catalog);
      }
    }

    const techniques: Array<Record<string, unknown>> = [];
    for (const [techniqueId, catalog] of poolMap.entries()) {
      const completedRow = completedByTechniqueId.get(techniqueId);
      techniques.push({
        id: catalog.id,
        name: catalog.name,
        category: catalog.main_group,
        status: completedRow ? 'completed' : 'required',
        imageUrl: buildImageUrl(catalog.image_path),
        // hasVideo намеренно ВСЕГДА false здесь, даже когда
        // student_video_path реально есть: TechniqueVideoModal (shared,
        // family-side) при hasVideo=true пытается получить signed URL
        // через FAMILY-сессионный supabase-клиент из bucket
        // 'technique-videos' — ни то, ни другое не подходит анонимной
        // Super Admin Preview (нет сессии вовсе) и не тот bucket (реальные
        // видео — private student-technique-videos, путь —
        // student_video_path, НЕ videoPath). Показывать hasVideo=true без
        // рабочего просмотра значило бы "зависшую" загрузку вместо честного
        // состояния — просмотр видео из Super Admin Preview сознательно НЕ
        // реализуется на этом шаге (см. итоговый отчёт задачи).
        hasVideo: false,
        videoPath: null,
        completedAt: completedRow?.completed_at ?? null,
        trainerComment: completedRow?.trainer_comment ?? null
      });
    }

    return {
      featureEnabled: true,
      bonusRequirement: settingsRow.bonus_requirement ?? null,
      bonusPoints: null,
      belt: null,
      techniques
    };
  } catch (e) {
    console.error('[get-student-preview] technique progress build failed', e);
    return null;
  }
}
