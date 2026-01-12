# 📊 VipSim Comprehensive Logging System

## Overview

VipSim now includes a **complete backend logging system** with spreadsheet-style data recording. All logs are linked by **User**, **Session**, and **Case** for comprehensive tracking and analysis.

---

## 🗄️ Database Tables

### 1. **login_logs** - Authentication Tracking
Tracks every login, logout, and failed login attempt.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| user_id | INTEGER | User who performed action |
| username | TEXT | Username (for failed logins too) |
| action | TEXT | 'login', 'logout', 'failed_login' |
| ip_address | TEXT | IP address of request |
| user_agent | TEXT | Browser/device information |
| timestamp | DATETIME | When action occurred |

**Linked By:** User ID

---

### 2. **settings_logs** - Settings Change Tracking
Records all LLM and monitor settings changes.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| user_id | INTEGER | User who made change |
| session_id | INTEGER | Session where change occurred |
| case_id | INTEGER | Case being used |
| setting_type | TEXT | 'llm', 'monitor', 'case_load' |
| setting_name | TEXT | Which setting changed |
| old_value | TEXT | Previous value |
| new_value | TEXT | New value |
| settings_json | JSON | Complete settings snapshot |
| timestamp | DATETIME | When change occurred |

**Linked By:** User ID, Session ID, Case ID

---

### 3. **session_settings** - Session Settings Snapshots
Captures complete settings used in each practice session.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| session_id | INTEGER | Practice session |
| case_id | INTEGER | Case being practiced |
| user_id | INTEGER | User practicing |
| llm_provider | TEXT | LLM provider (OpenAI, Ollama, etc) |
| llm_model | TEXT | Model used (gpt-3.5, llama3, etc) |
| llm_base_url | TEXT | API endpoint |
| monitor_hr | INTEGER | Heart rate setting |
| monitor_rhythm | TEXT | Cardiac rhythm |
| monitor_spo2 | INTEGER | Oxygen saturation |
| monitor_bp_sys | INTEGER | Systolic blood pressure |
| monitor_bp_dia | INTEGER | Diastolic blood pressure |
| monitor_rr | INTEGER | Respiratory rate |
| monitor_temp | REAL | Temperature |
| settings_snapshot | JSON | Complete JSON of all settings |
| timestamp | DATETIME | When session started |

**Linked By:** User ID, Session ID, Case ID

---

### 4. **sessions** - Enhanced with Settings
Already exists, now includes:
- `llm_settings` (JSON) - LLM configuration snapshot
- `monitor_settings` (JSON) - Monitor configuration snapshot

---

### 5. **interactions** - Chat Logs
Already exists, contains complete conversation history.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| session_id | INTEGER | Session this message belongs to |
| role | TEXT | 'user', 'assistant', 'system' |
| content | TEXT | Message content |
| timestamp | DATETIME | When message was sent |

**Linked By:** Session ID (which links to User and Case)

---

## 📥 CSV Export Endpoints (Admin Only)

### **GET /api/export/login-logs**
Export all login/logout/failed login attempts.

**Query Parameters:**
- `start_date` (optional) - Filter from date (YYYY-MM-DD)
- `end_date` (optional) - Filter to date (YYYY-MM-DD)

**Returns:** CSV file with:
- User ID, Username, Email, Role
- Action (login/logout/failed)
- IP Address, User Agent
- Timestamp

**Example:**
```bash
GET /api/export/login-logs?start_date=2026-01-01&end_date=2026-01-31
```

---

### **GET /api/export/chat-logs**
Export complete conversation history.

**Query Parameters:**
- `session_id` (optional) - Specific session
- `case_id` (optional) - All sessions for a case
- `start_date` (optional) - Filter from date
- `end_date` (optional) - Filter to date

**Returns:** CSV file with:
- Interaction ID, Session ID, Role, Content
- Timestamp, Case Name, Username
- Session duration, Start/End time

**Example:**
```bash
GET /api/export/chat-logs?case_id=5&start_date=2026-01-01
```

---

### **GET /api/export/settings-logs**
Export all settings changes (LLM, monitor, case loads).

