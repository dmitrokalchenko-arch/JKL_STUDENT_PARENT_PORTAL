import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { familyMock } from '../mocks/familyMock.js';
import { childrenMock } from '../mocks/childrenMock.js';
import { calculateAge, formatBirthDate } from '../utils/studentProfileFormatting.js';

function getMockFamilyChildren() {
  return {
    family: {
      id: null,
      displayName: familyMock.familyName
    },
    children: childrenMock.map((child) => ({
      id: String(child.id),
      firstName: child.firstName,
      lastName: child.lastName,
      clubId: '',
      studentPageActive: true
    }))
  };
}

// STUDENT PAGE ACCESS GATE (Family): доступ к платной Student Page
// ребёнка определяет ТОЛЬКО сервер — family_subscription_allows_access из
// get_current_family_children() (миграция 20260920100065), вычисленный
// public.get_student_page_access(): manual_disabled имеет высший приоритет,
// отсутствие строки student_page_access ИЛИ access_until IS NULL = активна
// (backward compatibility), истёкший access_until = не активна;
// trainer_access_after_expiry на Family не влияет. Здесь НЕТ собственного
// расчёта expiry — только чтение готового boolean.
//
// Колонки нет в ответе (старый контракт до миграции 065) -> true: в этом
// состоянии сервер ещё вообще не ограничивает Family по подписке, значит
// и frontend не вводит своё ограничение. Колонка есть, но не true -> false.
function resolveStudentPageActive(row) {
  if (!Object.prototype.hasOwnProperty.call(row, 'family_subscription_allows_access')) {
    return true;
  }
  return row.family_subscription_allows_access === true;
}

// Реальная семья и список активных детей текущего auth.uid() — см.
// supabase/migrations/20260720120010_create_get_current_family_children_rpc.sql.
// student_id приходит от RPC уже как text (не bigint) — здесь и везде ниже
// по цепочке (useFamilyData, useSelectedChild, techniqueProgressService)
// ЗАПРЕЩЕНО приводить его к Number/parseInt/unary + — это защита от потери
// точности bigint при прохождении через JSON, см. комментарий в миграции.
export async function getCurrentFamilyChildren() {
  if (!isSupabaseConfigured) {
    return getMockFamilyChildren();
  }

  const { data, error } = await supabase.rpc('get_current_family_children');

  if (error) {
    throw new Error(`Не удалось загрузить данные семьи: ${error.message}`);
  }

  const rows = data ?? [];

  // RPC возвращает по одной строке на пару (семья, ребёнок) через INNER
  // JOIN на family_students — для семьи без активных детей rows пуст, и
  // family_id/family_display_name тоже недоступны этим способом (в самой
  // RPC это не меняется на этом этапе — изменение SQL здесь не разрешено).
  // family в этом случае — пустой fallback, children — пустой массив; это
  // валидный результат, не ошибка.
  const firstRow = rows[0];

  return {
    family: {
      id: firstRow?.family_id ?? null,
      displayName: firstRow?.family_display_name ?? ''
    },
    // age/birthYear/sportName/groupName/trainingSchedule/contractStatus —
    // Block-1-Basisdaten (migration 20260901100040), NUR wenn in students/
    // groups/sports tatsächlich gepflegt (LEFT JOIN kann NULL liefern, z. B.
    // Schüler ohne zugewiesene Gruppe) — Komponenten (StudentProfileCard/
    // ChildSelector) rendern jedes Feld schon heute nur bei Vorhandensein.
    //
    // STUDENT PROFILE DATA PIPELINE AUDIT (задача "student-profile-data-
    // pipeline-audit"): age теперь ВСЕГДА вычисляется из student_birthdate
    // через calculateAge() — НЕ из row.student_age (та же ненадёжная
    // хранимая колонка students.alter, что и в trainerStudentsService.js,
    // см. её комментарий). birthDate — отформатированная строка для прямого
    // отображения (DD.MM.YYYY). gender/weight/phone/email/photoUrl/
    // trainerName — новые поля, требуют миграции 20260916160059
    // (⚠️ ПРЕДЛОЖЕНИЕ, ещё НЕ применена к production на этом шаге) — до её
    // применения соответствующие row.* будут undefined, поля просто не
    // отрендерятся. kyuGrade/beltColorName — раздельные поля вместо
    // единого beltLabel (toggle'ы Kyu/Цвет пояса независимы) — beltLabel
    // здесь больше не устанавливается для реальных данных.
    children: rows.map((row) => ({
      id: row.student_id,
      firstName: row.student_first_name,
      lastName: row.student_last_name,
      clubId: row.club_id,
      gender: row.student_gender ?? null,
      birthDate: formatBirthDate(row.student_birthdate),
      age: calculateAge(row.student_birthdate),
      birthYear: row.student_birthdate ? row.student_birthdate.slice(0, 4) : null,
      weight: row.aktuelles_gewicht ?? null,
      sportName: row.sport_name ?? null,
      groupName: row.group_name ?? null,
      trainingSchedule: [row.training_day, row.training_time].filter(Boolean).join(' · ') || null,
      trainerName: row.trainer_names ?? null,
      kyuGrade: row.kyu_grade ?? null,
      beltColorName: row.belt_color ?? null,
      phone: row.telefon ?? null,
      email: row.email ?? null,
      photoUrl: row.foto_url || null,
      contractStatus: row.contract_status ?? null,
      studentPageActive: resolveStudentPageActive(row)
    }))
  };
}
