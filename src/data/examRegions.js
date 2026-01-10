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
