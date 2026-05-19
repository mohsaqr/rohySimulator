/**
 * Physical Examination Regions and Types Configuration
 * Defines body regions, available examination techniques, and default findings
 *
 * Default findings follow MRCP PACES clinical examination standards
 * with comprehensive, systematic documentation of normal findings
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
    },
    // Neurological examination techniques
    mentalStatus: {
        id: 'mentalStatus',
        name: 'Mental Status',
        icon: 'Brain',
        description: 'Higher mental functions, GCS, orientation, cognition'
    },
    cranialNerves: {
        id: 'cranialNerves',
        name: 'Cranial Nerves',
        icon: 'Eye',
        description: 'Examination of all 12 cranial nerves'
    },
    motor: {
        id: 'motor',
        name: 'Motor Examination',
        icon: 'Dumbbell',
        description: 'Tone, power, bulk, fasciculations'
    },
    sensory: {
        id: 'sensory',
        name: 'Sensory Examination',
        icon: 'Hand',
        description: 'Light touch, pinprick, vibration, proprioception'
    },
    reflexes: {
        id: 'reflexes',
        name: 'Reflexes',
        icon: 'Zap',
        description: 'Deep tendon and superficial reflexes'
    },
    coordination: {
        id: 'coordination',
        name: 'Coordination',
        icon: 'Target',
        description: 'Cerebellar function tests'
    },
    gait: {
        id: 'gait',
        name: 'Gait',
        icon: 'Footprints',
        description: 'Gait pattern and balance assessment'
    }
};

// Body region definitions with available exam types and MRCP-standard findings
export const BODY_REGIONS = {
    // Combined Head & Neck region (used by BodyMap)
    headNeck: {
        id: 'headNeck',
        name: 'Head & Neck',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'auscultation', 'special'],
        specialTests: ['Pupil reflex', 'Fundoscopy', 'JVP assessment', 'Lymph node exam', 'Thyroid exam'],
        defaultFindings: {
            inspection: 'Head is normocephalic and atraumatic. Face is symmetrical with no evidence of facial nerve palsy. No ptosis, proptosis, or xanthelasma. Conjunctivae are pink, sclerae are white with no icterus. No pallor of the mucous membranes. The trachea is central and not deviated. No visible goitre, masses, or scars in the neck. Jugular venous pressure is not elevated with a normal waveform.',
            palpation: 'No scalp tenderness or masses. Temporal arteries are non-tender and pulsatile bilaterally. Neck is supple with full range of movement. No cervical, supraclavicular, or axillary lymphadenopathy. Thyroid gland is not palpable and moves normally with swallowing. Trachea is central and mobile. Carotid pulses are equal bilaterally with normal character.',
            auscultation: 'No carotid bruits bilaterally. No thyroid bruit.',
            special: 'Pupils are equal, round, and reactive to light and accommodation (PERRLA). Direct and consensual light reflexes are intact. Extraocular movements are full without nystagmus. Jugular venous pressure is measured at 3 cm above the sternal angle at 45 degrees. Hepatojugular reflux is negative.'
        }
    },
    // Chest region (alias used by BodyMap)
    chest: {
        id: 'chest',
        name: 'Chest',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'percussion', 'auscultation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'Chest wall is symmetrical with no visible deformity. No scars, sinuses, or skin changes. Respiratory rate is 14 breaths per minute with a regular pattern. Chest expansion appears equal bilaterally. No use of accessory muscles of respiration. No paradoxical breathing pattern. No visible apex beat or precordial pulsations.',
            palpation: 'Chest expansion is equal bilaterally, measured at 5 cm. Tactile vocal fremitus is equal in all zones. Apex beat is located in the 5th intercostal space in the mid-clavicular line, non-displaced, and of normal character. No parasternal heave or thrills. No chest wall tenderness.',
            percussion: 'Percussion note is resonant throughout all lung zones bilaterally. Cardiac dullness is present in the normal distribution. Liver dullness begins at the 5th intercostal space in the right mid-clavicular line.',
            auscultation: 'Vesicular breath sounds are heard throughout all lung zones with no added sounds. No wheeze, crackles, or pleural rub. Vocal resonance is normal and symmetrical. Heart sounds S1 and S2 are present and of normal intensity. No additional heart sounds (S3, S4). No murmurs, rubs, or gallops. Heart rhythm is regular.'
        }
    },
    // Upper arm regions (used by BodyMap)
    upperArmLeft: {
        id: 'upperArmLeft',
        name: 'Left Upper Arm',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Biceps reflex', 'Power', 'Sensation'],
        defaultFindings: {
            inspection: 'No muscle wasting, fasciculations, or asymmetry. Skin is intact with no rashes, bruising, or track marks. No swelling or deformity. Normal muscle bulk and symmetry when compared to the contralateral side.',
            palpation: 'No tenderness on palpation. Normal muscle tone and bulk. Brachial pulse is palpable with normal character. Temperature is equal to the contralateral side. No lymphadenopathy in the epitrochlear region.',
            special: 'Biceps reflex (C5/6) is 2+ and symmetrical. Power testing: shoulder abduction (C5) 5/5, elbow flexion (C5/6) 5/5. Sensation to light touch and pinprick is intact in C5, C6 dermatomes.'
        }
    },
    upperArmRight: {
        id: 'upperArmRight',
        name: 'Right Upper Arm',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Biceps reflex', 'Power', 'Sensation'],
        defaultFindings: {
            inspection: 'No muscle wasting, fasciculations, or asymmetry. Skin is intact with no rashes, bruising, or track marks. No swelling or deformity. Normal muscle bulk and symmetry when compared to the contralateral side.',
            palpation: 'No tenderness on palpation. Normal muscle tone and bulk. Brachial pulse is palpable with normal character. Temperature is equal to the contralateral side. No lymphadenopathy in the epitrochlear region.',
            special: 'Biceps reflex (C5/6) is 2+ and symmetrical. Power testing: shoulder abduction (C5) 5/5, elbow flexion (C5/6) 5/5. Sensation to light touch and pinprick is intact in C5, C6 dermatomes.'
        }
    },
    // Pelvis region (used by BodyMap)
    pelvis: {
        id: 'pelvis',
        name: 'Pelvis',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Hernia exam', 'Hip ROM', 'FABER test'],
        defaultFindings: {
            inspection: 'No visible masses, asymmetry, or skin changes in the inguinal regions bilaterally. No erythema, swelling, or visible hernias. Genitalia appear normal for stated age and sex (examination deferred if not indicated).',
            palpation: 'Femoral pulses are 2+ and equal bilaterally with normal character. No inguinal lymphadenopathy. No femoral bruits on auscultation. No tenderness over the pubic symphysis or anterior superior iliac spines. Inguinal canals are intact with no palpable hernia at rest or on Valsalva maneuver.',
            special: 'No inguinal hernia demonstrated on standing with cough impulse testing. Hip range of motion: flexion 120 degrees, extension 30 degrees, abduction 45 degrees, adduction 30 degrees, internal rotation 40 degrees, external rotation 45 degrees bilaterally. FABER test (Patrick test) is negative bilaterally.'
        }
    },
    // Lower leg regions (used by BodyMap)
    lowerLegLeft: {
        id: 'lowerLegLeft',
        name: 'Left Lower Leg',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Sensation', 'Edema assessment'],
        defaultFindings: {
            inspection: 'No swelling, erythema, or skin discolouration. No varicose veins, venous eczema, or lipodermatosclerosis. Skin is intact with no ulceration. No muscle wasting. Hair distribution is normal.',
            palpation: 'Non-tender throughout. Temperature is warm and equal to contralateral side. Posterior tibial pulse is 2+ and palpable posterior to the medial malleolus. No pitting oedema. Calf is soft and non-tender. No palpable cord or thrombophlebitis.',
            special: 'Sensation is intact to light touch, pinprick, and vibration sense. Ankle reflex (S1/2) is 2+ and present. Capillary refill time is less than 2 seconds. Buerger test is negative. No pitting oedema demonstrated to sacrum level.'
        }
    },
    lowerLegRight: {
        id: 'lowerLegRight',
        name: 'Right Lower Leg',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Sensation', 'Edema assessment'],
        defaultFindings: {
            inspection: 'No swelling, erythema, or skin discolouration. No varicose veins, venous eczema, or lipodermatosclerosis. Skin is intact with no ulceration. No muscle wasting. Hair distribution is normal.',
            palpation: 'Non-tender throughout. Temperature is warm and equal to contralateral side. Posterior tibial pulse is 2+ and palpable posterior to the medial malleolus. No pitting oedema. Calf is soft and non-tender. No palpable cord or thrombophlebitis.',
            special: 'Sensation is intact to light touch, pinprick, and vibration sense. Ankle reflex (S1/2) is 2+ and present. Capillary refill time is less than 2 seconds. Buerger test is negative. No pitting oedema demonstrated to sacrum level.'
        }
    },

    // Anterior view regions
    head: {
        id: 'head',
        name: 'Head & Face',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pupil reflex', 'Fundoscopy', 'Facial symmetry'],
        defaultFindings: {
            inspection: 'Head is normocephalic and atraumatic. Face is symmetrical at rest and with movement. No evidence of upper or lower motor neuron facial weakness. Skin is intact with no rashes, lesions, or abnormal pigmentation. No xanthelasma, arcus senilis, or malar flush. Eyebrows are present and symmetrical. No ptosis, lid lag, or lid retraction.',
            palpation: 'Scalp is non-tender with no masses or depressions. Temporal arteries are palpable, non-tender, and pulsatile bilaterally with no beading or thickening. Sinuses (frontal and maxillary) are non-tender to palpation. TMJ moves smoothly without clicking or crepitus.',
            special: 'Pupils are equal at 3mm, round, and reactive to light (direct and consensual) and accommodation. Red reflex is present bilaterally. Fundoscopy: optic discs are pink with sharp margins, cup-to-disc ratio 0.3, no papilloedema, haemorrhages, or exudates. Spontaneous venous pulsation is present.'
        }
    },
    eyes: {
        id: 'eyes',
        name: 'Eyes',
        view: 'anterior',
        examTypes: ['inspection', 'special'],
        specialTests: ['Visual acuity', 'Visual fields', 'Pupil response', 'Fundoscopy'],
        defaultFindings: {
            inspection: 'Eyes are normally positioned within the orbits with no proptosis or enophthalmos. Conjunctivae are pink and non-injected. Sclerae are white with no icterus. Corneas are clear. No xanthelasma, arcus senilis, or ptosis. Eyelids close completely.',
            special: 'Visual acuity: 6/6 in both eyes (corrected). Visual fields are full to confrontation with no defects. Pupils are equal (3mm), round, and reactive to light and accommodation (PERRLA). Extraocular movements are full in all directions without diplopia or nystagmus. Cover test shows no strabismus. Fundoscopy: red reflex present, optic discs appear healthy with sharp margins, cup-to-disc ratio 0.3, vessels show normal arteriovenous ratio of 2:3, no haemorrhages, exudates, or macular pathology.'
        }
    },
    ears: {
        id: 'ears',
        name: 'Ears',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Otoscopy', 'Hearing test', 'Rinne', 'Weber'],
        defaultFindings: {
            inspection: 'External ears (pinnae) are normally formed and symmetrical. No skin lesions, tophi, or abnormalities. External auditory canals are patent with no discharge, erythema, or swelling.',
            palpation: 'Tragal tenderness is absent bilaterally. Pinnae are non-tender. Mastoid processes are non-tender bilaterally. No preauricular or postauricular lymphadenopathy.',
            special: 'Otoscopy: external auditory canals are clear with normal cerumen. Tympanic membranes are intact, grey, and translucent with visible cone of light and malleus. No perforation, retraction, or effusion. Gross hearing test: patient hears whispered voice at 60cm bilaterally. Rinne test: air conduction greater than bone conduction bilaterally (positive). Weber test: sound localises to midline (no lateralisation).'
        }
    },
    nose: {
        id: 'nose',
        name: 'Nose',
        view: 'anterior',
        examTypes: ['inspection', 'palpation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'External nose is midline with no deviation, deformity, or swelling. Nasal bridge is intact. Nares are patent bilaterally. Anterior rhinoscopy: nasal septum is midline with no deviation or perforation. Nasal mucosa is pink and moist with no polyps, discharge, or crusting. Inferior turbinates are visualised and not hypertrophied.',
            palpation: 'No tenderness over the nasal bridge or nasal bones. Frontal and maxillary sinuses are non-tender to palpation and percussion. No crepitus.'
        }
    },
    mouth: {
        id: 'mouth',
        name: 'Mouth & Throat',
        view: 'anterior',
        examTypes: ['inspection', 'special'],
        specialTests: ['Gag reflex', 'Tongue movement'],
        defaultFindings: {
            inspection: 'Lips are pink, moist, and without lesions, cyanosis, or angular stomatitis. Oral mucosa is pink, moist, and intact without ulceration, leukoplakia, or candidiasis. Teeth are in good repair (or edentulous with well-fitting dentures). Gums are pink without recession, inflammation, or bleeding. Tongue is midline, pink, moist, with normal papillation, no fasciculations, wasting, or deviation. Palate moves symmetrically. Uvula is midline and rises symmetrically with phonation. Tonsils are present and not enlarged (grade 1), with no exudate. Posterior pharynx is non-erythematous with no post-nasal drip.',
            special: 'Tongue protrudes in the midline with full range of movement (XII nerve intact). Gag reflex is present bilaterally (IX, X nerves intact). Palate elevates symmetrically with phonation. Voice is normal in quality with no hoarseness or nasal speech.'
        }
    },
    neck: {
        id: 'neck',
        name: 'Neck',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'auscultation', 'special'],
        specialTests: ['JVP assessment', 'Lymph node exam', 'Thyroid exam'],
        defaultFindings: {
            inspection: 'Neck is symmetrical with normal contour. Trachea appears central. No visible goitre, masses, scars, or swelling. No jugular venous distension visible with patient at 45 degrees. No prominent carotid pulsations. Skin is intact.',
            palpation: 'Trachea is palpable and central, mobile, and without tracheal tug. Cervical lymph nodes: systematic examination of submental, submandibular, pre-auricular, post-auricular, occipital, anterior cervical chain, posterior cervical chain, and supraclavicular nodes reveals no lymphadenopathy. Thyroid gland is not palpable at rest and with swallowing. No thyroid nodules or masses. Carotid pulses are equal bilaterally with normal upstroke.',
            auscultation: 'No carotid bruits bilaterally. No thyroid bruit.',
            special: 'Jugular venous pressure is 3 cm above the sternal angle at 45 degrees (normal). JVP waveform shows normal a and v waves. Hepatojugular reflux is negative. Thyroid moves with swallowing but is not enlarged. Pemberton sign is negative.'
        }
    },
    chestAnterior: {
        id: 'chestAnterior',
        name: 'Chest (Anterior)',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'percussion', 'auscultation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'Respiratory rate is 14 breaths per minute with a regular rhythm. Breathing pattern is normal with no evidence of respiratory distress. No use of accessory muscles (sternocleidomastoid, scalenes, intercostals). Chest wall is symmetrical with no deformities (pectus excavatum, pectus carinatum, barrel chest). No surgical scars, sinuses, or visible masses. Chest expansion appears equal bilaterally. No paradoxical movement. No visible apex beat.',
            palpation: 'Trachea is central. Chest expansion is equal bilaterally, measured at 5 cm at the nipple line. Tactile vocal fremitus is normal and symmetrical in all zones. Apex beat is located in the 5th left intercostal space at the mid-clavicular line, non-displaced, normal character, and area. No right ventricular heave. No thrills palpable in any area.',
            percussion: 'Percussion note is resonant in all lung zones bilaterally (comparing right to left). Liver dullness begins at the 6th intercostal space in the right mid-clavicular line. Cardiac dullness is present in the normal distribution. No stony dullness suggestive of effusion.',
            auscultation: 'Breath sounds: vesicular breath sounds are heard throughout all lung zones bilaterally. No bronchial breathing. Vocal resonance is normal and symmetrical. No added sounds: no wheeze, crackles (fine or coarse), pleural rub, or stridor. Heart sounds: S1 and S2 are present with normal intensity and splitting. No additional heart sounds (S3 or S4). No murmurs in any position. Regular rhythm. No pericardial rub.'
        }
    },
    heart: {
        id: 'heart',
        name: 'Heart (Precordium)',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'auscultation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'Precordium is of normal shape with no deformity. No visible apex beat or abnormal pulsations. No surgical scars (midline sternotomy, lateral thoracotomy). No pacemaker or ICD bulge. No visible carotid pulsations or jugular venous distension.',
            palpation: 'Apex beat is located in the 5th left intercostal space at the mid-clavicular line. Character is non-displaced, non-sustained, non-heaving, and confined to one fingertip area. No parasternal heave (right ventricular hypertrophy). No thrills palpable in any area (aortic, pulmonary, tricuspid, mitral). No palpable P2. Carotid pulse is normal in character with no delay.',
            auscultation: 'S1 is of normal intensity, heard best at the apex. S2 is of normal intensity with normal physiological splitting heard at the left upper sternal edge. No added sounds: no S3 (ventricular gallop), S4 (atrial gallop), opening snap, ejection click, or pericardial knock. No murmurs audible in any area (aortic, pulmonary, tricuspid, mitral) with patient in supine, left lateral, and sitting forward positions. No pericardial friction rub. Heart rhythm is regular at 72 beats per minute. Lung bases are clear to auscultation posteriorly.'
        }
    },
    abdomen: {
        id: 'abdomen',
        name: 'Abdomen',
        view: 'anterior',
        examTypes: ['inspection', 'auscultation', 'percussion', 'palpation', 'special'],
        specialTests: ["Murphy's sign", "Rovsing's sign", "McBurney's point", "Rebound tenderness", "Guarding"],
        defaultFindings: {
            inspection: 'Abdomen is flat and symmetrical with no visible distension. Umbilicus is centrally located and inverted. No surgical scars, striae, or visible peristalsis. No dilated veins (caput medusae) or skin lesions. Flanks are not full. No hernias visible at rest or on coughing. No visible masses or pulsations.',
            auscultation: 'Bowel sounds are present and normal in character (2-5 per minute) in all four quadrants. No high-pitched or tinkling bowel sounds. No bruits over the aorta (epigastric), renal arteries (para-umbilical), or femoral arteries.',
            percussion: 'Percussion note is tympanic throughout the abdomen. No shifting dullness demonstrated. Liver span is 10 cm in the right mid-clavicular line (upper border at 5th intercostal space, lower border at costal margin). Splenic dullness is present in the left lower chest, not extending anteriorly. Bladder is not percussible.',
            palpation: 'Abdomen is soft and non-tender in all nine regions on light palpation. No guarding or rigidity. On deep palpation: liver edge is not palpable below the costal margin. Spleen is not palpable. Both kidneys are not ballotable. Aorta is palpable and non-expansile (less than 3 cm). No masses palpable. Inguinal lymph nodes are not enlarged.',
            special: 'Murphy\'s sign is negative (no inspiratory arrest with palpation of the right upper quadrant). Rovsing\'s sign is negative. McBurney\'s point is non-tender. No rebound tenderness. No voluntary or involuntary guarding. Psoas sign is negative. Obturator sign is negative. Hernial orifices are intact with no cough impulse.'
        }
    },
    upperLimbLeft: {
        id: 'upperLimbLeft',
        name: 'Left Upper Limb',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Tone', 'Power', 'Reflexes', 'Sensation'],
        defaultFindings: {
            inspection: 'The left upper limb is normally positioned with no postural abnormality. No muscle wasting, fasciculations, or asymmetry compared to the right side. Joints are not swollen or deformed. Skin is intact with no rashes, nail changes (clubbing, koilonychia, splinter haemorrhages), or lesions. No tremor at rest or with arms outstretched. No pronator drift.',
            palpation: 'Temperature is warm and equal to the contralateral side. Radial pulse is 2+ and regular with normal character. Brachial pulse is palpable. No epitrochlear lymphadenopathy. Joints are non-tender with no synovitis. Normal muscle bulk and consistency.',
            special: 'Tone: normal tone throughout with no spasticity, rigidity, or hypotonia. Power (MRC grading): shoulder abduction C5 (5/5), elbow flexion C5/6 (5/5), elbow extension C7 (5/5), wrist extension C6/7 (5/5), finger extension C7 (5/5), finger flexion C8 (5/5), finger abduction T1 (5/5). Reflexes: biceps C5/6 (2+), supinator C5/6 (2+), triceps C7 (2+). Sensation: light touch, pinprick, vibration, and proprioception intact in all dermatomes (C5-T1). Coordination: finger-nose test is accurate with no intention tremor or past-pointing.'
        }
    },
    upperLimbRight: {
        id: 'upperLimbRight',
        name: 'Right Upper Limb',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Tone', 'Power', 'Reflexes', 'Sensation'],
        defaultFindings: {
            inspection: 'The right upper limb is normally positioned with no postural abnormality. No muscle wasting, fasciculations, or asymmetry compared to the left side. Joints are not swollen or deformed. Skin is intact with no rashes, nail changes (clubbing, koilonychia, splinter haemorrhages), or lesions. No tremor at rest or with arms outstretched. No pronator drift.',
            palpation: 'Temperature is warm and equal to the contralateral side. Radial pulse is 2+ and regular with normal character. Brachial pulse is palpable. No epitrochlear lymphadenopathy. Joints are non-tender with no synovitis. Normal muscle bulk and consistency.',
            special: 'Tone: normal tone throughout with no spasticity, rigidity, or hypotonia. Power (MRC grading): shoulder abduction C5 (5/5), elbow flexion C5/6 (5/5), elbow extension C7 (5/5), wrist extension C6/7 (5/5), finger extension C7 (5/5), finger flexion C8 (5/5), finger abduction T1 (5/5). Reflexes: biceps C5/6 (2+), supinator C5/6 (2+), triceps C7 (2+). Sensation: light touch, pinprick, vibration, and proprioception intact in all dermatomes (C5-T1). Coordination: finger-nose test is accurate with no intention tremor or past-pointing.'
        }
    },
    lowerLimbLeft: {
        id: 'lowerLimbLeft',
        name: 'Left Lower Limb',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Tone', 'Power', 'Reflexes', 'Sensation', 'Edema'],
        defaultFindings: {
            inspection: 'The left lower limb is normally aligned with no leg length discrepancy. No muscle wasting of quadriceps, hamstrings, or calf muscles. No fasciculations. Skin is intact with normal colour and hair distribution. No varicose veins, venous eczema, lipodermatosclerosis, or ulceration. Nails are normal with no fungal changes. Joints show no swelling or deformity.',
            palpation: 'Temperature is warm and equal to the contralateral side. Femoral pulse is 2+ and easily palpable. Popliteal pulse is 2+ (may require deep palpation). Dorsalis pedis pulse is 2+ on the dorsum of the foot. Posterior tibial pulse is 2+ behind the medial malleolus. No pitting oedema to the level of the sacrum. Calf is soft and non-tender. No palpable cord or varicosities.',
            special: 'Tone: normal tone with no spasticity, rigidity, clonus, or hypotonia. Power (MRC grading): hip flexion L1/2 (5/5), hip extension L5/S1 (5/5), knee extension L3/4 (5/5), knee flexion L5/S1 (5/5), ankle dorsiflexion L4/5 (5/5), ankle plantarflexion S1/2 (5/5), great toe extension L5 (5/5). Reflexes: knee L3/4 (2+), ankle S1/2 (2+), plantar response is flexor (downgoing). Sensation: light touch, pinprick, vibration (at great toe and medial malleolus), and proprioception (great toe) intact in all dermatomes (L2-S1). Coordination: heel-shin test is normal with no dysmetria.'
        }
    },
    lowerLimbRight: {
        id: 'lowerLimbRight',
        name: 'Right Lower Limb',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Pulses', 'Tone', 'Power', 'Reflexes', 'Sensation', 'Edema'],
        defaultFindings: {
            inspection: 'The right lower limb is normally aligned with no leg length discrepancy. No muscle wasting of quadriceps, hamstrings, or calf muscles. No fasciculations. Skin is intact with normal colour and hair distribution. No varicose veins, venous eczema, lipodermatosclerosis, or ulceration. Nails are normal with no fungal changes. Joints show no swelling or deformity.',
            palpation: 'Temperature is warm and equal to the contralateral side. Femoral pulse is 2+ and easily palpable. Popliteal pulse is 2+ (may require deep palpation). Dorsalis pedis pulse is 2+ on the dorsum of the foot. Posterior tibial pulse is 2+ behind the medial malleolus. No pitting oedema to the level of the sacrum. Calf is soft and non-tender. No palpable cord or varicosities.',
            special: 'Tone: normal tone with no spasticity, rigidity, clonus, or hypotonia. Power (MRC grading): hip flexion L1/2 (5/5), hip extension L5/S1 (5/5), knee extension L3/4 (5/5), knee flexion L5/S1 (5/5), ankle dorsiflexion L4/5 (5/5), ankle plantarflexion S1/2 (5/5), great toe extension L5 (5/5). Reflexes: knee L3/4 (2+), ankle S1/2 (2+), plantar response is flexor (downgoing). Sensation: light touch, pinprick, vibration (at great toe and medial malleolus), and proprioception (great toe) intact in all dermatomes (L2-S1). Coordination: heel-shin test is normal with no dysmetria.'
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
            inspection: 'Shoulder contour is normal and symmetrical. No muscle wasting of deltoid, supraspinatus, or infraspinatus muscles. No swelling, erythema, or deformity. Scapula sits flat against the chest wall with no winging. No scars.',
            palpation: 'No tenderness over the sternoclavicular joint, clavicle, acromioclavicular joint, acromion, or glenohumeral joint. No tenderness in the subacromial space or bicipital groove. Acromioclavicular joint is stable. No crepitus.',
            special: 'Active range of motion: forward flexion 180 degrees, extension 60 degrees, abduction 180 degrees, adduction 50 degrees, external rotation 90 degrees, internal rotation (hand behind back reaching T6). Passive range equals active. Painful arc negative. Rotator cuff: supraspinatus (empty can test) negative, infraspinatus (resisted external rotation) intact, subscapularis (lift-off test) negative. Neer and Hawkins impingement tests negative. Apprehension and relocation tests negative. Speed\'s test negative for biceps tendinopathy.'
        }
    },
    shoulderRight: {
        id: 'shoulderRight',
        name: 'Right Shoulder',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Range of motion', 'Rotator cuff tests', 'Apprehension test', 'Empty can test'],
        defaultFindings: {
            inspection: 'Shoulder contour is normal and symmetrical. No muscle wasting of deltoid, supraspinatus, or infraspinatus muscles. No swelling, erythema, or deformity. Scapula sits flat against the chest wall with no winging. No scars.',
            palpation: 'No tenderness over the sternoclavicular joint, clavicle, acromioclavicular joint, acromion, or glenohumeral joint. No tenderness in the subacromial space or bicipital groove. Acromioclavicular joint is stable. No crepitus.',
            special: 'Active range of motion: forward flexion 180 degrees, extension 60 degrees, abduction 180 degrees, adduction 50 degrees, external rotation 90 degrees, internal rotation (hand behind back reaching T6). Passive range equals active. Painful arc negative. Rotator cuff: supraspinatus (empty can test) negative, infraspinatus (resisted external rotation) intact, subscapularis (lift-off test) negative. Neer and Hawkins impingement tests negative. Apprehension and relocation tests negative. Speed\'s test negative for biceps tendinopathy.'
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
            inspection: 'Normal carrying angle (5-15 degrees of valgus). No swelling, erythema, nodules, or deformity. No surgical scars. Olecranon bursa is not distended. No rheumatoid nodules. Skin is intact.',
            palpation: 'No effusion (the triangle between lateral epicondyle, radial head, and olecranon is not distended). No tenderness over the lateral epicondyle (tennis elbow) or medial epicondyle (golfer\'s elbow). Olecranon is non-tender. Radial head is palpable and non-tender. No warmth. Elbow is stable to varus and valgus stress.',
            special: 'Active range of motion: flexion 150 degrees, extension 0 degrees (full), supination 90 degrees, pronation 90 degrees. Passive range equals active. Biceps reflex (C5/6) is 2+. Brachioradialis reflex (C6) is 2+. Cozen\'s test (resisted wrist extension) negative. Golfer\'s elbow test (resisted wrist flexion) negative.'
        }
    },
    elbowRight: {
        id: 'elbowRight',
        name: 'Right Elbow',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Range of motion', 'Biceps reflex', 'Brachioradialis reflex'],
        defaultFindings: {
            inspection: 'Normal carrying angle (5-15 degrees of valgus). No swelling, erythema, nodules, or deformity. No surgical scars. Olecranon bursa is not distended. No rheumatoid nodules. Skin is intact.',
            palpation: 'No effusion (the triangle between lateral epicondyle, radial head, and olecranon is not distended). No tenderness over the lateral epicondyle (tennis elbow) or medial epicondyle (golfer\'s elbow). Olecranon is non-tender. Radial head is palpable and non-tender. No warmth. Elbow is stable to varus and valgus stress.',
            special: 'Active range of motion: flexion 150 degrees, extension 0 degrees (full), supination 90 degrees, pronation 90 degrees. Passive range equals active. Biceps reflex (C5/6) is 2+. Brachioradialis reflex (C6) is 2+. Cozen\'s test (resisted wrist extension) negative. Golfer\'s elbow test (resisted wrist flexion) negative.'
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
            inspection: 'Forearm is of normal contour with no swelling, deformity, or wasting. Muscle bulk of flexor and extensor compartments appears normal and symmetrical. Skin is intact with no rashes, bruising, or track marks.',
            palpation: 'Forearm is non-tender throughout flexor and extensor compartments. Radial pulse is 2+ at the wrist. No compartment tension. Skin turgor is normal.'
        }
    },
    forearmRight: {
        id: 'forearmRight',
        name: 'Right Forearm',
        view: 'anterior',
        examTypes: ['inspection', 'palpation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'Forearm is of normal contour with no swelling, deformity, or wasting. Muscle bulk of flexor and extensor compartments appears normal and symmetrical. Skin is intact with no rashes, bruising, or track marks.',
            palpation: 'Forearm is non-tender throughout flexor and extensor compartments. Radial pulse is 2+ at the wrist. No compartment tension. Skin turgor is normal.'
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
            inspection: 'Hands are held in normal resting posture. No swelling, deformity, or wasting of thenar or hypothenar eminences. Interossei and lumbricals are not wasted. No Dupuytren\'s contracture. Skin is intact with no rashes, ulcers, or sclerodactyly. Nails are normal with no clubbing, koilonychia, splinter haemorrhages, or nail fold infarcts. No Heberden\'s or Bouchard\'s nodes. No swan neck or boutonniere deformities. No Z-thumb or ulnar drift.',
            palpation: 'Temperature is warm. Radial pulse is 2+ and ulnar pulse is palpable. All MCP, PIP, and DIP joints are non-tender with no synovitis or effusion. No thenar or hypothenar tenderness. Carpal tunnel (Tinel\'s test) is non-tender.',
            special: 'Grip strength is 5/5 and symmetrical. Pinch grip is intact. Fine motor function is normal (able to pick up small objects). Allen\'s test shows dual arterial supply with rapid capillary refill when either radial or ulnar artery is released. Phalen\'s test is negative. Tinel\'s test at carpal tunnel is negative. Finkelstein\'s test for de Quervain\'s is negative. Sensation to light touch is intact in median, ulnar, and radial nerve distributions.'
        }
    },
    handRight: {
        id: 'handRight',
        name: 'Right Hand',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Grip strength', 'Fine motor', 'Sensation', 'Allen test'],
        defaultFindings: {
            inspection: 'Hands are held in normal resting posture. No swelling, deformity, or wasting of thenar or hypothenar eminences. Interossei and lumbricals are not wasted. No Dupuytren\'s contracture. Skin is intact with no rashes, ulcers, or sclerodactyly. Nails are normal with no clubbing, koilonychia, splinter haemorrhages, or nail fold infarcts. No Heberden\'s or Bouchard\'s nodes. No swan neck or boutonniere deformities. No Z-thumb or ulnar drift.',
            palpation: 'Temperature is warm. Radial pulse is 2+ and ulnar pulse is palpable. All MCP, PIP, and DIP joints are non-tender with no synovitis or effusion. No thenar or hypothenar tenderness. Carpal tunnel (Tinel\'s test) is non-tender.',
            special: 'Grip strength is 5/5 and symmetrical. Pinch grip is intact. Fine motor function is normal (able to pick up small objects). Allen\'s test shows dual arterial supply with rapid capillary refill when either radial or ulnar artery is released. Phalen\'s test is negative. Tinel\'s test at carpal tunnel is negative. Finkelstein\'s test for de Quervain\'s is negative. Sensation to light touch is intact in median, ulnar, and radial nerve distributions.'
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
            inspection: 'Inguinal regions are symmetrical with no visible masses, bulges, or skin changes bilaterally. No erythema or swelling. No visible femoral pulsations. Scrotum appears normal (in males).',
            palpation: 'Femoral pulses are 2+ and equal bilaterally with normal character. No femoral bruits on auscultation. No inguinal lymphadenopathy (horizontal or vertical groups). Inguinal canals are examined with the patient standing: external ring admits fingertip but no hernia palpable. No cough impulse.',
            special: 'No indirect inguinal hernia: no impulse felt at the deep ring (midpoint of inguinal ligament) with cough. No direct inguinal hernia: no impulse felt through the posterior wall of the inguinal canal with cough. No femoral hernia: no mass or impulse inferior to the inguinal ligament. Scrotal examination unremarkable with normal testes bilaterally (if performed).'
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
            inspection: 'Thigh is of normal contour with no wasting of quadriceps or adductor muscles. No swelling, erythema, or skin changes. Circumference is symmetrical to the contralateral side. No fasciculations.',
            palpation: 'Quadriceps and hamstring muscles are non-tender with normal bulk and tone. Femoral pulse is 2+. No masses or lymphadenopathy in the inguinal region.',
            special: 'Power: hip flexion (iliopsoas L1/2) 5/5, hip extension (gluteus maximus L5/S1) 5/5, hip abduction (gluteus medius L4/5) 5/5, hip adduction (adductors L2/3) 5/5, knee extension (quadriceps L3/4) 5/5. Sensation intact to light touch and pinprick in L2, L3 dermatomes.'
        }
    },
    thighRight: {
        id: 'thighRight',
        name: 'Right Thigh',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Muscle strength', 'Sensation'],
        defaultFindings: {
            inspection: 'Thigh is of normal contour with no wasting of quadriceps or adductor muscles. No swelling, erythema, or skin changes. Circumference is symmetrical to the contralateral side. No fasciculations.',
            palpation: 'Quadriceps and hamstring muscles are non-tender with normal bulk and tone. Femoral pulse is 2+. No masses or lymphadenopathy in the inguinal region.',
            special: 'Power: hip flexion (iliopsoas L1/2) 5/5, hip extension (gluteus maximus L5/S1) 5/5, hip abduction (gluteus medius L4/5) 5/5, hip adduction (adductors L2/3) 5/5, knee extension (quadriceps L3/4) 5/5. Sensation intact to light touch and pinprick in L2, L3 dermatomes.'
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
            inspection: 'Normal alignment with no varus or valgus deformity. No swelling, erythema, or effusion. Quadriceps bulk is normal with no wasting. Patella is centrally located. No scars. Gait is normal.',
            palpation: 'No warmth compared to contralateral side. No joint line tenderness (medial or lateral). Patella is non-tender with no crepitus on movement. No popliteal fossa mass (Baker\'s cyst). No effusion: patellar tap is negative, and bulge test is negative.',
            special: 'Active range of motion: flexion 140 degrees, extension 0 degrees (full). Passive range equals active. Knee reflex (L3/4) is 2+ and symmetrical. Ligament testing: anterior drawer test negative (ACL), posterior drawer test negative (PCL), Lachman test negative (ACL), valgus stress test negative at 0 and 30 degrees (MCL), varus stress test negative at 0 and 30 degrees (LCL). Meniscal testing: McMurray test negative, Apley grind test negative. Patellofemoral: no apprehension, Clarke\'s test negative.'
        }
    },
    kneeRight: {
        id: 'kneeRight',
        name: 'Right Knee',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Patellar reflex', 'Range of motion', 'Drawer test', 'McMurray test', 'Valgus/Varus stress'],
        defaultFindings: {
            inspection: 'Normal alignment with no varus or valgus deformity. No swelling, erythema, or effusion. Quadriceps bulk is normal with no wasting. Patella is centrally located. No scars. Gait is normal.',
            palpation: 'No warmth compared to contralateral side. No joint line tenderness (medial or lateral). Patella is non-tender with no crepitus on movement. No popliteal fossa mass (Baker\'s cyst). No effusion: patellar tap is negative, and bulge test is negative.',
            special: 'Active range of motion: flexion 140 degrees, extension 0 degrees (full). Passive range equals active. Knee reflex (L3/4) is 2+ and symmetrical. Ligament testing: anterior drawer test negative (ACL), posterior drawer test negative (PCL), Lachman test negative (ACL), valgus stress test negative at 0 and 30 degrees (MCL), varus stress test negative at 0 and 30 degrees (LCL). Meniscal testing: McMurray test negative, Apley grind test negative. Patellofemoral: no apprehension, Clarke\'s test negative.'
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
            inspection: 'Normal ankle alignment with no swelling, deformity, or skin changes. Medial and lateral malleoli are symmetrical. No erythema or effusion. Skin is intact with no ulceration.',
            palpation: 'No tenderness over medial malleolus, lateral malleolus, or anterior joint line. Posterior tibial pulse is 2+ behind the medial malleolus. Dorsalis pedis pulse is 2+ on dorsum of foot. Achilles tendon is intact and non-tender. No warmth.',
            special: 'Active range of motion: dorsiflexion 20 degrees, plantarflexion 50 degrees, inversion 30 degrees, eversion 20 degrees. Passive range equals active. Ankle is stable: anterior drawer test negative (ATFL), talar tilt test negative. Achilles reflex (S1/2) is 2+. Thompson test negative (Achilles intact).'
        }
    },
    ankleRight: {
        id: 'ankleRight',
        name: 'Right Ankle',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Range of motion', 'Drawer test', 'Achilles reflex'],
        defaultFindings: {
            inspection: 'Normal ankle alignment with no swelling, deformity, or skin changes. Medial and lateral malleoli are symmetrical. No erythema or effusion. Skin is intact with no ulceration.',
            palpation: 'No tenderness over medial malleolus, lateral malleolus, or anterior joint line. Posterior tibial pulse is 2+ behind the medial malleolus. Dorsalis pedis pulse is 2+ on dorsum of foot. Achilles tendon is intact and non-tender. No warmth.',
            special: 'Active range of motion: dorsiflexion 20 degrees, plantarflexion 50 degrees, inversion 30 degrees, eversion 20 degrees. Passive range equals active. Ankle is stable: anterior drawer test negative (ATFL), talar tilt test negative. Achilles reflex (S1/2) is 2+. Thompson test negative (Achilles intact).'
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
            inspection: 'Foot is normally aligned with maintained medial longitudinal arch. No pes planus or pes cavus. Toes are straight with no clawing, hammer toes, or hallux valgus. Skin is intact with no ulceration, calluses, or fissures. Nails are normal with no onychomycosis or ingrowing. No interdigital maceration. Hair distribution is normal.',
            palpation: 'Dorsalis pedis pulse is 2+ on the dorsum between 1st and 2nd metatarsals. Posterior tibial pulse is 2+ behind the medial malleolus. Foot is warm with capillary refill less than 2 seconds. No tenderness over metatarsal heads, midfoot, or plantar fascia. No interdigital tenderness (Morton\'s neuroma).',
            special: 'Sensation: 10g monofilament testing positive at all standard sites (great toe, 1st, 3rd, 5th metatarsal heads, heel). Vibration sense intact at great toe (128 Hz tuning fork). Proprioception intact at great toe. Plantar reflex is flexor (downgoing). Simmond\'s test negative (Achilles intact).'
        }
    },
    footRight: {
        id: 'footRight',
        name: 'Right Foot',
        view: 'anterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Sensation', 'Pulses', 'Plantar reflex'],
        defaultFindings: {
            inspection: 'Foot is normally aligned with maintained medial longitudinal arch. No pes planus or pes cavus. Toes are straight with no clawing, hammer toes, or hallux valgus. Skin is intact with no ulceration, calluses, or fissures. Nails are normal with no onychomycosis or ingrowing. No interdigital maceration. Hair distribution is normal.',
            palpation: 'Dorsalis pedis pulse is 2+ on the dorsum between 1st and 2nd metatarsals. Posterior tibial pulse is 2+ behind the medial malleolus. Foot is warm with capillary refill less than 2 seconds. No tenderness over metatarsal heads, midfoot, or plantar fascia. No interdigital tenderness (Morton\'s neuroma).',
            special: 'Sensation: 10g monofilament testing positive at all standard sites (great toe, 1st, 3rd, 5th metatarsal heads, heel). Vibration sense intact at great toe (128 Hz tuning fork). Proprioception intact at great toe. Plantar reflex is flexor (downgoing). Simmond\'s test negative (Achilles intact).'
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
            inspection: 'Spine is straight with no scoliosis or kyphosis. Shoulders are level. Scapulae are symmetrically positioned with no winging. No muscle wasting. Skin is intact with no rashes, lesions, or scars.',
            palpation: 'No tenderness over cervical or thoracic spinous processes. Paraspinal muscles are non-tender and symmetrical. No step deformity. Trapezius and rhomboid muscles are non-tender.',
            percussion: 'Percussion note is resonant over both lung fields posteriorly. No dullness suggesting consolidation or effusion.',
            auscultation: 'Vesicular breath sounds heard throughout both lung fields posteriorly. No added sounds: no crackles, wheeze, or pleural rub. Vocal resonance is normal and symmetrical.'
        }
    },
    backLower: {
        id: 'backLower',
        name: 'Lower Back (Lumbar)',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'percussion', 'special'],
        specialTests: ['CVA tenderness', 'Straight leg raise', 'Spinal ROM'],
        defaultFindings: {
            inspection: 'Normal lumbar lordosis is preserved. No scoliosis or list. Paraspinal muscles are symmetrical with no wasting or spasm. Skin is intact with no hairy patch, dimple, or lipoma over the spine (dysraphism). No scars.',
            palpation: 'No tenderness over lumbar spinous processes (L1-L5) or sacroiliac joints. Paraspinal muscles are non-tender with no spasm. Sciatic notch is non-tender bilaterally.',
            percussion: 'Costophrenic angle (CVA) tenderness is absent bilaterally. Percussion over the spine is non-tender.',
            special: 'Spinal range of motion: flexion (fingertips reach mid-tibia), extension 30 degrees, lateral flexion 30 degrees bilaterally, rotation 45 degrees bilaterally. Schober\'s test: greater than 5 cm expansion (normal lumbar flexion). Straight leg raise: negative bilaterally at 80 degrees with no radicular pain. Crossed straight leg raise negative. Femoral stretch test negative. Sacroiliac joint stress tests (FABER, Gaenslen\'s) negative.'
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
            inspection: 'Left scapula is normally positioned at T2-T7 level, 5 cm from the midline. No winging at rest or with forward arm flexion against resistance. Scapulohumeral rhythm is normal. No muscle wasting of supraspinatus, infraspinatus, or serratus anterior.',
            palpation: 'No tenderness over the scapular spine, medial border, or inferior angle. Supraspinatus and infraspinatus fossae are non-tender. Rhomboid muscles are non-tender.',
            auscultation: 'Breath sounds are vesicular and equal at the left lung base. No added sounds.'
        }
    },
    scapulaRight: {
        id: 'scapulaRight',
        name: 'Right Scapula',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'auscultation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'Right scapula is normally positioned at T2-T7 level, 5 cm from the midline. No winging at rest or with forward arm flexion against resistance. Scapulohumeral rhythm is normal. No muscle wasting of supraspinatus, infraspinatus, or serratus anterior.',
            palpation: 'No tenderness over the scapular spine, medial border, or inferior angle. Supraspinatus and infraspinatus fossae are non-tender. Rhomboid muscles are non-tender.',
            auscultation: 'Breath sounds are vesicular and equal at the right lung base. No added sounds.'
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
            inspection: 'Gluteal contour is normal and symmetrical. No muscle wasting or asymmetry. Skin is intact with no rashes, sinuses, or scars. Natal cleft is midline.',
            palpation: 'Gluteus maximus, medius, and minimus are non-tender. Greater trochanter is non-tender. Sciatic notch is non-tender. No palpable masses.',
            special: 'Piriformis test (FAIR test) is negative with no reproduction of sciatic symptoms. Hip internal rotation in flexion does not provoke pain. Sciatic nerve is not irritable to palpation at the sciatic notch. Trendelenburg test negative (pelvis remains level on single leg stance).'
        }
    },
    buttockRight: {
        id: 'buttockRight',
        name: 'Right Buttock / Gluteal',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Piriformis test', 'Sciatic nerve assessment'],
        defaultFindings: {
            inspection: 'Gluteal contour is normal and symmetrical. No muscle wasting or asymmetry. Skin is intact with no rashes, sinuses, or scars. Natal cleft is midline.',
            palpation: 'Gluteus maximus, medius, and minimus are non-tender. Greater trochanter is non-tender. Sciatic notch is non-tender. No palpable masses.',
            special: 'Piriformis test (FAIR test) is negative with no reproduction of sciatic symptoms. Hip internal rotation in flexion does not provoke pain. Sciatic nerve is not irritable to palpation at the sciatic notch. Trendelenburg test negative (pelvis remains level on single leg stance).'
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
            inspection: 'Sacrum is midline with normal contour. Skin is intact with no pressure sores, sinuses, dimples, or hairy patches. No sacral oedema.',
            palpation: 'Sacrum is non-tender to palpation. Sacroiliac joints are non-tender bilaterally. Coccyx is non-tender. No step deformity or bony abnormality.',
            percussion: 'Percussion over the sacrum is non-tender. No evidence of sacral oedema (pitting).'
        }
    },

    // Popliteal fossa regions (back of knee)
    poplitealLeft: {
        id: 'poplitealLeft',
        name: 'Left Popliteal Fossa',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'auscultation', 'special'],
        specialTests: ['Popliteal pulse', 'Baker cyst assessment'],
        defaultFindings: {
            inspection: 'Popliteal fossa is of normal contour with no visible swelling or masses. No varicose veins. Skin is intact.',
            palpation: 'Popliteal pulse is 2+ (palpable with deep pressure in the centre of the fossa with knee slightly flexed). No popliteal aneurysm (non-expansile). No Baker\'s cyst (no fluctuant mass). Popliteal fossa is non-tender.',
            auscultation: 'No bruit over the popliteal artery.',
            special: 'Popliteal pulse is 2+ and symmetrical, best felt with the knee slightly flexed and the patient relaxed. No popliteal aneurysm (pulse is non-expansile). Baker\'s cyst assessment: no fluctuant or tense mass in the medial popliteal fossa; no Foucher\'s sign; cyst does not become more prominent on knee extension.'
        }
    },
    poplitealRight: {
        id: 'poplitealRight',
        name: 'Right Popliteal Fossa',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'auscultation', 'special'],
        specialTests: ['Popliteal pulse', 'Baker cyst assessment'],
        defaultFindings: {
            inspection: 'Popliteal fossa is of normal contour with no visible swelling or masses. No varicose veins. Skin is intact.',
            palpation: 'Popliteal pulse is 2+ (palpable with deep pressure in the centre of the fossa with knee slightly flexed). No popliteal aneurysm (non-expansile). No Baker\'s cyst (no fluctuant mass). Popliteal fossa is non-tender.',
            auscultation: 'No bruit over the popliteal artery.',
            special: 'Popliteal pulse is 2+ and symmetrical, best felt with the knee slightly flexed and the patient relaxed. No popliteal aneurysm (pulse is non-expansile). Baker\'s cyst assessment: no fluctuant or tense mass in the medial popliteal fossa; no Foucher\'s sign; cyst does not become more prominent on knee extension.'
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
            inspection: 'Calf is of normal contour and symmetrical to the contralateral side (measured circumference equal within 1 cm). No swelling, erythema, or discolouration. No varicose veins or superficial thrombophlebitis. Skin is intact with no ulceration.',
            palpation: 'Calf is soft, non-tender, and non-indurated. Gastrocnemius and soleus muscles are non-tender. No palpable cord suggesting superficial thrombophlebitis. Temperature is equal to contralateral side.',
            special: 'Homan\'s sign: passive dorsiflexion of the ankle does not cause calf pain (note: low sensitivity for DVT). Calf squeeze test is non-tender. Thompson\'s test (Simmonds\' test): squeezing the calf produces plantar flexion at the ankle, indicating intact Achilles tendon.'
        }
    },
    calfRight: {
        id: 'calfRight',
        name: 'Right Calf',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Homan sign', 'Calf squeeze', 'Thompson test'],
        defaultFindings: {
            inspection: 'Calf is of normal contour and symmetrical to the contralateral side (measured circumference equal within 1 cm). No swelling, erythema, or discolouration. No varicose veins or superficial thrombophlebitis. Skin is intact with no ulceration.',
            palpation: 'Calf is soft, non-tender, and non-indurated. Gastrocnemius and soleus muscles are non-tender. No palpable cord suggesting superficial thrombophlebitis. Temperature is equal to contralateral side.',
            special: 'Homan\'s sign: passive dorsiflexion of the ankle does not cause calf pain (note: low sensitivity for DVT). Calf squeeze test is non-tender. Thompson\'s test (Simmonds\' test): squeezing the calf produces plantar flexion at the ankle, indicating intact Achilles tendon.'
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
            inspection: 'Achilles tendon is visible and of normal contour. No swelling, nodularity (xanthomata), or obvious gap. Heel alignment is normal (no valgus or varus).',
            palpation: 'Achilles tendon is palpable, intact, and non-tender throughout its length from calcaneal insertion to musculotendinous junction. No nodules, thickening, or crepitus. Retrocalcaneal bursa is non-tender.',
            special: 'Achilles (ankle) reflex (S1/2) is 2+ and symmetrical. Thompson\'s test (Simmonds\' test) is negative: squeezing the calf produces plantar flexion, confirming tendon continuity.'
        }
    },
    achillesRight: {
        id: 'achillesRight',
        name: 'Right Achilles Tendon',
        view: 'posterior',
        examTypes: ['inspection', 'palpation', 'special'],
        specialTests: ['Achilles reflex', 'Thompson test'],
        defaultFindings: {
            inspection: 'Achilles tendon is visible and of normal contour. No swelling, nodularity (xanthomata), or obvious gap. Heel alignment is normal (no valgus or varus).',
            palpation: 'Achilles tendon is palpable, intact, and non-tender throughout its length from calcaneal insertion to musculotendinous junction. No nodules, thickening, or crepitus. Retrocalcaneal bursa is non-tender.',
            special: 'Achilles (ankle) reflex (S1/2) is 2+ and symmetrical. Thompson\'s test (Simmonds\' test) is negative: squeezing the calf produces plantar flexion, confirming tendon continuity.'
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
            inspection: 'Heel is normally aligned with no valgus or varus deformity. Skin is intact with no ulceration, fissures, or calluses. No swelling.',
            palpation: 'Calcaneus is non-tender to squeeze test. Plantar fascia insertion at the medial calcaneal tubercle is non-tender. Posterior heel (Achilles insertion) is non-tender. No subcutaneous nodules.'
        }
    },
    heelRight: {
        id: 'heelRight',
        name: 'Right Heel',
        view: 'posterior',
        examTypes: ['inspection', 'palpation'],
        specialTests: [],
        defaultFindings: {
            inspection: 'Heel is normally aligned with no valgus or varus deformity. Skin is intact with no ulceration, fissures, or calluses. No swelling.',
            palpation: 'Calcaneus is non-tender to squeeze test. Plantar fascia insertion at the medial calcaneal tubercle is non-tender. Posterior heel (Achilles insertion) is non-tender. No subcutaneous nodules.'
        }
    },

    // Special examination systems
    neurological: {
        id: 'neurological',
        name: 'Neurological Examination',
        view: 'special',
        // `special` MUST be present whenever `specialTests` is non-empty:
        // ExamTypeSelector renders the chips off `specialTests` and fires
        // exam type `special`, while the editor only exposes a configurable
        // field for entries in `examTypes`. Omitting it (Bug 15, 18.5.2026)
        // made the neuro special tests unconfigurable yet still clickable,
        // so students got the literal "Not examined".
        examTypes: ['mentalStatus', 'cranialNerves', 'motor', 'sensory', 'reflexes', 'coordination', 'gait', 'special'],
        specialTests: [
            'Romberg test', 'Pronator drift', 'Babinski sign', 'Hoffmann sign',
            'Lhermitte sign', 'Kernig sign', 'Brudzinski sign'
        ],
        defaultFindings: {
            mentalStatus: `Glasgow Coma Scale: 15/15 (E4 V5 M6) - Eyes open spontaneously, oriented verbal response, obeys commands.

Orientation: Alert and fully oriented to person (knows own name and identity), place (knows current location), time (knows date, day, month, year), and situation (understands why they are being examined).

Attention: Able to spell "WORLD" backwards correctly (D-L-R-O-W). Serial 7s performed accurately (100, 93, 86, 79, 72). Digit span forward 7 digits, backward 5 digits.

Speech and Language:
- Fluency: Speech is fluent with normal rate, rhythm, and prosody
- Comprehension: Follows simple and complex commands appropriately
- Repetition: Accurately repeats "No ifs, ands, or buts"
- Naming: Names common objects (pen, watch, glasses) correctly
- Reading: Reads written commands accurately
- Writing: Writes a grammatically correct sentence

Memory:
- Immediate recall: Registers 3/3 objects (apple, table, penny)
- Short-term memory: Recalls 3/3 objects after 5 minutes
- Long-term memory: Recalls past medical history, personal events appropriately

Higher Cognitive Functions:
- Praxis: Able to demonstrate use of common objects, no apraxia
- Visuospatial: Clock drawing test normal (numbers correctly placed, hands pointing to 11:10)
- Calculations: Simple arithmetic intact
- Abstraction: Interprets proverbs appropriately`,

            cranialNerves: `CN I (Olfactory): Not formally tested (no subjective anosmia reported).

CN II (Optic):
- Visual acuity: 6/6 right eye, 6/6 left eye (with correction if worn)
- Visual fields: Full to confrontation in all four quadrants bilaterally. No field defects, neglect, or extinction to double simultaneous stimulation
- Pupils: Equal at 3mm diameter, round, regular. Direct light reflex brisk bilaterally. Consensual light reflex intact. No relative afferent pupillary defect (RAPD/Marcus Gunn pupil)
- Accommodation reflex: Intact with pupillary constriction and convergence on near focus
- Fundoscopy: Red reflex present. Optic discs pink with sharp margins, cup-to-disc ratio 0.3. No papilloedema. Vessels show normal arteriole-to-venule ratio with no AV nipping, silver wiring, or haemorrhages. Macula normal

CN III, IV, VI (Oculomotor, Trochlear, Abducens):
- Extraocular movements: Full range in all directions of gaze (up, down, left, right, and oblique movements)
- No nystagmus in primary gaze or on lateral gaze
- No diplopia reported in any direction
- No ptosis or lid lag
- Smooth pursuit and saccades normal

CN V (Trigeminal):
- Sensory: Light touch and pinprick sensation intact and equal in V1 (forehead), V2 (cheek), V3 (jaw) distributions bilaterally
- Motor: Masseter and temporalis muscles contract symmetrically with jaw clench. Jaw opens in midline against resistance
- Corneal reflex: Present bilaterally (tests V1 sensory and VII motor)
- Jaw jerk: Present and not exaggerated (1+)

CN VII (Facial):
- At rest: Face symmetrical, no facial droop, nasolabial folds equal
- Motor upper face: Forehead wrinkles symmetrically, eyebrows raise equally, able to close eyes tightly against resistance bilaterally
- Motor lower face: Symmetrical smile, able to puff cheeks, show teeth, and purse lips equally
- Taste: Not formally tested (no subjective dysgeusia)

CN VIII (Vestibulocochlear):
- Hearing: Grossly intact bilaterally to finger rub and whispered voice at 60cm
- Rinne test: Positive bilaterally (air conduction > bone conduction = normal)
- Weber test: Localizes to midline (no lateralization)
- No nystagmus, vertigo, or balance disturbance

CN IX, X (Glossopharyngeal, Vagus):
- Voice: Normal quality, no hoarseness, dysarthria, or nasal speech
- Palate: Uvula central at rest. Palate elevates symmetrically with phonation ("Ahh")
- Gag reflex: Present bilaterally (touch posterior pharynx → contraction)
- Swallowing: No dysphagia or nasal regurgitation reported
- Cough: Strong and effective

CN XI (Accessory):
- Sternocleidomastoid: Power 5/5 bilaterally for head turn against resistance
- Trapezius: Power 5/5 bilaterally for shoulder shrug against resistance. No wasting or asymmetry

CN XII (Hypoglossal):
- At rest: Tongue lies centrally in floor of mouth, no wasting or fasciculations
- Protrusion: Tongue protrudes in midline, no deviation
- Movement: Full range of movement side-to-side and up-down
- Power: Normal tongue strength against cheek bilaterally`,

            motor: `Inspection:
- No muscle wasting or asymmetry of limbs
- No fasciculations at rest or on percussion
- No abnormal movements (tremor, chorea, athetosis, dystonia, myoclonus)

Tone - Upper Limbs:
- Right arm: Normal tone at shoulder, elbow, and wrist. No spasticity (clasp-knife), rigidity (lead-pipe or cogwheel), or hypotonia
- Left arm: Normal tone at shoulder, elbow, and wrist. No spasticity, rigidity, or hypotonia

Tone - Lower Limbs:
- Right leg: Normal tone at hip, knee, and ankle. No spasticity, rigidity, or hypotonia
- Left leg: Normal tone at hip, knee, and ankle. No spasticity, rigidity, or hypotonia

Power (MRC Scale 0-5) - Upper Limbs:
Right | Left
- Shoulder abduction (C5, deltoid): 5/5 | 5/5
- Shoulder adduction (C5-7, pectorals): 5/5 | 5/5
- Elbow flexion (C5/6, biceps): 5/5 | 5/5
- Elbow extension (C7/8, triceps): 5/5 | 5/5
- Wrist extension (C6/7, radial n.): 5/5 | 5/5
- Wrist flexion (C7/8, median/ulnar): 5/5 | 5/5
- Finger extension (C7, posterior interosseous): 5/5 | 5/5
- Finger flexion (C8, median/ulnar): 5/5 | 5/5
- Finger abduction (T1, ulnar n.): 5/5 | 5/5
- Thumb abduction (T1, median n.): 5/5 | 5/5

Power (MRC Scale 0-5) - Lower Limbs:
Right | Left
- Hip flexion (L1/2, iliopsoas): 5/5 | 5/5
- Hip extension (L5/S1, gluteus max.): 5/5 | 5/5
- Hip abduction (L4/5, gluteus med.): 5/5 | 5/5
- Knee flexion (L5/S1, hamstrings): 5/5 | 5/5
- Knee extension (L3/4, quadriceps): 5/5 | 5/5
- Ankle dorsiflexion (L4/5, tibialis ant.): 5/5 | 5/5
- Ankle plantarflexion (S1/2, gastrocnemius): 5/5 | 5/5
- Great toe extension (L5, EHL): 5/5 | 5/5

Pronator Drift Test: Arms held outstretched with palms up for 20 seconds - no drift, pronation, or downward movement of either arm. Eyes open and closed both negative.`,

            sensory: `Light Touch (cotton wool):
- Upper limbs: Intact in C5 (lateral arm), C6 (lateral forearm, thumb), C7 (middle finger), C8 (little finger, medial forearm), T1 (medial arm) dermatomes bilaterally
- Lower limbs: Intact in L2 (anterior thigh), L3 (medial knee), L4 (medial calf), L5 (lateral calf, dorsum of foot), S1 (lateral foot, sole) dermatomes bilaterally
- Trunk: Intact across all thoracic dermatomes T2-T12 bilaterally

Pinprick (sharp/dull discrimination):
- Upper limbs: Intact and equal in all dermatomes bilaterally. Able to distinguish sharp from dull
- Lower limbs: Intact and equal in all dermatomes bilaterally. Able to distinguish sharp from dull
- No sensory level identified

Temperature: Not formally tested (intact pinprick suggests intact spinothalamic function)

Vibration Sense (128 Hz tuning fork):
- Upper limbs: Intact at distal interphalangeal joints of index fingers bilaterally
- Lower limbs: Intact at interphalangeal joint of great toe, medial malleolus, and tibial tuberosity bilaterally
- No reduction in vibration perception

Joint Position Sense (Proprioception):
- Upper limbs: Able to accurately detect small movements of distal interphalangeal joint of index finger bilaterally with eyes closed
- Lower limbs: Able to accurately detect small movements of interphalangeal joint of great toe bilaterally with eyes closed

Romberg Test: Negative. Patient stands steadily with feet together and eyes closed for 30 seconds without significant sway or loss of balance.

Two-Point Discrimination: Normal at fingertips (< 5mm)

Stereognosis: Able to identify common objects (coin, key, paper clip) by touch with eyes closed

Graphesthesia: Correctly identifies numbers traced on palm`,

            reflexes: `Deep Tendon Reflexes (graded 0-4):
0 = Absent, 1+ = Diminished, 2+ = Normal, 3+ = Brisk, 4+ = Clonus

Upper Limb Reflexes:
                        Right | Left
- Biceps (C5/6):         2+  |  2+
- Brachioradialis (C6):  2+  |  2+
- Triceps (C7):          2+  |  2+
- Finger flexors (C8):   2+  |  2+

Lower Limb Reflexes:
                        Right | Left
- Knee/Patellar (L3/4):  2+  |  2+
- Ankle (S1/2):          2+  |  2+

Reflex spread or crossed adductors: Absent

Hoffmann's Sign: Negative bilaterally (flicking distal phalanx of middle finger does not cause thumb/index finger flexion)

Plantar Response (Babinski):
- Right: Flexor (downgoing great toe) - Normal
- Left: Flexor (downgoing great toe) - Normal
- No fanning of toes

Clonus:
- Ankle: Absent bilaterally (< 3 beats on rapid dorsiflexion)
- Patellar: Absent bilaterally
- No sustained clonus

Superficial Reflexes:
- Abdominal reflexes (T7-T12): Present in all four quadrants
- Cremasteric reflex (L1/2): Present bilaterally (if male)

Jaw Jerk (CN V): Present but not exaggerated (1+), consistent with normal upper motor neuron function

Primitive Reflexes: Absent (no palmomental, grasp, snout, or glabellar tap)`,

            coordination: `Upper Limb Coordination:

Finger-Nose Test:
- Right: Performed smoothly with accurate targeting. No intention tremor, past-pointing, or dysmetria on repeated testing
- Left: Performed smoothly with accurate targeting. No intention tremor, past-pointing, or dysmetria on repeated testing

Finger-Nose-Finger Test:
- Right: Accurate with smooth trajectory between targets
- Left: Accurate with smooth trajectory between targets

Rapid Alternating Movements (Dysdiadochokinesia):
- Right: Rapid pronation-supination of forearm is smooth and regular
- Left: Rapid pronation-supination of forearm is smooth and regular
- No irregular rhythm or breakdown of movement

Fine Finger Movements:
- Rapid finger tapping and sequential finger opposition performed normally bilaterally

Rebound Test:
- No excessive rebound when arm is suddenly released, suggesting normal cerebellar check function

Lower Limb Coordination:

Heel-Shin Test:
- Right: Heel placed accurately on opposite knee and slides smoothly down shin to ankle without deviation
- Left: Heel placed accurately on opposite knee and slides smoothly down shin to ankle without deviation

Toe-Finger Test:
- Right: Accurate targeting of examiner's finger with great toe
- Left: Accurate targeting of examiner's finger with great toe

Rapid Foot Tapping:
- Both feet tap the floor rapidly and rhythmically

Truncal Ataxia: Absent. Patient sits unsupported with stable trunk.

Tandem Walking: See Gait section

Nystagmus Assessment: No nystagmus in primary gaze or on sustained lateral gaze (excluding physiological end-point nystagmus)`,

            gait: `Observation of Gait:
- Initiation: Normal, no hesitancy or freezing
- Base: Normal stance width (not broad-based)
- Stride: Normal length, equal bilaterally
- Arm swing: Present and symmetrical
- Posture: Upright, no stooped or leaning posture
- Fluidity: Smooth, coordinated movements throughout gait cycle
- Turning: Performed smoothly without loss of balance or requiring multiple steps

Heel Walking:
- Able to walk on heels for 10 steps maintaining balance (tests L4/5 dorsiflexors)

Toe Walking:
- Able to walk on toes for 10 steps maintaining balance (tests S1/2 plantarflexors)

Tandem Gait (Heel-to-Toe):
- Walks in a straight line placing heel directly in front of toe for 10 steps without significant unsteadiness (tests midline cerebellar function)

Romberg Test:
- Negative. Stands steadily with feet together, arms at sides, and eyes closed for 30 seconds. No excessive sway or loss of balance (tests proprioception when vestibular and visual inputs removed)

Unterberger/Fukuda Stepping Test:
- Marches in place with eyes closed for 50 steps. No significant rotation (< 30 degrees) or drift (tests vestibular function)

Single Leg Stance:
- Able to stand on each leg independently for > 5 seconds with eyes open

Functional Assessment:
- Able to rise from chair without using arms
- Able to climb stairs with normal reciprocal pattern`,
            special: `Romberg test: NEGATIVE - maintains balance with feet together and eyes closed for 30 seconds (no significant sway or loss of balance).

Pronator drift: NEGATIVE - arms held outstretched, palms up, eyes closed for 20-30 seconds with no drift, pronation, or downward movement of either arm.

Babinski sign: Plantar responses are FLEXOR (downgoing) bilaterally - normal.

Hoffmann sign: NEGATIVE bilaterally - flicking the distal phalanx of the middle finger produces no flexion of the thumb or index finger.

Lhermitte sign: NEGATIVE - neck flexion produces no electric shock-like sensation down the spine or limbs.

Kernig sign: NEGATIVE bilaterally - with hip flexed to 90°, the knee extends fully without resistance, pain, or hamstring spasm.

Brudzinski sign: NEGATIVE - passive neck flexion does not produce involuntary flexion of the hips or knees. No meningism.`
        }
    },
    general: {
        id: 'general',
        name: 'General Appearance',
        view: 'special',
        examTypes: ['inspection'],
        specialTests: [],
        defaultFindings: {
            inspection: 'The patient is alert, awake, and oriented to person, place, time, and situation. They appear their stated age, are well-nourished, well-hydrated, and in no apparent distress. They are sitting comfortably in bed/on the examination couch. Vital signs are stable. There are no obvious signs of respiratory distress (no use of accessory muscles, no pursed lip breathing, no cyanosis). No pallor, jaundice, or cyanosis. No cachexia or obesity. No lymphadenopathy visible in the cervical, axillary, or inguinal regions. Hands are warm with no clubbing, koilonychia, leukonychia, splinter haemorrhages, or palmar erythema. No asterixis or tremor. Mood and affect appear appropriate.'
        }
    }
};

// Bug 2 (16.5.2026 report): the posterior body map (src/utils/defaultRegions.js)
// emits region ids `upperBack` / `lowerBack` / `buttocks`, but BODY_REGIONS
// keys them `backUpper` / `backLower` / `buttockLeft|buttockRight`. Clicking
// those posterior regions therefore resolved to nothing — ExamTypeSelector
// showed "Unknown region selected" and the raw key. Rather than risk a
// rename of the shared map ids (saved exams / scenario configs reference
// them), alias the map ids onto the canonical exam definitions. `alias:true`
// keeps them out of view-derived region lists so nothing is double-counted.
BODY_REGIONS.upperBack = { ...BODY_REGIONS.backUpper, alias: true };
BODY_REGIONS.lowerBack = { ...BODY_REGIONS.backLower, alias: true };
// The map has one midline buttock region; the canonical data is split L/R
// with identical findings — present it as a single "Buttocks" region.
BODY_REGIONS.buttocks = {
    ...BODY_REGIONS.buttockLeft,
    id: 'buttocks',
    name: 'Buttocks',
    alias: true,
};

// Get regions by view
export function getRegionsByView(view) {
    return Object.values(BODY_REGIONS).filter(r => r.view === view && !r.alias);
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
            finding: 'The patient is alert but appears anxious and diaphoretic. They are sitting upright, leaning forward, and appear to be in moderate respiratory distress with use of accessory muscles. Skin is pale and clammy. No cyanosis of the lips or extremities.',
            abnormal: true
        }
    },
    chestAnterior: {
        inspection: {
            finding: 'Increased respiratory rate at 28 breaths per minute with visible use of accessory muscles (sternocleidomastoid and intercostals). Chest expansion appears reduced on the left side. No scars or deformity.',
            abnormal: true
        },
        palpation: {
            finding: 'Reduced chest expansion on the left side. Tactile vocal fremitus is reduced over the left lower zone. Apex beat is displaced laterally to the anterior axillary line.',
            abnormal: true
        },
        percussion: {
            finding: 'Percussion note is stony dull over the left lower zone posteriorly and laterally, suggestive of pleural effusion. Right side is resonant.',
            abnormal: true
        },
        auscultation: {
            finding: 'Breath sounds are reduced at the left base with no added sounds over the effusion. Bronchial breathing heard at the upper level of the effusion. Fine bibasal crackles on the right. Heart sounds: S1 and S2 present with a third heart sound (S3 gallop) at the apex.',
            abnormal: true
        }
    },
    heart: {
        inspection: {
            finding: 'Visible apex beat in the anterior axillary line (displaced laterally). No scars visible.',
            abnormal: true
        },
        palpation: {
            finding: 'Apex beat is displaced to the 6th intercostal space in the anterior axillary line. It is sustained, heaving, and diffuse, covering two intercostal spaces. No parasternal heave. No thrills.',
            abnormal: true
        },
        auscultation: {
            finding: 'S1 is normal. S2 is of normal intensity. There is a prominent third heart sound (S3) creating a gallop rhythm, best heard at the apex with the patient in the left lateral position. A grade 2/6 pansystolic murmur is heard at the apex, radiating to the axilla, consistent with mitral regurgitation. No pericardial rub.',
            abnormal: true
        }
    },
    abdomen: {
        inspection: {
            finding: 'Abdomen is mildly distended. No visible peristalsis. Umbilicus is everted.',
            abnormal: true
        },
        auscultation: {
            finding: 'Bowel sounds are present and normal.',
            abnormal: false
        },
        percussion: {
            finding: 'Shifting dullness is present, suggesting ascites. Liver dullness extends to 4 cm below the costal margin.',
            abnormal: true
        },
        palpation: {
            finding: 'Tender hepatomegaly with liver edge palpable 4 cm below the right costal margin. Liver edge is smooth and tender. Positive hepatojugular reflux. Spleen is not palpable.',
            abnormal: true
        },
        special: {
            finding: 'Fluid thrill is positive. Puddle sign positive. No rebound tenderness or guarding.',
            abnormal: true
        }
    },
    lowerLimbLeft: {
        inspection: {
            finding: 'Pitting oedema extending to the mid-thigh. Skin appears stretched and shiny. No varicose veins or ulceration.',
            abnormal: true
        },
        palpation: {
            finding: '3+ pitting oedema to the level of the mid-thigh. Pulses are palpable but difficult to assess due to oedema. Temperature is cool compared to proximal areas.',
            abnormal: true
        },
        special: {
            finding: 'Sensation intact. Power 5/5. Reflexes present but difficult to elicit due to oedema.',
            abnormal: true
        }
    },
    lowerLimbRight: {
        inspection: {
            finding: 'Pitting oedema extending to the mid-thigh. Skin appears stretched and shiny. No varicose veins or ulceration.',
            abnormal: true
        },
        palpation: {
            finding: '3+ pitting oedema to the level of the mid-thigh. Pulses are palpable but difficult to assess due to oedema. Temperature is cool compared to proximal areas.',
            abnormal: true
        },
        special: {
            finding: 'Sensation intact. Power 5/5. Reflexes present but difficult to elicit due to oedema.',
            abnormal: true
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
