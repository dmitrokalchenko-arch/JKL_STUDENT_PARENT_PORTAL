import { createContext, useContext } from 'react';

// Профиль текущего тренера, уже загруженный TrainerAuthGuard
// (get_current_trainer_profile). Провайдер ставится ТОЛЬКО после завершения
// загрузки и проверки is_active — потребители внутри guard никогда не видят
// промежуточное состояние, повторный RPC на каждой странице не нужен.
// null вне TrainerAuthGuard.
export const TrainerProfileContext = createContext(null);

export function useCurrentTrainerProfile() {
  return useContext(TrainerProfileContext);
}
