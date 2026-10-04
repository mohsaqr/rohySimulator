/*
 * pillStrings — every user-visible and screen-reader string of the compact
 * capture pill (<oyon-app chrome="capture"> / "capture-analytics"), in the
 * languages Oyon's hosts ship today.
 *
 * Plain JS (with a sibling .d.ts) so the root repo's node test chain can
 * execute it directly — same precedent as filterWindows.js. Keep this file
 * free of imports and browser APIs.
 *
 * Pure module: no React, no DOM. The element parses its `lang` and `labels`
 * attributes through `parsePillLang` / `parsePillLabels`, writes the result
 * into its per-instance host bridge, and CapturePill resolves the final table
 * with `pillStrings(lang, labels)`. Because the strings live in the bridge (not
 * in the runtime), a host changing `lang` or `labels` re-renders the pill text
 * and never touches the camera/capture session.
 *
 * Translations are machine-assisted UI strings (teaching/test software — no
 * linguistic sign-off). They avoid plural forms: counts are rendered as
 * "label: N", never "N samples", so no language needs plural rules.
 * "Capture" is translated as capture/measurement ("Erfassung", "mittaus",
 * "registrering"…), not "recording": Oyon keeps no video, and a learner
 * should not be told otherwise.
 *
 * Templates may contain {error}, {count} or {status}; `formatPillString`
 * fills them. A host override (the `labels` attribute) may use the same
 * placeholders.
 */

export const PILL_LANGS = Object.freeze(['en', 'de', 'es', 'it', 'fi', 'sv', 'fr', 'kk']);

export const PILL_STRING_KEYS = Object.freeze([
  // Accessible name of the whole pill (role="group").
  'pillLabel',
  // Headline / live status.
  'ready',
  'error',
  'starting',
  'capturing',
  'paused',
  // Capture controls.
  'startCapture',
  'startingCapture',
  'pauseCapture',
  'resumeCapture',
  'stopCapture',
  // Gaze calibration.
  'calibrateGaze',
  'recalibrateGaze',
  'calibratingGaze',
  'gazeError',
  'gazeActive',
  'gazeNoSignal',
  'gazeWaiting',
  'gazeWaitingStatus',
  // Analytics launch.
  'openAnalytics',
  'openAnalyticsUnavailable',
  // Emotion labels shown in the headline while capture is live. Keys follow
  // the classifier's label set (src/config/*: anger, contempt, disgust, fear,
  // happy, neutral, sad, surprise).
  'emotion_anger',
  'emotion_contempt',
  'emotion_disgust',
  'emotion_fear',
  'emotion_happy',
  'emotion_neutral',
  'emotion_sad',
  'emotion_surprise',
]);

const NBSP = ' ';

