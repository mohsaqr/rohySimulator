/**
 * Scenario Templates
 * Pre-built deterioration and recovery patterns for common clinical situations
 */

export const SCENARIO_TEMPLATES = {
  septic_shock: {
    name: "Septic Shock Progression",
    description: "Vasodilation leading to severe hypotension and hypoxia - late stage",
    duration: 40, // minutes (adjustable)
    timeline: [
      {
        time: 0,
        label: "Early sepsis - mild tachycardia and fever",
        params: { hr: 95, spo2: 94, rr: 20, bpSys: 110, bpDia: 70, temp: 38.5, etco2: 35 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 15 * 60, // 15 minutes
        label: "Progressive shock - tachycardia worsens, BP drops",
        params: { hr: 115, spo2: 90, rr: 26, bpSys: 90, bpDia: 50, temp: 39.5, etco2: 32 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 }
      },
      {
        time: 30 * 60, // 30 minutes
        label: "Severe shock - profound hypotension",
        params: { hr: 135, spo2: 85, rr: 32, bpSys: 70, bpDia: 35, temp: 39.5, etco2: 28 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 }
      },
      {
        time: 40 * 60, // 40 minutes
        label: "Late stage - critical hypotension and hypoxia",
        params: { hr: 145, spo2: 80, rr: 36, bpSys: 60, bpDia: 25, temp: 39.8, etco2: 26 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 3 }
      }
    ]
  },

  stemi_progression: {
    name: "STEMI Progression",
    description: "Acute MI progressing to cardiogenic shock - late stage",
    duration: 40, // minutes (adjustable)
    timeline: [
      {
        time: 0,
        label: "Initial presentation - chest pain, mild tachycardia",
        params: { hr: 80, spo2: 98, rr: 16, bpSys: 125, bpDia: 82, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 10 * 60, // 10 minutes
        label: "STEMI develops - ST elevation appears",
        params: { hr: 110, spo2: 96, rr: 22, bpSys: 145, bpDia: 95, temp: 37.0, etco2: 40 },
        conditions: { stElev: 2.0, pvc: false, wideQRS: false, tInv: false, noise: 0 }
      },
      {
        time: 25 * 60, // 25 minutes
        label: "Worsening ischemia - PVCs appear, BP drops",
        params: { hr: 125, spo2: 92, rr: 26, bpSys: 100, bpDia: 60, temp: 37.0, etco2: 42 },
        conditions: { stElev: 2.5, pvc: true, wideQRS: false, tInv: false, noise: 1 }
      },
      {
        time: 40 * 60, // 40 minutes
        label: "Late stage - cardiogenic shock develops",
        params: { hr: 135, spo2: 85, rr: 28, bpSys: 70, bpDia: 45, temp: 37.0, etco2: 44 },
        conditions: { stElev: 2.5, pvc: true, wideQRS: false, tInv: false, noise: 2 }
      }
    ]
  },

  hypertensive_crisis: {
    name: "Hypertensive Crisis",
    description: "Rapid increase in blood pressure leading to end-organ damage",
    duration: 45, // minutes
    timeline: [
      {
        time: 0,
        label: "Baseline - mildly elevated BP",
        params: { hr: 75, spo2: 99, rr: 14, bpSys: 130, bpDia: 85, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 15 * 60, // 15 minutes
        label: "Hypertension worsens - tachycardia develops",
        params: { hr: 90, spo2: 98, rr: 18, bpSys: 180, bpDia: 110, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 }
      },
      {
        time: 30 * 60, // 30 minutes
        label: "Crisis - very high BP, ST depression",
        params: { hr: 105, spo2: 96, rr: 22, bpSys: 220, bpDia: 130, temp: 37.0, etco2: 36 },
        conditions: { stElev: -1.0, pvc: false, wideQRS: false, tInv: false, noise: 0 }
      },
      {
        time: 45 * 60, // 45 minutes
        label: "Extreme hypertension - risk of stroke/MI",
        params: { hr: 115, spo2: 95, rr: 24, bpSys: 240, bpDia: 150, temp: 37.0, etco2: 35 },
        conditions: { stElev: -1.0, pvc: false, wideQRS: false, tInv: true, noise: 1 }
      }
    ]
  },

  respiratory_failure: {
    name: "Progressive Respiratory Failure",
    description: "Gradual onset of hypoxia and hypercapnia - late stage",
    duration: 30, // minutes (adjustable)
    timeline: [
      {
        time: 0,
        label: "Early respiratory distress",
        params: { hr: 90, spo2: 93, rr: 24, bpSys: 125, bpDia: 80, temp: 37.0, etco2: 42 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 10 * 60, // 10 minutes
        label: "Worsening hypoxia - compensatory tachypnea",
        params: { hr: 100, spo2: 88, rr: 32, bpSys: 130, bpDia: 85, temp: 37.0, etco2: 48 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 }
      },
      {
        time: 20 * 60, // 20 minutes
        label: "Severe hypoxia and hypercapnia",
        params: { hr: 115, spo2: 82, rr: 36, bpSys: 140, bpDia: 90, temp: 37.5, etco2: 54 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 }
      },
      {
        time: 30 * 60, // 30 minutes
        label: "Late stage - severe respiratory compromise",
        params: { hr: 125, spo2: 78, rr: 38, bpSys: 145, bpDia: 92, temp: 37.5, etco2: 60 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 3 }
      }
    ]
  },

  post_resuscitation_recovery: {
    name: "Post-Resuscitation Recovery",
    description: "Patient recovery after successful CPR and ROSC",
    duration: 30, // minutes
    timeline: [
      {
        time: 0,
        label: "ROSC achieved - unstable vitals",
        params: { hr: 145, spo2: 75, rr: 8, bpSys: 65, bpDia: 35, temp: 35.5, etco2: 25 },
        conditions: { stElev: 0, pvc: true, wideQRS: false, tInv: false, noise: 3 },
        rhythm: "NSR"
      },
      {
        time: 5 * 60, // 5 minutes
        label: "Stabilizing - oxygen improving",
        params: { hr: 125, spo2: 85, rr: 14, bpSys: 80, bpDia: 50, temp: 35.8, etco2: 32 },
        conditions: { stElev: 0, pvc: true, wideQRS: false, tInv: false, noise: 2 }
      },
      {
        time: 15 * 60, // 15 minutes
        label: "Continued improvement",
        params: { hr: 105, spo2: 92, rr: 18, bpSys: 95, bpDia: 60, temp: 36.2, etco2: 36 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 }
      },
      {
        time: 30 * 60, // 30 minutes
        label: "Stable post-arrest state",
        params: { hr: 88, spo2: 96, rr: 16, bpSys: 110, bpDia: 70, temp: 36.5, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 }
      }
    ]
  },

  anaphylaxis: {
    name: "Anaphylactic Shock",
    description: "Rapid onset of severe allergic reaction - late stage",
    duration: 10, // minutes (adjustable)
    timeline: [
      {
        time: 0,
        label: "Initial exposure - mild symptoms",
        params: { hr: 85, spo2: 98, rr: 16, bpSys: 120, bpDia: 80, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 2 * 60, // 2 minutes
        label: "Rapid onset - tachycardia, bronchospasm",
        params: { hr: 115, spo2: 92, rr: 28, bpSys: 100, bpDia: 65, temp: 37.0, etco2: 42 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 }
      },
      {
        time: 5 * 60, // 5 minutes
        label: "Severe reaction - hypotension, hypoxia",
        params: { hr: 135, spo2: 85, rr: 35, bpSys: 75, bpDia: 45, temp: 37.0, etco2: 48 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 3 }
      },
      {
        time: 10 * 60, // 10 minutes
        label: "Late stage - severe cardiovascular compromise",
        params: { hr: 150, spo2: 80, rr: 36, bpSys: 60, bpDia: 35, temp: 36.5, etco2: 50 },
        conditions: { stElev: 0, pvc: true, wideQRS: false, tInv: false, noise: 3 }
      }
    ]
  },

  diabetic_ketoacidosis: {
    name: "Diabetic Ketoacidosis (DKA)",
    description: "Dehydration leading to metabolic acidosis and altered mental status",
    duration: 45,
    timeline: [
      {
        time: 0,
        label: "Initial presentation - tachycardia, mild dehydration",
        params: { hr: 100, spo2: 98, rr: 22, bpSys: 110, bpDia: 70, temp: 37.2, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 15 * 60,
        label: "Kussmaul breathing develops - compensatory hyperventilation",
        params: { hr: 115, spo2: 97, rr: 28, bpSys: 100, bpDia: 65, temp: 37.2, etco2: 28 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 }
      },
      {
        time: 30 * 60,
        label: "Progressive acidosis - deep rapid breathing, hypotension",
        params: { hr: 125, spo2: 96, rr: 34, bpSys: 90, bpDia: 55, temp: 37.2, etco2: 22 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 }
      },
      {
        time: 45 * 60,
        label: "Severe DKA - altered mental status, cardiovascular compromise",
        params: { hr: 135, spo2: 95, rr: 38, bpSys: 80, bpDia: 45, temp: 37.2, etco2: 18 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 }
      }
    ]
  },

  acute_stroke: {
    name: "Acute Ischemic Stroke (CVA)",
    description: "Hypertensive response progressing to possible Cushing reflex",
    duration: 30,
    timeline: [
      {
        time: 0,
        label: "Initial presentation - hypertension, neurological deficit",
        params: { hr: 78, spo2: 97, rr: 16, bpSys: 160, bpDia: 95, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 10 * 60,
        label: "Worsening hypertension - compensatory response",
        params: { hr: 72, spo2: 96, rr: 18, bpSys: 180, bpDia: 105, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 }
      },
      {
        time: 20 * 60,
        label: "Severe hypertension - early Cushing signs",
        params: { hr: 65, spo2: 94, rr: 20, bpSys: 195, bpDia: 115, temp: 37.0, etco2: 36 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 }
      },
      {
        time: 30 * 60,
        label: "Cushing reflex - bradycardia with severe hypertension",
        params: { hr: 58, spo2: 92, rr: 22, bpSys: 210, bpDia: 120, temp: 37.0, etco2: 34 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 }
      }
    ]
  },

  pulmonary_embolism: {
    name: "Pulmonary Embolism (PE)",
    description: "Sudden hypoxia progressing to right heart strain and shock",
    duration: 25,
    timeline: [
      {
        time: 0,
        label: "Pre-event baseline",
        params: { hr: 85, spo2: 97, rr: 16, bpSys: 125, bpDia: 80, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 5 * 60,
        label: "Acute PE - sudden dyspnea, tachycardia, hypoxia",
        params: { hr: 110, spo2: 88, rr: 26, bpSys: 115, bpDia: 75, temp: 37.0, etco2: 30 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: true, noise: 1 }
      },
      {
        time: 15 * 60,
        label: "Right heart strain - worsening hypoxia despite oxygen",
        params: { hr: 130, spo2: 82, rr: 32, bpSys: 95, bpDia: 60, temp: 37.0, etco2: 26 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: true, noise: 2 }
      },
      {
        time: 25 * 60,
        label: "Obstructive shock - severe hypoxia, hypotension",
        params: { hr: 145, spo2: 78, rr: 36, bpSys: 75, bpDia: 45, temp: 37.0, etco2: 22 },
        conditions: { stElev: 0, pvc: true, wideQRS: false, tInv: true, noise: 3 }
      }
    ]
  },

  gi_bleed: {
    name: "Upper GI Bleed",
    description: "Progressive hemorrhagic shock from gastrointestinal bleeding",
    duration: 40,
    timeline: [
      {
        time: 0,
        label: "Initial presentation - hematemesis, mild tachycardia",
        params: { hr: 90, spo2: 98, rr: 16, bpSys: 120, bpDia: 80, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 15 * 60,
        label: "Class II hemorrhage - tachycardia, narrowing pulse pressure",
        params: { hr: 115, spo2: 97, rr: 20, bpSys: 100, bpDia: 75, temp: 37.0, etco2: 36 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 }
      },
      {
        time: 30 * 60,
        label: "Class III hemorrhage - significant hypotension, pallor",
        params: { hr: 135, spo2: 96, rr: 24, bpSys: 85, bpDia: 65, temp: 36.8, etco2: 32 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 }
      },
      {
        time: 40 * 60,
        label: "Class IV hemorrhage - severe shock, altered mental status",
        params: { hr: 150, spo2: 94, rr: 28, bpSys: 70, bpDia: 50, temp: 36.5, etco2: 28 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 }
      }
    ]
  },

  copd_exacerbation: {
    name: "COPD Exacerbation",
    description: "Hypercapnic respiratory failure with progressive CO2 retention",
    duration: 35,
    timeline: [
      {
        time: 0,
        label: "Acute exacerbation - increased work of breathing",
        params: { hr: 88, spo2: 90, rr: 22, bpSys: 140, bpDia: 85, temp: 37.5, etco2: 48 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 12 * 60,
        label: "Worsening hypercapnia - accessory muscle use",
        params: { hr: 100, spo2: 86, rr: 28, bpSys: 145, bpDia: 90, temp: 37.5, etco2: 55 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 }
      },
      {
        time: 24 * 60,
        label: "Severe hypercapnia - CO2 narcosis developing",
        params: { hr: 112, spo2: 82, rr: 32, bpSys: 150, bpDia: 95, temp: 37.5, etco2: 62 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 }
      },
      {
        time: 35 * 60,
        label: "Respiratory fatigue - decreasing RR, impending arrest",
        params: { hr: 120, spo2: 78, rr: 12, bpSys: 155, bpDia: 95, temp: 37.5, etco2: 70 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 3 }
      }
    ]
  },

  severe_hypoglycemia: {
    name: "Severe Hypoglycemia",
    description: "Rapid deterioration from low blood glucose with catecholamine surge",
    duration: 15,
    timeline: [
      {
        time: 0,
        label: "Initial symptoms - tremor, diaphoresis, anxiety",
        params: { hr: 95, spo2: 98, rr: 18, bpSys: 130, bpDia: 85, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 5 * 60,
        label: "Catecholamine surge - tachycardia, hypertension",
        params: { hr: 115, spo2: 97, rr: 22, bpSys: 140, bpDia: 95, temp: 37.0, etco2: 36 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 }
      },
      {
        time: 10 * 60,
        label: "Decompensation - confusion, declining BP",
        params: { hr: 130, spo2: 96, rr: 24, bpSys: 110, bpDia: 70, temp: 37.0, etco2: 34 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 }
      },
      {
        time: 15 * 60,
        label: "Severe neuroglycopenia - obtunded, cardiovascular collapse",
        params: { hr: 140, spo2: 95, rr: 26, bpSys: 90, bpDia: 55, temp: 37.0, etco2: 32 },
        conditions: { stElev: 0, pvc: true, wideQRS: false, tInv: false, noise: 3 }
      }
    ]
  },

  complete_heart_block: {
    name: "Complete Heart Block",
    description: "Third-degree AV block progressing to hemodynamic instability",
    duration: 20,
    timeline: [
      {
        time: 0,
        label: "Baseline - normal sinus rhythm",
        params: { hr: 75, spo2: 98, rr: 14, bpSys: 125, bpDia: 80, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 5 * 60,
        label: "Second-degree block develops - intermittent dropped beats",
        params: { hr: 55, spo2: 97, rr: 16, bpSys: 110, bpDia: 70, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 10 * 60,
        label: "Complete heart block - profound bradycardia, wide QRS escape",
        params: { hr: 38, spo2: 94, rr: 18, bpSys: 85, bpDia: 55, temp: 37.0, etco2: 36 },
        conditions: { stElev: 0, pvc: false, wideQRS: true, tInv: false, noise: 1 },
        rhythm: "NSR"
      },
      {
        time: 20 * 60,
        label: "Hemodynamic collapse - syncope, severe hypotension",
        params: { hr: 32, spo2: 90, rr: 20, bpSys: 70, bpDia: 40, temp: 37.0, etco2: 32 },
        conditions: { stElev: 0, pvc: false, wideQRS: true, tInv: false, noise: 2 },
        rhythm: "NSR"
      }
    ]
  },

  afib_rvr: {
    name: "Atrial Fibrillation with RVR",
    description: "Uncontrolled atrial fibrillation leading to heart failure symptoms",
    duration: 30,
    timeline: [
      {
        time: 0,
        label: "New onset AFib - rapid ventricular response",
        params: { hr: 145, spo2: 96, rr: 20, bpSys: 130, bpDia: 85, temp: 37.0, etco2: 36 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "AFib"
      },
      {
        time: 10 * 60,
        label: "Worsening tachycardia - mild hypotension developing",
        params: { hr: 165, spo2: 94, rr: 24, bpSys: 115, bpDia: 75, temp: 37.0, etco2: 34 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 },
        rhythm: "AFib"
      },
      {
        time: 20 * 60,
        label: "Heart failure symptoms - pulmonary congestion, hypotension",
        params: { hr: 175, spo2: 92, rr: 28, bpSys: 95, bpDia: 60, temp: 37.0, etco2: 32 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 },
        rhythm: "AFib"
      },
      {
        time: 30 * 60,
        label: "Cardiogenic shock - severe hypotension, hypoxia",
        params: { hr: 180, spo2: 88, rr: 32, bpSys: 80, bpDia: 50, temp: 37.0, etco2: 28 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: true, noise: 3 },
        rhythm: "AFib"
      }
    ]
  },

  opioid_overdose: {
    name: "Opioid Overdose",
    description: "CNS depression progressing to respiratory arrest",
    duration: 15,
    timeline: [
      {
        time: 0,
        label: "Initial sedation - bradypnea, mild hypoxia",
        params: { hr: 65, spo2: 92, rr: 10, bpSys: 110, bpDia: 70, temp: 37.0, etco2: 55 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 5 * 60,
        label: "Worsening CNS depression - severe hypoventilation",
        params: { hr: 58, spo2: 85, rr: 6, bpSys: 100, bpDia: 65, temp: 36.8, etco2: 65 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 1 }
      },
      {
        time: 10 * 60,
        label: "Near apnea - profound hypoxia, hypercapnia",
        params: { hr: 52, spo2: 75, rr: 4, bpSys: 90, bpDia: 55, temp: 36.5, etco2: 75 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 }
      },
      {
        time: 15 * 60,
        label: "Respiratory arrest imminent - agonal breathing",
        params: { hr: 45, spo2: 60, rr: 2, bpSys: 80, bpDia: 45, temp: 36.2, etco2: 85 },
        conditions: { stElev: 0, pvc: false, wideQRS: true, tInv: false, noise: 3 }
      }
    ]
  },

  pulmonary_edema: {
    name: "Acute Decompensated Heart Failure",
    description: "Flash pulmonary edema progressing to respiratory failure",
    duration: 35,
    timeline: [
      {
        time: 0,
        label: "Acute dyspnea - hypertension, tachypnea, mild hypoxia",
        params: { hr: 95, spo2: 94, rr: 24, bpSys: 160, bpDia: 100, temp: 37.0, etco2: 36 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      },
      {
        time: 12 * 60,
        label: "Worsening pulmonary edema - frothy sputum, severe hypertension",
        params: { hr: 110, spo2: 88, rr: 30, bpSys: 175, bpDia: 110, temp: 37.0, etco2: 34 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 2 }
      },
      {
        time: 24 * 60,
        label: "Severe respiratory distress - accessory muscle use, hypoxia",
        params: { hr: 125, spo2: 82, rr: 36, bpSys: 165, bpDia: 105, temp: 37.0, etco2: 32 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 3 }
      },
      {
        time: 35 * 60,
        label: "Impending respiratory failure - exhaustion, declining BP",
        params: { hr: 135, spo2: 75, rr: 38, bpSys: 140, bpDia: 90, temp: 37.0, etco2: 30 },
        conditions: { stElev: 0, pvc: true, wideQRS: false, tInv: true, noise: 3 }
      }
    ]
  }
};

/**
 * Get all scenario templates as array
 */
export const getAllTemplates = () => {
  return Object.entries(SCENARIO_TEMPLATES).map(([key, template]) => ({
    id: key,
    ...template
  }));
};

/**
 * Get template by ID
 */
export const getTemplateById = (id) => {
  return SCENARIO_TEMPLATES[id] || null;
};

/**
 * Create empty scenario template
 */
export const createEmptyScenario = () => {
  return {
    enabled: true,
    autoStart: false,
    timeline: [
      {
        time: 0,
        label: "Initial state",
        params: { hr: 80, spo2: 98, rr: 16, bpSys: 120, bpDia: 80, temp: 37.0, etco2: 38 },
        conditions: { stElev: 0, pvc: false, wideQRS: false, tInv: false, noise: 0 },
        rhythm: "NSR"
      }
    ]
  };
};

/**
 * Scale scenario timeline to new duration
 * @param {Object} template - Scenario template
 * @param {number} newDurationMinutes - New duration in minutes
 * @returns {Object} Scaled scenario
 */
export const scaleScenarioTimeline = (template, newDurationMinutes) => {
  const originalDuration = template.duration;
  const scaleFactor = newDurationMinutes / originalDuration;
  
  const scaledTimeline = template.timeline.map(step => ({
    ...step,
    time: Math.round(step.time * scaleFactor)
  }));
  
  return {
    enabled: true,
    autoStart: false,
    timeline: scaledTimeline
  };
};
