/**
 * Pre-configured Lab Panel Templates
 * Common clinical scenarios with appropriate abnormal values
 * Test names must match exactly with Lab_database.txt or heart.txt
 */

export const LAB_PANEL_TEMPLATES = {
    // ==================== CARDIAC PANELS ====================
    acute_mi: {
        name: "Acute MI Panel",
        description: "STEMI/NSTEMI with elevated cardiac markers",
        category: "Cardiac",
        tests: [
            { test_name: "Troponin I, cardiac", preset: "critical_high", value_multiplier: 50 },
            { test_name: "Troponin T, cardiac", preset: "critical_high", value_multiplier: 40 },
            { test_name: "High-Sensitivity Troponin I", preset: "critical_high", value_multiplier: 20 },
            { test_name: "Creatine Kinase-MB (CK-MB)", preset: "high", value_multiplier: 3 },
            { test_name: "Creatine Kinase (CK), Total", preset: "high", value_multiplier: 2.5 },
            { test_name: "BNP (B-type Natriuretic Peptide)", preset: "high", value_multiplier: 4 },
            { test_name: "Myoglobin, serum", preset: "high", value_multiplier: 5 }
        ]
    },

    heart_failure: {
        name: "Heart Failure Panel",
        description: "Congestive heart failure with fluid overload",
        category: "Cardiac",
        tests: [
            { test_name: "BNP (B-type Natriuretic Peptide)", preset: "critical_high", value_multiplier: 10 },
            { test_name: "NT-proBNP", preset: "critical_high", value_multiplier: 8 },
            { test_name: "Sodium, serum", preset: "low", value_multiplier: 0.95 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 1.8 },
            { test_name: "Blood Urea Nitrogen (BUN)", preset: "high", value_multiplier: 2 }
        ]
    },

    unstable_angina: {
        name: "Unstable Angina",
        description: "ACS without significant troponin rise",
        category: "Cardiac",
        tests: [
            { test_name: "Troponin I, cardiac", preset: "normal" },
            { test_name: "High-Sensitivity Troponin I", preset: "high", value_multiplier: 1.5 },
            { test_name: "BNP (B-type Natriuretic Peptide)", preset: "high", value_multiplier: 2 },
            { test_name: "Creatine Kinase (CK), Total", preset: "normal" }
        ]
    },

    // ==================== DIABETES PANELS ====================
    dka: {
        name: "Diabetic Ketoacidosis (DKA)",
        description: "Severe DKA with metabolic acidosis",
        category: "Diabetes",
        tests: [
            { test_name: "Glucose, fasting", preset: "critical_high", custom_value: 450 },
            { test_name: "HbA1c (Glycated Hemoglobin)", preset: "critical_high", custom_value: 12 },
            { test_name: "pH, arterial blood", preset: "critical_low", custom_value: 7.15 },
            { test_name: "Bicarbonate (CO2), serum", preset: "critical_low", custom_value: 10 },
            { test_name: "Potassium, serum", preset: "high", value_multiplier: 1.3 },
            { test_name: "Sodium, serum", preset: "low", value_multiplier: 0.92 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 1.5 }
        ]
    },

    hhs: {
        name: "Hyperosmolar Hyperglycemic State",
        description: "HHS with severe hyperglycemia and dehydration",
        category: "Diabetes",
        tests: [
            { test_name: "Glucose, fasting", preset: "critical_high", custom_value: 850 },
            { test_name: "HbA1c (Glycated Hemoglobin)", preset: "critical_high", custom_value: 14 },
            { test_name: "Sodium, serum", preset: "high", value_multiplier: 1.08 },
            { test_name: "Blood Urea Nitrogen (BUN)", preset: "critical_high", value_multiplier: 3 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 2.5 },
            { test_name: "pH, arterial blood", preset: "low", custom_value: 7.30 }
        ]
    },

    diabetes_uncontrolled: {
        name: "Uncontrolled Type 2 Diabetes",
        description: "Poor glycemic control with complications",
        category: "Diabetes",
        tests: [
            { test_name: "Glucose, fasting", preset: "high", custom_value: 280 },
            { test_name: "HbA1c (Glycated Hemoglobin)", preset: "critical_high", custom_value: 10.5 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 1.4 },
            { test_name: "Total Cholesterol", preset: "high", value_multiplier: 1.3 },
            { test_name: "LDL Cholesterol", preset: "high", value_multiplier: 1.5 },
            { test_name: "Triglycerides", preset: "high", value_multiplier: 2 }
        ]
    },

    hypoglycemia: {
        name: "Severe Hypoglycemia",
        description: "Critically low blood glucose",
        category: "Diabetes",
        tests: [
            { test_name: "Glucose, fasting", preset: "critical_low", custom_value: 35 },
            { test_name: "Potassium, serum", preset: "low", value_multiplier: 0.85 },
            { test_name: "Cortisol, AM", preset: "high", value_multiplier: 2 }
        ]
    },

    // ==================== CARDIOVASCULAR MORBIDITY ====================
    hypertensive_crisis: {
        name: "Hypertensive Crisis",
        description: "Severe hypertension with end-organ damage",
        category: "Cardiovascular",
        tests: [
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 2 },
            { test_name: "Blood Urea Nitrogen (BUN)", preset: "high", value_multiplier: 2.5 },
            { test_name: "Troponin I, cardiac", preset: "high", value_multiplier: 3 },
            { test_name: "BNP (B-type Natriuretic Peptide)", preset: "high", value_multiplier: 5 },
            { test_name: "Lactate Dehydrogenase (LDH)", preset: "high", value_multiplier: 1.5 }
        ]
    },

    aortic_dissection: {
        name: "Aortic Dissection",
        description: "Acute aortic dissection",
        category: "Cardiovascular",
        tests: [
            { test_name: "D-dimer, plasma", preset: "critical_high", value_multiplier: 15 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 1.5 },
            { test_name: "Hemoglobin", preset: "low", value_multiplier: 0.8 },
            { test_name: "Lactate, plasma", preset: "high", value_multiplier: 3 }
        ]
    },

    pe: {
        name: "Pulmonary Embolism",
        description: "Acute PE with right heart strain",
        category: "Cardiovascular",
        tests: [
            { test_name: "D-dimer, plasma", preset: "critical_high", value_multiplier: 15 },
            { test_name: "Troponin I, cardiac", preset: "high", value_multiplier: 3 },
            { test_name: "BNP (B-type Natriuretic Peptide)", preset: "high", value_multiplier: 4 },
            { test_name: "pO2, arterial blood", preset: "low", custom_value: 62 }
        ]
    },

    dvt: {
        name: "Deep Vein Thrombosis",
        description: "DVT with elevated coagulation markers",
        category: "Cardiovascular",
        tests: [
            { test_name: "D-dimer, plasma", preset: "critical_high", value_multiplier: 10 },
            { test_name: "Prothrombin Time (PT)", preset: "normal" },
            { test_name: "Partial Thromboplastin Time (PTT)", preset: "normal" }
        ]
    },

    atrial_fibrillation: {
        name: "New Atrial Fibrillation",
        description: "AF with potential underlying cause",
        category: "Cardiovascular",
        tests: [
            { test_name: "TSH", preset: "low", value_multiplier: 0.2 },
            { test_name: "Free T4, serum", preset: "high", value_multiplier: 1.5 },
            { test_name: "Potassium, serum", preset: "low", value_multiplier: 0.85 },
            { test_name: "Magnesium, serum", preset: "low", value_multiplier: 0.8 },
            { test_name: "BNP (B-type Natriuretic Peptide)", preset: "high", value_multiplier: 3 }
        ]
    },

    atherosclerosis: {
        name: "Atherosclerotic Disease",
        description: "Dyslipidemia with cardiovascular risk",
        category: "Cardiovascular",
        tests: [
            { test_name: "Total Cholesterol", preset: "high", custom_value: 280 },
            { test_name: "LDL Cholesterol", preset: "critical_high", custom_value: 190 },
            { test_name: "HDL Cholesterol", preset: "low", custom_value: 32 },
            { test_name: "Triglycerides", preset: "high", custom_value: 350 },
            { test_name: "CRP, serum", preset: "high", value_multiplier: 5 },
            { test_name: "HbA1c (Glycated Hemoglobin)", preset: "high", custom_value: 6.8 }
        ]
    },

    // ==================== RHEUMATOLOGICAL PANELS ====================
    rheumatoid_arthritis: {
        name: "Rheumatoid Arthritis Active",
        description: "Active RA with inflammation",
        category: "Rheumatology",
        tests: [
            { test_name: "Rheumatoid Factor", preset: "critical_high", value_multiplier: 5 },
            { test_name: "CRP, serum", preset: "high", value_multiplier: 8 },
            { test_name: "ESR, blood", preset: "high", value_multiplier: 4 },
            { test_name: "Hemoglobin", preset: "low", value_multiplier: 0.85 },
            { test_name: "Platelet Count", preset: "high", value_multiplier: 1.3 }
        ]
    },

    sle_flare: {
        name: "SLE Flare",
        description: "Systemic lupus erythematosus flare",
        category: "Rheumatology",
        tests: [
            { test_name: "ANA (Antinuclear Antibodies)", preset: "critical_high", value_multiplier: 10 },
            { test_name: "Complement C3", preset: "low", value_multiplier: 0.5 },
            { test_name: "Complement C4", preset: "low", value_multiplier: 0.4 },
            { test_name: "ESR, blood", preset: "high", value_multiplier: 5 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 1.8 },
            { test_name: "White Blood Cell Count (WBC)", preset: "low", value_multiplier: 0.6 },
            { test_name: "Platelet Count", preset: "low", value_multiplier: 0.7 }
        ]
    },

    gout_acute: {
        name: "Acute Gout Attack",
        description: "Acute gouty arthritis",
        category: "Rheumatology",
        tests: [
            { test_name: "Uric Acid, serum", preset: "critical_high", custom_value: 12 },
            { test_name: "CRP, serum", preset: "high", value_multiplier: 10 },
            { test_name: "ESR, blood", preset: "high", value_multiplier: 3 },
            { test_name: "White Blood Cell Count (WBC)", preset: "high", value_multiplier: 1.5 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 1.3 }
        ]
    },

    polymyalgia_rheumatica: {
        name: "Polymyalgia Rheumatica",
        description: "PMR with marked inflammation",
        category: "Rheumatology",
        tests: [
            { test_name: "ESR, blood", preset: "critical_high", value_multiplier: 6 },
            { test_name: "CRP, serum", preset: "critical_high", value_multiplier: 15 },
            { test_name: "Hemoglobin", preset: "low", value_multiplier: 0.8 },
            { test_name: "Platelet Count", preset: "high", value_multiplier: 1.4 },
            { test_name: "Alkaline Phosphatase (ALP)", preset: "high", value_multiplier: 1.5 }
        ]
    },

    ankylosing_spondylitis: {
        name: "Ankylosing Spondylitis",
        description: "Active AS with inflammation",
        category: "Rheumatology",
        tests: [
            { test_name: "CRP, serum", preset: "high", value_multiplier: 6 },
            { test_name: "ESR, blood", preset: "high", value_multiplier: 3 },
            { test_name: "Hemoglobin", preset: "low", value_multiplier: 0.9 }
        ]
    },

    vasculitis: {
        name: "Systemic Vasculitis",
        description: "ANCA-associated vasculitis",
        category: "Rheumatology",
        tests: [
            { test_name: "CRP, serum", preset: "critical_high", value_multiplier: 12 },
            { test_name: "ESR, blood", preset: "critical_high", value_multiplier: 5 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 2.5 },
            { test_name: "Hemoglobin", preset: "low", value_multiplier: 0.75 },
            { test_name: "White Blood Cell Count (WBC)", preset: "high", value_multiplier: 1.8 }
        ]
    },

    // ==================== SEPSIS/INFECTION ====================
    sepsis: {
        name: "Sepsis Panel",
        description: "Severe sepsis with organ dysfunction",
        category: "Infection",
        tests: [
            { test_name: "White Blood Cell Count (WBC)", preset: "critical_high", value_multiplier: 2.5 },
            { test_name: "Lactate, plasma", preset: "critical_high", custom_value: 6.5 },
            { test_name: "Procalcitonin, serum", preset: "critical_high", value_multiplier: 20 },
            { test_name: "CRP, serum", preset: "critical_high", value_multiplier: 15 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 2.2 },
            { test_name: "Platelet Count", preset: "low", value_multiplier: 0.4 },
            { test_name: "Bilirubin, Total", preset: "high", value_multiplier: 3 }
        ]
    },

    // ==================== RENAL ====================
    aki: {
        name: "Acute Kidney Injury",
        description: "Stage 3 AKI with uremia",
        category: "Renal",
        tests: [
            { test_name: "Creatinine, serum", preset: "critical_high", value_multiplier: 4 },
            { test_name: "Blood Urea Nitrogen (BUN)", preset: "critical_high", value_multiplier: 5 },
            { test_name: "Potassium, serum", preset: "high", value_multiplier: 1.4 },
            { test_name: "Phosphorus, serum", preset: "high", value_multiplier: 1.8 },
            { test_name: "Bicarbonate (CO2), serum", preset: "low", value_multiplier: 0.7 },
            { test_name: "Calcium, serum", preset: "low", value_multiplier: 0.85 }
        ]
    },

    ckd_stage5: {
        name: "CKD Stage 5 / ESRD",
        description: "End-stage renal disease",
        category: "Renal",
        tests: [
            { test_name: "Creatinine, serum", preset: "critical_high", custom_value: 8.5 },
            { test_name: "Blood Urea Nitrogen (BUN)", preset: "critical_high", custom_value: 95 },
            { test_name: "GFR (estimated)", preset: "critical_low", custom_value: 8 },
            { test_name: "Potassium, serum", preset: "high", value_multiplier: 1.35 },
            { test_name: "Hemoglobin", preset: "low", value_multiplier: 0.65 },
            { test_name: "PTH (Parathyroid Hormone)", preset: "critical_high", value_multiplier: 8 }
        ]
    },

    // ==================== HEPATIC ====================
    acute_hepatitis: {
        name: "Acute Hepatitis",
        description: "Acute viral or toxic hepatitis",
        category: "Hepatic",
        tests: [
            { test_name: "ALT (SGPT)", preset: "critical_high", value_multiplier: 30 },
            { test_name: "AST (SGOT)", preset: "critical_high", value_multiplier: 25 },
            { test_name: "Bilirubin, Total", preset: "high", value_multiplier: 8 },
            { test_name: "Bilirubin, Direct", preset: "high", value_multiplier: 10 },
            { test_name: "Alkaline Phosphatase (ALP)", preset: "high", value_multiplier: 2 },
            { test_name: "INR", preset: "high", custom_value: 1.8 },
            { test_name: "Albumin, serum", preset: "low", value_multiplier: 0.7 }
        ]
    },

    liver_cirrhosis: {
        name: "Liver Cirrhosis",
        description: "Decompensated cirrhosis",
        category: "Hepatic",
        tests: [
            { test_name: "Albumin, serum", preset: "critical_low", value_multiplier: 0.5 },
            { test_name: "INR", preset: "high", custom_value: 2.2 },
            { test_name: "Bilirubin, Total", preset: "high", value_multiplier: 5 },
            { test_name: "Platelet Count", preset: "low", value_multiplier: 0.4 },
            { test_name: "Sodium, serum", preset: "low", value_multiplier: 0.92 },
            { test_name: "Ammonia, plasma", preset: "high", value_multiplier: 3 }
        ]
    },

    // ==================== HEMATOLOGIC ====================
    anemia_iron_def: {
        name: "Iron Deficiency Anemia",
        description: "Severe iron deficiency anemia",
        category: "Hematologic",
        tests: [
            { test_name: "Hemoglobin", preset: "low", value_multiplier: 0.55 },
            { test_name: "Hematocrit", preset: "low", value_multiplier: 0.55 },
            { test_name: "Mean Corpuscular Volume (MCV)", preset: "low", value_multiplier: 0.8 },
            { test_name: "Iron, serum", preset: "critical_low", value_multiplier: 0.2 },
            { test_name: "Ferritin, serum", preset: "critical_low", custom_value: 5 },
            { test_name: "TIBC (Total Iron Binding Capacity)", preset: "high", value_multiplier: 1.5 }
        ]
    },

    dic: {
        name: "DIC",
        description: "Disseminated intravascular coagulation",
        category: "Hematologic",
        tests: [
            { test_name: "Platelet Count", preset: "critical_low", value_multiplier: 0.25 },
            { test_name: "Prothrombin Time (PT)", preset: "high", value_multiplier: 1.8 },
            { test_name: "Partial Thromboplastin Time (PTT)", preset: "high", value_multiplier: 1.6 },
            { test_name: "INR", preset: "high", custom_value: 2.5 },
            { test_name: "Fibrinogen", preset: "critical_low", value_multiplier: 0.3 },
            { test_name: "D-dimer, plasma", preset: "critical_high", value_multiplier: 20 }
        ]
    },

    // ==================== ELECTROLYTE ====================
    hyponatremia: {
        name: "Severe Hyponatremia",
        description: "Symptomatic hyponatremia",
        category: "Electrolyte",
        tests: [
            { test_name: "Sodium, serum", preset: "critical_low", custom_value: 118 },
            { test_name: "Osmolality, serum", preset: "low", custom_value: 250 }
        ]
    },

    hyperkalemia: {
        name: "Severe Hyperkalemia",
        description: "Life-threatening hyperkalemia",
        category: "Electrolyte",
        tests: [
            { test_name: "Potassium, serum", preset: "critical_high", custom_value: 7.2 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 2.5 },
            { test_name: "pH, arterial blood", preset: "low", custom_value: 7.28 }
        ]
    },

    // ==================== ENDOCRINE ====================
    thyroid_storm: {
        name: "Thyroid Storm",
        description: "Severe thyrotoxicosis",
        category: "Endocrine",
        tests: [
            { test_name: "TSH", preset: "critical_low", custom_value: 0.01 },
            { test_name: "Free T4, serum", preset: "critical_high", value_multiplier: 4 },
            { test_name: "Free T3, serum", preset: "critical_high", value_multiplier: 3.5 }
        ]
    },

    myxedema: {
        name: "Myxedema Coma",
        description: "Severe hypothyroidism",
        category: "Endocrine",
        tests: [
            { test_name: "TSH", preset: "critical_high", custom_value: 85 },
            { test_name: "Free T4, serum", preset: "critical_low", value_multiplier: 0.2 },
            { test_name: "Sodium, serum", preset: "low", value_multiplier: 0.92 },
            { test_name: "Glucose, fasting", preset: "low", value_multiplier: 0.7 }
        ]
    },

    // ==================== PANCREATITIS ====================
    acute_pancreatitis: {
        name: "Acute Pancreatitis",
        description: "Severe acute pancreatitis",
        category: "GI",
        tests: [
            { test_name: "Lipase, serum", preset: "critical_high", value_multiplier: 15 },
            { test_name: "Amylase, serum", preset: "critical_high", value_multiplier: 8 },
            { test_name: "White Blood Cell Count (WBC)", preset: "high", value_multiplier: 1.8 },
            { test_name: "Calcium, serum", preset: "low", value_multiplier: 0.8 },
            { test_name: "Glucose, fasting", preset: "high", value_multiplier: 1.8 },
            { test_name: "Lactate Dehydrogenase (LDH)", preset: "high", value_multiplier: 2.5 }
        ]
    },

    // ==================== RHABDOMYOLYSIS ====================
    rhabdomyolysis: {
        name: "Rhabdomyolysis",
        description: "Muscle breakdown with AKI risk",
        category: "Musculoskeletal",
        tests: [
            { test_name: "Creatine Kinase (CK), Total", preset: "critical_high", custom_value: 45000 },
            { test_name: "Myoglobin, serum", preset: "critical_high", value_multiplier: 50 },
            { test_name: "Potassium, serum", preset: "high", value_multiplier: 1.4 },
            { test_name: "Phosphorus, serum", preset: "high", value_multiplier: 1.6 },
            { test_name: "Calcium, serum", preset: "low", value_multiplier: 0.75 },
            { test_name: "Creatinine, serum", preset: "high", value_multiplier: 2.5 },
            { test_name: "Uric Acid, serum", preset: "high", value_multiplier: 2 }
        ]
    }
};