export const PILL_STRING_TABLE = deepFreeze({
  en: {
    pillLabel: 'Oyon emotion capture',
    ready: 'Ready',
    error: 'Error',
    starting: 'Camera…',
    capturing: 'Capturing',
    paused: 'Paused',
    startCapture: 'Start capture',
    startingCapture: 'Starting camera…',
    pauseCapture: 'Pause capture',
    resumeCapture: 'Resume capture',
    stopCapture: 'Stop capture',
    calibrateGaze: 'Calibrate gaze tracking',
    recalibrateGaze: 'Re-calibrate gaze tracking',
    calibratingGaze: 'Calibrating gaze…',
    gazeError: 'Gaze error: {error}',
    gazeActive: 'Gaze active, samples: {count}',
    gazeNoSignal: 'Gaze running ({status}), no usable sample yet',
    gazeWaiting: 'Gaze status: {status}',
    gazeWaitingStatus: 'waiting',
    openAnalytics: 'Open Oyon analytics for this session',
    openAnalyticsUnavailable: 'Start capture before opening session analytics',
    // English keeps the classifier's own words — exactly what the pill
    // showed before it was localised.
    emotion_anger: 'anger',
    emotion_contempt: 'contempt',
    emotion_disgust: 'disgust',
    emotion_fear: 'fear',
    emotion_happy: 'happy',
    emotion_neutral: 'neutral',
    emotion_sad: 'sad',
    emotion_surprise: 'surprise',
  },
  de: {
    pillLabel: 'Oyon-Emotionserfassung',
    ready: 'Bereit',
    error: 'Fehler',
    starting: 'Kamera…',
    capturing: 'Erfassung läuft',
    paused: 'Pausiert',
    startCapture: 'Erfassung starten',
    startingCapture: 'Kamera wird gestartet…',
    pauseCapture: 'Erfassung pausieren',
    resumeCapture: 'Erfassung fortsetzen',
    stopCapture: 'Erfassung beenden',
    calibrateGaze: 'Blickverfolgung kalibrieren',
    recalibrateGaze: 'Blickverfolgung neu kalibrieren',
    calibratingGaze: 'Blickverfolgung wird kalibriert…',
    gazeError: 'Fehler bei der Blickverfolgung: {error}',
    gazeActive: 'Blickverfolgung aktiv, Messpunkte: {count}',
    gazeNoSignal: 'Blickverfolgung läuft ({status}), noch kein verwertbarer Messpunkt',
    gazeWaiting: 'Status der Blickverfolgung: {status}',
    gazeWaitingStatus: 'wartet',
    openAnalytics: 'Oyon-Analyse für diese Sitzung öffnen',
    openAnalyticsUnavailable: 'Starten Sie die Erfassung, bevor Sie die Sitzungsanalyse öffnen',
    emotion_anger: 'Wut',
    emotion_contempt: 'Verachtung',
    emotion_disgust: 'Ekel',
    emotion_fear: 'Angst',
    emotion_happy: 'Freude',
    emotion_neutral: 'Neutral',
    emotion_sad: 'Trauer',
    emotion_surprise: 'Überraschung',
  },
  es: {
    pillLabel: 'Captura de emociones de Oyon',
    ready: 'Listo',
    error: 'Error',
    starting: 'Cámara…',
    capturing: 'Capturando',
    paused: 'En pausa',
    startCapture: 'Iniciar captura',
    startingCapture: 'Iniciando la cámara…',
    pauseCapture: 'Pausar captura',
    resumeCapture: 'Reanudar captura',
    stopCapture: 'Detener captura',
    calibrateGaze: 'Calibrar el seguimiento de la mirada',
    recalibrateGaze: 'Volver a calibrar el seguimiento de la mirada',
    calibratingGaze: 'Calibrando la mirada…',
    gazeError: 'Error en el seguimiento de la mirada: {error}',
    gazeActive: 'Seguimiento de la mirada activo, muestras: {count}',
    gazeNoSignal: 'Seguimiento de la mirada en curso ({status}), todavía sin una muestra válida',
    gazeWaiting: 'Estado del seguimiento de la mirada: {status}',
    gazeWaitingStatus: 'en espera',
    openAnalytics: 'Abrir la analítica de Oyon de esta sesión',
    openAnalyticsUnavailable: 'Inicia la captura antes de abrir la analítica de la sesión',
    emotion_anger: 'Enfado',
    emotion_contempt: 'Desprecio',
    emotion_disgust: 'Asco',
    emotion_fear: 'Miedo',
    emotion_happy: 'Alegría',
    emotion_neutral: 'Neutral',
    emotion_sad: 'Tristeza',
    emotion_surprise: 'Sorpresa',
  },
  it: {
    pillLabel: 'Rilevamento delle emozioni Oyon',
    ready: 'Pronto',
    error: 'Errore',
    starting: 'Fotocamera…',
    capturing: 'Rilevamento in corso',
    paused: 'In pausa',
    startCapture: 'Avvia il rilevamento',
    startingCapture: 'Avvio della fotocamera…',
    pauseCapture: 'Metti in pausa il rilevamento',
    resumeCapture: 'Riprendi il rilevamento',
    stopCapture: 'Interrompi il rilevamento',
    calibrateGaze: 'Calibra il tracciamento dello sguardo',
    recalibrateGaze: 'Ricalibra il tracciamento dello sguardo',
    calibratingGaze: 'Calibrazione dello sguardo…',
    gazeError: 'Errore del tracciamento dello sguardo: {error}',
    gazeActive: 'Tracciamento dello sguardo attivo, campioni: {count}',
    gazeNoSignal: 'Tracciamento dello sguardo in corso ({status}), ancora nessun campione utilizzabile',
    gazeWaiting: 'Stato del tracciamento dello sguardo: {status}',
    gazeWaitingStatus: 'in attesa',
    openAnalytics: 'Apri le analisi Oyon di questa sessione',
    openAnalyticsUnavailable: 'Avvia il rilevamento prima di aprire le analisi della sessione',
    emotion_anger: 'Rabbia',
    emotion_contempt: 'Disprezzo',
    emotion_disgust: 'Disgusto',
    emotion_fear: 'Paura',
    emotion_happy: 'Gioia',
    emotion_neutral: 'Neutro',
    emotion_sad: 'Tristezza',
    emotion_surprise: 'Sorpresa',
  },
  fi: {
    pillLabel: 'Oyon-tunnetunnistus',
    ready: 'Valmis',
    error: 'Virhe',
    starting: 'Kamera…',
    capturing: 'Mittaus käynnissä',
    paused: 'Tauolla',
    startCapture: 'Aloita mittaus',
    startingCapture: 'Kameraa käynnistetään…',
    pauseCapture: 'Keskeytä mittaus',
    resumeCapture: 'Jatka mittausta',
    stopCapture: 'Lopeta mittaus',
    calibrateGaze: 'Kalibroi katseenseuranta',
    recalibrateGaze: 'Kalibroi katseenseuranta uudelleen',
    calibratingGaze: 'Katseenseurantaa kalibroidaan…',
    gazeError: 'Katseenseurannan virhe: {error}',
    gazeActive: 'Katseenseuranta käynnissä, näytteitä: {count}',
    gazeNoSignal: 'Katseenseuranta käynnissä ({status}), ei vielä käyttökelpoista näytettä',
    gazeWaiting: 'Katseenseurannan tila: {status}',
    gazeWaitingStatus: 'odottaa',
    openAnalytics: 'Avaa tämän istunnon Oyon-analytiikka',
    openAnalyticsUnavailable: 'Aloita mittaus ennen istunnon analytiikan avaamista',
    emotion_anger: 'Viha',
    emotion_contempt: 'Halveksunta',
    emotion_disgust: 'Inho',
    emotion_fear: 'Pelko',
    emotion_happy: 'Ilo',
    emotion_neutral: 'Neutraali',
    emotion_sad: 'Suru',
    emotion_surprise: 'Yllätys',
  },
  sv: {
    pillLabel: 'Oyon känsloregistrering',
    ready: 'Redo',
    error: 'Fel',
    starting: 'Kamera…',
    capturing: 'Registrering pågår',
    paused: 'Pausad',
    startCapture: 'Starta registrering',
    startingCapture: 'Startar kameran…',
    pauseCapture: 'Pausa registreringen',
    resumeCapture: 'Återuppta registreringen',
    stopCapture: 'Stoppa registreringen',
    calibrateGaze: 'Kalibrera blickspårningen',
    recalibrateGaze: 'Kalibrera om blickspårningen',
    calibratingGaze: 'Kalibrerar blickspårningen…',
    gazeError: 'Fel i blickspårningen: {error}',
    gazeActive: 'Blickspårning aktiv, mätpunkter: {count}',
    gazeNoSignal: 'Blickspårningen körs ({status}), ingen användbar mätpunkt ännu',
    gazeWaiting: 'Blickspårningens status: {status}',
    gazeWaitingStatus: 'väntar',
    openAnalytics: 'Öppna Oyon-analysen för den här sessionen',
    openAnalyticsUnavailable: 'Starta registreringen innan du öppnar sessionsanalysen',
    emotion_anger: 'Ilska',
    emotion_contempt: 'Förakt',
    emotion_disgust: 'Avsky',
    emotion_fear: 'Rädsla',
    emotion_happy: 'Glädje',
    emotion_neutral: 'Neutral',
    emotion_sad: 'Sorg',
    emotion_surprise: 'Förvåning',
  },
  fr: {
    pillLabel: 'Capture des émotions Oyon',
    ready: 'Prêt',
    error: 'Erreur',
    starting: 'Caméra…',
    capturing: 'Capture en cours',
    paused: 'En pause',
    startCapture: 'Démarrer la capture',
    startingCapture: 'Démarrage de la caméra…',
    pauseCapture: 'Mettre la capture en pause',
    resumeCapture: 'Reprendre la capture',
    stopCapture: 'Arrêter la capture',
    calibrateGaze: 'Calibrer le suivi du regard',
    recalibrateGaze: 'Recalibrer le suivi du regard',
    calibratingGaze: 'Calibrage du regard…',
    gazeError: `Erreur du suivi du regard${NBSP}: {error}`,
    gazeActive: `Suivi du regard actif, échantillons${NBSP}: {count}`,
    gazeNoSignal: 'Suivi du regard en cours ({status}), aucun échantillon exploitable pour l’instant',
    gazeWaiting: `État du suivi du regard${NBSP}: {status}`,
    gazeWaitingStatus: 'en attente',
    openAnalytics: 'Ouvrir l’analyse Oyon de cette session',
    openAnalyticsUnavailable: 'Démarrez la capture avant d’ouvrir l’analyse de la session',
    emotion_anger: 'Colère',
    emotion_contempt: 'Mépris',
    emotion_disgust: 'Dégoût',
    emotion_fear: 'Peur',
    emotion_happy: 'Joie',
    emotion_neutral: 'Neutre',
    emotion_sad: 'Tristesse',
    emotion_surprise: 'Surprise',
  },
  kk: {
    pillLabel: 'Oyon эмоцияны анықтау',
    ready: 'Дайын',
    error: 'Қате',
    starting: 'Камера…',
    capturing: 'Тіркеу жүріп жатыр',
    paused: 'Кідіртілді',
    startCapture: 'Тіркеуді бастау',
    startingCapture: 'Камера іске қосылуда…',
    pauseCapture: 'Тіркеуді кідірту',
    resumeCapture: 'Тіркеуді жалғастыру',
    stopCapture: 'Тіркеуді тоқтату',
    calibrateGaze: 'Көзқарасты бақылауды калибрлеу',
    recalibrateGaze: 'Көзқарасты бақылауды қайта калибрлеу',
    calibratingGaze: 'Көзқарас калибрленуде…',
    gazeError: 'Көзқарасты бақылау қатесі: {error}',
    gazeActive: 'Көзқарасты бақылау белсенді, үлгілер: {count}',
    gazeNoSignal: 'Көзқарасты бақылау жұмыс істеп тұр ({status}), әзірге жарамды үлгі жоқ',
    gazeWaiting: 'Көзқарасты бақылау күйі: {status}',
    gazeWaitingStatus: 'күтуде',
    openAnalytics: 'Осы сессияның Oyon талдауын ашу',
    openAnalyticsUnavailable: 'Сессия талдауын ашпас бұрын тіркеуді бастаңыз',
    emotion_anger: 'Ашу',
    emotion_contempt: 'Менсінбеу',
    emotion_disgust: 'Жиіркеніш',
    emotion_fear: 'Қорқыныш',
    emotion_happy: 'Қуаныш',
    emotion_neutral: 'Бейтарап',
    emotion_sad: 'Мұң',
    emotion_surprise: 'Таңданыс',
  },
});

