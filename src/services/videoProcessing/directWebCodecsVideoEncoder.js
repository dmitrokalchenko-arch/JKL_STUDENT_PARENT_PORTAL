import { CustomVideoEncoder, EncodedPacket } from 'mediabunny';

// TEMP DIAGNOSTICS (ПУТЬ A — последняя client-side попытка перед server-side
// fallback): физический iPhone Safari тест показал, что ВСЕ 9 AVC candidate
// (High/Main/Baseline × no-preference/prefer-hardware/prefer-software)
// проходят наш собственный preflight (VideoEncoder.isConfigSupported()), но
// mediabunny's ensureEncoder() (node_modules/mediabunny/dist/modules/src/
// media-source.js:618, идентично src/media-source.ts:711) делает СВОЙ
// СОБСТВЕННЫЙ повторный вызов isConfigSupported() непосредственно перед
// реальным configure() — и именно ЭТОТ повторный вызов возвращает false для
// конфига, который секунды назад был подтверждён supported:true (500ms
// resource-settle delay и отключение synthetic probe это не изменили).
//
// Это — единственная причина ошибки "is not supported in this environment"
// на реальном processing: то, что произойдёт ПОСЛЕ (реальный
// VideoEncoder.configure()+encode()) до сих пор ни разу физически не
// проверялось, потому что mediabunny сама не пропускает код дальше своего
// внутреннего isConfigSupported()-гейта.
//
// mediabunny официально поддерживает обход именно этого гейта: если
// зарегистрированный CustomVideoEncoder.supports(codec, config) вернёт true,
// ensureEncoder() выбирает его СРАЗУ (media-source.js:594-598, ДО первого
// вызова VideoEncoder.isConfigSupported() для этого candidate) и передаёт
// управление configure()/encode()/flush()/close() целиком нам —
// mediabunny продолжает использоваться ТОЛЬКО как demux/decode/mux слой
// (VideoSampleSink на чтение, Output/Mp4OutputFormat на запись), а сам
// WebCodecs VideoEncoder мы вызываем напрямую, БЕЗ повторной проверки
// isConfigSupported() внутри (наш собственный app-level preflight в
// findWorkingAvcEncoderConfig её уже сделал один раз для этого candidate).
//
// mediabunny инстанцирует зарегистрированный класс БЕЗ аргументов
// (`new MatchingCustomEncoder()`, media-source.js:648) и присваивает
// codec/config/onPacket/onError как обычные свойства ПОСЛЕ создания
// (media-source.js:650-673) — конструктора с параметрами тут нет,
// поэтому app-level diagnostic context (candidateIndex — единственное,
// чего нет в config) передаётся через этот отдельный module-level "мост"
// (setDirectEncoderDiagnosticStage), который findWorkingAvcEncoderConfig
// обновляет перед каждой real-попыткой. Безопасно, т.к. попытки кандидатов
// строго последовательны (никогда не параллельны).
let activeOnStage = null;

export function setDirectEncoderDiagnosticStage(onStage) {
  activeOnStage = onStage;
}

function reportStage(stage, extra) {
  activeOnStage?.(stage, { forceLog: true, ...extra });
}

// Расширяет ПУБЛИЧНЫЙ mediabunny API (custom-coder.ts/js) — НЕ patch
// node_modules. supports() намеренно ограничен ТОЛЬКО codec==='avc' (это
// приложение больше никакой другой codec через mediabunny не кодирует) —
// не расширяем область действия без необходимости (задание, раздел 3).
export class DirectWebCodecsVideoEncoder extends CustomVideoEncoder {
  static supports(codec) {
    return codec === 'avc';
  }

  // mediabunny await'ит init() (media-source.js:673) перед тем как считать
  // encoderInitialized=true — синхронный VideoEncoder.configure() внутри
  // async-функции это переживает нормально.
  async init() {
    reportStage('CUSTOM_ENCODER_SELECTED', {
      width: this.config.width,
      height: this.config.height,
      bitrate: this.config.bitrate
    });
    reportStage('CUSTOM_ENCODER_CONFIGURE_START', {
      width: this.config.width,
      height: this.config.height,
      bitrate: this.config.bitrate
    });

    this._firstEncodeSeen = false;
    // Нативный WebCodecs VideoEncoder — тот же глобальный класс, что и
    // остальной pipeline (processTechniqueClip.js), НЕ обёрнутый mediabunny.
    this._encoder = new VideoEncoder({
      output: (chunk, meta) => {
        // EncodedPacket.fromEncodedChunk — публичный статический хелпер
        // mediabunny (packet.ts/js) — onPacket() САМ проверяет
        // `instanceof EncodedPacket` (media-source.js:655-657) и бросит,
        // если передать сырой EncodedVideoChunk напрямую.
        this.onPacket(EncodedPacket.fromEncodedChunk(chunk), meta);
      },
      error: (error) => {
        reportStage('CUSTOM_ENCODER_ERROR_CALLBACK', { message: error?.message, name: error?.name });
        this.onError(error);
      }
    });

    // КРИТИЧНО (задание, раздел 3): НЕ вызывать VideoEncoder.isConfigSupported()
    // здесь ещё раз — наш собственный app-level preflight в
    // findWorkingAvcEncoderConfig уже это сделал для этого candidate. Мы
    // напрямую пробуем configure() — это тот самый "честный результат",
    // которого раньше не было видно из-за mediabunny's внутреннего гейта.
    try {
      this._encoder.configure(this.config);
      reportStage('CUSTOM_ENCODER_CONFIGURE_OK');
    } catch (err) {
      reportStage('CUSTOM_ENCODER_CONFIGURE_THROW', { message: err?.message, name: err?.name });
      throw err;
    }
  }

  // mediabunny клонирует наш output VideoSample перед вызовом (media-
  // source.js:458) и закрывает клон сама в своём finally (media-
  // source.js:464) — здесь закрывается только VideoFrame, который мы сами
  // получаем через toVideoFrame() (независимая от canvas копия для нашего
  // raw RGBA пути, см. processTechniqueClip.js/createOutputVideoSample).
  async encode(videoSample, options) {
    const frame = videoSample.toVideoFrame();
    try {
      if (!this._firstEncodeSeen) {
        this._firstEncodeSeen = true;
        reportStage('CUSTOM_ENCODER_FIRST_ENCODE_START');
      }
      this._encoder.encode(frame, options);
    } finally {
      frame.close();
    }
    if (this._firstEncodeSeen && !this._firstEncodeOkReported) {
      this._firstEncodeOkReported = true;
      reportStage('CUSTOM_ENCODER_FIRST_ENCODE_OK');
    }
  }

  async flush() {
    reportStage('CUSTOM_ENCODER_FLUSH_START');
    await this._encoder.flush();
    reportStage('CUSTOM_ENCODER_FLUSH_OK');
  }

  // Защита от double-close (native VideoEncoder.close() бросает, если уже
  // closed) — та же проверка state, что mediabunny сама делает для
  // встроенного (не custom) пути (media-source.js:834).
  async close() {
    if (this._encoder && this._encoder.state !== 'closed') {
      this._encoder.close();
    }
    reportStage('CUSTOM_ENCODER_CLOSE');
  }
}
