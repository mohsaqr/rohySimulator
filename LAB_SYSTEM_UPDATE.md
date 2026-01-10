# Laboratory System Update - Flexible Configuration

## ✅ Implementation Complete

The laboratory investigation system has been updated with a more flexible approach that gives instructors complete control over lab availability and values.

## 🎯 New Features

### 1. **Default Labs Toggle** (Case Designer - Step 4)

Instructors can now enable/disable default lab availability:

#### ✅ **Toggle ON** (Default)
- **All 77 lab tests are automatically available**
- Students can order any lab from the full database
- All tests return **normal values** by default
- Gender-specific ranges are automatically matched
- No configuration required for normal values

#### ❌ **Toggle OFF**
- **Only configured abnormal tests are available**
- Students can still search and select any test
- Tests without configured values return **"Result Not Available"**
- Useful for teaching resource limitations or pre-authorization

### 2. **Abnormal Tests (Optional Configuration)**

Instructors can optionally configure specific tests with abnormal values:

#### **Add Individual Tests**
1. Search for test by name
2. Select from results
3. Configure abnormal value
4. Set turnaround time

#### **Add By Group** 🆕
1. Select a test group from dropdown (e.g., "Hematology (CBC)")
2. Click "Add Group" button
3. All tests in that group are added at once
4. Configure abnormal values for each
5. Perfect for creating comprehensive cases quickly

### 3. **Smart Value Resolution**

When a student orders a lab test:

```
IF test has configured abnormal value:
    → Return abnormal value (as set by instructor)
ELSE IF default labs enabled:
    → Return normal value (random from normal samples)
ELSE:
    → Return "Result Not Available"
```

## 🎓 Use Cases

### Case 1: Normal Patient (Simple)
**Configuration:**
- ✅ Default Labs Enabled: **ON**
- Abnormal Tests: **None**

**Result:**
- All 77 tests available with normal values
- No configuration needed
- Perfect for routine checkups or normal baseline cases

### Case 2: Specific Pathology (Common)
**Configuration:**
- ✅ Default Labs Enabled: **ON**
- Abnormal Tests: **Glucose (450), HbA1c (12.5), Ketones (High)**

**Result:**
- All 77 tests available
- Most return normal values
- Glucose, HbA1c, and Ketones return abnormal values
- Perfect for diabetic ketoacidosis case

### Case 3: Comprehensive Hematology Case
**Configuration:**
- ✅ Default Labs Enabled: **ON**
- Abnormal Tests: **Add by Group → "Hematology (CBC)"**
- Then configure: WBC (18000), Hemoglobin (8.5), Platelets (50000)

**Result:**
- All 77 tests available
- CBC panel shows anemia + thrombocytopenia
- Other tests return normal values
- Perfect for hematologic disorders

### Case 4: Resource-Limited Setting (Advanced)
**Configuration:**
- ❌ Default Labs Enabled: **OFF**
- Abnormal Tests: **Only critical tests (Glucose, CBC, BMP)**

**Result:**
- Only configured tests return results
- Other tests show "Result Not Available"
- Teaches resource management and test prioritization
- Simulates rural or emergency settings

## 🔧 Technical Implementation

### Backend Changes

#### 1. **`/api/sessions/:sessionId/available-labs`**
- Checks `defaultLabsEnabled` setting in case config
- If enabled: Returns all 77 tests from database
- Merges configured abnormal values with defaults
- Each lab marked with `source: 'configured'` or `source: 'default'`

#### 2. **`/api/sessions/:sessionId/order-labs`**
- Accepts both configured lab IDs and default lab IDs
- For default labs (ID starts with `default_`):
  - Creates temporary `case_investigations` entry
  - Uses gender-specific normal values
  - Assigns random normal value from samples
- For configured labs:
  - Uses existing case_investigations entry
  - Returns configured abnormal value

#### 3. **Lab Value Resolution**
```javascript
// Priority order:
1. Configured abnormal value (highest)
2. Default normal value (if enabled)
3. "Not Available" (if defaults off)
```

### Frontend Changes

#### 1. **Step 4: Laboratory Investigations**
- **New Toggle:** "All Lab Tests Available by Default"
  - Clear explanation of ON/OFF behavior
  - Default: ON
  - Persisted in case config

- **Renamed Section:** "Abnormal Tests (Optional)"
  - Emphasizes optional nature
  - Shows count of configured tests
  - Yellow "ABNORMAL" badge on each

- **Add By Group Button:** 🆕
  - Enabled when specific group selected
  - Fetches all tests in group
  - Adds them with one click
  - Shows loading state

