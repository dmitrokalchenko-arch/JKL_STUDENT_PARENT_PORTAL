import { supabase, isSupabaseConfigured } from './supabaseClient.js';
import { familyMock } from '../mocks/familyMock.js';
import { childrenMock } from '../mocks/childrenMock.js';

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
      clubId: ''
    }))
  };
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
    children: rows.map((row) => ({
      id: row.student_id,
      firstName: row.student_first_name,
      lastName: row.student_last_name,
      clubId: row.club_id
    }))
  };
}
