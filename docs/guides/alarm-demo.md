# Demo Alarm Case - Quick Start Guide

## Purpose
This case demonstrates the full alarm system with rapid patient deterioration, triggering multiple alarms simultaneously.

## How to Use

### 1. Import the Case
1. Login as **Admin**
2. Click **Settings** button (⚙️ icon in top-right corner)
3. Go to **"Manage Cases"** tab
4. Click **"Import Case"** button (📥 icon)
5. Select `DEMO_ALARM_CASE.json`
6. Case will be imported as "DEMO: Rapid Deterioration with Alarms"

### 2. Load the Case
1. **Settings → Cases tab** shows all available cases
2. Find "DEMO: Rapid Deterioration with Alarms" in the list
3. Click on the case card to select it
4. The case will load automatically into the main monitor view
5. Close Settings panel (X button) to return to monitor

### 3. Start the Simulation
1. **IMPORTANT:** Alarms work immediately - NO session needed!
2. Once case loads, alarms trigger automatically within 2 seconds
3. The patient will display with multiple alarm conditions active
4. (Optional) Click **"Start New Session"** to log alarms to database

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

**Individual Alarm Actions:**
- **Acknowledge:** Silences alarm permanently (until condition recurs)
- **Snooze:** Hides alarm for X minutes, then re-activates if condition persists

**Bulk Actions:**
- **Acknowledge All:** Clears all active alarms at once
- **Snooze All:** Snoozes all active alarms for the configured duration

**Snooze Configuration:**
- Settings → Alarms → Snooze Settings
- Choose duration: 1, 2, 3, 5, 10, or 15 minutes
- Default: 5 minutes

**Snoozed Alarms Display:**
- Shows countdown timer for each snoozed alarm
- Alarm re-activates automatically when snooze expires
- Visual indicator: 💤 emoji
- Example: "HR_HIGH - Returns in 4 mins"

**Audio Control:**
- **Mute:** Click mute button (audio stops but visual alarms remain)
- **Unmute:** Click unmute button to restore audio

**History:**
- Settings → Alarms → History tab
- Shows all alarms with timestamps
- Tracks acknowledged and snoozed alarms

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
1. ✓ Verify case loaded successfully (check top-left banner)
2. ✓ Wait 2-3 seconds after case loads (alarms check every 2s)
3. ✓ Check browser console for errors
4. ✓ Verify Settings → Alarms → Thresholds are enabled (toggle should be green)
5. ✓ Check if alarm was snoozed (see "Snoozed Alarms" section)

**No audio?**
1. ✓ **Click anywhere on screen first** (browser audio policy requires user interaction)
2. ✓ Check alarm is not muted (speaker icon should NOT be red)
3. ✓ Check browser sound permissions
4. ✓ Verify system volume is up
5. ✓ Try refreshing page and clicking again

**Alarms disappear after 5 seconds?**
- Not normal! Check if they're being snoozed automatically
- Check "Snoozed Alarms" section in Settings → Alarms
- If vitals return to normal, alarm clears automatically (this is correct behavior)

**Alarm returns after snoozing?**
- **This is expected behavior!** Snooze is temporary
- If condition persists when snooze expires, alarm re-activates
- To permanently silence: Acknowledge alarm OR fix the vital sign
- Snooze duration configurable: 1-15 minutes

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

**Questions?** Check [Clinical Features Guide](clinical-features.md) for complete alarm system documentation.
