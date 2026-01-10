# Laboratory Investigation System - Complete Guide

## Overview

The Laboratory Investigation System is a comprehensive, realistic simulation of clinical laboratory testing integrated into Rohy. It uses a database of 695+ real-world lab tests with gender-specific normal ranges to provide an authentic learning experience.

## Architecture

### Data Flow
```
Lab_database.txt (695 tests)
    ↓
Case Designer (Step 4)
    ↓
Database (case_investigations table)
    ↓
Student Orders Labs
    ↓
Results Display (with configurable settings)
    ↓
Instructor Can Edit Values (Real-time)
```

### Components

#### Backend
1. **`server/db.js`** - Enhanced database schema with 8 new columns for lab data
2. **`server/services/labDatabase.js`** - Lab database loader and search service
3. **`server/routes.js`** - 10+ new API endpoints for lab operations

#### Frontend
1. **`ConfigPanel.jsx`** - Step 4: Laboratory Investigations in Case Wizard
2. **`InvestigationPanel.jsx`** - Redesigned with search/browse modes
3. **`LabResultsModal.jsx`** - Beautiful results display with flags and formatting
4. **`LabValueEditor.jsx`** - Instructor real-time value editor
5. **`App.jsx`** - Integration of all components

## Features

### For Case Designers (Instructors/Admins)

#### Step 4: Laboratory Investigations
When creating or editing a case, instructors can:

1. **Search 695+ Lab Tests**
   - Real-time search with fuzzy matching
   - Filter by test group (Endocrinology, Hematology, etc.)
   - Gender-specific ranges automatically matched to patient demographics

2. **Configure Test Values**
   - Default: Random normal value from sample range
   - Manual override: Set abnormal values for pathological cases
   - Mark tests as abnormal with one click
   - Set turnaround time (default: 30 minutes)

3. **Test Groups Available**
   - Endocrinology (Diabetes, Thyroid, Adrenal, Reproductive)
   - Hematology (Blood counts, Coagulation)
   - Chemistry (Electrolytes, Liver, Kidney function)
   - Cardiac markers
   - Immunology
   - Toxicology
   - And many more...

#### Real-Time Editing During Simulation
Instructors can access the "Labs" tab in Monitor Settings to:
- View all configured lab tests for the current case
- Edit values on-the-fly during active simulation
- Simulate disease progression or treatment response
- Changes apply immediately to ordered (but not yet viewed) tests
- All edits are logged in the event log

### For Students

#### Ordering Laboratory Tests

**Two Modes Available:**

1. **Search Mode (Default)**
   - Type test name (e.g., "glucose", "CBC", "troponin")
   - Filter by group dropdown
   - Multi-select with checkboxes
   - Order selected tests with one click

2. **Browse All Mode**
   - View all available tests grouped by category
   - Collapsible sections for easy navigation
   - Same selection and ordering mechanism

**Features:**
- Real-time countdown timers for pending results
- Visual notifications when results are ready
- "Already ordered" status prevents duplicates
- See test group, turnaround time, and abnormal flags

#### Viewing Results

**Beautiful Results Modal Features:**
- Professional lab report format
- Patient demographics in header
- Ordered and resulted timestamps
- Color-coded values:
  - 🟢 Green = Normal
  - 🟡 Yellow = Abnormal (High)
  - 🔵 Blue = Abnormal (Low)
- Flags: ↑ HIGH, ↓ LOW, ⚠️ CRITICAL
- Toggle normal ranges on/off
- Toggle flags on/off
- Print-friendly format

**Settings (Persisted in localStorage):**
- Show/hide normal ranges
- Show/hide abnormal flags
- Settings apply across all sessions

## Database Schema

### Enhanced `case_investigations` Table
```sql
CREATE TABLE case_investigations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER,
    investigation_type TEXT,
    test_name TEXT,
    result_data JSON,
    image_url TEXT,
    turnaround_minutes INTEGER DEFAULT 30,
    -- NEW COLUMNS FOR LAB SYSTEM --
    test_group TEXT,              -- e.g., "Endocrinology (Diabetes)"
    gender_category TEXT,          -- "Male", "Female", or "Both"
    min_value REAL,               -- Normal range minimum
    max_value REAL,               -- Normal range maximum
    current_value REAL,           -- Actual value (normal or abnormal)
    unit TEXT,                    -- e.g., "mg/dL", "mmol/L"
    normal_samples JSON,          -- Array of normal sample values
    is_abnormal BOOLEAN DEFAULT 0, -- Flag if instructor modified
    FOREIGN KEY(case_id) REFERENCES cases(id)
);
```

