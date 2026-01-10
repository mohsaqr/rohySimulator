# Demo Alarm Case - Quick Start Guide

## Purpose
This case demonstrates the full alarm system with rapid patient deterioration, triggering multiple alarms simultaneously.

## How to Use

### 1. Import the Case
1. Login as **Admin**
2. Go to **Settings → Manage Cases**
3. Click **"Import Case"** button
4. Select `DEMO_ALARM_CASE.json`
5. Case will be imported as "DEMO: Rapid Deterioration with Alarms"

### 2. Start the Simulation
1. Close Settings panel
2. Select the Demo case from the case dropdown
3. **IMPORTANT:** Click **"Start New Session"** button
   - ⚠️ **Alarms ONLY work during active sessions!**
   - You must start a session before alarms will trigger
4. The patient will load with multiple alarm conditions active

### 3. Expected Alarm Triggers (Immediate)

When you start the session, you should see **6-7 alarms** immediately:

| Vital Sign | Value | Threshold | Alarm |
|------------|-------|-----------|-------|
| **HR** | 150 bpm | >120 | ✓ HIGH |
| **SpO2** | 85% | <90 | ✓ LOW |
| **RR** | 35 /min | >30 | ✓ HIGH |
| **BP Sys** | 85 mmHg | <90 | ✓ LOW |
| **BP Dia** | 50 mmHg | <50 | ✓ LOW |
| **Temp** | 39.5°C | >38.5 | ✓ HIGH |
| **EtCO2** | 55 mmHg | >50 | ✓ HIGH |

### 4. Alarm Indicators

**Visual:**
- 🔔 Bell icon in top-right with red badge showing alarm count
- Red flashing borders around monitor
- Active alarms list in Settings → Alarms tab

**Audio:**
- Continuous beeping sound (880 Hz tone)
- Beeps every 0.5 seconds while alarms are active

### 5. Managing Alarms

- **Acknowledge Individual:** Click "Acknowledge" next to each alarm
- **Acknowledge All:** Click "Acknowledge All Alarms" button
- **Mute Sound:** Click mute button (audio stops but visual remains)
- **View History:** Settings → Alarms → History tab

### 6. Scenario Progression

The case includes a 5-minute scenario with 4 stages:

| Time | Stage | Key Changes |
|------|-------|-------------|
| 0:00 | Initial | Multiple alarms active |
| 2:00 | Worsening | HR→160, SpO2→80 |
| 4:00 | Critical | HR→170, SpO2→75, VTach rhythm |
| 5:00 | Late stage | HR→180, SpO2→70 (maximum alarm state) |

### 7. Troubleshooting

**No alarms triggering?**
1. ✓ Verify you **started a session** (not just loaded the case)
2. ✓ Check browser console for errors
3. ✓ Click anywhere on screen (audio needs user interaction)
4. ✓ Check Settings → Alarms → Configuration to verify thresholds are enabled

**No audio?**
1. ✓ Click anywhere on screen first (browser audio policy)
2. ✓ Check alarm is not muted
3. ✓ Check browser sound permissions
4. ✓ Verify system volume is up

**Alarms stop immediately?**
- This is normal! Alarms have a 5-second debounce period
- If vital returns to normal range, alarm clears automatically

## Default Alarm Thresholds

```
HR:      50 - 120 bpm
SpO2:    90 - (no upper limit)
BP Sys:  90 - 180 mmHg
BP Dia:  50 - 110 mmHg
RR:      8 - 30 /min
Temp:    36 - 38.5°C
EtCO2:   30 - 50 mmHg
```

## Customizing Thresholds

1. Go to **Settings → Alarms → Configuration**
2. Adjust thresholds for each vital sign
3. Enable/disable individual alarms
4. Click "Save Configuration" to persist changes

## Educational Use

This case is ideal for:
- ✓ Teaching alarm recognition and prioritization
- ✓ Demonstrating alarm fatigue
- ✓ Practicing systematic vital sign assessment
- ✓ Training on rapid response protocols
- ✓ Testing alarm acknowledgment workflows

## Technical Notes

- Alarms check vitals every 2 seconds
- 5-second debounce prevents alarm spam
- All alarms logged to database with timestamps
- Event log captures all alarm triggers and acknowledgments
- Audio uses Web Audio API (requires HTTPS in production)

---

**Questions?** Check `CLINICAL_FEATURES_GUIDE.md` for complete alarm system documentation.
