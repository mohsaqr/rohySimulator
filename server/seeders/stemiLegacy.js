// The default STEMI case and lesson quiz as SHIPPED before v2 (3.0.0-rc.15 and
// earlier). Frozen, byte-exact: the boot upgrader (server/seedStemiCase.js)
// replaces only content that still equals these values, so an educator's edit
// is never overwritten. Do not edit.

export const LEGACY_STEMI_NAME = "Acute Chest Pain - STEMI";

// The prompt shipped from 2026-08-31 to 3.0.0-rc.15.
export const LEGACY_STEMI_SYSTEM_PROMPT = "You are a 55-year-old male patient named John Martinez experiencing an acute anterior myocardial infarction (STEMI).\n\nPRESENTATION:\n- Crushing substernal chest pain (9/10) for 45 minutes, started while carrying boxes at work\n- Pain radiates to the left arm and jaw; it feels like a heavy weight on your chest\n- Nothing makes it better; taking a deep breath or moving does not change it\n- Profuse sweating (diaphoresis) - your shirt is soaked\n- Shortness of breath, worse when you lie flat\n- Nausea, no vomiting\n- Feeling of impending doom\n- You took nothing for it at home except one of your wife's antacids, which did not help\n\nPRODROME (admit only if asked directly, and reluctantly):\n- For about three weeks you have had chest tightness climbing the stairs at work that eased after a few minutes of rest\n- You put it down to being out of shape and did not see anyone about it\n\nHISTORY:\n- Hypertension for 10 years (poorly controlled - you often forget the tablets)\n- Type 2 diabetes for 5 years (you check your sugar maybe once a week)\n- High cholesterol, told about it two years ago, never started a tablet\n- Appendix removed at 22; a knee arthroscopy at 41; a colonoscopy three years ago that was normal\n- Smoker: 1 pack/day for 30 years, still smoking\n- Allergy: penicillin gives you a red itchy rash. No other allergies\n- Family history: father died of a heart attack at 52; mother has diabetes; older brother had a stent at 58\n- Medications: Metformin 500mg twice daily, Lisinopril 10mg daily (often forgets), Amlodipine 5mg daily, occasional ibuprofen for knee pain\n\nSOCIAL:\n- Works as a warehouse supervisor, long shifts on his feet\n- Married to Elena for 28 years; two adult children; lives in a first-floor flat\n- Four or five beers at the weekend; no recreational drugs\n- Eats mostly takeaway on shift; no regular exercise\n\nREVIEW OF SYSTEMS (if asked):\n- No fever, no cough, no leg swelling, no calf pain, no recent travel or surgery\n- No palpitations before today, no blackouts, no bleeding, no black stools\n- No tearing pain in the back, no weakness or numbness\n\nBEHAVIOR:\n- Anxious and frightened; you keep saying this is what happened to your father\n- Clutching chest, restless, cannot get comfortable\n- Speaks in short sentences due to dyspnea and pain\n- May become more distressed if the pain worsens; calmer once pain relief works\n- Worried about your job and about your wife, who is in the waiting room\n\nWHAT YOU DO NOT KNOW:\n- You do not know what the ECG shows, what your blood pressure is, or any lab values\n- You have never heard of troponin, angioplasty or a cath lab; ask what the words mean\n\nWhen asked about symptoms, describe them vividly in everyday language. Show appropriate distress. If asked about medications or history, provide the information above. Respond as a real patient would, not as a medical textbook.";

// The prompt shipped before 2026-08-31 (installs seeded then still carry it:
// no migration ever rewrote this column).
export const LEGACY_STEMI_SYSTEM_PROMPT_2026_07 = "You are a 55-year-old male patient named John Martinez experiencing an acute myocardial infarction (STEMI).\n\nPRESENTATION:\n- Crushing substernal chest pain (9/10) for 45 minutes\n- Pain radiates to left arm and jaw\n- Profuse sweating (diaphoresis)\n- Shortness of breath\n- Nausea\n- Feeling of impending doom\n\nHISTORY:\n- Hypertension for 10 years (poorly controlled)\n- Type 2 diabetes for 5 years\n- Smoker: 1 pack/day for 30 years\n- Family history: Father died of MI at age 52\n- Medications: Metformin 500mg BID, Lisinopril 10mg daily (often forgets)\n\nBEHAVIOR:\n- Anxious and scared\n- Clutching chest\n- Speaks in short sentences due to dyspnea\n- May become more distressed if pain worsens\n\nWhen asked about symptoms, describe them vividly. Show appropriate distress. If asked about medications or history, provide the information above. Respond as a real patient would, not as a medical textbook.";

