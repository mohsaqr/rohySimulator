# JSON Import/Export Guide

## Overview
VipSim now supports **full JSON import/export** for both **monitor settings** and **patient cases**, allowing you to save, share, and load configurations as portable JSON files.

---

## Features

### **1. Monitor Settings (Simulator Configuration)**
- Export current monitor state to JSON file
- Import monitor settings from JSON file
- Share configurations between users
- Version control your simulator setups

### **2. Patient Cases**
- Export individual cases to JSON files
- Import cases from JSON files
- Share teaching scenarios
- Backup and distribute case libraries

---

## Monitor Settings Export/Import

### **Where to Find:**
```
1. Open Patient Monitor
2. Click Settings button (⚙️)
3. Scroll to bottom
4. See "Export JSON" and "Import JSON" buttons
```

### **Export Settings:**
**Steps:**
1. Configure monitor (vitals, rhythm, ECG patterns)
2. Click "Export JSON"
3. JSON file downloads automatically
4. Filename: `vipsim-settings-YYYY-MM-DD.json`

**What's Exported:**
- Rhythm (NSR, AFib, VTach, etc.)
- Conditions (ST elevation, PVCs, wide QRS, T-inversion, noise)
- Parameters (HR, SpO2, RR, BP, Temp, EtCO2)
- Metadata (version, export timestamp)

**Example JSON:**
```json
{
  "version": "1.0",
  "exportedAt": "2026-01-09T23:45:00.000Z",
  "rhythm": "NSR",
  "conditions": {
    "pvc": false,
    "stElev": 2,
    "tInv": false,
    "wideQRS": false,
    "noise": 0
  },
  "params": {
    "hr": 95,
    "spo2": 98,
    "rr": 16,
    "bpSys": 120,
    "bpDia": 80,
    "temp": 37.0,
    "etco2": 38
  }
}
```

### **Import Settings:**
**Steps:**
1. Click "Import JSON"
2. Select JSON file from your computer
3. Settings apply immediately
4. Monitor updates in real-time

**Validation:**
- File must be valid JSON
- Must contain `rhythm`, `conditions`, and `params`
- Invalid files show error message

---

## Patient Case Export/Import

### **Where to Find:**
```
1. Settings → Manage Cases tab
2. Admin users see:
   - "New Case" button
   - "Import" button (import case from JSON)
3. Each case has:
   - "Load" button (use in simulation)
   - Export icon (📥 download as JSON)
```

### **Export Case:**
**Steps:**
1. Go to Settings → Manage Cases
2. Find case you want to export
3. Click the export icon (📥) next to the case
4. JSON file downloads
5. Filename: `case-[case-name].json`

**What's Exported:**
- Case name and description
- Patient configuration
- System prompt for LLM
- Image URL
- All case metadata
- Version and export timestamp

**Example Case JSON:**
```json
{
  "version": "1.0",
  "exportedAt": "2026-01-09T23:50:00.000Z",
  "name": "Acute MI - 55yo Male",
  "description": "55-year-old male with chest pain, ST elevation",
  "system_prompt": "You are a 55-year-old male patient experiencing acute myocardial infarction...",
  "image_url": "/patient_mi_case_55m.png",
  "config": {
    "initialVitals": {
      "hr": 95,
      "bp": "140/90",
      "spo2": 96
    }
  }
}
```

### **Import Case (Admin Only):**
**Steps:**
1. Go to Settings → Manage Cases
2. Click "Import" button
3. Select case JSON file
4. Case automatically saved to database
5. Appears in cases list immediately

**Validation:**
- Must be valid JSON
- Requires `name` and `description` fields
- Database ID is auto-generated (removed from import)
- Duplicate names are allowed

---

## Use Cases

### **1. Teaching Scenarios - Share with Colleagues**
```
Teacher:
1. Create custom case (MI, stroke, sepsis)
2. Configure monitor settings (STEMI pattern)
3. Export both case + settings as JSON
4. Share files via email/cloud

Student/Colleague:
1. Import case JSON → adds to database
2. Import settings JSON → configures monitor
3. Ready to practice immediately
```

