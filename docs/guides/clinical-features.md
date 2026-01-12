# Clinical Features Guide - Rohy Simulator

## Overview
This guide documents the new clinical simulation features added to Rohy: **Alarm System**, **Event Logging**, **Case-based Scenarios**, and **Investigation Ordering** (Labs & Radiology).

---

## 1. Alarm System

### Features
- **Configurable Thresholds**: Set high/low limits for each vital sign
- **Visual Alerts**: Flashing red borders on vital sign boxes
- **Audio Alerts**: Beeping alarm sounds (Web Audio API)
- **Alarm Acknowledgment**: Click to silence individual or all alarms
- **Alarm History**: View all triggered alarms for the session
- **Mute Function**: Temporarily silence all alarm sounds

### How to Use

#### Access Alarm Settings
1. Click the **Bell** icon in the monitor header (shows active alarm count)
2. Or open **Settings** drawer and select the **Alarms** tab

#### Configure Thresholds
1. Navigate to **Alarms** tab
2. For each vital sign:
   - Toggle **Enable/Disable** switch
   - Set **Low** threshold (if applicable)
   - Set **High** threshold (if applicable)
3. Click **Save Alarm Config** to persist settings

#### Respond to Alarms
- **Active Alarms** section shows all triggered alarms
- Click **Acknowledge** on individual alarms to silence
- Click **Acknowledge All** to clear all alarms at once
- Click **Mute/Unmute** (speaker icon) to toggle audio

### Default Thresholds
```javascript
hr:     { low: 50,   high: 120 }
spo2:   { low: 90,   high: null }
bpSys:  { low: 90,   high: 180 }
bpDia:  { low: 50,   high: 110 }
rr:     { low: 8,    high: 30 }
temp:   { low: 36,   high: 38.5 }
etco2:  { low: 30,   high: 50 }
```

---

## 2. Event Log

### Features
- **Real-time Logging**: Automatically captures all significant events
- **Chronological Display**: Time-stamped event stream
- **Event Filtering**: Filter by type (all, vitals, alarms, scenario, settings)
- **Search & Export**: Export event log to CSV

### What Gets Logged
- **Vital Changes**: Significant changes (>10% for most vitals)
- **Alarms**: All alarm triggers and acknowledgments
- **Scenario Events**: Timeline step changes
- **Case Loading**: When a new case is loaded
- **ECG Changes**: Pattern changes (NSR → AFib, etc.)
- **Settings Changes**: Monitor configuration changes

### How to Use

#### View Event Log
1. Open **Settings** drawer
2. Select **Events** tab
3. View real-time event stream

#### Filter Events
- Click filter buttons: **All**, **Vitals**, **Alarms**, **Scenario**, **Settings**
- Auto-scrolls to latest event

#### Export Events
1. Click **Export CSV** button
2. CSV file downloads with all session events
3. Filename: `event-log-[sessionId]-[timestamp].csv`

### Event Format Example
```
[12:34:56] HR increased from 85 to 102 bpm (Warning)
[12:35:12] SpO2 alarm triggered: 88% < 90% threshold (Critical)
[12:35:18] Alarm acknowledged by user
[12:36:02] ECG pattern changed: NSR → Atrial Fibrillation
```

---

## 3. Case-Based Scenarios

### Features
- **Timeline-Based Progression**: Define vital sign changes over time
- **Automatic Deterioration**: Patient vitals evolve based on timeline
- **Bi-Directional Changes**: Support both worsening and improvement
- **Auto-Start Option**: Automatically begin scenario when case loads
- **Manual Control**: Play/pause scenario progression