### `investigation_orders` Table
```sql
CREATE TABLE investigation_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    investigation_id INTEGER,
    ordered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    available_at DATETIME,        -- ordered_at + turnaround_minutes
    viewed_at DATETIME,            -- When student opened results
    FOREIGN KEY(session_id) REFERENCES sessions(id),
    FOREIGN KEY(investigation_id) REFERENCES case_investigations(id)
);
```

## API Endpoints

### Lab Database Endpoints
- `GET /api/labs/search?q=glucose&limit=50` - Search lab tests
- `GET /api/labs/groups` - Get all test groups
- `GET /api/labs/group/:groupName` - Get tests by group
- `GET /api/labs/all?page=1&pageSize=50` - Get all tests (paginated)
- `GET /api/labs/grouped` - Get tests grouped by name

### Case Configuration Endpoints
- `POST /api/cases/:caseId/labs` - Add lab test to case
- `PUT /api/cases/:caseId/labs/:labId` - Update lab values
- `DELETE /api/cases/:caseId/labs/:labId` - Remove lab from case

### Simulation Endpoints
- `GET /api/sessions/:sessionId/available-labs` - Get labs for session's case
- `POST /api/sessions/:sessionId/order-labs` - Order multiple tests
- `GET /api/sessions/:sessionId/lab-results` - Get completed results
- `PUT /api/sessions/:sessionId/labs/:labId` - Instructor edit during sim
- `PUT /api/orders/:orderId/view` - Mark result as viewed

## Lab Database Structure

### Source: `Lab_database.txt`

Contains 695+ tests with the following structure:
```json
{
  "test_name": "Glucose, blood",
  "group": "Endocrinology (Diabetes)",
  "category": "Male",
  "min_value": 70,
  "max_value": 100,
  "unit": "mg/dL",
  "normal_samples": [85, 92, 78, 88, 95]
}
```

### Gender-Specific Ranges
Many tests have separate entries for Male and Female with different normal ranges. The system automatically selects the appropriate range based on the patient's gender set in Step 2 (Demographics).

## User Workflows

### Workflow 1: Create Case with Abnormal Labs

1. **Admin opens Case Wizard**
2. **Step 1:** Configure persona and behavior
3. **Step 2:** Set patient demographics (e.g., Male, 55yo)
4. **Step 3:** Configure scenarios (optional)
5. **Step 4: Laboratory Investigations**
   - Search "glucose"
   - System auto-loads Male ranges (70-100 mg/dL)
   - Default value: 85 mg/dL (random from normal samples)
   - Click "Mark Abnormal"
   - Enter custom value: 450 mg/dL (diabetic crisis)
   - Add more tests (HbA1c, Ketones, BMP, etc.)
6. **Step 5:** Add clinical records pages
7. **Save Case** - Labs are saved to database

### Workflow 2: Student Orders & Views Results

1. **Student loads case "Diabetic Emergency"**
2. **Clicks "Order Labs" button** (top right)
3. **Search panel opens** (default mode)
4. **Types "glucose"** in search bar
5. **Selects multiple tests:**
   - ☑ Glucose, blood
   - ☑ Hemoglobin A1c
   - ☑ Basic Metabolic Panel
6. **Clicks "Order Selected Tests"**
7. **Sees pending orders** with countdown timers:
   - Glucose - Ready in 30 min ⏰
   - HbA1c - Ready in 45 min ⏰
   - BMP - Ready in 30 min ⏰
8. **Waits for turnaround time** (real-time or fast-forward)
9. **Notification appears** "Results Available"
10. **Clicks "View Results"**
11. **Beautiful modal shows:**
    - Glucose: 450 ⚠️ mg/dL (Range: 70-100) ↑ HIGH
    - HbA1c: 12.5 ⚠️ % (Range: 4-6) ↑ HIGH
    - BMP values all displayed with flags
12. **Student analyzes results** and makes clinical decisions
13. **All orders logged** in database for analytics

### Workflow 3: Instructor Edits During Simulation

1. **Simulation running**, student ordered CBC
2. **Instructor opens Monitor Settings** → **Labs tab**
3. **Finds "Complete Blood Count"**
4. **Expands test details**
5. **Changes WBC** from 12.5 to 18.0 (worsening infection)
6. **Clicks "Save Changes"**
7. **Value updates immediately:**
   - If student already viewed: visible on re-check
   - If not yet viewed: new values appear when opened
8. **Edit logged in event_log** table

## Technical Implementation Details

### Performance Optimizations
- Lab database cached in memory on server startup
- 695 tests searchable in < 100ms
- Fuzzy search with partial matching
- Client-side filtering for instant results
- Pagination for "Browse All" mode

