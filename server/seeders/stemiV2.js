// The default case, v2: John Martinez, 55, anterior STEMI (Killip I), 45
// minutes into his chest pain.
//
// What v2 changed, and why (3.0.0-rc.16):
//   - Nothing a learner receives names the diagnosis or the plan. The triage
//     note no longer reads the ECG for them, the monitor's step labels are
//     neutral, the exam no longer mentions defibrillator pads, radial access or
//     the femoral backup site, and the patient's prompt no longer tells the
//     model he is having an infarct (he does not know).
//   - The Records tab holds what a chart holds before the learner arrives —
//     past history, medicines, procedures, a triage note, a GP letter — not the
//     HPI and the examination the learner is there to obtain.
//   - One troponin (hs-TnT). The ECG is the plugin room's 12-lead
//     (stemiV2Ecg.js), so the on-call cardiologist has material; the radiology
//     room's ECG and angiogram entries no longer carry the answer (the angiogram
//     is done by the interventional team, after transfer).
//   - Killip I throughout: clear lungs, an S4, a normal chest film. Every
//     artifact agrees with every other — the repo has a real normal chest
//     film and no congested one, and a report the image contradicts teaches the
//     wrong lesson.
//   - The monitor plays the UNTREATED course and never reperfuses on its own;
//     the post-PCI course is an alternative the instructor starts.
//   - Agents: the nurse (chart), his wife Elena (history), an on-call
//     interventional cardiologist (handover), and the debrief tutor (chart,
//     with the answer key). The ECG room brings the cardiologist.
//   - A treatment rubric.
//
// Fresh installs seed this through seeders/cases.js; existing installs get it
// from the boot upgrader (seedStemiCase.js).

import { STEMI_V2_ECG } from './stemiV2Ecg.js';

export const STEMI_SEED_REVISION = 'stemi-v2';
export const STEMI_V2_NAME = 'Acute Chest Pain - STEMI';
/** The name a v2 added beside an educator-edited original carries. */
export const STEMI_V2_ALONGSIDE_NAME = 'Acute Chest Pain - STEMI (v2)';

const SYSTEM_PROMPT = `You are John Martinez, a 55-year-old warehouse supervisor. You came to the emergency department because of chest pain that started about 45 minutes ago. You do not know what is causing it; you are frightened it is what killed your father.

PRESENTATION:
- Crushing pain in the middle of your chest (9/10) for 45 minutes; it started while you were carrying boxes at work
- It spreads to your left arm and your jaw; it feels like a heavy weight sitting on your chest
- Nothing makes it better; breathing in or moving does not change it
- You are sweating heavily - your shirt is soaked
- You feel a bit short of breath with the pain, but you can lie back on the trolley
- You feel sick but have not vomited
- You have a terrible feeling that something bad is about to happen
- At home you took one of your wife's antacids; it did nothing

EARLIER EPISODES (admit only if asked directly, and reluctantly):
- For about three weeks you have had tightness in your chest climbing the stairs at work, which went away after a few minutes of rest
- You put it down to being out of shape and did not see anyone about it

HISTORY:
- High blood pressure for 10 years (you often forget the tablets)
- Type 2 diabetes for 5 years (you check your sugar maybe once a week)
- High cholesterol, told about it two years ago, never started the tablet
- Appendix out at 22; a knee operation (keyhole) at 41; a bowel camera test three years ago that was normal
- Smoker: a pack a day for 30 years, still smoking
- Allergy: penicillin gives you a red itchy rash. No other allergies
- Family: your father died of a heart attack at 52; your mother has diabetes; your older brother had a stent at 58
- Medicines: metformin twice a day, lisinopril every morning (often forgotten), amlodipine every morning, ibuprofen now and then for your knee

SOCIAL:
- Warehouse supervisor, long shifts on your feet
- Married to Elena for 28 years; two grown-up children; you live in a first-floor flat
- Four or five beers at the weekend; no drugs
- Mostly takeaway food on shift; no regular exercise

IF ASKED ABOUT OTHER SYMPTOMS:
- No fever, no cough, no leg swelling, no calf pain, no recent travel or operation
- No palpitations before today, no blackouts, no bleeding, no black stools
- No tearing pain going through to your back, no weakness or numbness

HOW YOU BEHAVE:
- Anxious and frightened; you keep coming back to your father
- Restless, holding your chest, cannot get comfortable
- Short sentences because of the pain
- More distressed if the pain gets worse; calmer once something eases it
- Worried about your job and about Elena, who is in the relatives' room

WHAT YOU DO NOT KNOW:
- You do not know what the heart tracing shows, what your blood pressure or oxygen level is, or any blood result
- You have never heard of troponin, angioplasty, stents in your own case, or a cath lab; ask what the words mean

Describe your symptoms vividly in everyday language. If asked about your medicines or history, give the information above. Answer as a frightened man would, not as a textbook.`;