### **2. Backup Your Configuration**
```
1. Export all cases (click export on each)
2. Export current monitor settings
3. Store JSON files in version control (Git)
4. Restore anytime by importing
```

### **3. Standardize Across Institution**
```
1. Admin creates standard cases
2. Export to JSON files
3. Distribute to all instructors
4. Everyone imports → same cases for consistency
```

### **4. Build Case Library**
```
Organize cases by category:
- cardiac/case-stemi.json
- cardiac/case-nstemi.json
- respiratory/case-copd-exacerbation.json
- neuro/case-stroke.json
```

---

## Differences: localStorage vs JSON Files

| Feature | localStorage (Browser) | JSON Files |
|---------|----------------------|------------|
| **Automatic** | Yes, auto-save | No, manual export |
| **Persistence** | Per browser | Portable files |
| **Sharing** | Cannot share | Easy to share |
| **Backup** | Lost if browser cleared | Permanent files |
| **Version Control** | No | Yes (Git, etc.) |
| **Best For** | Personal defaults | Collaboration & sharing |

### **Recommendation:**
- Use **localStorage** for your personal default settings
- Use **JSON Export** for sharing and backup

---

## JSON File Locations

**Monitor Settings:**
- Downloads to: `~/Downloads/vipsim-settings-YYYY-MM-DD.json`
- Import from: Any location

**Cases:**
- Downloads to: `~/Downloads/case-[name].json`
- Import from: Any location

---

## Advanced: Editing JSON Files

### **Monitor Settings:**
You can manually edit settings JSON:

```json
{
  "rhythm": "VTach",         // NSR, AFib, VTach, VFib, Asystole
  "conditions": {
    "pvc": true,             // true/false
    "stElev": 2,             // -3 to +3 mm
    "tInv": true,            // true/false
    "wideQRS": false,        // true/false
    "noise": 3               // 0-10
  },
  "params": {
    "hr": 160,               // 20-250 BPM
    "spo2": 88,              // 50-100 %
    "rr": 24,                // 0-60 /min
    "bpSys": 90,             // 50-250 mmHg
    "bpDia": 60,             // 30-150 mmHg
    "temp": 38.5,            // 30-42 °C
    "etco2": 45              // 0-100 mmHg
  }
}
```

### **Cases:**
Edit case JSON to customize:
- Change `name` and `description`
- Modify `system_prompt` for different patient responses
- Update `image_url` for different patient images
- Add custom `config` fields

---

## Troubleshooting

### **Import Fails:**
- ✗ "Invalid settings file format"
  - Check JSON is valid (use JSONLint.com)
  - Ensure all required fields present
  
- ✗ "Failed to import case"
  - Verify `name` and `description` exist
  - Check JSON syntax

### **Export Not Downloading:**
- Check browser download settings
- Disable popup blockers
- Try different browser

### **Case Not Appearing:**
- Admin users only can import cases
- Refresh case list (reload page)
- Check server logs for errors

---

## API Endpoints (for Advanced Users)

### **Cases:**
- `POST /api/cases` - Create case (used by import)
- `GET /api/cases` - List all cases
- `GET /api/cases/:id` - Get specific case
- `PUT /api/cases/:id` - Update case
- `DELETE /api/cases/:id` - Delete case

All endpoints require authentication token.

---

## Best Practices

✅ **Export before major changes**
✅ **Name files descriptively** (`case-mi-anterior-stemi.json`)
✅ **Store in version control** (Git repository)
✅ **Share via cloud storage** (Google Drive, Dropbox)
✅ **Document custom cases** (add comments in JSON)

❌ **Don't edit critical fields** (`version` should remain)
❌ **Don't share with database IDs** (removed on export)
❌ **Don't store sensitive data** (patient PHI)

---

## Future Enhancements

Planned features:
- Bulk export (all cases at once)
- Scenario templates library
- Cloud sync (optional)
- Case rating and comments
- Automatic updates from repository

---

**Created:** January 2026  
**Version:** 1.0 - Full JSON Import/Export Support
