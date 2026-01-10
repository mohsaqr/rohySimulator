# Scenario Repository - Complete Testing Guide

## 🎯 **What Was Implemented**

### **1. Database-Backed Scenario Storage** ✅
- Scenarios stored in SQLite `scenarios` table
- No longer in browser localStorage or embedded in case JSON
- Shareable between users (public/private control)

### **2. Full UI Integration** ✅
- New "Scenarios" tab in Settings panel
- Browse, create, edit, delete scenarios
- Integration with Case Wizard Step 3
- Seed 6 default scenarios (admin only)

### **3. Dual Selection Approach** ✅
- **Repository Browser:** Database scenarios (persistent, shareable)
- **Quick Templates:** Built-in templates (hardcoded, fast)

---

## 📋 **Testing Checklist**

### **Phase 1: Setup & Seeding**

**1.1 Start the Application**
```bash
# Terminal 1
cd /Users/mohammedsaqr/Documents/VipSim
npm run dev
```

**1.2 Login as Admin**
- Navigate to http://localhost:5175/
- Login with admin credentials
- Verify admin badge shows

**1.3 Seed Default Scenarios**

**Method A: Via Browser Console (Recommended)**
```javascript
// Open DevTools (F12) → Console tab
fetch('http://localhost:3000/api/scenarios/seed', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  }
})
.then(r => r.json())
.then(data => {
  console.log('Seed result:', data);
  alert(`✓ Seeded ${data.inserted} scenarios successfully!`);
});
```

**Expected Result:**
```json
{
  "message": "Seeded 6 scenarios, 0 errors",
  "inserted": 6,
  "errors": 0
}
```

**Method B: Via Scenarios Tab**
1. Settings → Scenarios tab
2. If empty, you should see "Seed Defaults" button
3. Click it
4. Confirm seeding
5. Verify 6 scenarios appear

---

### **Phase 2: Browse Scenarios**

**2.1 Access Scenarios Tab**
1. Click Settings (⚙️ icon)
2. Click "Scenarios" tab (Layers icon 📚)
3. Should see list of 6 scenarios

**2.2 Verify Scenario Display**

Each scenario card should show:
- ✅ Name (e.g., "STEMI Progression")
- ✅ Description
- ✅ Category badge (e.g., "Cardiac")
- ✅ Duration (e.g., "40 min")
- ✅ Steps count (e.g., "📋 4 steps")
- ✅ Public/Private icon (🌐 for public)
- ✅ Action buttons: Play, Edit, Delete

**2.3 Expected Scenarios**
1. **STEMI Progression** - 40 min, Cardiac, 4 steps
2. **Septic Shock Progression** - 40 min, Sepsis, 4 steps
3. **Respiratory Failure** - 30 min, Respiratory, 4 steps
4. **Hypertensive Crisis** - 45 min, Cardiovascular, 4 steps
5. **Anaphylactic Shock** - 10 min, Allergic, 4 steps
6. **Post-Resuscitation Recovery** - 30 min, Recovery, 3 steps

---

### **Phase 3: Use Scenario in Case**

**3.1 Create New Case**
1. Settings → Cases tab (📄 icon)
2. Click "New Case" button
3. Fill in Step 1 (Persona):
   - Name: "Test Cardiac Case"
   - System prompt: Any text
4. Fill in Step 2 (Demographics):
   - Age: 55
   - Gender: Male
5. Click "Next" to reach Step 3

**3.2 Browse Repository Method**
1. In Step 3, find the **blue "Scenario Repository" section**
2. Click **"Browse Repository"** button
3. Should switch to Scenarios tab
4. Click **Play button (▶️)** on "STEMI Progression"
5. Alert: "Scenario 'STEMI Progression' applied to case!"
6. Should auto-switch back to Cases tab
7. Navigate back to Step 3
8. Verify green success message shows:
   ```
   ✓ Using scenario from repository: STEMI Progression
   ```

