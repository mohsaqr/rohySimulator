// Explicit i18n key maps for labels that come from STATIC frontend data
// maps — BODY_REGIONS / EXAM_TECHNIQUES / specialTests in
// src/data/examRegions.js and the BodyMap polygon labels in
// src/utils/defaultRegions.js.
//
// Why maps instead of t(`region_${id}`): the i18n convention (I18N_PLAN.md)
// bans computed keys — every key must exist literally so extraction and
// grep stay reliable. Every key referenced here is present in
// src/locales/en/examination.json (namespace: 'examination'), and every
// en value is byte-identical to the English name in the data map.
//
// Labels that come from the DATABASE or case config (exam findings,
// author-entered region labels saved via BodyMapDebug) are clinical /
// author content and are NOT translated — the helpers below fall back to
// the raw label whenever an id has no key here.

export const REGION_NAME_KEYS = {
    abdomen: 'region_abdomen',
    achillesLeft: 'region_achilles_left',
    achillesRight: 'region_achilles_right',
    ankleLeft: 'region_ankle_left',
    ankleRight: 'region_ankle_right',
    backLower: 'region_back_lower',
    backUpper: 'region_back_upper',
    buttockLeft: 'region_buttock_left',
    buttockRight: 'region_buttock_right',
    buttocks: 'region_buttocks',
    calfLeft: 'region_calf_left',
    calfRight: 'region_calf_right',
    chest: 'region_chest',
    chestAnterior: 'region_chest_anterior',
    ears: 'region_ears',
    elbowLeft: 'region_elbow_left',
    elbowRight: 'region_elbow_right',
    eyes: 'region_eyes',
    footLeft: 'region_foot_left',
    footRight: 'region_foot_right',
    forearmLeft: 'region_forearm_left',
    forearmRight: 'region_forearm_right',
    general: 'region_general',
    groin: 'region_groin',
    handLeft: 'region_hand_left',
    handRight: 'region_hand_right',
    head: 'region_head',
    headNeck: 'region_head_neck',
    heart: 'region_heart',
    heelLeft: 'region_heel_left',
    heelRight: 'region_heel_right',
    kneeLeft: 'region_knee_left',
    kneeRight: 'region_knee_right',
    // Body-map alias ids resolve to the same canonical exam regions
    // (see the alias block at the bottom of examRegions.js).
    lowerBack: 'region_back_lower',
    lowerLegLeft: 'region_lower_leg_left',
    lowerLegRight: 'region_lower_leg_right',
    lowerLimbLeft: 'region_lower_limb_left',
    lowerLimbRight: 'region_lower_limb_right',
    mouth: 'region_mouth',
    neck: 'region_neck',
    neurological: 'region_neurological',
    nose: 'region_nose',
    pelvis: 'region_pelvis',
    poplitealLeft: 'region_popliteal_left',
    poplitealRight: 'region_popliteal_right',
    sacrum: 'region_sacrum',
    scapulaLeft: 'region_scapula_left',
    scapulaRight: 'region_scapula_right',
    shoulderLeft: 'region_shoulder_left',
    shoulderRight: 'region_shoulder_right',
    thighLeft: 'region_thigh_left',
    thighRight: 'region_thigh_right',
    upperArmLeft: 'region_upper_arm_left',
    upperArmRight: 'region_upper_arm_right',
    upperBack: 'region_back_upper',
    upperLimbLeft: 'region_upper_limb_left',
    upperLimbRight: 'region_upper_limb_right'
};

// Short polygon labels shown on the BodyMap silhouette. Where the map
// label equals the full region name the region_* key is reused.
export const MAP_LABEL_KEYS = {
    abdomen: 'region_abdomen',
    buttocks: 'region_buttocks',
    calfLeft: 'map_calf_left',
    calfRight: 'map_calf_right',
    chest: 'region_chest',
    footLeft: 'map_foot_left',
    footRight: 'map_foot_right',
    forearmLeft: 'map_forearm_left',
    forearmRight: 'map_forearm_right',
    handLeft: 'map_hand_left',
    handRight: 'map_hand_right',
    headNeck: 'region_head_neck',
    heelLeft: 'map_heel_left',
    heelRight: 'map_heel_right',
    lowerBack: 'map_lower_back',
    lowerLegLeft: 'map_lower_leg_left',
    lowerLegRight: 'map_lower_leg_right',
    pelvis: 'region_pelvis',
    thighLeft: 'map_thigh_left',
    thighRight: 'map_thigh_right',
    upperArmLeft: 'map_upper_arm_left',
    upperArmRight: 'map_upper_arm_right',
    upperBack: 'region_back_upper'
};

export const TECHNIQUE_NAME_KEYS = {
    auscultation: 'technique_auscultation',
    coordination: 'technique_coordination',
    cranialNerves: 'technique_cranial_nerves',
    gait: 'technique_gait',
    inspection: 'technique_inspection',
    mentalStatus: 'technique_mental_status',
    motor: 'technique_motor',
    palpation: 'technique_palpation',
    percussion: 'technique_percussion',
    reflexes: 'technique_reflexes',
    sensory: 'technique_sensory',
    special: 'technique_special'
};