// Helper to get all categories
export const getTemplateCategories = () => {
    const categories = new Set();
    Object.values(LAB_PANEL_TEMPLATES).forEach(template => {
        categories.add(template.category);
    });
    return Array.from(categories).sort();
};

// Helper to get templates by category
export const getTemplatesByCategory = (category) => {
    return Object.entries(LAB_PANEL_TEMPLATES)
        .filter(([_, template]) => template.category === category)
        .map(([key, template]) => ({ key, ...template }));
};

// Search aliases for smart search
export const SEARCH_ALIASES = {
    // Common abbreviations
    'cbc': ['WBC', 'RBC', 'Hemoglobin', 'Hematocrit', 'Platelet count', 'MCV', 'MCH', 'MCHC'],
    'bmp': ['Sodium', 'Potassium', 'Chloride', 'Bicarbonate', 'BUN', 'Creatinine', 'Glucose'],
    'cmp': ['Sodium', 'Potassium', 'Chloride', 'Bicarbonate', 'BUN', 'Creatinine', 'Glucose', 'Calcium', 'Albumin', 'Bilirubin', 'ALT', 'AST', 'Alkaline phosphatase'],
    'lft': ['ALT', 'AST', 'Alkaline phosphatase', 'Bilirubin', 'Albumin', 'GGT'],
    'lfts': ['ALT', 'AST', 'Alkaline phosphatase', 'Bilirubin', 'Albumin', 'GGT'],
    'rft': ['Creatinine', 'BUN', 'GFR'],
    'kft': ['Creatinine', 'BUN', 'GFR'],
    'abg': ['pH', 'pCO2', 'pO2', 'Bicarbonate', 'Base excess'],
    'coags': ['PT', 'PTT', 'INR', 'Fibrinogen', 'D-dimer'],
    'coagulation': ['PT', 'PTT', 'INR', 'Fibrinogen', 'D-dimer'],

    // Cardiac
    'cardiac': ['Troponin', 'BNP', 'Myoglobin', 'Creatine Kinase', 'NT-pro', 'Natriuretic', 'cardiac'],
    'cardiac markers': ['Troponin', 'BNP', 'Myoglobin', 'Creatine Kinase', 'NT-pro'],
    'cardiology': ['Troponin', 'BNP', 'Myoglobin', 'Creatine Kinase', 'NT-pro', 'Natriuretic', 'cardiac'],
    'cardiology crisis': ['Troponin', 'BNP', 'Myoglobin', 'Creatine Kinase', 'NT-pro', 'Natriuretic'],
    'acs': ['Troponin', 'BNP', 'Myoglobin'],
    'mi': ['Troponin', 'BNP', 'Myoglobin'],
    'stemi': ['Troponin', 'BNP', 'Myoglobin'],
    'nstemi': ['Troponin', 'BNP', 'Myoglobin'],
    'trop': ['Troponin'],
    'troponin': ['Troponin I', 'Troponin T', 'cardiac'],
    'bnp': ['BNP', 'NT-pro', 'Natriuretic'],

    // Thyroid
    'thyroid': ['TSH', 'T4', 'T3', 'Free T4', 'Free T3'],
    'tft': ['TSH', 'T4', 'T3', 'Free T4', 'Free T3'],

    // Rheumatology
    'rheum': ['RF', 'ANA', 'CRP', 'ESR', 'Complement', 'Uric acid'],
    'rheumatology': ['RF', 'ANA', 'CRP', 'ESR', 'Complement', 'Uric acid', 'Rheumatoid'],
    'arthritis': ['RF', 'CRP', 'ESR', 'Uric acid', 'Rheumatoid'],
    'lupus': ['ANA', 'Complement', 'C3', 'C4'],
    'gout': ['Uric acid'],

    // Diabetes
    'diabetes': ['Glucose', 'HbA1c', 'Hemoglobin A1c'],
    'dm': ['Glucose', 'HbA1c', 'Hemoglobin A1c'],
    'a1c': ['Hemoglobin A1c', 'HbA1c'],
    'hba1c': ['Hemoglobin A1c', 'HbA1c'],

    // Other
    'iron studies': ['Iron', 'Ferritin', 'TIBC', 'Transferrin'],
    'lipid': ['Cholesterol', 'Triglycerides', 'HDL', 'LDL'],
    'lipid panel': ['Cholesterol', 'Triglycerides', 'HDL', 'LDL'],
    'electrolytes': ['Sodium', 'Potassium', 'Chloride', 'Bicarbonate', 'Magnesium', 'Phosphorus', 'Calcium'],
    'lytes': ['Sodium', 'Potassium', 'Chloride', 'Bicarbonate'],
    'inflammatory': ['CRP', 'ESR', 'Procalcitonin'],
    'sepsis': ['Lactate', 'Procalcitonin', 'WBC', 'CRP'],

    // Abbreviations
    'na': ['Sodium'],
    'k': ['Potassium'],
    'ca': ['Calcium'],
    'mg': ['Magnesium'],
    'phos': ['Phosphorus'],
    'cr': ['Creatinine'],
    'alt': ['ALT'],
    'ast': ['AST'],
    'alp': ['Alkaline phosphatase'],
    'bili': ['Bilirubin'],
    'alb': ['Albumin'],
    'hgb': ['Hemoglobin'],
    'hb': ['Hemoglobin'],
    'hct': ['Hematocrit'],
    'plt': ['Platelet'],
    'wbc': ['WBC', 'White blood'],
    'rbc': ['RBC', 'Red blood'],
    'inr': ['INR'],
    'pt': ['PT', 'Prothrombin'],
    'ptt': ['PTT'],
    'esr': ['ESR', 'Sedimentation'],
    'crp': ['CRP', 'C-reactive'],
    'rf': ['Rheumatoid factor']
};

export default LAB_PANEL_TEMPLATES;
