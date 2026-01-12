# Scenario Repository System

## Overview
The Scenario Repository is a database-backed system for creating, sharing, and reusing patient progression scenarios across multiple cases.

## Key Features

### **1. Database Storage**
- ✅ Scenarios stored in SQLite database (not just browser)
- ✅ Persistent across sessions and devices
- ✅ Can be shared between users
- ✅ Version controlled and auditable

### **2. Public & Private Scenarios**
- **Public Scenarios:** Visible to all users, can be used by anyone
- **Private Scenarios:** Only visible to creator
- **System Scenarios:** Pre-built templates (STEMI, Septic Shock, etc.)

### **3. Scenario Metadata**
Each scenario includes:
```json
{
  "id": 1,
  "name": "STEMI Progression",
  "description": "Acute MI progressing to cardiogenic shock",
  "duration_minutes": 40,
  "category": "Cardiac",
  "timeline": [...],
  "created_by": 1,
  "is_public": true,
  "created_at": "2026-01-10T..."
}
```

## Usage

### **For Admins:**

**1. Seed Default Scenarios**
```
Settings → Scenarios → "Seed Defaults" button
```
This adds 6 pre-built scenarios to the repository:
- STEMI Progression (40 min)
- Septic Shock Progression (40 min)
- Respiratory Failure (30 min)
- Hypertensive Crisis (45 min)
- Anaphylactic Shock (10 min)
- Post-Resuscitation Recovery (30 min)

**2. Create New Scenario**
```
Settings → Scenarios → "New Scenario" button
```
(Note: Currently requires JSON editing, visual builder coming soon)

**3. Manage Scenarios**
- Edit existing scenarios
- Delete scenarios
- Toggle public/private visibility

### **For All Users:**

**1. Browse Scenarios**
```
Settings → Scenarios tab
```
View all available scenarios (public + your private ones)

**2. Use in Case Creation**
```
Settings → Cases → Edit Case → Step 3 (Scenario)
→ "Browse Repository" button
→ Select scenario → "Use in Case"
```

**3. Filter & Search**
- By category (Cardiac, Respiratory, Sepsis, etc.)
- By duration
- By creator

## Database Schema

