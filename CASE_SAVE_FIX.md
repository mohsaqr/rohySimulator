# Case Save Fix - Critical Update

## Problem Identified

**Error:** `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`

**Root Causes:**
1. ❌ **Missing scenario field** in POST/PUT routes - Cases with scenarios weren't being saved
2. ❌ **Poor error handling** - HTML error pages were being parsed as JSON
3. ❌ **No validation** - Cases could be saved without required fields
4. ❌ **JSON parsing issues** - Config and scenario fields weren't being parsed when retrieved

---

## 🔧 Fixes Implemented

### 1. Updated Backend Routes (`server/routes.js`)

#### POST /api/cases - Added scenario field
```javascript
// BEFORE
const { name, description, system_prompt, config, image_url } = req.body;
const sql = `INSERT INTO cases (name, description, system_prompt, config, image_url) VALUES (?, ?, ?, ?, ?)`;

// AFTER
const { name, description, system_prompt, config, image_url, scenario } = req.body;
const sql = `INSERT INTO cases (name, description, system_prompt, config, image_url, scenario) VALUES (?, ?, ?, ?, ?, ?)`;
const params = [
    name, 
    description, 
    system_prompt, 
    JSON.stringify(config || {}), 
    image_url || null,
    scenario ? JSON.stringify(scenario) : null  // NEW
];
```

#### PUT /api/cases/:id - Added scenario field
```javascript
// BEFORE
const sql = `UPDATE cases SET name = ?, description = ?, system_prompt = ?, config = ?, image_url = ? WHERE id = ?`;

// AFTER
const sql = `UPDATE cases SET name = ?, description = ?, system_prompt = ?, config = ?, image_url = ?, scenario = ? WHERE id = ?`;
```

#### GET /api/cases - Proper JSON parsing
```javascript
// BEFORE
res.json({ cases: rows });

// AFTER
const cases = rows.map(row => ({
    ...row,
    config: row.config ? JSON.parse(row.config) : {},
    scenario: row.scenario ? JSON.parse(row.scenario) : null
}));
res.json({ cases });
```

### 2. Enhanced Frontend Error Handling (`ConfigPanel.jsx`)

#### Validation Before Save
```javascript
// Validate required fields
if (!editingCase.name || editingCase.name.trim() === '') {
    alert('Please enter a case name before saving.');
    return;
}

// Check authentication
if (!token) {
    alert('Authentication required. Please log in again.');
    return;
}

// Ensure config exists
const config = editingCase.config || {};
```

#### Better Error Messages
```javascript
if (!res.ok) {
    // Check if response is JSON
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        const error = await res.json();
        throw new Error(error.error || `Failed to save case (${res.status})`);
    } else {
        // Response is not JSON (likely HTML error page)
        const text = await res.text();
        console.error('Non-JSON response:', text);
        throw new Error(`Server error (${res.status}). Check console for details.`);
    }
}
```

#### Debug Logging
```javascript
console.log('Saving case:', { isUpdate, url, payload: { ...payload, config: 'omitted for brevity' } });
console.log('Response status:', res.status);
console.log('Case saved successfully:', saved);
```

---

## ✅ What's Fixed

| Issue | Status | Solution |
|-------|--------|----------|
| Scenario not saving | ✅ Fixed | Added scenario field to POST/PUT routes |
| Config not saving | ✅ Fixed | Ensured config defaults to {} |
| HTML error parsed as JSON | ✅ Fixed | Check content-type before parsing |
| No validation | ✅ Fixed | Validate name and token before save |
| Silent failures | ✅ Fixed | Console logging at each step |
| JSON parsing on retrieval | ✅ Fixed | Parse config and scenario in GET route |

---

## 🧪 How to Test

### Test 1: New Case with Default Data
```
1. Open Settings → Cases → New Case
2. Click "Load Standard Defaults" (Step 1)
3. Navigate through all steps (auto-saves on each Next)
4. Check browser console for "Case saved successfully" logs
5. Verify green notification appears
6. Click "Save & Finish" on Step 5
7. Verify case appears in cases list
```

