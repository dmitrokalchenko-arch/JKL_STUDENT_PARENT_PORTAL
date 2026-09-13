// Простой, намеренно НЕ детализированный device/capability guard (задание:
// "полностью отказываемся от обработки видео на iPhone/Safari/мобильных
// устройствах... не нужно определять конкретно iPhone 14 и т.п."). Browser-
// side video processing (mediabunny/WebCodecs, см.
// processTechniqueClip.js) остаётся ТОЛЬКО для desktop — вся история
// попыток завести его на iPhone Safari (probe/candidate fallback/custom
// encoder/server-side worker) показала, что там нет надёжного пути на
// уровне браузера.
//
// Обычный regex по navigator.userAgent — сознательно простой сигнал, а не
// строгая capability-проверка (WebCodecs/OffscreenCanvas support и т.п.):
// нам не нужно отличать "какой именно мобильный браузер может частично
// сработать" — нужно отличить "мобильное устройство вообще" от desktop.
// Обычные desktop-браузеры (Chrome/Firefox/Safari/Edge на Windows/macOS/
// Linux) не содержат ни одного из этих токенов в своём User-Agent — ложное
// срабатывание на desktop Chromium исключено.
const MOBILE_USER_AGENT_REGEX = /Mobi|Android|iPhone|iPad|iPod/i;

export function isVideoProcessingSupportedDevice() {
  if (typeof navigator === 'undefined' || typeof navigator.userAgent !== 'string') {
    return true;
  }
  return !MOBILE_USER_AGENT_REGEX.test(navigator.userAgent);
}
