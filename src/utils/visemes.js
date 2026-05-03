// 15 Oculus visemes in the canonical order produced by scripts/rocketbox-convert.
// Index 0 (`viseme_sil`) is silence; the remaining 14 cover the standard
// English phoneme set the lipsync runtime drives via wawa-lipsync.
//
// The RocketBox conversion pipeline writes morph targets in this exact order
// followed by `eyeBlinkLeft`, `eyeBlinkRight` (indices 15, 16). Both the
// runtime morph driver in PatientAvatar.jsx and the build-time pipeline in
// scripts/rocketbox-convert/convert.mjs import this list so the order can
// only ever drift in one place.
export const VISEME_KEYS = [
    'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH', 'viseme_DD',
    'viseme_kk',  'viseme_CH', 'viseme_SS', 'viseme_nn', 'viseme_RR',
    'viseme_aa',  'viseme_E',  'viseme_I',  'viseme_O',  'viseme_U'
];
