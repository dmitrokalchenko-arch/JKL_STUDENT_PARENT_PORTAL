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
// CLUB-SCOPED TECHNIQUE PROGRESS (добавлено отдельным шагом, см. миграцию
// 20260913120053_create_club_technique_program_schema.sql): после
// разрешения claimed.student_id/club_id ТЕМ ЖЕ токеном читает
// club_technique_program_settings/club_required_techniques СТРОГО по
// club_id ЭТОГО студента (никогда не club_id с клиента) + собственные
// student_technique_records — клуб A никогда не может повлиять на то, что
// увидит студент клуба B. Обе новые таблицы читаются best-effort: если
// миграция ещё не применена (таблиц физически нет), techniqueProgress
// просто отсутствует в ответе — та же деградация, что уже было ДО этого
// шага, ничего не ломается независимо от порядка деплоя.
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
  const techniqueProgress = await buildTechniqueProgress(supabaseAdmin, claimed.club_id, studentRow.id);

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

// Форма объекта — ТОТ ЖЕ контракт, что уже потребляет существующий
// (немодифицированный по данным) TechniqueProgressSection/
// selectTechniqueGroups: { featureEnabled, bonusRequirement, bonusPoints,
// belt, techniques: [{id, name, category, status, imageUrl, hasVideo,
// videoPath, completedAt, trainerComment}] }. category — main_group
// judo_techniques ('Nage-waza'/'Katame-waza'), status — 'completed' |
// 'required', взаимоисключающе (та же гарантия, что в исходном дизайне
// selectTechniqueGroups). belt_key IS NULL — единственная программа,
// которую сегодня читает этот путь (см. комментарий в миграции).
//
// Возвращает null при ЛЮБОЙ ошибке (включая "таблицы ещё нет" —
// PGRST205/42P01 до применения миграции) — вызывающий код просто не
// добавляет techniqueProgress в ответ, старое поведение полностью
// сохраняется.
async function buildTechniqueProgress(
  supabaseAdmin: ReturnType<typeof createClient>,
  clubId: string,
  studentId: number
): Promise<Record<string, unknown> | null> {
  try {
    const [{ data: settingsRow }, { data: requiredRows, error: requiredError }, { data: completedRows, error: completedError }] =
      await Promise.all([
        supabaseAdmin
          .from('club_technique_program_settings')
          .select('bonus_requirement')
          .eq('club_id', clubId)
          .maybeSingle(),
        supabaseAdmin
          .from('club_required_techniques')
          .select('technique_id, judo_techniques(id, name, main_group, image_path)')
          .eq('club_id', clubId)
          .is('belt_key', null),
        supabaseAdmin
          .from('student_technique_records')
          .select('technique_id, completed_at, trainer_comment, judo_techniques(id, name, main_group, image_path)')
          .eq('student_id', studentId)
      ]);

    if (requiredError || completedError) {
      // Таблица ещё не существует (миграция не применена) или другая
      // ошибка — не роняем основной ответ, просто не показываем прогресс.
      console.error('[get-student-preview] technique progress unavailable', requiredError, completedError);
      return null;
    }

    const buildImageUrl = (imagePath: string | null) =>
      imagePath
        ? `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/judo-techniques/${imagePath}`
        : null;

    const completedByTechniqueId = new Map<string, (typeof completedRows)[number]>();
    for (const row of completedRows ?? []) {
      completedByTechniqueId.set(row.technique_id, row);
    }

    const techniques: Array<Record<string, unknown>> = [];
    const seenTechniqueIds = new Set<string>();

    for (const row of requiredRows ?? []) {
      const catalog = row.judo_techniques as { id: string; name: string; main_group: string; image_path: string | null } | null;
      if (!catalog) continue; // защитный борт: technique_id не должен указывать в никуда (FK), но join может вернуть null при рассинхронизации кэша схемы
      seenTechniqueIds.add(row.technique_id);
      const completedRow = completedByTechniqueId.get(row.technique_id);
      techniques.push({
        id: catalog.id,
        name: catalog.name,
        category: catalog.main_group,
        status: completedRow ? 'completed' : 'required',
        imageUrl: buildImageUrl(catalog.image_path),
        hasVideo: false,
        videoPath: null,
        completedAt: completedRow?.completed_at ?? null,
        trainerComment: completedRow?.trainer_comment ?? null
      });
    }

    // Выполненные техники, которых нет в required-списке клуба (например,
    // студент выполнил технику сверх программы) — тоже считаются
    // completed для общего счётчика/бонуса, просто не попадают ни в одну
    // required-группу (ровно так это уже работает в
    // selectTechniqueGroups — required-группы фильтруют по status
    // 'required', extra completed сюда не попадают, и это корректно).
    for (const row of completedRows ?? []) {
      if (seenTechniqueIds.has(row.technique_id)) continue;
      const catalog = row.judo_techniques as { id: string; name: string; main_group: string; image_path: string | null } | null;
      if (!catalog) continue;
      techniques.push({
        id: catalog.id,
        name: catalog.name,
        category: catalog.main_group,
        status: 'completed',
        imageUrl: buildImageUrl(catalog.image_path),
        hasVideo: false,
        videoPath: null,
        completedAt: row.completed_at,
        trainerComment: row.trainer_comment ?? null
      });
    }

    return {
      featureEnabled: true,
      bonusRequirement: settingsRow?.bonus_requirement ?? null,
      bonusPoints: null,
      belt: null,
      techniques
    };
  } catch (e) {
    console.error('[get-student-preview] technique progress build failed', e);
    return null;
  }
}