**3.3 Configure Duration**
1. Select duration dropdown below scenario selector
2. Choose "60 minutes (1 hour)"
3. Verify timeline preview updates with new timings
4. Check auto-start checkbox
5. Click "Next" to Step 4

**3.4 Save Case**
1. Add any clinical pages (optional)
2. Click "Save Case"
3. Verify case appears in case list
4. Click "Export" to download JSON
5. Open JSON file and verify:
   ```json
   {
     "name": "Test Cardiac Case",
     "scenario": {
       "enabled": true,
       "autoStart": true,
       "timeline": [...]
     },
     "scenario_from_repository": {
       "id": 1,
       "name": "STEMI Progression"
     }
   }
   ```

---

### **Phase 4: Quick Templates (Alternative Method)**

**4.1 Use Quick Template Instead**
1. Create another new case
2. In Step 3, scroll to "Quick Templates" section
3. Select "Septic Shock Progression" from dropdown
4. Verify it works same as before (no repository metadata)
5. This is the old method (hardcoded templates)

**4.2 Verify Difference**
- Quick templates: No `scenario_from_repository` in JSON
- Repository scenarios: Has `scenario_from_repository.id` and `name`

---

### **Phase 5: Edit & Delete Scenarios**

**5.1 Edit Scenario (Not Fully Implemented Yet)**
1. Settings → Scenarios tab
2. Click **Edit button (✏️)** on any scenario
3. Modal appears with note: "Visual editor coming soon!"
4. Click "Close"
5. **TODO:** Full editing UI not yet implemented

**5.2 Delete Scenario**
1. Click **Delete button (🗑️)** on "Hypertensive Crisis"
2. Confirm deletion
3. Verify scenario removed from list
4. Verify count reduces from 6 to 5

**5.3 Verify Database Persistence**
1. Refresh browser (F5)
2. Return to Scenarios tab
3. Verify only 5 scenarios remain (deletion persisted)

---

### **Phase 6: Permissions & Privacy**

**6.1 Admin Can See All**
- Public scenarios (is_public = 1)
- Own private scenarios
- Other users' public scenarios

**6.2 Create Private Scenario (Manual)**
```javascript
// Console
fetch('http://localhost:3000/api/scenarios', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${localStorage.getItem('token')}`
  },
  body: JSON.stringify({
    name: "My Private Test",
    description: "Testing private scenarios",
    duration_minutes: 20,
    category: "Test",
    timeline: [
      { time: 0, label: "Start", params: { hr: 80, spo2: 98, rr: 16, bpSys: 120, bpDia: 80, temp: 37, etco2: 38 } }
    ],
    is_public: false
  })
})
.then(r => r.json())
.then(console.log);
```

**6.3 Verify Private Scenario**
1. Refresh Scenarios tab
2. Should see new scenario with **🔒 Lock icon** (private)
3. Logout and login as different user
4. Verify private scenario NOT visible to other users

---

### **Phase 7: Load Scenario in Simulation**

**7.1 Load Case with Scenario**
1. Close Settings panel
2. Select "Test Cardiac Case" from case dropdown (top-left)
3. Case loads with patient info

**7.2 Verify Scenario Runs**
1. Monitor should display initial vitals
2. If auto-start enabled, scenario begins automatically
3. Settings → Monitor Settings → Scenarios tab
4. Should show:
   - Current step
   - Progress bar
   - "⏩ Trigger Next Step" button
5. Click trigger button to manually advance
6. Verify vitals update to next step values

**7.3 Monitor Scenario Progress**
1. Watch timeline in Settings → Scenarios
2. Verify current step highlights
3. Check vitals change according to timeline
4. Verify event log records scenario steps

---

## 🐛 **Known Issues & Limitations**

### **Not Yet Implemented:**
1. ❌ Visual scenario editor (JSON editing only)
2. ❌ Scenario templates dropdown (uses hardcoded list)
3. ❌ Conditional branching
4. ❌ Scenario versioning
5. ❌ Import/export scenarios separately
6. ❌ Scenario ratings/feedback

### **Workarounds:**
- **Creating Scenarios:** Use API endpoint with JSON
- **Editing Scenarios:** Use API PUT endpoint
- **Complex Logic:** Use quick templates for now

---

## 📊 **Verification Points**

### **Database:**
```bash
# Check scenarios table
sqlite3 server/database.sqlite "SELECT id, name, duration_minutes, category, is_public FROM scenarios;"
```

Expected output:
```
1|STEMI Progression|40|Cardiac|1
2|Septic Shock Progression|40|Sepsis|1
3|Respiratory Failure|30|Respiratory|1
4|Hypertensive Crisis|45|Cardiovascular|1
5|Anaphylactic Shock|10|Allergic|1
6|Post-Resuscitation Recovery|30|Recovery|1
```

### **API Endpoints:**
```bash
# Get all scenarios
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/scenarios

