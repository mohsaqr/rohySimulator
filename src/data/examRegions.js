/**
 * Physical Examination Regions and Types Configuration
 * Defines body regions, available examination techniques, and default findings
 */

// Examination technique definitions
export const EXAM_TECHNIQUES = {
    inspection: {
        id: 'inspection',
        name: 'Inspection',
        icon: 'Eye',
        description: 'Visual examination'
    },
    palpation: {
        id: 'palpation',
        name: 'Palpation',
        icon: 'Hand',
        description: 'Examination by touch'
    },
    percussion: {
        id: 'percussion',
        name: 'Percussion',
        icon: 'Pointer',
        description: 'Tapping to assess underlying structures'
    },
    auscultation: {
        id: 'auscultation',
        name: 'Auscultation',
        icon: 'Stethoscope',
        description: 'Listening with stethoscope'
    },
    special: {
        id: 'special',
        name: 'Special Tests',
        icon: 'ClipboardCheck',
        description: 'Specific diagnostic maneuvers'
    }
};

// Body region definitions with available exam types
export const BODY_REGIONS = {
    // Anterior view regions
    head: {
        id: 'head',
        name: 'Head & Face',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pupil reflex', 'Fundoscopy', 'Facial symmetry'],
        defaultFindings: {
            inspection: 'Normocephalic, atraumatic, no facial asymmetry',
            palpation: 'No tenderness, no masses',
            special: 'Pupils equal, round, reactive to light (PERRLA)'
        }
    },
    eyes: {
        id: 'eyes',
        name: 'Eyes',
        view: 'anterior',
        examTypes: ['inspection', 'special'],
        specialTests: ['Visual acuity', 'Visual fields', 'Pupil response', 'Fundoscopy'],
        defaultFindings: {
            inspection: 'Conjunctivae clear, no icterus, no pallor',
            special: 'PERRLA, EOM intact, no nystagmus'
        }
    },
    ears: {
        id: 'ears',
        name: 'Ears',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Otoscopy', 'Hearing test', 'Rinne', 'Weber'],
        defaultFindings: {
            inspection: 'External ears normal, no discharge',
            palpation: 'No tenderness, no masses',
            special: 'Tympanic membranes intact, hearing grossly normal'
        }
    },
    nose: {
        id: 'nose',
        name: 'Nose',
        view: 'anterior',
        examTypes: ['inspection', 'palpation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No deviation, no discharge, mucosa pink',
            palpation: 'No tenderness over sinuses'
        }
    },
    mouth: {
        id: 'mouth',
        name: 'Mouth & Throat',
        view: 'anterior',
        examTypes: ['inspection', 'special'],
        specialTests: ['Gag reflex', 'Tongue movement'],
        defaultFindings: {
            inspection: 'Oral mucosa moist, no lesions, pharynx non-erythematous, tonsils normal',
            special: 'Gag reflex intact, tongue midline'
        }
    },
    neck: {
        id: 'neck',
        name: 'Neck',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'auscultation', 'special'],
        specialTests: ['JVP assessment', 'Lymph node exam', 'Thyroid exam'],
        defaultFindings: {
            inspection: 'No masses, no JVD, trachea midline',
            palpation: 'Supple, no lymphadenopathy, thyroid normal size',
            auscultation: 'No carotid bruits',
            special: 'JVP not elevated, no thyromegaly'
        }
    },
    chestAnterior: {
        id: 'chestAnterior',
        name: 'Chest (Anterior)',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'percussion', 'auscultation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'Symmetrical chest rise, no deformities, no scars',
            palpation: 'No tenderness, normal tactile fremitus, apex beat normal position',
            percussion: 'Resonant bilaterally',
            auscultation: 'Clear breath sounds bilaterally, no wheeze or crackles. Heart sounds S1 S2 normal, no murmurs'
        }
    },
    heart: {
        id: 'heart',
        name: 'Heart (Precordium)',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'auscultation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No visible pulsations, no scars',
            palpation: 'Apex beat in 5th intercostal space MCL, no heaves or thrills',
            auscultation: 'S1 S2 normal, regular rate and rhythm, no murmurs, rubs, or gallops'
        }
    },
    abdomen: {
        id: 'abdomen',
        name: 'Abdomen',
        view: 'anterior',
        examTypes: ['inspection', 'auscultation', 'percussion', 'palpation', 'special'],
        specialTests: ["Murphy's sign", "Rovsing's sign", "McBurney's point", "Rebound tenderness", "Guarding"],
        defaultFindings: {
            inspection: 'Flat, no distension, no scars, no visible peristalsis',
            auscultation: 'Normoactive bowel sounds in all quadrants',
            percussion: 'Tympanic throughout, no shifting dullness',
            palpation: 'Soft, non-tender, no organomegaly, no masses',
            special: "Murphy's negative, no rebound, no guarding"
        }
    },
    upperLimbLeft: {
        id: 'upperLimbLeft',
        name: 'Left Upper Limb',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Tone', 'Power', 'Reflexes', 'Sensation'],
        defaultFindings: {
            inspection: 'No deformities, no swelling, no skin changes',
            palpation: 'Radial pulse 2+ regular, no tenderness',
            special: 'Power 5/5, tone normal, reflexes 2+, sensation intact'
        }
    },
    upperLimbRight: {
        id: 'upperLimbRight',
        name: 'Right Upper Limb',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Tone', 'Power', 'Reflexes', 'Sensation'],
        defaultFindings: {
            inspection: 'No deformities, no swelling, no skin changes',
            palpation: 'Radial pulse 2+ regular, no tenderness',
            special: 'Power 5/5, tone normal, reflexes 2+, sensation intact'
        }
    },
    lowerLimbLeft: {
        id: 'lowerLimbLeft',
        name: 'Left Lower Limb',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Tone', 'Power', 'Reflexes', 'Sensation', 'Edema'],
        defaultFindings: {
            inspection: 'No deformities, no swelling, no varicosities',
            palpation: 'Dorsalis pedis and posterior tibial pulses 2+, no pitting edema',
            special: 'Power 5/5, tone normal, reflexes 2+, sensation intact'
        }
    },
    lowerLimbRight: {
        id: 'lowerLimbRight',
        name: 'Right Lower Limb',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Tone', 'Power', 'Reflexes', 'Sensation', 'Edema'],
        defaultFindings: {
            inspection: 'No deformities, no swelling, no varicosities',
            palpation: 'Dorsalis pedis and posterior tibial pulses 2+, no pitting edema',
            special: 'Power 5/5, tone normal, reflexes 2+, sensation intact'
        }
    },

    // Shoulder regions
    shoulderLeft: {
        id: 'shoulderLeft',
        name: 'Left Shoulder',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Range of motion', 'Rotator cuff tests', 'Apprehension test', 'Empty can test'],
        defaultFindings: {
            inspection: 'No swelling, no deformity, no muscle wasting',
            palpation: 'No tenderness over AC joint, no crepitus',
            special: 'Full range of motion, rotator cuff intact, negative apprehension'
        }
    },
    shoulderRight: {
        id: 'shoulderRight',
        name: 'Right Shoulder',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Range of motion', 'Rotator cuff tests', 'Apprehension test', 'Empty can test'],
        defaultFindings: {
            inspection: 'No swelling, no deformity, no muscle wasting',
            palpation: 'No tenderness over AC joint, no crepitus',
            special: 'Full range of motion, rotator cuff intact, negative apprehension'
        }
    },

    // Elbow regions
    elbowLeft: {
        id: 'elbowLeft',
        name: 'Left Elbow',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Range of motion', 'Biceps reflex', 'Brachioradialis reflex'],
        defaultFindings: {
            inspection: 'No swelling, no deformity, normal carrying angle',
            palpation: 'No tenderness, no effusion',
            special: 'Full range of motion, biceps reflex 2+'
        }
    },
    elbowRight: {
        id: 'elbowRight',
        name: 'Right Elbow',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Range of motion', 'Biceps reflex', 'Brachioradialis reflex'],
        defaultFindings: {
            inspection: 'No swelling, no deformity, normal carrying angle',
            palpation: 'No tenderness, no effusion',
            special: 'Full range of motion, biceps reflex 2+'
        }
    },

    // Forearm regions
    forearmLeft: {
        id: 'forearmLeft',
        name: 'Left Forearm',
        view: 'anterior',
        examTypes: ['inspection', 'palpation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No swelling, no deformity, no skin changes',
            palpation: 'No tenderness, radial pulse 2+'
        }
    },
    forearmRight: {
        id: 'forearmRight',
        name: 'Right Forearm',
        view: 'anterior',
        examTypes: ['inspection', 'palpation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No swelling, no deformity, no skin changes',
            palpation: 'No tenderness, radial pulse 2+'
        }
    },

    // Hand regions
    handLeft: {
        id: 'handLeft',
        name: 'Left Hand',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Grip strength', 'Fine motor', 'Sensation', 'Allen test'],
        defaultFindings: {
            inspection: 'No deformities, no swelling, no nail changes',
            palpation: 'Warm, no tenderness, radial and ulnar pulses palpable',
            special: 'Grip strength normal, fine motor intact, sensation intact'
        }
    },
    handRight: {
        id: 'handRight',
        name: 'Right Hand',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Grip strength', 'Fine motor', 'Sensation', 'Allen test'],
        defaultFindings: {
            inspection: 'No deformities, no swelling, no nail changes',
            palpation: 'Warm, no tenderness, radial and ulnar pulses palpable',
            special: 'Grip strength normal, fine motor intact, sensation intact'
        }
    },

    // Groin region
    groin: {
        id: 'groin',
        name: 'Groin / Inguinal',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Hernia exam', 'Lymph node exam', 'Femoral pulse'],
        defaultFindings: {
            inspection: 'No visible masses or bulges',
            palpation: 'No inguinal lymphadenopathy, femoral pulses 2+ bilaterally',
            special: 'No inguinal hernia on Valsalva'
        }
    },

    // Thigh regions
    thighLeft: {
        id: 'thighLeft',
        name: 'Left Thigh',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Muscle strength', 'Sensation'],
        defaultFindings: {
            inspection: 'No swelling, no skin changes, normal muscle bulk',
            palpation: 'No tenderness, no masses',
            special: 'Power 5/5 quadriceps, sensation intact'
        }
    },
    thighRight: {
        id: 'thighRight',
        name: 'Right Thigh',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Muscle strength', 'Sensation'],
        defaultFindings: {
            inspection: 'No swelling, no skin changes, normal muscle bulk',
            palpation: 'No tenderness, no masses',
            special: 'Power 5/5 quadriceps, sensation intact'
        }
    },

    // Knee regions
    kneeLeft: {
        id: 'kneeLeft',
        name: 'Left Knee',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Patellar reflex', 'Range of motion', 'Drawer test', 'McMurray test', 'Valgus/Varus stress'],
        defaultFindings: {
            inspection: 'No swelling, no deformity, no erythema',
            palpation: 'No effusion, no joint line tenderness, patella tracks normally',
            special: 'Patellar reflex 2+, full range of motion, ligaments stable, McMurray negative'
        }
    },
    kneeRight: {
        id: 'kneeRight',
        name: 'Right Knee',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Patellar reflex', 'Range of motion', 'Drawer test', 'McMurray test', 'Valgus/Varus stress'],
        defaultFindings: {
            inspection: 'No swelling, no deformity, no erythema',
            palpation: 'No effusion, no joint line tenderness, patella tracks normally',
            special: 'Patellar reflex 2+, full range of motion, ligaments stable, McMurray negative'
        }
    },

    // Ankle regions
    ankleLeft: {
        id: 'ankleLeft',
        name: 'Left Ankle',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Range of motion', 'Drawer test', 'Achilles reflex'],
        defaultFindings: {
            inspection: 'No swelling, no deformity',
            palpation: 'No tenderness over malleoli, posterior tibial pulse 2+',
            special: 'Full range of motion, ankle stable, Achilles reflex 2+'
        }
    },
    ankleRight: {
        id: 'ankleRight',
        name: 'Right Ankle',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Range of motion', 'Drawer test', 'Achilles reflex'],
        defaultFindings: {
            inspection: 'No swelling, no deformity',
            palpation: 'No tenderness over malleoli, posterior tibial pulse 2+',
            special: 'Full range of motion, ankle stable, Achilles reflex 2+'
        }
    },

    // Foot regions
    footLeft: {
        id: 'footLeft',
        name: 'Left Foot',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Sensation', 'Pulses', 'Plantar reflex'],
        defaultFindings: {
            inspection: 'No deformities, no skin changes, no ulcers',
            palpation: 'Warm, dorsalis pedis pulse 2+, no edema',
            special: 'Sensation intact to monofilament, plantar reflex downgoing'
        }
    },
    footRight: {
        id: 'footRight',
        name: 'Right Foot',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Sensation', 'Pulses', 'Plantar reflex'],
        defaultFindings: {
            inspection: 'No deformities, no skin changes, no ulcers',
            palpation: 'Warm, dorsalis pedis pulse 2+, no edema',
            special: 'Sensation intact to monofilament, plantar reflex downgoing'
        }
    },

    // Posterior view regions
    backUpper: {
        id: 'backUpper',
        name: 'Upper Back',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'percussion', 'auscultation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No deformities, no skin lesions',
            palpation: 'No tenderness, no spinal deformity',
            percussion: 'Resonant bilaterally',
            auscultation: 'Clear breath sounds bilaterally'
        }
    },
    backLower: {
        id: 'backLower',
        name: 'Lower Back (Lumbar)',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'percussion', 'special'],
        specialTests: ['CVA tenderness', 'Straight leg raise', 'Spinal ROM'],
        defaultFindings: {
            inspection: 'Normal spinal curvature, no deformities',
            palpation: 'No tenderness over spinous processes',
            percussion: 'No CVA tenderness',
            special: 'Straight leg raise negative bilaterally'
        }
    },

    // Scapula regions
    scapulaLeft: {
        id: 'scapulaLeft',
        name: 'Left Scapula',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'auscultation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No winging, symmetrical position',
            palpation: 'No tenderness, normal muscle tone',
            auscultation: 'Clear breath sounds at left lung base'
        }
    },
    scapulaRight: {
        id: 'scapulaRight',
        name: 'Right Scapula',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'auscultation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No winging, symmetrical position',
            palpation: 'No tenderness, normal muscle tone',
            auscultation: 'Clear breath sounds at right lung base'
        }
    },

    // Buttocks regions (left and right)
    buttockLeft: {
        id: 'buttockLeft',
        name: 'Left Buttock / Gluteal',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Piriformis test', 'Sciatic nerve assessment'],
        defaultFindings: {
            inspection: 'No asymmetry, no skin changes',
            palpation: 'No tenderness over gluteal muscles or sciatic notch',
            special: 'No piriformis tenderness, no sciatic irritation'
        }
    },
    buttockRight: {
        id: 'buttockRight',
        name: 'Right Buttock / Gluteal',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Piriformis test', 'Sciatic nerve assessment'],
        defaultFindings: {
            inspection: 'No asymmetry, no skin changes',
            palpation: 'No tenderness over gluteal muscles or sciatic notch',
            special: 'No piriformis tenderness, no sciatic irritation'
        }
    },

    // Sacrum region
    sacrum: {
        id: 'sacrum',
        name: 'Sacrum',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'percussion'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No skin changes, no dimpling',
            palpation: 'Non-tender, no step deformity',
            percussion: 'No tenderness'
        }
    },

    // Popliteal fossa regions (back of knee)
    poplitealLeft: {
        id: 'poplitealLeft',
        name: 'Left Popliteal Fossa',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'auscultation'],
        specialTests: ['Popliteal pulse', 'Baker cyst assessment'],
        defaultFindings: {
            inspection: 'No swelling, no visible mass',
            palpation: 'Popliteal pulse 2+, no cyst palpable',
            auscultation: 'No bruit'
        }
    },
    poplitealRight: {
        id: 'poplitealRight',
        name: 'Right Popliteal Fossa',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'auscultation'],
        specialTests: ['Popliteal pulse', 'Baker cyst assessment'],
        defaultFindings: {
            inspection: 'No swelling, no visible mass',
            palpation: 'Popliteal pulse 2+, no cyst palpable',
            auscultation: 'No bruit'
        }
    },

    // Calf regions
    calfLeft: {
        id: 'calfLeft',
        name: 'Left Calf',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Homan sign', 'Calf squeeze', 'Thompson test'],
        defaultFindings: {
            inspection: 'No swelling, no erythema, no varicosities',
            palpation: 'Soft, non-tender, no cord palpable',
            special: "Homan's sign negative, Thompson test negative"
        }
    },
    calfRight: {
        id: 'calfRight',
        name: 'Right Calf',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Homan sign', 'Calf squeeze', 'Thompson test'],
        defaultFindings: {
            inspection: 'No swelling, no erythema, no varicosities',
            palpation: 'Soft, non-tender, no cord palpable',
            special: "Homan's sign negative, Thompson test negative"
        }
    },

    // Achilles tendon regions
    achillesLeft: {
        id: 'achillesLeft',
        name: 'Left Achilles Tendon',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Achilles reflex', 'Thompson test'],
        defaultFindings: {
            inspection: 'No swelling, no nodules',
            palpation: 'Non-tender, intact tendon',
            special: 'Achilles reflex 2+, Thompson test negative'
        }
    },
    achillesRight: {
        id: 'achillesRight',
        name: 'Right Achilles Tendon',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Achilles reflex', 'Thompson test'],
        defaultFindings: {
            inspection: 'No swelling, no nodules',
            palpation: 'Non-tender, intact tendon',
            special: 'Achilles reflex 2+, Thompson test negative'
        }
    },

    // Heel regions
    heelLeft: {
        id: 'heelLeft',
        name: 'Left Heel',
        view: 'posterior',
        examTypes: ['inspection', 'palpation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No swelling, no skin changes',
            palpation: 'Non-tender, no calcaneal spur tenderness'
        }
    },
    heelRight: {
        id: 'heelRight',
        name: 'Right Heel',
        view: 'posterior',
        examTypes: ['inspection', 'palpation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'No swelling, no skin changes',
            palpation: 'Non-tender, no calcaneal spur tenderness'
        }
    },

    // Special examination systems
    neurological: {
        id: 'neurological',
        name: 'Neurological',
        view: 'special',
        examTypes: ['special'],
        specialTests: [
            'Mental status', 'Cranial nerves', 'Motor exam',
            'Sensory exam', 'Reflexes', 'Coordination', 'Gait'
        ],
        defaultFindings: {
            special: 'GCS 15, oriented x3. Cranial nerves II-XII intact. Motor 5/5 all extremities. Sensory intact to light touch. Reflexes 2+ and symmetrical. Coordination intact, gait normal.'
        }
    },
    general: {
        id: 'general',
        name: 'General Appearance',
        view: 'special',
        examTypes: ['inspection'],
        specialTests: [],
        defaultFindings: {
            inspection: 'Alert and oriented, appears stated age, in no acute distress, well-nourished, well-developed'
        }
    }
};

