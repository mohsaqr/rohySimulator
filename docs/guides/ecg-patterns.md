# ECG Patterns Clinical Reference Guide

## Overview
The monitor now includes **realistic ECG pattern presets** with clinically accurate ST segment deviations and waveform characteristics.

---

## ST Segment Scaling

### **Realistic Values:**
- **Normal:** 0 mm (isoelectric)
- **Borderline:** ±0.25-0.5 mm
- **Significant:** ≥1 mm elevation or depression
- **Critical (STEMI):** ≥2 mm elevation (≥1mm in limb leads clinically)

### **Clinical Interpretation:**
| ST Deviation | Clinical Significance |
|--------------|----------------------|
| 0 mm | Normal, isoelectric baseline |
| +0.5 mm | Early repolarization (can be normal) |
| +1 mm | Pericarditis, early MI |
| +2 mm | **STEMI - Acute MI** |
| -0.5 mm | Angina, ischemia |
| -1 mm | **NSTEMI, subendocardial ischemia** |
| -2 mm | Severe ischemia, digoxin effect |

---

## ECG Pattern Presets

### **1. STEMI (ST-Elevation MI)**
**Settings:**
- ST Elevation: +2 mm
- Heart Rate: 95 BPM
- Rhythm: NSR

**Clinical:**
- Acute myocardial infarction
- Transmural ischemia
- Requires immediate PCI/thrombolysis
- Convex ST elevation ("tombstone")

---

### **2. NSTEMI (Non-ST-Elevation MI)**
**Settings:**
- ST Depression: -1 mm
- T-wave Inversion: Yes
- Heart Rate: 88 BPM

**Clinical:**
- Subendocardial ischemia
- Non-transmural infarction
- Troponin elevation without ST elevation
- Risk stratification needed

---

### **3. Angina (Ischemia)**
**Settings:**
- ST Depression: -0.5 mm
- Heart Rate: 92 BPM

**Clinical:**
- Reversible ischemia
- Exercise-induced changes
- Demand ischemia
- May resolve with rest/nitrates

---

### **4. Hyperkalemia**
**Settings:**
- Wide QRS: Yes
- Normal ST segment
- Heart Rate: 70 BPM

**Clinical:**
- Peaked T-waves (not explicitly shown)
- Widened QRS
- Can progress to sine wave → VFib
- K+ > 6.5 mEq/L

---

### **5. Hypokalemia**
**Settings:**
- ST Depression: -0.5 mm
- T-wave Inversion/Flattening: Yes
- Heart Rate: 82 BPM

**Clinical:**
- Flattened T-waves
- Prominent U-waves
- ST depression
- Increased arrhythmia risk
- K+ < 3.0 mEq/L

---

### **6. Pericarditis**
**Settings:**
- ST Elevation: +1 mm (diffuse)
- Heart Rate: 88 BPM

**Clinical:**
- Diffuse ST elevation
- PR depression (not shown)
- Concave ST segments
- Usually benign vs MI

---

### **7. LBBB (Left Bundle Branch Block)**
**Settings:**
- Wide QRS: Yes
- Heart Rate: 78 BPM

**Clinical:**
- QRS > 120 ms
- Discordant ST/T changes
- Makes STEMI diagnosis difficult
- May indicate underlying heart disease

---

### **8. PVCs (Premature Ventricular Contractions)**
**Settings:**
- PVC: Enabled (random ectopics)
- Heart Rate: 85 BPM

**Clinical:**
- Wide, bizarre QRS
- No preceding P-wave
- Compensatory pause
- Common, often benign

---

### **9. Atrial Fibrillation**
**Settings:**
- Rhythm: AFib
- No P-waves, irregular R-R
- Heart Rate: 110 BPM (irregularly irregular)

**Clinical:**
- Loss of atrial kick
- Risk of stroke (thrombus)
- Rate vs rhythm control
- Anticoagulation needed

---

### **10. Ventricular Tachycardia**
**Settings:**
- Rhythm: VTach
- Wide QRS
- Heart Rate: 160 BPM

**Clinical:**
- Life-threatening arrhythmia
- Wide complex tachycardia
- Can degenerate to VFib
- Immediate intervention needed

---

## Manual Adjustment

### **ST Deviation Slider:**
- **Range:** -3 to +3 mm (clinical range)
- **Step:** 0.25 mm
- **Warning:** Red text + ⚠️ when |ST| ≥ 1mm

### **Other Modifiers:**
- **PVCs:** Random ectopic beats
- **Wide QRS:** Bundle branch blocks
- **T-wave Inversion:** Ischemia, electrolyte abnormalities
- **Signal Noise:** Muscle artifact, movement

---

## Teaching Tips

### **Progressive MI Scenario:**
1. Start: Normal ECG
2. **5 min:** Angina (-0.5mm ST depression)
3. **10 min:** NSTEMI (-1mm ST depression, T-inversion)
4. **15 min:** STEMI (+2mm ST elevation)

### **Electrolyte Series:**
1. Normal → Hyperkalemia (wide QRS)
2. Normal → Hypokalemia (flat T, ST depression)

### **Arrhythmia Progression:**
1. NSR → PVCs → VTach → VFib

---

## Clinical Pearls

✅ **1mm of ST elevation = 0.1mV on ECG**
✅ **STEMI criteria: ≥1mm in 2+ contiguous leads**
✅ **New LBBB with chest pain = STEMI equivalent**
✅ **Reciprocal ST depression confirms STEMI**
✅ **Pericarditis: Diffuse ST↑ + PR↓**

⚠️ **Warning Signs:**
- ST elevation + wide QRS = possible VT
- ST depression + tachycardia = demand ischemia
- Irregular narrow complex = likely AFib
- Irregular wide complex = AFib + BBB or VT

---

## References

- **Normal ST:** Isoelectric baseline (±0.5mm acceptable)
- **STEMI Criteria:** ≥2mm in precordial leads (V2-V3) or ≥1mm in limb leads
- **Hyperkalemia Stages:**
  - Mild (5.5-6): Peaked T
  - Moderate (6-7): Wide QRS, flat P
  - Severe (>7): Sine wave, VFib risk

---

**Last Updated:** January 2026
**Version:** 2.0 - Realistic ST Scaling