### Scenario Structure (JSON)
```json
{
  "scenario": {
    "enabled": true,
    "autoStart": false,
    "timeline": [
      {
        "time": 0,
        "label": "Initial presentation",
        "params": { "hr": 85, "spo2": 98, "bpSys": 125, "bpDia": 82 },
        "conditions": { "stElev": 0 }
      },
      {
        "time": 300,
        "label": "If untreated: MI develops",
        "params": { "hr": 110, "spo2": 94, "bpSys": 145, "bpDia": 95 },
        "conditions": { "stElev": 2.0 }
      },
      {
        "time": 600,
        "label": "Worsening: PVCs appear",
        "params": { "hr": 125, "spo2": 90, "bpSys": 100, "bpDia": 60 },
        "conditions": { "pvc": true }
      }
    ]
  }
}
```

### How to Use

#### Add Scenario to Case (Admin)
1. Go to **Settings** → **Manage Cases**
2. Edit or create a case
3. Add `scenario` object to case JSON (see structure above)
4. Set `autoStart: true` to begin automatically

#### Control Scenario Playback
1. Open **Settings** drawer → **Scenarios** tab
2. Select scenario from list
3. Use **Play/Pause** button to control progression
4. **Stop/Reset** to return to initial state
5. Current time displayed (e.g., "300s")

#### Monitor Scenario Progress
- Event log shows each timeline step as it occurs
- Vitals interpolate smoothly between keyframes
- Can manually override vitals during scenario

---

## 4. Investigation Ordering (Labs & Radiology)

### Features
- **Case-Specific Tests**: Each case can have its own investigations
- **Turnaround Time Simulation**: Results available after realistic delay
- **Order Multiple Tests**: Select and order multiple investigations
- **Countdown Timers**: Track pending results
- **Visual Results Display**: Lab tables and radiology images
- **Zoom & Pan**: Image viewer for radiology studies

### How to Add Investigations to Case (Admin)

#### 1. Via API Endpoint
```javascript
POST /api/investigations

Body:
{
  "case_id": 1,
  "investigation_type": "lab",
  "test_name": "Troponin I",
  "result_data": {
    "Troponin I": {
      "value": 4.2,
      "unit": "ng/mL",
      "normalRange": "0-0.04",
      "flag": "CRITICAL HIGH"
    }
  },
  "turnaround_minutes": 45
}
```

#### 2. Lab Result Format
```json
{
  "investigation_type": "lab",
  "test_name": "Complete Blood Count",
  "result_data": {
    "WBC": { "value": 12.5, "unit": "×10⁹/L", "normalRange": "4.5-11.0", "flag": "HIGH" },
    "Hemoglobin": { "value": 14.2, "unit": "g/dL", "normalRange": "13.5-17.5", "flag": "" },
    "Platelets": { "value": 220, "unit": "×10⁹/L", "normalRange": "150-400", "flag": "" }
  },
  "turnaround_minutes": 30
}
```

#### 3. Radiology Result Format
```json
{
  "investigation_type": "radiology",
  "test_name": "Chest X-ray (PA & Lateral)",
  "image_url": "/uploads/xray-pulmonary-edema.jpg",
  "result_data": {
    "interpretation": "Bilateral pulmonary edema, cardiomegaly present. Recommend repeat imaging after diuresis.",
    "findings": [
      "Bilateral interstitial edema",
      "Cardiomegaly (CTR >0.5)",
      "Kerley B lines present",
      "No pleural effusions"
    ]
  },
  "turnaround_minutes": 60
}
```

### How to Order Investigations (User)

#### 1. Access Investigation Panel
- Click **Order Tests** button (purple, top-right)
- Shows available tests for current case

#### 2. Order Tests
1. Check tests to order
2. Click **Order X Test(s)** button
3. Tests move to **Pending Results** section

#### 3. View Results
1. Wait for turnaround time (countdown timer shown)
2. **Results Ready** section appears when available
3. Click on test to view results
4. Results display in full-screen modal

#### 4. Interpret Results
**For Labs:**
- Table with parameter, value, unit, normal range
- Abnormal values highlighted (yellow/red)
- Critical values marked with "CRITICAL HIGH/LOW"

