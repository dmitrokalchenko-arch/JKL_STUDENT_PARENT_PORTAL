import { KYU_PROGRAM_BLOCK_TYPES } from '../components/trainer/KyuProgramBlocks.jsx';

// Общие чистые helpers над формой "программа Kyu из трёх блоков"
// ({required_nage, required_katame, additional} — по одному Set
// technique_id на блок). Вынесены из TrainerKyuProgramPage.jsx, чтобы
// TrainerKyuTemplatePage.jsx (общий редактор DJB/Go Kyu шаблонов) мог
// использовать ТУ ЖЕ логику draft/saved/dirty без копирования (см.
// задание "Trainer Kyu-Programm — DJB/Go Kyu template", раздел 3: "не
// копируй большой объём существующей логики без необходимости").
export function createEmptyKyuProgram() {
  return { required_nage: new Set(), required_katame: new Set(), additional: new Set() };
}

export function cloneKyuProgram(program) {
  return {
    required_nage: new Set(program.required_nage),
    required_katame: new Set(program.required_katame),
    additional: new Set(program.additional)
  };
}

export function kyuProgramsEqual(a, b) {
  return KYU_PROGRAM_BLOCK_TYPES.every((blockType) => {
    if (a[blockType].size !== b[blockType].size) return false;
    for (const techniqueId of a[blockType]) {
      if (!b[blockType].has(techniqueId)) return false;
    }
    return true;
  });
}

export function kyuProgramTotalCount(program) {
  return KYU_PROGRAM_BLOCK_TYPES.reduce((sum, blockType) => sum + program[blockType].size, 0);
}

// items — ответ get_trainer_kyu_program/get_trainer_djb_template (плоский
// список строк с полем block_type) -> программа из трёх Set.
export function kyuProgramFromItems(items) {
  const program = createEmptyKyuProgram();
  items.forEach((item) => {
    if (program[item.block_type]) {
      program[item.block_type].add(item.technique_id);
    }
  });
  return program;
}

// программа из трёх Set -> плоский массив {technique_id, block_type} для
// save_trainer_kyu_program/save_trainer_djb_template (p_items).
export function kyuProgramToItems(program) {
  return KYU_PROGRAM_BLOCK_TYPES.flatMap((blockType) =>
    [...program[blockType]].map((techniqueId) => ({ technique_id: techniqueId, block_type: blockType }))
  );
}