#### 2. **LabInvestigationSelector Component**
- New prop: `showAddByGroup`
- New function: `handleAddByGroup()`
- Fetches from `/api/labs/group/:groupName`
- Groups tests by name (handles gender variations)
- Adds all unique tests

#### 3. **InvestigationPanel** (Student View)
- No visible changes
- Seamlessly handles both configured and default labs
- Shows all available tests regardless of source

## 📚 Test Groups Available

Students/instructors can add entire groups at once:

- Endocrinology (Diabetes)
- Endocrinology (Thyroid)
- Endocrinology (Adrenal)
- Endocrinology (Reproductive)
- Hematology (CBC)
- Hematology (Coagulation)
- Chemistry (Electrolytes)
- Chemistry (Liver Function)
- Chemistry (Kidney Function)
- Cardiac Markers
- Lipid Panel
- Immunology
- And more...

## 💡 Best Practices

### For Simple Cases
1. Leave **Default Labs ON**
2. Don't configure any abnormal tests
3. Students can order anything, all normal

### For Pathology Cases
1. Leave **Default Labs ON**
2. Add abnormal tests by:
   - **Individual:** Search and add one by one
   - **Group:** Select group + "Add Group"
3. Configure abnormal values
4. Normal tests return normal values

### For Resource Teaching
1. Turn **Default Labs OFF**
2. Only add available tests
3. Students learn to work with limitations
4. Teaches test prioritization

### For Quick Setup
1. Use "Add By Group" for related tests
2. Batch configure values
3. Much faster than individual selection

## 🎯 Workflow Example

### Creating a "Diabetic Ketoacidosis" Case

**Step 4: Laboratory Investigations**

1. **✅ Check:** "All Lab Tests Available by Default" (ON)
   - This ensures students can order other tests if needed

2. **Add Abnormal Tests:**
   - Search "glucose" → Add → Set to **450 mg/dL**
   - Search "hemoglobin a1c" → Add → Set to **12.5%**
   - Select "Endocrinology (Diabetes)" → "Add Group"
   - Configure:
     - Ketones: High
     - pH: 7.2
     - Bicarbonate: 12

3. **Save Case**

**During Simulation:**
- Student orders: Glucose → Returns **450** (abnormal)
- Student orders: CBC → Returns **normal values** (default)
- Student orders: HbA1c → Returns **12.5%** (abnormal)
- Student orders: Lipid Panel → Returns **normal values** (default)

## 📊 Comparison: Old vs New

| Feature | Old System | New System |
|---------|-----------|------------|
| Default Availability | Must configure each test | All 77 tests available by default |
| Normal Values | Must add even for normal | Auto-generated from database |
| Abnormal Values | Required configuration | Optional configuration |
| Batch Adding | No | Yes - Add by Group |
| Resource Limitation | Not possible | Toggle off defaults |
| Setup Time | High | Low |

## 🚀 Benefits

### For Instructors
✅ **Faster case creation** - No need to add normal tests  
✅ **Flexibility** - Control exactly what's available  
✅ **Batch operations** - Add entire test groups  
✅ **Teaching tool** - Can simulate resource limitations  

### For Students
✅ **Realistic experience** - Can order any test like real life  
✅ **Learning flexibility** - Can explore beyond required tests  
✅ **Resource awareness** - Understands when tests unavailable  

## 🔄 Migration

### Existing Cases
- **No action needed**
- `defaultLabsEnabled` defaults to `true`
- Existing configured abnormal tests work as before
- Additional tests now available automatically

### New Cases
- Start with all tests available
- Add abnormal values as needed
- Use "Add by Group" for efficiency

## ⚠️ Important Notes

1. **Default ON is recommended** for most cases
2. **Turn defaults OFF** only for specific teaching scenarios
3. **Gender matching** still automatic
4. **Normal values** are random from normal_samples (realistic variation)
5. **Configured values** always override defaults

## 📝 Documentation Updated

- `LABORATORY_SYSTEM_GUIDE.md` - Complete system documentation
- `LAB_SYSTEM_UPDATE.md` - This document (feature update)
- Inline code comments

## ✅ Status: Production Ready

All features tested and working:
- ✅ Default labs toggle
- ✅ Add by group functionality
- ✅ Value resolution logic
- ✅ Frontend integration
- ✅ Backend API updates
- ✅ Database migrations
- ✅ No breaking changes

---

**Updated:** January 2026  
**Version:** 2.0.0  
**Author:** Mohammed Saqr, University of Eastern Finland