**For Radiology:**
- Image viewer with zoom controls
- Findings list (if provided)
- Radiologist interpretation

---

## Database Schema

### New Tables

#### event_log
- `id`: Primary key
- `session_id`: Link to session
- `event_type`: 'vital_change', 'alarm', 'scenario_step', 'case_load'
- `description`: Human-readable description
- `vital_sign`: Affected vital (if applicable)
- `old_value`, `new_value`: Before/after values
- `timestamp`: When event occurred

#### alarm_events
- `id`: Primary key
- `session_id`: Link to session
- `vital_sign`: Which vital triggered alarm
- `threshold_type`: 'high' or 'low'
- `threshold_value`: The threshold that was crossed
- `actual_value`: Actual vital value
- `triggered_at`: When alarm triggered
- `acknowledged_at`: When user acknowledged (NULL if active)

#### alarm_config
- `id`: Primary key
- `user_id`: User who set config (NULL = default)
- `vital_sign`: Which vital
- `high_threshold`, `low_threshold`: Thresholds
- `enabled`: Boolean

#### case_investigations
- `id`: Primary key
- `case_id`: Link to case
- `investigation_type`: 'lab' or 'radiology'
- `test_name`: Name of test
- `result_data`: JSON (structured results)
- `image_url`: For radiology images
- `turnaround_minutes`: Delay before results ready

#### investigation_orders
- `id`: Primary key
- `session_id`: Link to session
- `investigation_id`: Link to investigation
- `ordered_at`: When ordered
- `available_at`: When results ready
- `viewed_at`: When user viewed results

---

## API Endpoints

### Event Logging
- `POST /api/events/batch` - Log multiple events
- `GET /api/sessions/:id/events` - Get all events for session

### Alarms
- `POST /api/alarms/log` - Log alarm trigger
- `PUT /api/alarms/:id/acknowledge` - Acknowledge alarm
- `GET /api/alarms/config` - Get default alarm config
- `POST /api/alarms/config` - Save alarm config

### Investigations
- `GET /api/cases/:id/investigations` - Get investigations for case
- `POST /api/investigations` - Create investigation (admin)
- `POST /api/sessions/:id/order` - Order investigation(s)
- `GET /api/sessions/:id/orders` - Get orders for session
- `PUT /api/orders/:id/view` - Mark investigation as viewed

---

## Teaching Use Cases

### 1. Alarm Fatigue Simulation
- Set overly sensitive thresholds
- Generate multiple alarms
- Students practice prioritization

### 2. Progressive Deterioration
- Create scenario with gradual worsening
- Students must recognize changes
- Log provides objective performance review

### 3. Clinical Decision Making
- Order labs based on presentation
- Interpret results to guide treatment
- Timeline correlates interventions with outcomes

### 4. Performance Review
- Export event log for debrief
- Review response times to alarms
- Analyze decision-making patterns

---

## Future Enhancements

### Planned Features
- **Intervention Tracking**: Log medications/procedures given
- **Scenario Branching**: Different paths based on interventions
- **Performance Metrics**: Automated scoring
- **Case Library Sharing**: Import/export scenarios with investigations
- **Voice Commands**: Verbal orders and documentation
- **Team Simulation**: Multi-user sessions

---

## Troubleshooting

### Alarms Not Playing
- Check browser allows audio autoplay
- Click anywhere on page to initialize Web Audio API
- Verify alarms not muted (speaker icon)

### Events Not Logging
- Verify session has started (load a case)
- Check browser console for errors
- Ensure backend is running

### Investigation Results Not Appearing
- Check turnaround time has elapsed
- Verify investigation was added to case
- Refresh the investigation panel

### Scenario Not Running
- Ensure scenario has valid timeline
- Check `autoStart` is set to `true`
- Manually start from Scenarios tab

---

**Version:** 1.0  
**Last Updated:** January 2026  
**Author:** Rohy Development Team
