# Monitor Settings Persistence Guide

## Overview
The Patient Monitor now supports **persistent settings** that are saved between sessions using browser localStorage.

---

## Features

### 1. **Factory Defaults**
The monitor comes with pre-configured factory defaults:
- Heart Rate: 80 BPM
- SpO2: 98%
- Respiratory Rate: 16
- Blood Pressure: 120/80 mmHg
- Temperature: 37.0°C
- EtCO2: 38 mmHg
- Rhythm: Normal Sinus Rhythm (NSR)
- No ECG modifiers

### 2. **Session Settings (Temporary)**
- Make any changes to vitals, rhythm, or ECG patterns
- Changes apply immediately
- **NOT saved** between sessions
- Reloading the page will restore either:
  - Saved settings (if you previously saved)
  - Factory defaults (if nothing saved)

### 3. **Persistent Settings (Saved)**
- Click **"Save Current Settings"** button
- Settings are stored in browser localStorage
- Automatically loaded on next session
- Visual indicators show when custom settings are active

---

## How to Use

### **Save Your Current Configuration:**
```
1. Adjust monitor settings (vitals, rhythm, ECG patterns)
2. Open Monitor Settings (⚙️ button)
3. Scroll to bottom
4. Click "Save Current Settings"
5. Confirmation message appears
```

### **Visual Indicators:**
- **Settings Button Color:**
  - 🔵 Blue = Factory defaults
  - 🟣 Purple = Custom settings loaded
- **Green Dot:** Appears on settings button when custom settings active
- **Info Banner:** Shows in settings panel with timestamp

### **Reset Options:**

#### **Reset to Defaults** (Clears saved settings)
```
1. Open Monitor Settings
2. Click "Reset to Defaults"
3. Confirm action
4. Monitor returns to factory settings
5. Saved settings are cleared
```

#### **Clear Saved Settings** (Keep current, but don't save)
```
1. Open Monitor Settings
2. Click "Clear Saved Settings"
3. Next reload will use factory defaults
4. Current session continues with current values
```

---

## Use Cases

### **Scenario 1: Teaching MI Cases**
```
1. Set up STEMI pattern (ST elevation +5mm, HR 95)
2. Click "Save Current Settings"
3. Every session starts with MI pattern ready
4. Students see consistent presentation
```

### **Scenario 2: Custom Baseline**
```
1. Adjust vitals for specific patient profile
2. Set HR: 65, BP: 110/70, SpO2: 96%
3. Save settings
4. All simulations start from this baseline
```

### **Scenario 3: Temporary Changes**
```
1. Make changes for one session
2. DON'T click save
3. Reload page to return to saved/default state
```

---

## Technical Details

### **Storage Location:**
- Browser localStorage
- Key: `vipsim_monitor_settings`
- Persists until manually cleared

### **Stored Data:**
```json
{
  "rhythm": "NSR",
  "conditions": {
    "pvc": false,
    "stElev": 0,
    "tInv": false,
    "wideQRS": false,
    "noise": 0
  },
  "params": {
    "hr": 80,
    "spo2": 98,
    "rr": 16,
    "bpSys": 120,
    "bpDia": 80,
    "temp": 37.0,
    "etco2": 38
  },
  "savedAt": "2026-01-09T23:30:00.000Z"
}
```

### **Load Priority:**
1. Saved settings (if exist)
2. Factory defaults (if no saved settings)

---

## FAQ

**Q: Will my settings sync across devices?**
A: No, settings are stored locally in each browser.

**Q: What happens if I clear browser data?**
A: Saved settings will be lost. Monitor returns to factory defaults.

**Q: Can I export/import settings?**
A: Not yet, but this could be added in the future.

**Q: Do settings affect the chat/LLM?**
A: No, only the visual monitor display is affected.

**Q: Can I save multiple presets?**
A: Currently only one saved configuration is supported.

---

## Tips

✅ **Save after configuring teaching scenarios**
✅ **Use "Reset to Defaults" to start fresh**
✅ **Check the purple indicator to know if custom settings are active**
✅ **Timestamp shows when settings were last saved**

❌ **Don't save if you're just testing**
❌ **Don't forget to save if you want settings to persist**

---

## Future Enhancements (Potential)

- Multiple saved presets
- Export/import settings as JSON
- Per-case default settings
- Cloud sync across devices
- Settings templates library

---

**Created:** January 2026
**Version:** 1.0
