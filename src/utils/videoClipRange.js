// Чистые функции для Technique Clip Editor (Phase 1 — только UX выбора
// эпизода, см. TechniqueClipEditor.jsx). Вынесены отдельно от компонента,
// потому что Phase 2 (физический trim через WebCodecs) будет использовать
// ТУ ЖЕ математику клипа для реального decode-диапазона — переиспользуется
// как есть, не дублируется.

export const CLIP_DURATION_OPTIONS_SEC = [5, 7, 15, 20, 25];
export const DEFAULT_CLIP_DURATION_SEC = 7;

// clipEnd = clipStart + duration, с зажимом в границы [0, sourceDuration]
// (задание, этап 3/4/6):
//   - если duration длиннее самого source — клип становится всем source
//     (start=0, end=sourceDuration), а не обрезается по номинальной
//     duration за пределы реальной длины;
//   - если duration укладывается, но desiredStart слишком близко к концу —
//     start сдвигается назад ровно настолько, чтобы end не вышел за
//     sourceDuration (а не наоборот обрезаем end короче выбранной duration).
// effectiveDurationSec в результате может быть МЕНЬШЕ duration (только в
// первом случае) — вызывающий код показывает это как информационную
// подсказку, не как ошибку (задание: "не ломать UI").
export function clampClipRange({ desiredStartSec, durationSec, sourceDurationSec }) {
  const safeSourceDuration = Number.isFinite(sourceDurationSec) && sourceDurationSec > 0 ? sourceDurationSec : 0;

  if (safeSourceDuration === 0) {
    return { clipStart: 0, clipEnd: 0, effectiveDurationSec: 0 };
  }

  const effectiveDurationSec = Math.min(durationSec, safeSourceDuration);
  const maxStart = Math.max(0, safeSourceDuration - effectiveDurationSec);
  const clipStart = Math.min(Math.max(0, desiredStartSec), maxStart);
  const clipEnd = Math.min(clipStart + effectiveDurationSec, safeSourceDuration);

  return { clipStart, clipEnd, effectiveDurationSec };
}

// "MM:SS" — секунды могут быть дробными (fine adjustment на 0.5 сек) на
// входе, но отображение всегда целочисленное (округление вниз, как в
// большинстве video-плееров — currentTime "01:32.7" отображается как "01:32").
export function formatClipTime(totalSeconds) {
  const safeSeconds = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = Math.floor(safeSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