**Query Parameters:**
- `setting_type` (optional) - Filter by type ('llm', 'monitor', 'case_load')
- `start_date` (optional) - Filter from date
- `end_date` (optional) - Filter to date

**Returns:** CSV file with:
- Setting Type, Setting Name
- Old Value, New Value
- User, Case, Session
- Complete settings JSON
- Timestamp

**Example:**
```bash
GET /api/export/settings-logs?setting_type=llm
```

---

### **GET /api/export/session-settings**
Export complete settings snapshots for each session.

**Query Parameters:**
- `case_id` (optional) - Filter by case
- `start_date` (optional) - Filter from date
- `end_date` (optional) - Filter to date

**Returns:** CSV file with:
- Session ID, User, Case Name
- LLM Provider, Model, Base URL
- Monitor: HR, Rhythm, SpO2, BP, RR, Temp
- Session Start/End time, Duration
- Timestamp

**Example:**
```bash
GET /api/export/session-settings?case_id=3
```

---

### **GET /api/export/complete-session/:sessionId**
Export COMPLETE session data (all information + chat log).

**Returns:** CSV file with:
- **Session Info Section:**
  - User, Case, Duration
  - All LLM settings used
  - All Monitor settings used
- **Chat Log Section:**
  - Complete conversation
  - Role, Content, Timestamp for each message

**Example:**
```bash
GET /api/export/complete-session/123
```

---

## 🖥️ Admin UI - System Logs Tab

Located in **Settings → System Logs** (Admin only)

### Features:

1. **Quick Export Buttons**
   - Login Logs (CSV)
   - Chat Logs (CSV)
   - Settings Logs (CSV)
   - Session Settings (CSV)

2. **Date Range Filtering**
   - Filter by start date
   - Filter by end date
   - Apply to all exports

3. **Live Log Viewers**
   - **Login Activity** - Last 50 login events
   - **Settings Changes** - Last 50 setting modifications
   - Real-time updates

4. **Visual Indicators**
   - Color-coded by action type
   - Success (green), Failed (red), Logout (blue)
   - Timestamp and IP address display

---

## 🔄 Automatic Logging Events

### **Login Events**
- ✅ Successful login → logged automatically
- ❌ Failed login attempt → logged with username
- 🚪 Logout → logged when user clicks logout

### **Session Events**
- 🎯 Case loaded → logged with complete settings snapshot
- ⚙️ Settings changed → logged with old/new values
- 💬 Every chat message → automatically logged to interactions
- ⏱️ Session duration → tracked automatically

### **Settings Events**
- 🤖 LLM provider changed → logged
- 📊 Monitor settings adjusted → logged
- 🔄 Model switched → logged

---

## 📊 Data Linkage Structure

All logs are interconnected:

```
User (users table)
  └─> Login Logs (login_logs)
  └─> Session (sessions)
      ├─> Case (cases)
      ├─> Session Settings (session_settings)
      ├─> Settings Logs (settings_logs)
      └─> Interactions (interactions/chat)
```

**Every log entry can be traced to:**
- Which user performed the action
- Which session it occurred in
- Which case was being used
- Exact timestamp

---

## 🔍 Usage Examples

### Example 1: Analyze User Practice Patterns
```sql
-- Get all sessions for a user with complete settings
SELECT 
    s.id, s.start_time, s.duration,
    c.name as case_name,
    ss.llm_model, ss.monitor_hr, ss.monitor_rhythm
FROM sessions s
JOIN cases c ON s.case_id = c.id
JOIN session_settings ss ON s.id = ss.session_id
WHERE s.user_id = 5
ORDER BY s.start_time DESC;
```

### Example 2: Track LLM Usage
```sql
-- See which LLM models are most used
SELECT 
    llm_provider, llm_model, COUNT(*) as usage_count
FROM session_settings
GROUP BY llm_provider, llm_model
ORDER BY usage_count DESC;
```