### Gender Matching Logic
```javascript
// Automatic gender-specific range selection
const selectTest = (testName, patientGender) => {
  const variations = getTestVariations(testName);
  
  // 1. Try exact gender match
  let match = variations.find(v => v.category === patientGender);
  
  // 2. Fallback to 'Both' category
  if (!match) {
    match = variations.find(v => v.category === 'Both');
  }
  
  // 3. Last resort: first variation
  if (!match) {
    match = variations[0];
  }
  
  return match;
};
```

### Normal Value Selection
```javascript
// Random normal sample for realism
const getDefaultValue = (test) => {
  if (test.normal_samples && test.normal_samples.length > 0) {
    const randomIndex = Math.floor(Math.random() * test.normal_samples.length);
    return test.normal_samples[randomIndex];
  }
  // Fallback to midpoint
  return (test.min_value + test.max_value) / 2;
};
```

### Value Evaluation
```javascript
const evaluateValue = (value, minValue, maxValue) => {
  if (value < minValue) return 'low';
  if (value > maxValue) return 'high';
  return 'normal';
};
```

### Real-Time Updates
- Polling every 10 seconds for order status
- Optimistic UI updates for better UX
- Future: WebSocket for instant updates

## Settings & Preferences

### User Settings (localStorage)
- `rohy_show_lab_ranges` - Show/hide normal ranges (default: true)
- `rohy_show_lab_flags` - Show/hide abnormal flags (default: true)

### Instructor Settings
- Snooze duration for alarms
- Real-time lab value editing
- All settings persisted per session

## Logging & Analytics

All lab-related events are logged to `event_log` table:
- Investigation ordered
- Results viewed
- Instructor edits
- Timestamps for all actions

## Best Practices

### For Case Designers
1. **Match lab values to clinical scenario**
   - Diabetic case: High glucose, high HbA1c
   - Anemia: Low hemoglobin, low hematocrit
   - Kidney failure: High creatinine, high BUN
2. **Use realistic abnormal values**
   - Reference actual clinical ranges
   - Consider severity (mild, moderate, severe)
3. **Set appropriate turnaround times**
   - STAT tests: 15-30 minutes
   - Routine: 30-60 minutes
   - Special tests: 2-24 hours
4. **Test the scenario before publishing**
   - Verify values display correctly
   - Check flags are appropriate
   - Ensure gender matching works

### For Students
1. **Order relevant tests based on presentation**
2. **Wait for results before ordering more**
3. **Review all values, not just abnormals**
4. **Compare to normal ranges**
5. **Consider trending over time**

### For Instructors During Simulation
1. **Use real-time editing sparingly**
2. **Simulate realistic disease progression**
3. **Document edits in case notes**
4. **Explain changes to students**

## Troubleshooting

### Common Issues

**Labs not showing up in case:**
- Verify case has labs configured in Step 4
- Check database for case_investigations entries
- Ensure session is active

**Results not appearing:**
- Check turnaround time hasn't elapsed
- Verify order was successful (check investigation_orders table)
- Poll interval is 10 seconds - wait for refresh

**Gender mismatch:**
- Verify patient demographics set in Step 2
- Check lab database has correct gender categories
- Some tests only available for one gender

**Values not updating:**
- Instructor edits only affect not-yet-viewed results
- Refresh the investigation panel
- Check browser console for errors

## Future Enhancements

### Planned Features
- **Trending graphs** - Show values over time if repeated
- **Critical value alerts** - Pop-up for dangerous values
- **Lab interpretation hints** - Educational notes
- **AI suggestions** - "Based on these values, consider ordering..."
- **Cost tracking** - Budget simulation
- **Insurance approval** - Pre-authorization delays
- **Conditional results** - Labs change based on treatment
- **Export to PDF** - Professional lab reports

### Integration Opportunities
- Link to differential diagnosis system
- Connect with treatment decision trees
- Integration with electronic health records
- Real-time collaboration for team-based learning

## Technical Requirements

### Browser Support
- Modern browsers with ES6+ support
- Chrome, Firefox, Safari, Edge (latest versions)
- JavaScript enabled
- LocalStorage support

### Server Requirements
- Node.js 14+
- SQLite 3
- 100MB+ storage for lab database

## Credits

**Lab Database Source:** Real-world clinical laboratory reference ranges  
**Implementation:** Mohammed Saqr, University of Eastern Finland  
**License:** MIT

## Support

For issues, feature requests, or contributions:
- Check existing cases for examples
- Review console logs for errors
- Contact: Mohammed Saqr (www.saqr.me)

---

**Version:** 1.0.0  
**Last Updated:** January 2026  
**Status:** Production Ready ✓