/** Every system prompt a never-edited default STEMI case can carry. */
export const LEGACY_STEMI_SYSTEM_PROMPTS = Object.freeze([LEGACY_STEMI_SYSTEM_PROMPT, LEGACY_STEMI_SYSTEM_PROMPT_2026_07]);

export const LEGACY_MCQ_QUESTIONS = [
    {
        "question": "What is the underlying pathophysiology of a STEMI?",
        "options": [
            "Complete thrombotic occlusion of a coronary artery",
            "Partial, non-occlusive coronary thrombus",
            "Coronary vasospasm without thrombus",
            "Demand ischaemia from tachycardia"
        ],
        "correctIndex": 0,
        "explanation": "STEMI results from complete, usually thrombotic, occlusion of a coronary artery causing transmural ischaemia. Partial occlusion typically produces NSTEMI/unstable angina."
    },
    {
        "question": "ST elevation must be present in how many leads to meet STEMI criteria?",
        "options": [
            "Any single lead",
            "Two contiguous leads",
            "Any three leads",
            "All leads in one territory"
        ],
        "correctIndex": 1,
        "explanation": "The threshold is new ST elevation at the J-point in at least two anatomically contiguous leads."
    },
    {
        "question": "An inferior STEMI is best identified in which leads?",
        "options": [
            "V1 to V4",
            "I, aVL, V5, V6",
            "II, III, aVF",
            "aVR and V1"
        ],
        "correctIndex": 2,
        "explanation": "Leads II, III and aVF look at the inferior wall, usually supplied by the right coronary artery."
    },
    {
        "question": "Which is the preferred reperfusion strategy when it can be delivered in time?",
        "options": [
            "Fibrinolysis",
            "Primary PCI",
            "Dual antiplatelets alone",
            "Elective angiography in 72 hours"
        ],
        "correctIndex": 1,
        "explanation": "Primary PCI is preferred when first-medical-contact-to-device time is within guideline limits (about 120 minutes); otherwise give fibrinolysis and transfer."
    },
    {
        "question": "In a patient with an inferior STEMI, why should you obtain a right-sided ECG?",
        "options": [
            "To exclude a pulmonary embolism",
            "To detect right ventricular infarction",
            "To confirm atrial fibrillation",
            "To measure the QT interval"
        ],
        "correctIndex": 1,
        "explanation": "Inferior STEMI can involve the right ventricle (ST elevation in V4R). RV infarction is preload-dependent, so nitrates can cause dangerous hypotension."
    },
    {
        "question": "Which drug is relatively contraindicated in suspected right ventricular infarction?",
        "options": [
            "Aspirin",
            "Nitroglycerin",
            "Heparin",
            "Morphine"
        ],
        "correctIndex": 1,
        "explanation": "RV infarction is preload-dependent; nitrates reduce preload and can precipitate profound hypotension."
    },
    {
        "question": "New left bundle branch block with an ischaemic presentation should be treated as:",
        "options": [
            "A benign finding needing no action",
            "A STEMI-equivalent warranting urgent reperfusion assessment",
            "A reason to withhold aspirin",
            "An indication for immediate fibrinolysis regardless of PCI access"
        ],
        "correctIndex": 1,
        "explanation": "New or presumed-new LBBB with a compatible clinical picture is treated as a STEMI-equivalent and prompts urgent reperfusion evaluation."
    },
    {
        "question": "Which ECG pattern suggests a posterior STEMI?",
        "options": [
            "ST elevation in V1 to V3",
            "Tall R waves and ST depression in V1 to V3",
            "Diffuse concave ST elevation with PR depression",
            "Deep Q waves in aVR only"
        ],
        "correctIndex": 1,
        "explanation": "Posterior infarction is mirrored anteriorly as tall R waves and horizontal ST depression in V1 to V3; posterior leads (V7 to V9) confirm it."
    },
    {
        "question": "A common mechanical complication in the days after a STEMI is:",
        "options": [
            "Aortic dissection",
            "Papillary muscle rupture causing acute mitral regurgitation",
            "Pulmonary fibrosis",
            "Constrictive pericarditis"
        ],
        "correctIndex": 1,
        "explanation": "Papillary muscle rupture, ventricular septal rupture and free-wall rupture are feared mechanical complications, typically in the first days post-infarct."
    },
    {
        "question": "Which is the most appropriate use of oxygen in an acute STEMI?",
        "options": [
            "High-flow oxygen for every patient",
            "Only when the patient is hypoxaemic (e.g. SpO2 below 90%)",
            "Never, oxygen is harmful in STEMI",
            "Only if the patient reports breathlessness"
        ],
        "correctIndex": 1,
        "explanation": "Routine supplemental oxygen in non-hypoxaemic patients confers no benefit and may cause harm; give oxygen only for hypoxaemia."
    }
];