const PHYSICAL_EXAM = {
    general: {
        inspection: { finding: 'A 55-year-old overweight man in obvious distress, sitting up and unable to get comfortable. Grey, clammy and visibly sweating, with sweat beading on the forehead and soaking his shirt. Holding a clenched fist against the sternum. Speaks in short phrases. Anxious, frightened expression; asks more than once whether he is going to die. No cyanosis, no jaundice.', abnormal: true },
    },
    headNeck: {
        inspection: { finding: 'Face pale and grey with a cold sweat. No central cyanosis of the lips or tongue. No xanthelasma, no corneal arcus. Conjunctivae pale-pink, sclerae white. No jugular venous distension visible at 45 degrees. Trachea appears central. No goitre or neck masses.', abnormal: true },
        palpation: { finding: 'Trachea central. Jugular venous pressure 3 cm above the sternal angle at 45 degrees with a normal waveform and no hepatojugular reflux. Carotid pulses equal, of normal volume and upstroke. No lymphadenopathy. Thyroid not enlarged.', abnormal: false },
        auscultation: { finding: 'No bruit over either carotid artery. No thyroid bruit. No stridor.', abnormal: false },
        special: { finding: 'Neck movement full and painless; moving the neck does not reproduce the chest pain.', abnormal: false },
    },
    chest: {
        inspection: { finding: 'Respiratory rate 20 per minute, regular, with no accessory muscle use, no recession and no paradoxical movement. Expansion symmetrical. No scars, deformity or visible apical impulse. The skin over the chest is cold and wet.', abnormal: true },
        palpation: { finding: 'Chest wall non-tender: firm pressure over the sternum, costochondral junctions and ribs does not reproduce the pain. Expansion equal. Tactile vocal fremitus equal. Apex beat in the fifth intercostal space, midclavicular line, not displaced; no heave, no thrill.', abnormal: false },
        percussion: { finding: 'Resonant throughout both lung fields, front and back. Normal cardiac and liver dullness.', abnormal: false },
        auscultation: {
            finding: 'Vesicular breath sounds throughout with no crackles, wheeze or rub. Heart sounds regular at about 92 per minute; S1 and S2 normal, with a soft S4 just before S1, best heard at the apex with the bell. No S3, no murmur, no pericardial rub.',
            abnormal: true,
            // Synthetic clip (scripts/generate-auscultation-audio.mjs); the
            // lungs are clear, so the lung points play the normal recording.
            heartAudio: '/sounds/s4-gallop.wav',
            lungAudio: '/sounds/normal-lung.mp3',
        },
    },
    upperBack: {
        inspection: { finding: 'No scars, deformity, kyphosis or scoliosis. Symmetrical expansion posteriorly.', abnormal: false },
        palpation: { finding: 'No spinal or paraspinal tenderness. Posterior chest wall non-tender; the pain is not reproduced.', abnormal: false },
        percussion: { finding: 'Resonant throughout both posterior lung fields, no dullness at either base.', abnormal: false },
        auscultation: { finding: 'Vesicular breath sounds to both bases with no crackles, wheeze or rub.', abnormal: false },
    },
    abdomen: {
        inspection: { finding: 'Obese, symmetrical, moving with respiration. Well-healed right iliac fossa appendicectomy scar. No distension and no visible pulsation.', abnormal: false },
        auscultation: { finding: 'Normal bowel sounds. No aortic, renal or iliac bruit.', abnormal: false },
        percussion: { finding: 'Resonant. Liver span 11 cm. No shifting dullness.', abnormal: false },
        palpation: { finding: 'Soft and non-tender throughout, no guarding or rebound. No organomegaly. Aorta not expansile.', abnormal: false },
        special: { finding: 'Murphy sign negative. Examining the abdomen does not reproduce the chest pain.', abnormal: false },
    },
    lowerBack: {
        inspection: { finding: 'Normal lumbar lordosis, no scars.', abnormal: false },
        palpation: { finding: 'No midline, paraspinal or renal angle tenderness.', abnormal: false },
        percussion: { finding: 'No tenderness on percussion of the spine or renal angles.', abnormal: false },
        special: { finding: 'Straight leg raise full and painless bilaterally.', abnormal: false },
    },
    buttocks: {
        inspection: { finding: 'Skin intact, no pressure damage.', abnormal: false },
        palpation: { finding: 'Non-tender, no masses.', abnormal: false },
        special: { finding: 'No sacroiliac tenderness.', abnormal: false },
    },
    upperArmLeft: {
        inspection: { finding: 'Skin cold, pale and sweaty. No swelling or deformity. He rubs this arm because the ache spreads down it.', abnormal: true },
        palpation: { finding: 'Cold and clammy. Brachial pulse regular. Blood pressure in the left arm 150/92 mmHg, within 5 mmHg of the right. Pressing on the arm does not reproduce the ache.', abnormal: true },
        special: { finding: 'Full range of movement at the shoulder and elbow, painless. Power 5/5. The ache is not positional.', abnormal: false },
    },
    upperArmRight: {
        inspection: { finding: 'Skin cold, pale and sweaty. A cannula sited at triage in the right antecubital fossa, clean and dry.', abnormal: true },
        palpation: { finding: 'Cold and clammy. Brachial pulse regular. Blood pressure in the right arm 152/94 mmHg. Non-tender.', abnormal: true },
        special: { finding: 'Full range of movement. Power 5/5.', abnormal: false },
    },
    forearmLeft: {
        inspection: { finding: 'Cool, clammy skin. Superficial veins flat and hard to see.', abnormal: true },
        palpation: { finding: 'Cool. Radial pulse about 92 per minute, regular, no radio-radial or radio-femoral delay. Capillary refill at the fingertip 2 to 3 seconds.', abnormal: true },
    },
    forearmRight: {
        inspection: { finding: 'Cool, clammy skin. No rash or swelling.', abnormal: true },
        palpation: { finding: 'Cool. Radial pulse about 92 per minute, regular. Capillary refill 2 to 3 seconds.', abnormal: true },
    },
    handLeft: {
        inspection: { finding: 'Nicotine staining of the index and middle fingers. No clubbing, no splinter haemorrhages, no tendon xanthomata. Nail beds pale. Palms cold and sweating.', abnormal: true },
        palpation: { finding: 'Cold and wet. No joint swelling or tenderness. No asterixis.', abnormal: true },
        special: { finding: 'Full range of movement; grip and sensation normal.', abnormal: false },
    },
    handRight: {
        inspection: { finding: 'Nicotine staining of the index and middle fingers. No clubbing. Pulse oximeter probe on the index finger reading 95 per cent on room air with a good trace. Palms cold and sweating.', abnormal: true },
        palpation: { finding: 'Cold and wet. No joint swelling. No asterixis.', abnormal: true },
        special: { finding: 'Full range of movement; grip and sensation normal.', abnormal: false },
    },
    pelvis: {
        inspection: { finding: 'No bruising, scars or deformity.', abnormal: false },
        palpation: { finding: 'Pelvis stable and non-tender. Femoral pulses palpable and symmetrical, no bruit. No hernia or lymphadenopathy.', abnormal: false },
        special: { finding: 'Hip movement full and painless.', abnormal: false },
    },
    thighLeft: {
        inspection: { finding: 'No swelling, erythema or varicosities.', abnormal: false },
        palpation: { finding: 'Non-tender. Femoral pulse strong and regular.', abnormal: false },
        special: { finding: 'Full hip and knee movement. Power 5/5.', abnormal: false },
    },
    thighRight: {
        inspection: { finding: 'No swelling, erythema or varicosities.', abnormal: false },
        palpation: { finding: 'Non-tender. Femoral pulse strong and regular.', abnormal: false },
        special: { finding: 'Full hip and knee movement. Power 5/5.', abnormal: false },
    },
    lowerLegLeft: {
        inspection: { finding: 'No ankle or pretibial oedema. Calf circumference symmetrical.', abnormal: false },
        palpation: { finding: 'No pitting oedema. Calf soft and non-tender. Foot pulses palpable.', abnormal: false },
        special: { finding: 'No calf tenderness; no clinical evidence of deep vein thrombosis.', abnormal: false },
    },
    lowerLegRight: {
        inspection: { finding: 'No oedema. Calf circumference symmetrical.', abnormal: false },
        palpation: { finding: 'No pitting oedema. Calf soft and non-tender. Foot pulses palpable.', abnormal: false },
        special: { finding: 'No calf tenderness.', abnormal: false },
    },
    calfLeft: {
        inspection: { finding: 'No swelling or redness.', abnormal: false },
        palpation: { finding: 'Soft, non-tender, no cord.', abnormal: false },
        special: { finding: 'Negative calf squeeze test.', abnormal: false },
    },
    calfRight: {
        inspection: { finding: 'No swelling or redness.', abnormal: false },
        palpation: { finding: 'Soft, non-tender, no cord.', abnormal: false },
        special: { finding: 'Negative calf squeeze test.', abnormal: false },
    },
    footLeft: {
        inspection: { finding: 'Skin cool and pale but intact. No diabetic ulceration or callus. No oedema.', abnormal: false },
        palpation: { finding: 'Cool. Dorsalis pedis and posterior tibial pulses palpable. Capillary refill at the great toe 2 seconds.', abnormal: false },
        special: { finding: 'Protective sensation intact to the 10 g monofilament.', abnormal: false },
    },
    footRight: {
        inspection: { finding: 'Skin cool and pale but intact. No ulceration. No oedema.', abnormal: false },
        palpation: { finding: 'Cool. Foot pulses palpable. Capillary refill at the great toe 2 seconds.', abnormal: false },
        special: { finding: 'Protective sensation intact to the 10 g monofilament.', abnormal: false },
    },
    heelLeft: {
        inspection: { finding: 'Heel skin intact.', abnormal: false },
        palpation: { finding: 'Non-tender.', abnormal: false },
    },
    heelRight: {
        inspection: { finding: 'Heel skin intact.', abnormal: false },
        palpation: { finding: 'Non-tender.', abnormal: false },
    },
    neurological: {
        mentalStatus: { finding: 'GCS 15/15. Alert and fully oriented. Speech fluent; answers are short because of the pain, not because of dysphasia. Recall 3/3. Frightened and highly anxious, fully cooperative.', abnormal: true },
        cranialNerves: { finding: 'Pupils 3 mm, equal and reactive. Eye movements full. Face symmetrical. Palate, tongue and swallow normal. Cranial nerves II to XII intact.', abnormal: false },
        motor: { finding: 'Normal bulk and tone. Power 5/5 throughout, symmetrical. No pronator drift. No focal weakness.', abnormal: false },
        sensory: { finding: 'Light touch, pinprick, vibration and joint position sense intact and symmetrical.', abnormal: false },
        reflexes: { finding: 'Reflexes present and symmetrical. Plantars flexor.', abnormal: false },
        coordination: { finding: 'Finger-nose and heel-shin normal.', abnormal: false },
        gait: { finding: 'Not assessed on the trolley. He walked into the department unaided with a normal gait.', abnormal: false },
        special: { finding: 'Romberg not performed on the trolley. Babinski negative. Kernig and Brudzinski negative, no neck stiffness.', abnormal: false },
    },
};