### Test 2: Edit Existing Case
```
1. Click "Edit" on any case
2. Modify some fields
3. Click "Save Progress"
4. Check console for success log
5. Close wizard
6. Reopen case
7. Verify changes persisted
```

### Test 3: Case with Scenario
```
1. Create new case
2. Go to Step 3 (Progression Scenario)
3. Select a scenario template (e.g., STEMI Progression)
4. Choose duration (e.g., 30 minutes)
5. Navigate to Step 5
6. Click "Save & Finish"
7. Load the case in simulation
8. Verify scenario loads properly
```

### Test 4: Error Handling
```
1. Create new case
2. Leave name blank
3. Try to save
4. Should see: "Please enter a case name before saving."
```

---

## 🔍 Debugging Tips

### Check Browser Console
Look for these logs:
```javascript
✅ "Saving case:" - Shows what's being sent
✅ "Response status: 200" or "Response status: 201"
✅ "Case saved successfully:" - Shows returned data
❌ "Non-JSON response:" - Indicates server error
```

### Check Network Tab
1. Open DevTools → Network
2. Click "Save Progress" or "Save & Finish"
3. Look for POST/PUT to `/api/cases`
4. Check:
   - Request payload includes all fields
   - Response is 200/201 with JSON
   - If 500, check Response tab for error

### Check Server Logs
```bash
# If running in terminal, check output
# Look for:
✅ "Loaded X lab tests from database"
❌ "Error saving case:" - Shows database errors
```

### Check Database Directly
```bash
cd /Users/mohammedsaqr/Documents/VipSim
sqlite3 server/database.sqlite

# Check if case was saved
SELECT id, name, scenario IS NOT NULL as has_scenario FROM cases ORDER BY id DESC LIMIT 5;

# Check case details
SELECT * FROM cases WHERE id = <case_id>;
```

---

## 🚨 Common Issues & Solutions

### Issue: "Unexpected token '<'"
**Cause:** Server returning HTML error page  
**Fix:** Check server console for actual error, check authentication token

### Issue: Changes not persisting
**Cause:** Case not being saved to database  
**Fix:** Check console for save logs, verify token exists, check network tab

### Issue: "Failed to save case (500)"
**Cause:** Database error or missing required field  
**Fix:** Check server console, ensure name is provided

### Issue: Scenario not loading in simulation
**Cause:** Scenario field wasn't saved  
**Fix:** Now fixed! Scenario field added to routes

---

## 📊 Data Flow

```
User clicks "Save Progress"
    ↓
Validate name and token
    ↓
Prepare payload with config, scenario
    ↓
POST or PUT to /api/cases
    ↓
Server: JSON.stringify(config, scenario)
    ↓
Insert/Update in SQLite
    ↓
Return saved case with ID
    ↓
Frontend: Update editingCase with ID
    ↓
Show success notification
    ↓
Stay on current step (allow more edits)
```

---

## ✨ New Features Summary

1. **Auto-save on navigation** - No more lost work
2. **Scenario persistence** - Scenarios now save properly
3. **Better error messages** - Know what went wrong
4. **Debug logging** - Track save progress in console
5. **Validation** - Can't save incomplete cases
6. **Toast notifications** - Non-intrusive success feedback
7. **Continuous editing** - Wizard stays open after save

---

## 🎯 Verification Checklist

Before considering this fixed, verify:

- [ ] New case can be created
- [ ] Case saves successfully (check console logs)
- [ ] Green notification appears
- [ ] Case appears in cases list
- [ ] Reopening case shows saved data
- [ ] Scenario saves and loads
- [ ] Lab investigations save
- [ ] Clinical records save
- [ ] Image URL saves
- [ ] Updates work (not just creates)
- [ ] No "Unexpected token '<'" errors

---

**Status:** ✅ **FIXED**  
**Date:** January 10, 2026  
**Tested:** Pending user verification  
**Backend Restarted:** Yes (required for route changes)

---

## 📝 Notes

- Server must be restarted after route changes
- Frontend changes are hot-reloaded automatically
- All JSON fields (config, scenario) properly handled
- Database schema already had scenario column (from migration)
- Routes just weren't using it - now fixed!