### Example 3: Find Failed Login Attempts
```sql
-- Security monitoring: failed login attempts
SELECT username, ip_address, timestamp
FROM login_logs
WHERE action = 'failed_login'
ORDER BY timestamp DESC
LIMIT 50;
```

---

## 📈 Spreadsheet Analysis

### Open CSVs in:
- **Microsoft Excel**
- **Google Sheets**
- **LibreOffice Calc**
- **Apple Numbers**
- Any CSV-compatible tool

### Recommended Analysis:
1. **Login Patterns**
   - Peak usage times
   - User activity trends
   - Security monitoring

2. **Chat Effectiveness**
   - Average conversation length
   - Most common questions
   - Student performance patterns

3. **Settings Usage**
   - Popular LLM configurations
   - Monitor settings preferences
   - Case difficulty analysis

4. **Session Analytics**
   - Average session duration
   - Completion rates
   - Case popularity

---

## 🔒 Security & Privacy

### Admin-Only Access
- ✅ Only admins can export logs
- ✅ Only admins can view system logs tab
- ✅ Users can only see their own data

### Data Included
- ✅ Complete conversation history
- ✅ User activity tracking
- ✅ IP addresses (for security)
- ✅ Timestamps for all events

### Best Practices
- 🔐 Keep exports secure
- 🗑️ Delete old exports after analysis
- 👥 Only share anonymized data
- 📅 Regular log reviews for security

---

## 🚀 Quick Start Guide

### For Admins:

1. **Login as Admin**
2. **Go to Settings (⚙️)**
3. **Click "System Logs" tab**
4. **Choose what to export:**
   - Login Logs
   - Chat Logs
   - Settings Logs
   - Session Settings
5. **Click download button**
6. **Open CSV in Excel/Sheets**
7. **Analyze data!**

### Date Filtering:
1. Set start date (optional)
2. Set end date (optional)
3. Click export - filters apply automatically

---

## 📋 Complete Data Schema

All tables and their relationships for comprehensive analysis:

```
users                    login_logs
  ├─ id          ←────────  user_id
  ├─ username              username
  ├─ email                 action
  ├─ role                  ip_address
  └─ created_at            timestamp

sessions                 session_settings
  ├─ id          ←────────  session_id
  ├─ case_id     ←────────  case_id
  ├─ user_id     ←────────  user_id
  ├─ start_time            llm_provider
  ├─ end_time              llm_model
  ├─ duration              monitor_*
  ├─ llm_settings          settings_snapshot
  └─ monitor_settings

interactions            settings_logs
  ├─ id                    ├─ user_id
  ├─ session_id    ──────> ├─ session_id
  ├─ role                  ├─ case_id
  ├─ content               ├─ setting_type
  └─ timestamp             ├─ old_value/new_value
                           └─ timestamp

cases
  ├─ id
  ├─ name
  ├─ description
  ├─ system_prompt
  └─ config
```

---

## ✅ What's Tracked

### ✅ User Authentication
- Every login
- Every logout
- Failed login attempts
- IP addresses
- Browser/device info

### ✅ Chat/Conversations
- Every message (user & AI)
- Complete conversation history
- Timestamps for each message
- Linked to user, session, case

### ✅ Settings
- LLM provider/model changes
- Monitor settings adjustments
- Case loads
- Before/after values

### ✅ Sessions
- Start time
- End time
- Duration
- Complete settings snapshot
- User, case linkage

---

## 🎉 Benefits

1. **Complete Audit Trail** - Know exactly what happened and when
2. **Performance Analysis** - Track student progress and usage patterns
3. **Security Monitoring** - Failed login attempts, unusual activity
4. **Quality Assurance** - Review conversations for training quality
5. **Research Data** - Comprehensive data for educational research
6. **Compliance** - Meet logging requirements for medical education

---

## 📞 Support

All logging is automatic. Admins can export data anytime through the System Logs interface.

For technical details, see:
- `server/db.js` - Database schema
- `server/routes.js` - Export endpoints
- `src/components/settings/ConfigPanel.jsx` - UI implementation

---

**🎉 Your complete backend logging system is ready to use!**

All data is automatically recorded and ready for spreadsheet analysis.
