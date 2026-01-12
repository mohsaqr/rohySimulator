# Scenario Selector - User Guide

## Overview
The scenario selector allows case creators to add **automatic patient progression** (deterioration or improvement) to their cases without manually editing JSON files.

## Location
**Settings → Manage Cases → Create/Edit Case → Step 3: Progression Scenario**

---

## How to Use

### 1. Select a Scenario Template
Choose from 6 pre-built clinical scenarios:

| Scenario | Description | Default Duration |
|----------|-------------|------------------|
| **STEMI Progression** | Acute MI → cardiogenic shock | 40 min |
| **Septic Shock** | Early sepsis → severe shock | 40 min |
| **Respiratory Failure** | Dyspnea → severe hypoxia/hypercapnia | 30 min |
| **Hypertensive Crisis** | BP rising → crisis peak | 45 min |
| **Anaphylaxis** | Allergic reaction → cardiovascular compromise | 10 min |
| **Post-Resuscitation Recovery** | Post-ROSC → stabilization | 30 min |

### 2. Set Progression Duration
Choose how fast the patient progresses:
- **Very Fast** (5 minutes) - For quick demonstrations
- **Fast** (10 minutes) - Rapid progression
- **Standard** (30 minutes) - Realistic timeline
- **Slow** (1-2 hours) - Extended scenarios

The system automatically scales all timeline steps to match your chosen duration.

### 3. Preview the Timeline
The wizard shows you a step-by-step preview:
```
0:00  - Initial presentation
10:00 - STEMI develops
25:00 - Worsening ischemia
40:00 - Late stage - cardiogenic shock
```

### 4. Auto-Start Option
- ✅ **Enabled**: Scenario starts automatically when case loads
- ❌ **Disabled**: Instructor must manually trigger steps during simulation

---

## Key Features

✅ **No Death Stages**: All scenarios end at "late stage" - critical but recoverable  
✅ **Scalable Timing**: Same scenario can run from 5 minutes to 2 hours  
✅ **Manual Control**: Instructors can skip ahead or pause at any step  
✅ **Template-Based**: Predefined realistic clinical progressions  

---

## For Instructors

During simulation:
1. Go to **Monitor Settings → Scenarios Tab**
2. See current scenario step and progress
3. Use **⏩ Trigger Next Step** button to manually advance
4. All transitions logged in event log

---

## Technical Details

### What Gets Saved
When you select a scenario, the system generates a `scenario` JSON object in the case file containing:
- `enabled: true`
- `autoStart: true/false`
- `timeline`: Array of steps with:
  - `time`: Seconds from start
  - `label`: Description
  - `params`: Vital signs (hr, spo2, rr, bp, temp, etco2)
  - `conditions`: ECG modifiers (ST elevation, PVCs, etc.)
  - `rhythm`: NSR, AFib, VTach, etc.

### Timeline Scaling
The `scaleScenarioTimeline()` function proportionally adjusts all step times:
```
Original: 40 min scenario → scale to 60 min
Step at 10 min → becomes 15 min
Step at 25 min → becomes 37.5 min
```

---

## Coming Soon
- Custom scenario builder (drag-and-drop timeline editor)
- Conditional branching (if treatment given, use different path)
- More templates (DKA, stroke, trauma)