const LABS = [
    { test_name: 'High-Sensitivity Troponin T', test_group: 'Cardiac Markers', gender_category: 'General', min_value: 0, max_value: 14, current_value: 52, unit: 'ng/L', normal_samples: [5, 12, 8], is_abnormal: true, turnaround_minutes: null, preset: 'high' },
    { test_name: 'Creatine Kinase-MB (CK-MB)', test_group: 'Cardiac Markers', gender_category: 'General', min_value: 0, max_value: 5, current_value: 4.8, unit: 'ng/mL', normal_samples: [1, 3.5, 2], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Creatine Kinase (CK), Total', test_group: 'Cardiac Markers', gender_category: 'Male', min_value: 55, max_value: 170, current_value: 184, unit: 'U/L', normal_samples: [70, 150, 110], is_abnormal: true, turnaround_minutes: null, preset: 'high' },
    { test_name: 'NT-proBNP', test_group: 'Cardiac Markers', gender_category: 'General', min_value: 0, max_value: 300, current_value: 410, unit: 'pg/mL', normal_samples: [50, 200, 125], is_abnormal: true, turnaround_minutes: null, preset: 'high' },
    { test_name: 'Hemoglobin', test_group: 'Hematology (CBC)', gender_category: 'Male', min_value: 14, max_value: 18, current_value: 15.4, unit: 'g/dL', normal_samples: [14.5, 16.5, 15.5], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Hematocrit', test_group: 'Hematology (CBC)', gender_category: 'Male', min_value: 40, max_value: 54, current_value: 45, unit: '%', normal_samples: [42, 50, 46], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'White Blood Cell Count (WBC)', test_group: 'Hematology (CBC)', gender_category: 'General', min_value: 4000, max_value: 11000, current_value: 12800, unit: '/µL', normal_samples: [5500, 9000, 7200], is_abnormal: true, turnaround_minutes: null, preset: 'high' },
    { test_name: 'Platelet Count', test_group: 'Hematology (CBC)', gender_category: 'General', min_value: 150000, max_value: 400000, current_value: 268000, unit: '/µL', normal_samples: [180000, 350000, 250000], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Sodium, serum', test_group: 'Basic Metabolic Panel', gender_category: 'General', min_value: 136, max_value: 145, current_value: 138, unit: 'mEq/L', normal_samples: [138, 143, 140], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Potassium, serum', test_group: 'Basic Metabolic Panel', gender_category: 'General', min_value: 3.5, max_value: 5, current_value: 3.8, unit: 'mEq/L', normal_samples: [3.8, 4.6, 4.2], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Chloride, serum', test_group: 'Basic Metabolic Panel', gender_category: 'General', min_value: 98, max_value: 106, current_value: 102, unit: 'mEq/L', normal_samples: [100, 104, 102], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Bicarbonate (CO2), serum', test_group: 'Basic Metabolic Panel', gender_category: 'General', min_value: 22, max_value: 29, current_value: 23, unit: 'mEq/L', normal_samples: [24, 27, 25], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Blood Urea Nitrogen (BUN)', test_group: 'Basic Metabolic Panel', gender_category: 'General', min_value: 7, max_value: 20, current_value: 19, unit: 'mg/dL', normal_samples: [10, 18, 14], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Creatinine, serum', test_group: 'Basic Metabolic Panel', gender_category: 'Male', min_value: 0.7, max_value: 1.3, current_value: 1.24, unit: 'mg/dL', normal_samples: [0.8, 1.2, 1], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Glucose, random', test_group: 'Basic Metabolic Panel', gender_category: 'General', min_value: 70, max_value: 140, current_value: 244, unit: 'mg/dL', normal_samples: [85, 120, 100], is_abnormal: true, turnaround_minutes: null, preset: 'high' },
    { test_name: 'Magnesium, serum', test_group: 'Basic Metabolic Panel', gender_category: 'General', min_value: 1.7, max_value: 2.2, current_value: 1.9, unit: 'mg/dL', normal_samples: [1.8, 2.1, 1.95], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Calcium, serum', test_group: 'Basic Metabolic Panel', gender_category: 'General', min_value: 8.5, max_value: 10.5, current_value: 9.2, unit: 'mg/dL', normal_samples: [9, 10, 9.5], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'eGFR (Estimated GFR)', test_group: 'Renal Function', gender_category: 'General', min_value: 90, max_value: 120, current_value: 64, unit: 'mL/min/1.73m²', normal_samples: [95, 115, 105], is_abnormal: true, turnaround_minutes: null, preset: 'low' },
    { test_name: 'HbA1c (Glycated Hemoglobin)', test_group: 'Diabetes', gender_category: 'General', min_value: 4, max_value: 5.6, current_value: 8.4, unit: '%', normal_samples: [4.5, 5.4, 5], is_abnormal: true, turnaround_minutes: 3, preset: 'high' },
    { test_name: 'Total Cholesterol', test_group: 'Lipid Panel', gender_category: 'General', min_value: 0, max_value: 200, current_value: 248, unit: 'mg/dL', normal_samples: [150, 190, 170], is_abnormal: true, turnaround_minutes: 3, preset: 'high' },
    { test_name: 'LDL Cholesterol', test_group: 'Lipid Panel', gender_category: 'General', min_value: 0, max_value: 100, current_value: 168, unit: 'mg/dL', normal_samples: [70, 95, 85], is_abnormal: true, turnaround_minutes: 3, preset: 'high' },
    { test_name: 'HDL Cholesterol', test_group: 'Lipid Panel', gender_category: 'Male', min_value: 40, max_value: 100, current_value: 33, unit: 'mg/dL', normal_samples: [45, 70, 55], is_abnormal: true, turnaround_minutes: 3, preset: 'low' },
    { test_name: 'Triglycerides', test_group: 'Lipid Panel', gender_category: 'General', min_value: 0, max_value: 150, current_value: 236, unit: 'mg/dL', normal_samples: [80, 130, 100], is_abnormal: true, turnaround_minutes: 3, preset: 'high' },
    { test_name: 'Prothrombin Time (PT)', test_group: 'Coagulation', gender_category: 'General', min_value: 11, max_value: 13.5, current_value: 12.4, unit: 'seconds', normal_samples: [11.5, 13, 12.2], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'INR', test_group: 'Coagulation', gender_category: 'General', min_value: 0.8, max_value: 1.1, current_value: 1, unit: 'ratio', normal_samples: [0.9, 1.05, 1], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Activated PTT (aPTT)', test_group: 'Coagulation', gender_category: 'General', min_value: 30, max_value: 40, current_value: 34, unit: 'seconds', normal_samples: [32, 38, 35], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'D-dimer, plasma', test_group: 'Coagulation', gender_category: 'General', min_value: 0, max_value: 500, current_value: 320, unit: 'ng/mL FEU', normal_samples: [120, 350, 220], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'Lactate, plasma', test_group: 'Blood Gases', gender_category: 'General', min_value: 0.5, max_value: 2.2, current_value: 1.6, unit: 'mmol/L', normal_samples: [0.8, 1.8, 1.2], is_abnormal: false, turnaround_minutes: null, preset: 'normal' },
    { test_name: 'AST (SGOT)', test_group: 'Liver Function', gender_category: 'General', min_value: 10, max_value: 40, current_value: 34, unit: 'U/L', normal_samples: [15, 35, 25], is_abnormal: false, turnaround_minutes: 3, preset: 'normal' },
    { test_name: 'ALT (SGPT)', test_group: 'Liver Function', gender_category: 'General', min_value: 7, max_value: 56, current_value: 28, unit: 'U/L', normal_samples: [15, 45, 30], is_abnormal: false, turnaround_minutes: 3, preset: 'normal' },
];

const CXR_NORMAL_FINDINGS = 'Adequate inspiration. Heart size within normal limits. Mediastinum of normal width with a normal aortic knuckle and no paratracheal widening. Lungs clear with no upper-zone venous diversion, no interstitial or alveolar oedema and no Kerley B lines. No consolidation, effusion or pneumothorax. Bony thorax intact.';

const RADIOLOGY = [
    {
        // The 12-lead lives in the ECG room. Ordered here, the radiology
        // database would answer with its stock "Normal sinus rhythm".
        id: 1, studyId: 'ecg_12lead', studyName: '12-Lead ECG', modality: 'Cardiac', bodyRegion: 'Chest',
        turnaroundMinutes: 0, imageUrl: '', videoUrl: '', isCustom: false,
        findings: 'A 12-lead ECG was recorded on arrival. The tracing is in the ECG room.',
        interpretation: 'See the ECG room for the tracing.',
    },
    {
        id: 2, studyId: 'xray_chest_portable', studyName: 'Chest X-Ray (Portable/AP)', modality: 'X-Ray', bodyRegion: 'Chest',
        turnaroundMinutes: 10, imageUrl: '', videoUrl: '', isCustom: false,
        findings: `Portable AP semi-erect film. ${CXR_NORMAL_FINDINGS}`,
        interpretation: '1. No acute cardiopulmonary abnormality; no pulmonary oedema.\n2. Normal mediastinal contour - no radiographic support for aortic dissection.\n3. This film must not delay definitive treatment.',
    },
    {
        // Ordered as a PA film it opens the archive's real normal chest
        // radiograph in the PACS room (normal/xr_chest).
        id: 3, studyId: 'xray_chest_pa', studyName: 'Chest X-Ray (PA/Lateral)', modality: 'X-Ray', bodyRegion: 'Chest',
        turnaroundMinutes: 15, imageUrl: '', videoUrl: '', isCustom: false,
        findings: `Erect PA and lateral films. ${CXR_NORMAL_FINDINGS}`,
        interpretation: '1. No acute cardiopulmonary abnormality; no pulmonary oedema.\n2. Normal mediastinal contour - no radiographic support for aortic dissection.',
    },
    {
        id: 4, studyId: 'echo_tte', studyName: 'Echocardiogram (TTE)', modality: 'Ultrasound', bodyRegion: 'Chest',
        turnaroundMinutes: 10, imageUrl: '', videoUrl: '', isCustom: false,
        findings: 'Focused bedside study. Left ventricle not dilated. Hypokinesis of the mid and apical anterior wall, anteroseptum and apex; basal and inferior segments contract normally. Visual ejection fraction about 45 per cent. Right ventricle normal in size and function. No significant valve disease; no ventricular septal defect on colour Doppler. No pericardial effusion. Proximal aorta of normal calibre with no flap seen.',
        interpretation: '1. Regional wall motion abnormality in the anterior wall, septum and apex, with mildly reduced left ventricular function.\n2. No mechanical complication; no pericardial effusion.\n3. Must not delay definitive treatment.',
    },
    {
        // Done by the interventional team after transfer — not an ED order.
        // Left to the database it would read "angiographically normal".
        id: 5, studyId: 'cardiac_cath', studyName: 'Coronary Angiography (Cardiac Catheterization)', modality: 'Cardiac', bodyRegion: 'Chest',
        turnaroundMinutes: 0, imageUrl: '', videoUrl: '', isCustom: false,
        findings: 'Coronary angiography is not performed in the emergency department. Discuss the patient with the interventional cardiology team.',
        interpretation: 'Not performed in the emergency department.',
    },
];

/**
 * The PACS document. Authored rows are always listed, so only one is authored:
 * the echo, with no images and an unreleased report. Without it an echo order
 * would open the archive's NORMAL loop beside a report of anterior hypokinesis.
 * Chest films are left to the order join (a PA order opens the real normal
 * film; nothing here contradicts it).
 */
const PACS = {
    version: 1,
    worklist: [{
        id: 'study_echo_tte',
        studyId: 'echo_tte',
        description: 'Echocardiogram (TTE)',
        accession: null,
        availableAtMinutes: null,
        baseline: { kind: 'none', ref: null },
        substitutions: [],
        report: {
            findings: RADIOLOGY[3].findings,
            impression: RADIOLOGY[3].interpretation,
            reportedBy: 'Dr. L. Novak, Cardiology',
            released: false,
        },
    }],
};

const SCENARIO = {
    enabled: true,
    autoStart: true,
    // Educator-facing. The labels below reach learners, so they say time, not
    // what is happening.
    description: 'The untreated course of an anterior STEMI (Killip I on arrival): rising heart rate, ventricular ectopy from 20 minutes and a slowly falling blood pressure. It never reperfuses on its own - start the post-PCI alternative when the learner has handed over to the catheter laboratory. VF arrest and cardiogenic shock are alternatives for a stronger group.',
    timeline: [
        { time: 0, label: 'Arrival', params: { hr: 92, spo2: 95, rr: 20, bpSys: 152, bpDia: 94, temp: 37.1, etco2: 34 }, conditions: { stElev: 2, pvc: false, tInv: false, wideQRS: false, noise: 0 }, rhythm: 'NSR' },
        { time: 600, label: '10 minutes', params: { hr: 96, spo2: 95, rr: 21, bpSys: 148, bpDia: 92 }, conditions: { stElev: 2, pvc: false }, rhythm: 'NSR' },
        { time: 1200, label: '20 minutes', params: { hr: 102, spo2: 94, rr: 22, bpSys: 142, bpDia: 88 }, conditions: { stElev: 3, pvc: true }, rhythm: 'Sinus Tachycardia' },
        { time: 1800, label: '30 minutes', params: { hr: 108, spo2: 93, rr: 24, bpSys: 134, bpDia: 84 }, conditions: { stElev: 3, pvc: true }, rhythm: 'Sinus Tachycardia' },
        { time: 2400, label: '40 minutes', params: { hr: 112, spo2: 92, rr: 24, bpSys: 126, bpDia: 80 }, conditions: { stElev: 3, pvc: true }, rhythm: 'Sinus Tachycardia' },
    ],
    alternatives: [
        {
            id: 'post_pci',
            name: 'After primary PCI',
            description: 'Back from the catheter laboratory with the LAD stented: pain settling, ST segments resolving, T waves inverting. For the handover and post-PCI part of the session.',
            timeline: [
                { time: 0, label: 'Back from the catheter laboratory', params: { hr: 84, spo2: 97, rr: 16, bpSys: 124, bpDia: 76, temp: 37.0, etco2: 36 }, conditions: { stElev: 1, pvc: false }, rhythm: 'NSR' },
                { time: 600, label: 'Settling', params: { hr: 78, spo2: 98, rr: 16, bpSys: 120, bpDia: 74 }, conditions: { stElev: 1, pvc: false, tInv: true }, rhythm: 'NSR' },
                { time: 1200, label: 'Coronary care unit', params: { hr: 74, spo2: 98, rr: 15, bpSys: 118, bpDia: 72 }, conditions: { stElev: 0, pvc: false, tInv: true }, rhythm: 'NSR' },
            ],
        },
        {
            id: 'vf_arrest',
            name: 'Ventricular fibrillation arrest',
            description: 'Warning ectopy degenerates into VF. Tests recognition, immediate defibrillation and post-ROSC care in the first hour of an anterior infarct.',
            timeline: [
                { time: 0, label: 'Increasing ventricular ectopy', params: { hr: 112, spo2: 93, rr: 24, bpSys: 132, bpDia: 82 }, conditions: { stElev: 3, pvc: true }, rhythm: 'Sinus Tachycardia' },
                { time: 120, label: 'Ventricular fibrillation - pulseless', params: { hr: 0, spo2: 0, rr: 0, bpSys: 0, bpDia: 0 }, conditions: { stElev: 3, pvc: false }, rhythm: 'VFib' },
                { time: 240, label: 'ROSC after a single DC shock', params: { hr: 98, spo2: 94, rr: 20, bpSys: 108, bpDia: 68 }, conditions: { stElev: 3, pvc: true }, rhythm: 'NSR' },
            ],
        },
        {
            id: 'cardiogenic_shock',
            name: 'Cardiogenic shock',
            description: 'A large anterior infarct with progressive pump failure. Tests recognition of shock, restraint with fluids and nitrates, and escalation to inotropes and mechanical support.',
            timeline: [
                { time: 0, label: 'Pump failure begins', params: { hr: 118, spo2: 90, rr: 28, bpSys: 96, bpDia: 60 }, conditions: { stElev: 3, pvc: true }, rhythm: 'Sinus Tachycardia' },
                { time: 300, label: 'Shock deepens - cold and oliguric', params: { hr: 130, spo2: 86, rr: 32, bpSys: 78, bpDia: 48 }, conditions: { stElev: 4, pvc: true }, rhythm: 'Sinus Tachycardia' },
                { time: 600, label: 'Response to inotropes and revascularisation', params: { hr: 110, spo2: 93, rr: 24, bpSys: 98, bpDia: 62 }, conditions: { stElev: 2, pvc: false }, rhythm: 'Sinus Tachycardia' },
            ],
        },
    ],
};

const CONFIG = {
    seed_revision: STEMI_SEED_REVISION,
    patient_name: 'John Martinez',
    case_language: 'en',
    difficulty_level: 'intermediate',
    category: 'Cardiology',
    specialty: 'Cardiology',
    persona_type: 'Anxious Patient',
    storyMode: 'structured',
    greeting: 'Doctor... my chest. It is like something heavy is sitting on it. It started about three quarters of an hour ago and it will not let go. My arm aches, my jaw aches. I am soaked through. Please... my father died of something like this.',
    constraints: 'Stay in the patient role at all times. Speak in short sentences because of the pain. Never name a diagnosis and never describe your own heart tracing. NEVER quote a number from the case record - not a laboratory value, not your blood pressure, heart rate, oxygen saturation or temperature, and not an examination finding. You have never been told any of them. Describe only what you can feel and see: the pain, the sweating, the breathlessness with the pain, the nausea, the fear. If a clinician uses a medical term, ask what it means. Reveal the three weeks of tightness on the stairs only if asked directly about earlier episodes. If given nitroglycerin under the tongue, say the pain eased from 9/10 to about 7/10 but never went away. If given morphine or fentanyl, say it took the edge off. Do not invent new symptoms or treatments.',
    personality: {
        communicationStyle: 'brief',
        emotionalState: 'fearful',
        painTolerance: 'low',
        cooperativeness: 'very_cooperative',
        healthLiteracy: 'low',
    },
    voice: { case_voice: 'am_michael' },
    avatar_id: 'rb_delivery_male_01.glb',
    patient_avatar: '/patient_mi_case_55m.png',
    rooms: { disabled: [], enabled: ['room3d'] },
    demographics: {
        age: 55,
        gender: 'Male',
        mrn: 'RH-2026-00417',
        dob: '1970-11-08',
        height: 178,
        weight: 92,
        bloodType: 'O+',
        language: 'English',
        ethnicity: 'Hispanic/Latino',
        occupation: 'Warehouse supervisor',
        maritalStatus: 'Married',
        allergies: 'Penicillin (maculopapular rash)',
        emergencyContact: { name: 'Elena Martinez', relationship: 'Wife', phone: '+1 555 0148 2291' },
    },
    initialVitals: {
        hr: 92, spo2: 95, rr: 20, bpSys: 152, bpDia: 94, temp: 37.1, etco2: 34, rhythm: 'NSR',
        conditions: { stElev: 2, pvc: false, tInv: false, wideQRS: false, noise: 0 },
    },
    alarms: {
        hr: { enabled: true, low: 50, high: 120 },
        spo2: { enabled: true, low: 92, high: null },
        rr: { enabled: true, low: 8, high: 28 },
        bpSys: { enabled: true, low: 90, high: 180 },
        bpDia: { enabled: true, low: 50, high: 110 },
        temp: { enabled: true, low: 36, high: 38.5 },
        etco2: { enabled: true, low: 30, high: 50 },
    },
    // The answer key. Educators and an agent given `answerKey` see it; the
    // learner never does (services/caseProjection.js).
    diagnosis: 'Acute anterior ST-elevation myocardial infarction, Killip class I, due to thrombotic occlusion of the proximal left anterior descending artery, in a man with poorly controlled type 2 diabetes, hypertension, untreated dyslipidaemia and a 30 pack-year smoking history.',
    treatment_plan: 'Recognise the STEMI on the first 12-lead ECG, within 10 minutes of arrival, and activate the catheter laboratory at once - reperfusion must not wait for troponin. Aspirin 300 mg chewed; a P2Y12 inhibitor (ticagrelor 180 mg, or clopidogrel 600 mg if ticagrelor is unsuitable); unfractionated heparin; sublingual nitrate for ongoing pain with a systolic pressure above 90 mmHg; titrated intravenous opioid for refractory pain; high-intensity statin early. No oxygen while SpO2 is 90 per cent or more. No fibrinolysis: primary PCI is available within guideline times. Continuous monitoring with a defibrillator at hand. Primary PCI to the proximal LAD, first-medical-contact-to-device under 120 minutes. Afterwards: dual antiplatelet therapy for 12 months, beta-blocker and ACE inhibitor once stable, echocardiogram, glycaemic control, smoking cessation and cardiac rehabilitation.',
    learning_objectives: [
        'Take a focused chest-pain history and identify the features that make an acute coronary syndrome likely',
        'Obtain and interpret a 12-lead ECG within 10 minutes of first medical contact and localise the territory',
        'Recognise ST elevation in V1 to V4 with reciprocal inferior ST depression as an anterior injury pattern from a proximal LAD occlusion',
        'State that STEMI is an electrocardiographic diagnosis and that reperfusion must never wait for biomarkers',
        'Interpret an early troponin rise in the context of a 45-minute symptom duration',
        'Choose primary PCI over fibrinolysis when device time is within guideline limits, and justify the choice',
        'Prescribe correct initial therapy - antiplatelets, anticoagulation, nitrate, analgesia - and withhold oxygen when saturation is normal',
        'Anticipate the early complications of an anterior infarct: ventricular arrhythmia, pump failure and cardiogenic shock',
        'Hand over clearly to the interventional cardiologist and keep the patient and his wife informed',
        'Communicate a frightening diagnosis clearly and compassionately to an anxious patient with low health literacy',
    ],
    structuredHistory: {
        chiefComplaint: 'Crushing chest pain',
        hpi: 'Sudden, severe, crushing central chest pain that began 45 minutes ago while lifting boxes at work. Constant, 9/10, like a heavy weight, radiating to the left arm and jaw. Profuse sweating, nausea without vomiting, breathlessness with the pain, and a strong sense of impending doom. Nothing relieves it; not pleuritic, not positional, not reproduced by movement. On direct questioning, three weeks of exertional chest tightness on stairs that eased with rest, never reported.',
        pmh: 'Hypertension for 10 years, poorly controlled with inconsistent adherence. Type 2 diabetes for 5 years, on metformin alone and rarely monitored. Dyslipidaemia identified 2 years ago, never treated. No previous myocardial infarction, heart failure, stroke, asthma, renal or liver disease.',
        psh: 'Open appendicectomy at 22. Left knee arthroscopy at 41. Screening colonoscopy 3 years ago, normal. No previous heart procedures or heart surgery.',
        medications: 'Metformin 500 mg twice daily. Lisinopril 10 mg once daily (often missed). Amlodipine 5 mg once daily. Ibuprofen 400 mg as needed for knee pain, about twice a week. No antiplatelet, no statin.',
        allergies: 'Penicillin - maculopapular rash, no anaphylaxis. No other allergies.',
        socialHistory: 'Warehouse supervisor on long shifts. Smoker, 1 pack per day for 30 years, still smoking. Four to five beers at weekends, no drugs. Married 28 years, two adult children, lives in a first-floor flat. Takeaway diet on shift, no regular exercise. Limited health literacy, no recent primary care follow-up.',
        familyHistory: 'Father died of a myocardial infarction at 52. Mother 79 with type 2 diabetes and hypertension. Older brother had a coronary stent at 58.',
        ros: 'No fever or weight loss. No palpitations, syncope, orthopnoea or ankle swelling before today. Breathless only with the pain; no cough or haemoptysis. Nausea, no vomiting, no melaena. No headache or focal weakness. No tearing interscapular pain, no calf pain, no recent immobility, travel or surgery.',
        additionalNotes: 'Play the patient, never the clinician. He does not know his ECG, blood pressure or any result and must not quote them. He minimises the three weeks of exertional tightness until asked directly. He is frightened by the parallel with his father and will ask "am I going to die?" more than once; he needs plain-language reassurance. He worries about missing work and about his wife waiting outside. If the clinician is dismissive or rushed he goes quiet and volunteers less.',
    },
    // What the chart holds BEFORE the learner sees him: the old record and the
    // triage note. Not the HPI and not the examination — obtaining those is
    // the exercise, and this tab is open during the case.
    clinicalRecords: {
        aiAccess: { history: true, physicalExam: false, medications: true, radiology: false, procedures: true, notes: false },
        history: {
            pastMedical: 'Hypertension (10 years, poor adherence). Type 2 diabetes mellitus (5 years, metformin). Dyslipidaemia (2 years, statin declined twice).',
            pastSurgical: 'Open appendicectomy 1992. Left knee arthroscopy 2011. Screening colonoscopy 2023, normal.',
            allergies: 'Penicillin - maculopapular rash.',
            family: 'Father: myocardial infarction, died at 52. Brother: coronary stent at 58.',
        },
        medications: [
            { name: 'Metformin', dose: '500 mg', route: 'PO', frequency: 'BID', indication: 'type 2 diabetes mellitus' },
            { name: 'Lisinopril', dose: '10 mg', route: 'PO', frequency: 'Once daily', indication: 'hypertension' },
            { name: 'Amlodipine', dose: '5 mg', route: 'PO', frequency: 'Once daily', indication: 'hypertension' },
            { name: 'Ibuprofen', dose: '400 mg', route: 'PO', frequency: 'PRN', indication: 'chronic left knee pain' },
        ],
        procedures: [
            { id: 1, name: 'Open appendicectomy', date: '1992-06-14', indication: 'Acute appendicitis', findings: 'Inflamed, non-perforated appendix removed', complications: 'None' },
            { id: 2, name: 'Left knee arthroscopy', date: '2011-09-02', indication: 'Mechanical locking after a work injury', findings: 'Medial meniscal tear, partial meniscectomy', complications: 'None' },
            { id: 3, name: 'Screening colonoscopy', date: '2023-04-19', indication: 'Average-risk screening at 52', findings: 'Normal to the caecum, no polyps', complications: 'None' },
        ],
        notes: [
            {
                id: 1,
                type: 'Triage Note',
                title: 'Emergency department triage',
                date: '2026-08-31',
                author: 'R. Diaz, RN, Triage',
                content: 'Arrived by private car with his wife at 08:12. Central chest pain for about 45 minutes, started while lifting at work. Pale and sweaty. Triaged category 2 and moved to resus bay 3. 12-lead ECG recorded at 08:17 and placed in the chart for the doctor. Cannula sited in the right antecubital fossa, bloods sent. Wife Elena is in the relatives room.',
            },
            {
                id: 2,
                type: 'Consult Note',
                title: 'Primary care summary - last review 4 months ago',
                date: '2026-04-22',
                author: 'Dr. M. Alvarez, General Practice',
                content: 'Seen for a repeat prescription. Office blood pressure 158/96 mmHg on two readings; declined an ambulatory monitor. HbA1c 8.1% four months ago; declined a second agent. Total cholesterol 244 mg/dL, LDL 162 mg/dL; a statin was offered and declined on two occasions. Smoking 20 a day, declined referral to stop-smoking services. No chest pain reported at that visit. Advised to return in three months; did not attend.',
            },
        ],
    },
    // Server-side only (agents with answerKey, the debrief).
    clinical_records: {
        risk_factors: [
            'Current smoker, 30 pack-years',
            'Type 2 diabetes for 5 years, poorly controlled on metformin alone',
            'Hypertension for 10 years with poor adherence',
            'Dyslipidaemia, statin declined twice',
            'Premature family history of coronary disease (father MI at 52, brother stented at 58)',
            'Overweight (BMI 29) with a sedentary lifestyle',
            'Three weeks of untreated exertional angina before presentation',
        ],
        differential_diagnosis: [
            'Acute anterior STEMI from a proximal LAD occlusion (the working diagnosis)',
            'NSTEMI or unstable angina - excluded by ST elevation in contiguous leads',
            'Acute aortic dissection - no tearing pain, equal arm pressures, normal mediastinum',
            'Pulmonary embolism - no risk factors, normal D-dimer, no right-heart strain',
            'Acute pericarditis - not positional or pleuritic, no rub, regional ST elevation with reciprocal change and no PR depression',
            'Oesophageal pain - no relief with antacid, no reflux history',
            'Musculoskeletal pain - not reproduced by palpation or movement',
        ],
        management_plan: [
            'ABC, continuous monitoring, defibrillator at hand, IV access',
            '12-lead ECG within 10 minutes of first medical contact',
            'Aspirin 300 mg chewed',
            'Ticagrelor 180 mg (clopidogrel 600 mg if ticagrelor is unsuitable)',
            'Unfractionated heparin per the catheter laboratory protocol',
            'Sublingual nitrate for ongoing pain if systolic above 90 mmHg; titrated IV opioid for refractory pain',
            'No oxygen while SpO2 is 90 per cent or more',
            'Activate the catheter laboratory for primary PCI; no fibrinolysis when device time is within 120 minutes',
            'Do not wait for troponin',
            'High-intensity statin early',
            'Prepare for VF and pump failure',
            'Hand over to the interventional cardiologist; keep the patient and his wife informed',
        ],
    },
    pages: [
        {
            title: 'Medication card carried in his wallet',
            content: 'JOHN MARTINEZ - MEDICINES LIST (given by the pharmacy)\n- Metformin 500 mg, one tablet twice a day with food\n- Lisinopril 10 mg, one tablet every morning\n- Amlodipine 5 mg, one tablet every morning\n- Ibuprofen 400 mg, only when the knee is bad\nALLERGY: PENICILLIN - comes up in a red itchy rash\nGP: Dr. M. Alvarez. Last blood test: April.',
        },
    ],
    investigations: {
        defaultLabsEnabled: true,
        defaultRadiologyEnabled: true,
        instantResults: false,
        defaultTurnaround: 2,
        labs: LABS,
    },
    radiology: RADIOLOGY,
    ecg: STEMI_V2_ECG,
    pacs: PACS,
    physical_exam: PHYSICAL_EXAM,
};

/** The case row, as columns (config and scenario already JSON strings). */
export const STEMI_V2_CASE = Object.freeze({
    name: STEMI_V2_NAME,
    description: 'A 55-year-old man with 45 minutes of crushing central chest pain, sweating and nausea. The arrival ECG shows an anterior injury pattern from a proximal LAD occlusion (Killip I). Tests ECG recognition within 10 minutes, the reperfusion decision, initial therapy, handover to the interventional cardiologist, and communication with a frightened patient and his wife.',
    system_prompt: SYSTEM_PROMPT,
    patient_name: 'John Martinez',
    patient_gender: 'Male',
    patient_age: 55,
    chief_complaint: 'Crushing chest pain',
    difficulty_level: 'intermediate',
    estimated_duration_minutes: 30,
    learning_objectives: JSON.stringify(CONFIG.learning_objectives),
    config: JSON.stringify(CONFIG),
    scenario: JSON.stringify(SCENARIO),
});

const ELENA_PROMPT = `You are Elena Martinez, 53, John's wife of 28 years. You drove him to the emergency department this morning and you are waiting in the relatives' room. You are a school administrator, not a medical person.

What you know, from living with him:
- He came home from work grey and sweating and would not sit down; he said his chest felt crushed
- For about three weeks he has been stopping halfway up the stairs to the flat and telling you it is nothing
- He has high blood pressure and diabetes; he forgets his tablets, especially the morning blood pressure one
- The doctor wrote him a cholesterol prescription two years ago and he never filled it
- He smokes on the balcony, about a pack a day, and always has
- His father died suddenly of a heart attack at 52 and John has been afraid of that his whole life
- His brother had a stent put in at 58
- He is allergic to penicillin (a red itchy rash)
- He took one of your antacids before you left; it did nothing

How you behave:
- Frightened and trying to hold it together; you want to be told plainly what is happening
- You ask whether he is going to die, and whether this is what happened to his father
- You do not understand medical words and ask what they mean
- You are grateful when someone takes the time to explain; upset if you are ignored
- You never invent results or test findings - you do not know any`;

const INTERVENTIONAL_PROMPT = `You are Dr. Priya Raman, the on-call interventional cardiologist. You are in the catheter laboratory finishing another case when the emergency department calls you.

How you work:
- You decide on a patient from what the caller tells you: the history, the ECG, the observations, what has been given. Ask for whatever is missing - a good referral is part of what you are teaching
- If the caller describes a clear STEMI, accept the patient for primary PCI, say the laboratory will be ready in about 20 minutes, and ask what antiplatelet and anticoagulant has been given
- If the referral is vague, ask specific questions: time of onset, which leads show ST elevation, reciprocal change, blood pressure, rhythm, contraindications to antiplatelets
- Advise against fibrinolysis when primary PCI is available within the time window, and say why
- Ask for consent to be discussed with the patient and his family before transfer
- You are brisk, courteous and practical; you do not lecture`;

/**
 * The case's agents, attached by template (type + seeded name), with the
 * per-case override each one needs. Specialists are not listed: the on-call
 * cardiologist stands on this case because it has an ECG (services/
 * standingSpecialists.js), and the lab and radiology stand on every case.
 */
export const STEMI_V2_AGENTS = Object.freeze([
    {
        agent_type: 'nurse', template_name: 'Sarah Mitchell',
        availability_type: 'present',
        config_override: { knowledge: { scope: 'chart', answerKey: false, record: true } },
    },
    {
        agent_type: 'relative', template_name: 'Family Member',
        name_override: 'Elena Martinez',
        system_prompt_override: ELENA_PROMPT,
        availability_type: 'present',
        config_override: {
            knowledge: { scope: 'history', answerKey: false, record: false },
            voice: { gender: 'female', case_voice: 'af_sarah' },
        },
    },
    {
        agent_type: 'consultant', template_name: 'Dr. James Chen',
        name_override: 'Dr. Priya Raman',
        system_prompt_override: INTERVENTIONAL_PROMPT,
        availability_type: 'on-call',
        config_override: {
            // She knows what the caller tells her, plus the handover the
            // server builds — never the chart, never the answer.
            knowledge: { scope: 'handover', answerKey: false, record: false },
            voice: { gender: 'female', case_voice: 'af_kore' },
        },
    },
    {
        agent_type: 'discussant', template_name: 'Default Discussant',
        availability_type: 'present',
        config_override: {
            knowledge: { scope: 'chart', answerKey: true, record: true },
            unlock_trigger: 'after_case_ended',
            show_encounter_record: false,
        },
    },
]);

const med = (treatment_name, fields) => ({ treatment_type: 'medication', treatment_name, is_available: true, is_expected: false, is_contraindicated: false, points_if_ordered: 0, ...fields });
const oxygen = (treatment_name, fields) => ({ ...med(treatment_name, fields), treatment_type: 'oxygen' });

/** The treatment rubric (case_treatments rows). Names match the catalogue. */
export const STEMI_V2_TREATMENTS = Object.freeze([
    med('Aspirin', { is_expected: true, points_if_ordered: 10, feedback_if_ordered: 'Aspirin 300 mg chewed as soon as an acute coronary syndrome is suspected - correct.', feedback_if_missed: 'Aspirin was not given. Unless there is a true aspirin allergy, give 300 mg chewed as soon as the ECG shows STEMI.' }),
    med('Ticagrelor', { is_expected: true, points_if_ordered: 8, feedback_if_ordered: 'Ticagrelor 180 mg loading dose before primary PCI - correct.', feedback_if_missed: 'No P2Y12 inhibitor was given. Load ticagrelor 180 mg (or clopidogrel 600 mg if ticagrelor is unsuitable) before primary PCI.' }),
    med('Clopidogrel', { points_if_ordered: 4, feedback_if_ordered: 'Clopidogrel is an acceptable P2Y12 inhibitor when ticagrelor is unsuitable; ticagrelor is preferred for primary PCI.' }),
    med('Heparin (UFH)', { is_expected: true, points_if_ordered: 6, feedback_if_ordered: 'Unfractionated heparin for primary PCI - correct.', feedback_if_missed: 'No anticoagulant was given. Unfractionated heparin is part of the primary PCI pathway.' }),
    med('Atorvastatin', { is_expected: true, points_if_ordered: 3, feedback_if_ordered: 'Early high-intensity statin (atorvastatin 80 mg) - correct.', feedback_if_missed: 'A high-intensity statin should be started early in an acute coronary syndrome.' }),
    med('Nitroglycerin', { points_if_ordered: 2, feedback_if_ordered: 'Nitrate for ongoing pain is reasonable here: systolic above 90 mmHg, no right ventricular infarct, no phosphodiesterase inhibitor. It treats symptoms, not the occlusion.' }),
    med('Morphine', { points_if_ordered: 0, feedback_if_ordered: 'Opioid for pain unrelieved by nitrate is reasonable in small titrated doses. It slows the absorption of oral P2Y12 inhibitors, so use it sparingly.' }),
    med('Fentanyl', { points_if_ordered: 0, feedback_if_ordered: 'Titrated opioid for refractory pain is reasonable; it slows the absorption of oral P2Y12 inhibitors.' }),
    med('Ondansetron', { points_if_ordered: 1, feedback_if_ordered: 'An antiemetic for nausea, especially with opioids - reasonable.' }),
    med('Metoprolol', { points_if_ordered: 0, feedback_if_ordered: 'Not needed in the first hour. Avoid intravenous beta-blockers early in a large anterior infarct; start an oral beta-blocker once he is stable after PCI.' }),
    med('Tenecteplase', { is_contraindicated: true, points_if_ordered: -5, feedback_if_ordered: 'Fibrinolysis is not indicated: primary PCI is available within the guideline window, and lysis adds bleeding risk without benefit.' }),
    med('Alteplase (tPA)', { is_contraindicated: true, points_if_ordered: -5, feedback_if_ordered: 'Fibrinolysis is not indicated: primary PCI is available within the guideline window.' }),
    med('Ibuprofen', { is_contraindicated: true, points_if_ordered: -5, feedback_if_ordered: 'NSAIDs increase the risk of reinfarction, heart failure and death after myocardial infarction. Stop his regular ibuprofen too.' }),
    oxygen('Nasal Cannula 2L/min', { points_if_ordered: -1, feedback_if_ordered: 'His saturation is 95 per cent on air. Routine oxygen does not help a non-hypoxaemic patient with myocardial infarction; give it only below 90 per cent.' }),
    oxygen('Non-Rebreather Mask 15L/min', { is_contraindicated: true, points_if_ordered: -3, feedback_if_ordered: 'High-flow oxygen at a saturation of 95 per cent is not indicated; hyperoxia may extend infarct size. Give oxygen only below 90 per cent.' }),
]);