# Get single scenario
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/scenarios/1

# Create scenario
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"name":"Test","description":"...","duration_minutes":30,"timeline":[]}' \
  http://localhost:3000/api/scenarios
```

### **Browser Console Checks:**
```javascript
// Verify scenarios loaded
fetch('http://localhost:3000/api/scenarios', {
  headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
})
.then(r => r.json())
.then(data => console.table(data.scenarios));

// Check case has scenario
fetch('http://localhost:3000/api/cases/1', {
  headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
})
.then(r => r.json())
.then(c => console.log('Scenario:', c.scenario));
```

---

## ✅ **Success Criteria**

### **Repository Works If:**
1. ✅ Can seed 6 default scenarios
2. ✅ Scenarios persist after browser refresh
3. ✅ Can browse scenarios in UI
4. ✅ Can select scenario and apply to case
5. ✅ Scenario appears in case JSON
6. ✅ Scenario runs correctly in monitor
7. ✅ Can delete scenarios
8. ✅ Private scenarios not visible to other users
9. ✅ Admin can see all scenarios
10. ✅ No console errors during workflow

### **Integration Works If:**
1. ✅ Scenarios tab accessible in Settings
2. ✅ Case Wizard Step 3 shows both options
3. ✅ Browse button switches to Scenarios tab
4. ✅ Play button applies scenario to case
5. ✅ Returns to Cases tab after selection
6. ✅ Green success message shows in Step 3
7. ✅ Timeline preview updates correctly
8. ✅ Saved case includes scenario metadata
9. ✅ Quick templates still work as before
10. ✅ No breaking changes to existing features

---

## 🔧 **Troubleshooting**

### **Seed Fails:**
- Check if admin logged in
- Verify token in localStorage
- Check browser console for errors
- Try restarting server

### **Scenarios Don't Show:**
- Verify seeding completed successfully
- Check database: `SELECT COUNT(*) FROM scenarios;`
- Verify authentication token valid
- Try refreshing page

### **Can't Apply Scenario:**
- Must be in Case Wizard (editing a case)
- Must click "New Case" or "Edit" first
- Verify you're on Step 3 before browsing
- Check browser console for errors

### **Scenario Doesn't Run:**
- Verify case has `scenario` field in JSON
- Check `scenario.enabled` is true
- Verify timeline has valid steps
- Check monitor Settings → Scenarios tab

---

## 📚 **Next Steps**

1. **Test all phases above**
2. **Report any issues found**
3. **Suggest UI improvements**
4. **Request missing features**
5. **Document use cases**
6. **Train other instructors**

---

**Need Help?** See:
- `SCENARIO_REPOSITORY_GUIDE.md` - System overview
- `SCENARIO_SELECTOR_GUIDE.md` - Basic usage
- `CLINICAL_FEATURES_GUIDE.md` - Scenario mechanics