// Get regions by view
export function getRegionsByView(view) {
    return Object.values(BODY_REGIONS).filter(r => r.view === view);
}

// Get available exam types for a region
export function getExamTypesForRegion(regionId) {
    const region = BODY_REGIONS[regionId];
    if (!region) return [];
    return region.examTypes.map(typeId => EXAM_TECHNIQUES[typeId]);
}

// Get default finding for a region and exam type
export function getDefaultFinding(regionId, examType) {
    const region = BODY_REGIONS[regionId];
    if (!region || !region.defaultFindings) return 'Not examined';
    return region.defaultFindings[examType] || 'Not examined';
}

// Generate empty physical exam template for case configuration
export function generateEmptyPhysicalExam() {
    const exam = {};
    Object.keys(BODY_REGIONS).forEach(regionId => {
        const region = BODY_REGIONS[regionId];
        exam[regionId] = {};
        region.examTypes.forEach(examType => {
            exam[regionId][examType] = {
                finding: region.defaultFindings[examType] || '',
                abnormal: false
            };
        });
    });
    return exam;
}

// Sample abnormal physical exam for testing
export const SAMPLE_ABNORMAL_EXAM = {
    general: {
        inspection: {
            finding: 'Alert but anxious, diaphoretic, in moderate respiratory distress',
            abnormal: true
        }
    },
    chestAnterior: {
        inspection: {
            finding: 'Using accessory muscles, increased respiratory rate',
            abnormal: true
        },
        palpation: {
            finding: 'Decreased tactile fremitus at left base',
            abnormal: true
        },
        percussion: {
            finding: 'Dull to percussion at left base',
            abnormal: true
        },
        auscultation: {
            finding: 'Decreased breath sounds at left base, bilateral crackles',
            abnormal: true
        }
    },
    heart: {
        inspection: {
            finding: 'No visible abnormalities',
            abnormal: false
        },
        palpation: {
            finding: 'Apex beat displaced laterally',
            abnormal: true
        },
        auscultation: {
            finding: 'S1 S2 present, S3 gallop heard, no murmurs',
            abnormal: true
        }
    },
    abdomen: {
        inspection: {
            finding: 'Soft, non-distended',
            abnormal: false
        },
        auscultation: {
            finding: 'Normal bowel sounds',
            abnormal: false
        },
        percussion: {
            finding: 'Tympanic',
            abnormal: false
        },
        palpation: {
            finding: 'Tender right upper quadrant, positive Murphy\'s sign',
            abnormal: true
        },
        special: {
            finding: 'Murphy\'s sign positive, no rebound tenderness',
            abnormal: true
        }
    },
    lowerLimbLeft: {
        inspection: {
            finding: 'Mild pitting edema to mid-calf',
            abnormal: true
        },
        palpation: {
            finding: '1+ pitting edema, pulses palpable but weak',
            abnormal: true
        },
        special: {
            finding: 'Power 5/5, sensation intact',
            abnormal: false
        }
    },
    lowerLimbRight: {
        inspection: {
            finding: 'Mild pitting edema to mid-calf',
            abnormal: true
        },
        palpation: {
            finding: '1+ pitting edema, pulses palpable but weak',
            abnormal: true
        },
        special: {
            finding: 'Power 5/5, sensation intact',
            abnormal: false
        }
    }
};

export default {
    EXAM_TECHNIQUES,
    BODY_REGIONS,
    getRegionsByView,
    getExamTypesForRegion,
    getDefaultFinding,
    generateEmptyPhysicalExam,
    SAMPLE_ABNORMAL_EXAM
};