function deepFreeze(table) {
  for (const strings of Object.values(table)) Object.freeze(strings);
  return Object.freeze(table);
}

const KNOWN_LANGS = new Set(PILL_LANGS);
const KNOWN_KEYS = new Set(PILL_STRING_KEYS);

/**
 * Normalise a BCP-47-ish tag to a table language: the primary subtag,
 * case-insensitive, `_` accepted as a separator ('de-DE', 'DE_at',
 * 'kk-Cyrl-KZ' → 'de', 'de', 'kk'). Absent/empty → 'en' (recognized);
 * anything without a table → 'en' (not recognized, so the caller can warn).
 */
export function parsePillLang(value) {
  const primary = String(value ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (primary === '') return { lang: 'en', recognized: true };
  if (KNOWN_LANGS.has(primary)) return { lang: primary, recognized: true };
  return { lang: 'en', recognized: false };
}

/**
 * Parse the `labels` attribute: a JSON object mapping string keys from
 * PILL_STRING_KEYS to non-empty strings. Never throws. Bad JSON or a
 * non-object is ignored entirely; unknown keys and non-string / blank values
 * are dropped one by one, and every drop is reported in `problems`.
 */
export function parsePillLabels(value) {
  if (value == null || String(value).trim() === '') return { labels: null, problems: [] };
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    return { labels: null, problems: ['`labels` is not valid JSON — ignored'] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { labels: null, problems: ['`labels` must be a JSON object — ignored'] };
  }
  const labels = {};
  const problems = [];
  for (const [key, text] of Object.entries(parsed)) {
    if (!KNOWN_KEYS.has(key)) {
      problems.push(`unknown \`labels\` key "${key}" — ignored`);
    } else if (typeof text !== 'string' || text.trim() === '') {
      problems.push(`\`labels.${key}\` must be a non-empty string — ignored`);
    } else {
      labels[key] = text;
    }
  }
  return {
    labels: Object.keys(labels).length > 0 ? Object.freeze(labels) : null,
    problems,
  };
}

/**
 * The complete string table for a language with host overrides applied.
 * English backs every key, so a table can never render a missing string.
 */
export function pillStrings(lang, labels = null) {
  return Object.freeze({
    ...PILL_STRING_TABLE.en,
    ...(PILL_STRING_TABLE[lang] ?? {}),
    ...(labels ?? {}),
  });
}

/** Fill {name} placeholders; an unknown placeholder is left as written. */
export function formatPillString(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (whole, name) => {
    const v = vars?.[name];
    return v == null ? whole : String(v);
  });
}

/**
 * Localised emotion label for the headline. Classifier labels map onto the
 * emotion_* keys ('angry' is accepted as an alias of 'anger'); a label the
 * table does not know is shown as the classifier wrote it.
 */
export function pillEmotionLabel(strings, raw) {
  const normalized = String(raw).trim().toLowerCase();
  const key = `emotion_${normalized === 'angry' ? 'anger' : normalized}`;
  return KNOWN_KEYS.has(key) ? strings[key] : raw;
}