```sql
CREATE TABLE scenarios (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL,
    category TEXT,
    timeline JSON NOT NULL,
    created_by INTEGER,
    is_public BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### GET /api/scenarios
Returns all scenarios visible to current user

**Response:**
```json
{
  "scenarios": [
    {
      "id": 1,
      "name": "STEMI Progression",
      "duration_minutes": 40,
      "timeline": [...],
      "created_by_username": "admin"
    }
  ]
}
```

### GET /api/scenarios/:id
Returns single scenario by ID

### POST /api/scenarios
Create new scenario

**Body:**
```json
{
  "name": "My Custom Scenario",
  "description": "...",
  "duration_minutes": 30,
  "category": "General",
  "timeline": [...],
  "is_public": false
}
```

### PUT /api/scenarios/:id
Update existing scenario (own scenarios only, or admin)

### DELETE /api/scenarios/:id
Delete scenario (own scenarios only, or admin)

### POST /api/scenarios/seed (Admin only)
Seeds the database with 6 default scenarios

## Integration with Case Builder

### **Old Way (Before):**
```
Case Wizard Step 3:
→ Select from dropdown (hardcoded templates)
→ Scenario embedded in case JSON
→ No reusability
```

### **New Way (After):**
```
Case Wizard Step 3:
→ "Browse Repository" button
→ Select from database scenarios
→ Scenario referenced by ID OR embedded
→ Full reusability
```

### **Benefits:**
1. ✅ One scenario can be used in multiple cases
2. ✅ Update scenario once, affects all cases using it
3. ✅ Share scenarios between instructors
4. ✅ Build a library of clinical progressions
5. ✅ Export/import scenarios separately from cases

## Timeline Format

Each scenario has a timeline array with steps:

```json
{
  "timeline": [
    {
      "time": 0,              // Seconds from start
      "label": "Initial presentation",
      "params": {
        "hr": 80,
        "spo2": 98,
        "rr": 16,
        "bpSys": 120,
        "bpDia": 80,
        "temp": 37.0,
        "etco2": 38
      },
      "conditions": {
        "stElev": 0,
        "pvc": false,
        "wideQRS": false,
        "tInv": false,
        "noise": 0
      },
      "rhythm": "NSR"
    },
    {
      "time": 600,            // 10 minutes later
      "label": "STEMI develops",
      "params": { "hr": 110, ... },
      "conditions": { "stElev": 2.0 }
    }
  ]
}
```

## Scenario Categories

Suggested categories for organization:
- **Cardiac:** MI, arrhythmias, heart failure
- **Respiratory:** ARDS, pneumonia, asthma
- **Sepsis:** Septic shock, severe sepsis
- **Neurological:** Stroke, seizures
- **Trauma:** Hemorrhage, multiple injuries
- **Metabolic:** DKA, hypoglycemia
- **Allergic:** Anaphylaxis
- **Recovery:** Post-procedure, post-resuscitation

## Migration Notes

### **Alarm Configs → Database** (Completed)
- ✅ Alarm thresholds now saved to database per user
- ✅ No longer stored in localStorage
- ✅ Synced across sessions
- ✅ Retrieved via `/api/alarms/config` endpoint

### **Scenarios → Database** (Completed)
- ✅ Scenarios stored in database
- ✅ Can be browsed and selected
- ✅ Reusable across cases
- ✅ Managed via `/api/scenarios` endpoints

### **LLM Settings → Database** (Future)
- ⏳ Currently in localStorage
- 📋 TODO: Move to user preferences table
- 📋 TODO: Sync across devices

## Visual Scenario Builder (Future)

Planned features:
- ✅ Drag-and-drop timeline editor
- ✅ Visual vital sign curves
- ✅ Real-time preview
- ✅ Step-by-step wizard
- ✅ Import/export JSON
- ✅ Duplicate and modify existing scenarios
- ✅ Test scenarios before saving

## Best Practices

### **Creating Scenarios:**
1. Start with a template (seed defaults)
2. Duplicate and modify
3. Test with a demo case first
4. Share publicly if clinically accurate
5. Use descriptive names and categories

### **Using Scenarios:**
1. Browse repository first before creating new
2. Use existing scenarios when possible
3. Adjust duration to fit learning objectives
4. Combine scenarios for complex cases
5. Document any modifications

### **Maintaining Repository:**
1. Regular review of public scenarios
2. Remove outdated or inaccurate scenarios
3. Consolidate duplicates
4. Update based on user feedback
5. Version control important scenarios

## Troubleshooting

**Scenarios not loading?**
1. Check network connection
2. Verify authentication token
3. Check browser console for errors
4. Try refreshing the page

**Can't edit scenario?**
- Only creator or admin can edit
- Check if you're logged in
- Verify scenario ownership

**Seed button not showing?**
- Must be admin user
- Button only shows if 0 scenarios exist
- Can manually call API endpoint if needed

**Scenario not appearing in case builder?**
- Verify scenario is public or you're the creator
- Check scenario has valid timeline
- Refresh the scenarios list

## Future Enhancements

1. **Conditional Branching:** Different paths based on interventions
2. **Scenario Templates:** Pre-fill based on diagnosis
3. **AI Suggestions:** Generate scenarios from case descriptions
4. **Collaborative Editing:** Multiple users editing same scenario
5. **Version History:** Track changes over time
6. **Import from Literature:** Common clinical progressions
7. **Scenario Ratings:** User feedback and ratings
8. **Usage Statistics:** Track which scenarios are most popular

---

**Need Help?** See [Clinical Features Guide](clinical-features.md) for scenario mechanics or [Scenario Selector Guide](scenario-selector.md) for basic usage.