// Keyed by the exact English maneuver string used in specialTests arrays —
// that string is also the runtime identifier passed to onExamTypeSelect
// and written into the exam log, so it stays English in data/logging and
// is only translated at the display site.
export const SPECIAL_TEST_KEYS = {
    'Achilles reflex': 'test_achilles_reflex',
    'Allen test': 'test_allen',
    'Apprehension test': 'test_apprehension',
    'Babinski sign': 'test_babinski',
    'Baker cyst assessment': 'test_baker_cyst',
    'Biceps reflex': 'test_biceps_reflex',
    'Brachioradialis reflex': 'test_brachioradialis_reflex',
    'Brudzinski sign': 'test_brudzinski',
    'CVA tenderness': 'test_cva_tenderness',
    'Calf squeeze': 'test_calf_squeeze',
    'Drawer test': 'test_drawer',
    'Edema': 'test_edema',
    'Edema assessment': 'test_edema_assessment',
    'Empty can test': 'test_empty_can',
    'FABER test': 'test_faber',
    'Facial symmetry': 'test_facial_symmetry',
    'Femoral pulse': 'test_femoral_pulse',
    'Fine motor': 'test_fine_motor',
    'Fundoscopy': 'test_fundoscopy',
    'Gag reflex': 'test_gag_reflex',
    'Grip strength': 'test_grip_strength',
    'Guarding': 'test_guarding',
    'Hearing test': 'test_hearing',
    'Hernia exam': 'test_hernia_exam',
    'Hip ROM': 'test_hip_rom',
    'Hoffmann sign': 'test_hoffmann',
    'Homan sign': 'test_homan',
    'JVP assessment': 'test_jvp_assessment',
    'Kernig sign': 'test_kernig',
    'Lhermitte sign': 'test_lhermitte',
    'Lymph node exam': 'test_lymph_node_exam',
    "McBurney's point": 'test_mcburneys_point',
    'McMurray test': 'test_mcmurray',
    "Murphy's sign": 'test_murphys_sign',
    'Muscle strength': 'test_muscle_strength',
    'Otoscopy': 'test_otoscopy',
    'Patellar reflex': 'test_patellar_reflex',
    'Piriformis test': 'test_piriformis',
    'Plantar reflex': 'test_plantar_reflex',
    'Popliteal pulse': 'test_popliteal_pulse',
    'Power': 'test_power',
    'Pronator drift': 'test_pronator_drift',
    'Pulses': 'test_pulses',
    'Pupil reflex': 'test_pupil_reflex',
    'Pupil response': 'test_pupil_response',
    'Range of motion': 'test_range_of_motion',
    'Rebound tenderness': 'test_rebound_tenderness',
    'Reflexes': 'test_reflexes',
    'Rinne': 'test_rinne',
    'Romberg test': 'test_romberg',
    'Rotator cuff tests': 'test_rotator_cuff',
    "Rovsing's sign": 'test_rovsings_sign',
    'Sciatic nerve assessment': 'test_sciatic_nerve',
    'Sensation': 'test_sensation',
    'Spinal ROM': 'test_spinal_rom',
    'Straight leg raise': 'test_straight_leg_raise',
    'Thompson test': 'test_thompson',
    'Thyroid exam': 'test_thyroid_exam',
    'Tone': 'test_tone',
    'Tongue movement': 'test_tongue_movement',
    'Valgus/Varus stress': 'test_valgus_varus',
    'Visual acuity': 'test_visual_acuity',
    'Visual fields': 'test_visual_fields',
    'Weber': 'test_weber'
};

/**
 * Display name for a body region. Translates known BODY_REGIONS ids;
 * unknown ids (e.g. author-defined regions) fall back to the supplied
 * English name, then to the raw id.
 */
export function regionLabel(t, regionId, fallbackName) {
    const key = REGION_NAME_KEYS[regionId];
    return key ? t(key) : (fallbackName || regionId);
}

/** Display label for a BodyMap polygon; unknown ids keep their raw label. */
export function mapRegionLabel(t, regionId, fallbackLabel) {
    const key = MAP_LABEL_KEYS[regionId];
    return key ? t(key) : (fallbackLabel || regionId);
}

/** Display name for an exam technique; unknown ids keep their raw name. */
export function techniqueLabel(t, techniqueId, fallbackName) {
    const key = TECHNIQUE_NAME_KEYS[techniqueId];
    return key ? t(key) : (fallbackName || techniqueId);
}

/** Display label for a special-test maneuver; unknown strings pass through. */
export function specialTestLabel(t, testName) {
    const key = SPECIAL_TEST_KEYS[testName];
    return key ? t(key) : testName;
}
