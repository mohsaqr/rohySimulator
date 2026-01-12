# Rohy - Virtual Patient Simulation System
## Complete System Documentation

**Version:** 2.0.0  
**Last Updated:** January 2026  
**Created & Maintained by:** Mohammed Saqr, Professor of Computer Science, University of Eastern Finland  
**Website:** [www.saqr.me](https://www.saqr.me)  
**License:** MIT

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [System Architecture](#system-architecture)
4. [Core Features](#core-features)
5. [User Roles](#user-roles)
6. [File Structure](#file-structure)
7. [Database Schema](#database-schema)
8. [API Endpoints](#api-endpoints)
9. [Detailed Feature Guides](#detailed-feature-guides)
10. [Development](#development)
11. [Deployment](#deployment)
12. [Troubleshooting](#troubleshooting)

---

## Overview

### What is Rohy?

Rohy is a comprehensive virtual patient simulation system designed for medical education. It provides realistic patient interactions, vital signs monitoring, laboratory investigations, and scenario-based learning experiences.

### Key Capabilities

- **🤖 AI-Powered Patient Interaction** - LLM-driven conversational patient simulation
- **📊 Real-Time Vital Signs Monitoring** - Advanced ECG generation, vital signs display with alarms
- **🔬 Laboratory Investigation System** - 77+ lab tests with normal/abnormal values
- **📈 Scenario-Based Learning** - Progressive deterioration scenarios with timeline management
- **👥 Multi-User Support** - Student and instructor roles with full authentication
- **📝 Comprehensive Logging** - All interactions, settings changes, and events tracked
- **🎛️ Instructor Controls** - Real-time editing of vitals, labs, and scenarios during simulation
- **📊 Analytics & Reporting** - Session tracking, performance metrics, data export

### Technology Stack

**Frontend:**
- React 18
- Vite
- TailwindCSS
- Lucide Icons

**Backend:**
- Node.js + Express
- SQLite3 (database)
- JWT Authentication
- Bcrypt (password hashing)

**APIs & Services:**
- LLM Integration (OpenAI, LM Studio, Ollama)
- Custom lab database service
- Real-time ECG generation engine

---

## Quick Start

### Prerequisites

- Node.js 14+
- npm or yarn
- Modern web browser (Chrome, Firefox, Safari, Edge)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd VipSim

# Install dependencies
npm install

# Set up environment
cp server/.env.example server/.env
# Edit server/.env with your settings

# Run development server
npm run dev
```

### First Time Setup

1. **Access the application:** http://localhost:5173/
2. **Register first user:** Will automatically become admin
3. **Create a case:** Settings → Cases → New Case
4. **Start simulation:** Select case → Start session

For detailed setup instructions, see [Quick Start](../getting-started/quickstart.md)

---

## System Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         ROHY SYSTEM                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Frontend   │  │   Backend    │  │   Database   │     │
│  │   (React)    │◄─┤  (Node.js)   │◄─┤   (SQLite)   │     │
│  │   Port 5173  │  │   Port 3000  │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│         │                  │                                │
│         │                  │                                │
│         ▼                  ▼                                │
│  ┌──────────────────────────────────┐                      │
│  │     External Services             │                      │
│  │  - OpenAI API                     │                      │
│  │  - LM Studio (Local)              │                      │
│  │  - Ollama (Local)                 │                      │
│  └──────────────────────────────────┘                      │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Action → Frontend Component → API Call → Backend Route → Database
                                                    ↓
                                            External Services
                                                    ↓
                                        Response ← Processing
```

For detailed architecture, see [Architecture Guide](architecture.md)

---

## Core Features

### 1. Authentication System

**Features:**
- User registration and login
- JWT-based authentication
- Role-based access control (Admin/User)
- Session management
- Login/logout logging

**Documentation:** [Authentication Guide](../getting-started/authentication.md)

### 2. Patient Monitor

**Features:**
- Real-time vital signs display
- Advanced ECG waveform generation
- Multiple rhythm patterns (NSR, VT, VF, Asystole, etc.)
- Alarm system with customizable thresholds
- Scenario progression with timeline
- Manual and automatic vital control

**Available Rhythms:**
- Normal Sinus Rhythm (NSR)
- Sinus Tachycardia
- Sinus Bradycardia
- Atrial Fibrillation (AFib)
- Ventricular Tachycardia (VT)
- Ventricular Fibrillation (VF)
- Asystole
- PVCs (Premature Ventricular Contractions)

**Documentation:** [Monitor Settings](../guides/monitor-settings.md), [ECG Patterns](../guides/ecg-patterns.md)

### 3. Laboratory Investigation System

**Features:**
- 77 lab tests from comprehensive database
- Gender-specific normal ranges
- Default labs mode (all tests available with normal values)
- Optional abnormal test configuration
- Add individual tests or entire groups
- Real-time instructor editing
- Turnaround time simulation
- Beautiful results display with flags

**Test Categories:**
- Endocrinology (Diabetes, Thyroid, Adrenal, Reproductive)
- Hematology (CBC, Coagulation)
- Chemistry (Electrolytes, Liver, Kidney)
- Cardiac Markers
- Lipid Panel
- Immunology
- Toxicology

**Documentation:** [Laboratory System](../guides/laboratory-system.md), [Laboratory System](../guides/laboratory-system.md)

### 4. Scenario System

**Features:**
- Reusable scenario templates
- Timeline-based progression
- Automatic vital signs changes
- Configurable duration (5 min - 2 hours)
- Manual or automatic triggering
- Built-in scenarios:
  - STEMI Progression
  - Septic Shock
  - Respiratory Failure
  - Hypertensive Crisis
  - Anaphylactic Shock
  - Post-Resuscitation Recovery

**Documentation:** [Scenario System](../guides/scenario-system.md)

### 5. Case Management

**Features:**
- Case wizard with 5 steps:
  1. Persona & Behavior
  2. Patient Details & Demographics
  3. Progression Scenario (Optional)
  4. Laboratory Investigations
  5. Clinical Records
- JSON import/export
- Image upload for patient avatar
- System prompt configuration
- LLM model selection per case

**Documentation:** [Import/Export Guide](../guides/import-export.md)

### 6. AI Chat Interface

**Features:**
- LLM-powered patient conversation
- Support for multiple providers:
  - OpenAI API
  - LM Studio (Local)
  - Ollama (Local)
- Context-aware responses
- System prompt injection
- Clinical records access
- Message history tracking

**Documentation:** [Clinical Features](../guides/clinical-features.md)

### 7. Alarm System

**Features:**
- Real-time threshold monitoring
- Audio alarms with different patterns
- Acknowledge and snooze functionality
- Configurable snooze duration (1-15 min)
- Per-vital-sign thresholds
- Alarm history logging
- Visual indicators

**Demo Case:** [Alarm Demo](../guides/alarm-demo.md)

### 8. Logging & Analytics

**Features:**
- Comprehensive event logging
- Session tracking
- Interaction history
- Settings change logs
- Login/logout tracking
- Export to CSV
- Real-time event display

**Documentation:** [Logging System](../guides/logging-system.md)

---

## User Roles

### Student (User Role)

**Permissions:**
- Start simulation sessions
- Interact with AI patient
- Order laboratory tests
- View results
- Monitor vital signs
- View own session history
- Export own data

**Restrictions:**
- Cannot create/edit cases
- Cannot edit scenarios
- Cannot view other users' data
- Cannot access admin functions

### Instructor (Admin Role)

**Permissions:**
- All student permissions
- Create/edit/delete cases
- Configure lab values
- Create/edit scenarios
- Real-time editing during simulation:
  - Modify vital signs
  - Edit lab values
  - Trigger scenario steps
- User management
- View all users' data
- Export all data
- System configuration

**Special Features:**
- Lab Value Editor (during simulation)
- Manual scenario control
- Full analytics access
- Batch user creation

---

## File Structure

```
VipSim/
├── server/                          # Backend
│   ├── server.js                    # Express server entry point
│   ├── db.js                        # Database schema & initialization
│   ├── routes.js                    # API endpoints
│   ├── database.sqlite              # SQLite database file
│   ├── .env                         # Environment variables
│   ├── middleware/
│   │   └── auth.js                  # Authentication middleware
│   └── services/
│       └── labDatabase.js           # Lab database service
│
├── src/                             # Frontend
│   ├── main.jsx                     # React entry point
│   ├── App.jsx                      # Main app component
│   ├── components/
│   │   ├── auth/
│   │   │   ├── LoginPage.jsx        # Login interface
│   │   │   └── RegisterPage.jsx    # Registration interface
│   │   ├── chat/
│   │   │   └── ChatInterface.jsx   # AI chat component
│   │   ├── investigations/
│   │   │   ├── InvestigationPanel.jsx      # Lab ordering panel
│   │   │   ├── LabResultsModal.jsx         # Results display
│   │   │   └── LabValueEditor.jsx          # Instructor editor
│   │   ├── monitor/
│   │   │   ├── PatientMonitor.jsx          # Vital signs monitor
│   │   │   └── EventLog.jsx                # Event log display
│   │   ├── patient/
│   │   │   └── PatientVisual.jsx           # Patient avatar
│   │   └── settings/
│   │       ├── ConfigPanel.jsx             # Case wizard
│   │       └── ScenarioRepository.jsx      # Scenario manager
│   ├── contexts/
│   │   └── AuthContext.jsx          # Authentication context
│   ├── services/
│   │   ├── authService.js           # Auth API calls
│   │   └── llmService.js            # LLM integration
│   ├── hooks/
│   │   ├── useAlarms.js             # Alarm system hook
│   │   └── useEventLog.js           # Event logging hook
│   ├── data/
│   │   ├── investigationTemplates.js   # Lab templates
│   │   └── scenarioTemplates.js        # Scenario templates
│   └── utils/
│       └── alarmAudio.js            # Audio alarm generation
│
├── public/                          # Static assets
│   ├── uploads/                     # User-uploaded images
│   └── patient_avatar.png           # Default avatar
│
├── Lab_database.txt                 # Lab tests database (77 tests)
├── DEMO_ALARM_CASE.json            # Demo case file
│
├── Documentation/                   # (This section)
│   ├── ROHY_SYSTEM_DOCUMENTATION.md # **THIS FILE - Central Hub**
│   ├── QUICKSTART.md                # Quick start guide
│   ├── ARCHITECTURAL_GUIDE.md       # System architecture
│   ├── AUTH_SETUP.md                # Authentication details
│   ├── LABORATORY_SYSTEM_GUIDE.md   # Lab system complete guide
│   ├── LAB_SYSTEM_UPDATE.md         # Recent lab updates
│   ├── SCENARIO_REPOSITORY_GUIDE.md # Scenario system guide
│   ├── MONITOR_SETTINGS_GUIDE.md    # Monitor configuration
│   ├── ECG_PATTERNS_GUIDE.md        # ECG generation details
│   ├── CLINICAL_FEATURES_GUIDE.md   # Clinical features
│   ├── LOGGING_SYSTEM.md            # Logging details
│   ├── JSON_IMPORT_EXPORT_GUIDE.md  # Import/export guide
│   └── DEMO_ALARM_README.md         # Alarm demo guide
│
├── package.json                     # Node dependencies
├── vite.config.js                   # Vite configuration
├── tailwind.config.js               # Tailwind CSS config
├── LICENSE                          # MIT License
└── README.md                        # Main README
```

---

## Database Schema

### Core Tables

#### 1. **users**
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    name TEXT,
    password_hash TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 2. **cases**
```sql
CREATE TABLE cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt TEXT,
    config JSON,                  -- Stores demographics, vitals, investigations, etc.
    image_url TEXT,
    scenario JSON,                -- Scenario timeline
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### 3. **sessions**
```sql
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER,
    user_id INTEGER,
    student_name TEXT,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_time DATETIME,
    duration INTEGER,             -- In seconds
    monitor_settings JSON,
    llm_settings JSON,
    FOREIGN KEY(case_id) REFERENCES cases(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

#### 4. **interactions** (Chat Log)
```sql
CREATE TABLE interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    role TEXT CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);
```

#### 5. **case_investigations** (Lab Configuration)
```sql
CREATE TABLE case_investigations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER,
    investigation_type TEXT,      -- 'lab' or 'radiology'
    test_name TEXT,
    result_data JSON,
    image_url TEXT,
    turnaround_minutes INTEGER DEFAULT 30,
    -- Lab-specific fields --
    test_group TEXT,
    gender_category TEXT,
    min_value REAL,
    max_value REAL,
    current_value REAL,
    unit TEXT,
    normal_samples JSON,
    is_abnormal BOOLEAN DEFAULT 0,
    FOREIGN KEY(case_id) REFERENCES cases(id)
);
```

#### 6. **investigation_orders** (Lab Orders)
```sql
CREATE TABLE investigation_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    investigation_id INTEGER,
    ordered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    available_at DATETIME,        -- ordered_at + turnaround_minutes
    viewed_at DATETIME,
    FOREIGN KEY(session_id) REFERENCES sessions(id),
    FOREIGN KEY(investigation_id) REFERENCES case_investigations(id)
);
```

#### 7. **event_log** (Comprehensive Event Tracking)
```sql
CREATE TABLE event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    event_type TEXT,              -- 'vital_change', 'lab_ordered', 'scenario_step', etc.
    description TEXT,
    vital_sign TEXT,
    old_value TEXT,
    new_value TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);
```

#### 8. **alarm_events** (Alarm Tracking)
```sql
CREATE TABLE alarm_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    vital_sign TEXT,
    threshold_type TEXT,          -- 'high' or 'low'
    threshold_value REAL,
    actual_value REAL,
    triggered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acknowledged_at DATETIME,
    FOREIGN KEY(session_id) REFERENCES sessions(id)
);
```

#### 9. **scenarios** (Scenario Repository)
```sql
CREATE TABLE scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL,
    category TEXT,
    timeline JSON NOT NULL,       -- Array of { time, label, params, conditions, rhythm }
    created_by INTEGER,
    is_public BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(created_by) REFERENCES users(id)
);
```

#### 10. **login_logs** (Authentication Tracking)
```sql
CREATE TABLE login_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT CHECK(action IN ('login', 'logout', 'failed_login')) NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

For complete schema details, see `server/db.js`

---

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/verify` - Verify JWT token
- `GET /api/auth/profile` - Get user profile
- `POST /api/auth/logout` - Log logout event

### User Management (Admin)
- `GET /api/users` - List all users
- `POST /api/users/create` - Create user (no auto-login)
- `POST /api/users/batch` - Batch create users from CSV
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Cases
- `GET /api/cases` - List all cases
- `POST /api/cases` - Create case (Admin)
- `PUT /api/cases/:id` - Update case (Admin)
- `DELETE /api/cases/:id` - Delete case (Admin)
- `GET /api/cases/:id/investigations` - Get case investigations

### Sessions
- `POST /api/sessions` - Start session
- `PUT /api/sessions/:id/end` - End session
- `GET /api/sessions/:id/events` - Get session events

### Interactions (Chat)
- `POST /api/interactions` - Log interaction
- `GET /api/interactions/:session_id` - Get chat history

### Laboratory System
- `GET /api/labs/search?q=query` - Search lab tests
- `GET /api/labs/groups` - Get test groups
- `GET /api/labs/group/:groupName` - Get tests by group
- `GET /api/labs/all` - Get all tests (paginated)
- `POST /api/cases/:caseId/labs` - Add lab to case
- `PUT /api/cases/:caseId/labs/:labId` - Update lab values
- `DELETE /api/cases/:caseId/labs/:labId` - Remove lab from case
- `GET /api/sessions/:sessionId/available-labs` - Get available labs for session
- `POST /api/sessions/:sessionId/order-labs` - Order lab tests
- `GET /api/sessions/:sessionId/lab-results` - Get completed results
- `PUT /api/sessions/:sessionId/labs/:labId` - Instructor edit lab value
- `PUT /api/orders/:orderId/view` - Mark result as viewed

### Scenarios
- `GET /api/scenarios` - List scenarios (public + user's)
- `GET /api/scenarios/:id` - Get scenario details
- `POST /api/scenarios` - Create scenario
- `PUT /api/scenarios/:id` - Update scenario
- `DELETE /api/scenarios/:id` - Delete scenario
- `POST /api/scenarios/seed` - Seed default scenarios (Admin)

### Alarms
- `POST /api/alarms/log` - Log alarm event
- `PUT /api/alarms/:id/acknowledge` - Acknowledge alarm
- `GET /api/alarms/config` - Get default alarm config
- `POST /api/alarms/config` - Save alarm config

### Analytics & Export
- `GET /api/analytics/sessions` - Get sessions (filtered by role)
- `GET /api/analytics/sessions/:id` - Get session details
- `GET /api/analytics/user-stats/:userId` - Get user statistics
- `GET /api/analytics/login-logs` - Get login logs (Admin)
- `GET /api/analytics/settings-logs` - Get settings logs (Admin)
- `GET /api/export/login-logs` - Export login logs as CSV
- `GET /api/export/chat-logs` - Export chat logs as CSV
- `GET /api/export/settings-logs` - Export settings logs as CSV
- `GET /api/export/complete-session/:sessionId` - Export complete session

### Utility
- `POST /api/upload` - Upload image
- `POST /api/proxy/llm` - LLM proxy (avoid CORS)
- `POST /api/events/batch` - Batch log events
- `POST /api/settings/log` - Log settings change

---

## Detailed Feature Guides

### By Topic

| Guide | Description | File |
|-------|-------------|------|
| **Quick Start** | Get started quickly | [Quick Start](../getting-started/quickstart.md) |
| **Architecture** | System design & structure | [Architecture Guide](architecture.md) |
| **Authentication** | User management & security | [Authentication Guide](../getting-started/authentication.md) |
| **Laboratory System** | Complete lab testing guide | [Laboratory System](../guides/laboratory-system.md) |
| **Lab Updates** | Recent lab system changes | [Laboratory System](../guides/laboratory-system.md) |
| **Scenarios** | Progressive scenarios guide | [Scenario System](../guides/scenario-system.md) |
| **Monitor Settings** | Vital signs configuration | [Monitor Settings](../guides/monitor-settings.md) |
| **ECG Patterns** | ECG generation details | [ECG Patterns](../guides/ecg-patterns.md) |
| **Clinical Features** | AI patient interaction | [Clinical Features](../guides/clinical-features.md) |
| **Logging System** | Event tracking & export | [Logging System](../guides/logging-system.md) |
| **Import/Export** | Case JSON management | [Import/Export Guide](../guides/import-export.md) |
| **Alarm Demo** | Example alarm case | [Alarm Demo](../guides/alarm-demo.md) |

---

## Development

### Local Development Setup

```bash
# Install dependencies
npm install

# Run development server (frontend + backend)
npm run dev

# Run only frontend
npm run client

# Run only backend
npm run server
```

### Environment Variables

Create `server/.env`:

```env
PORT=3000
JWT_SECRET=your-secret-key-here
NODE_ENV=development
```

### Code Style

- **Frontend:** React functional components with hooks
- **Backend:** Express with callback-style async
- **Styling:** TailwindCSS utility classes
- **Database:** SQLite with callback API

### Adding New Features

1. **Database:** Update schema in `server/db.js`
2. **Backend:** Add routes in `server/routes.js`
3. **Frontend:** Create components in `src/components/`
4. **Documentation:** Update relevant guides

### Testing Workflow

1. Create test case in UI
2. Start simulation session
3. Test all features (chat, labs, vitals, alarms)
4. Check logs in database
5. Export data for verification

---

## Deployment

### Production Build

```bash
# Build frontend
npm run build

# Start production server
NODE_ENV=production node server/server.js
```

### Server Requirements

- **CPU:** 2+ cores
- **RAM:** 2GB minimum, 4GB recommended
- **Storage:** 1GB for application + database growth
- **Node.js:** 14+
- **Port:** 3000 (backend), 5173 (dev frontend)

### Recommended Deployment

**Option 1: Single Server**
```
Nginx (Reverse Proxy)
  ↓
Node.js Backend (Port 3000)
  + Serve Static Frontend Build
```

**Option 2: Separate Servers**
```
Frontend Server (Nginx)
  → Serve React build files
  → Proxy API calls to backend

Backend Server (Node.js)
  → API endpoints
  → Database
```

### Environment Configuration

**Production `.env`:**
```env
PORT=3000
JWT_SECRET=<strong-random-secret>
NODE_ENV=production
DATABASE_PATH=./server/database.sqlite
```

### Security Considerations

1. **Change JWT_SECRET** in production
2. **Enable HTTPS** (Let's Encrypt)
3. **Set up CORS** properly for frontend domain
4. **Regular backups** of SQLite database
5. **Rate limiting** on login endpoints
6. **Input validation** on all endpoints
7. **SQL injection protection** (parameterized queries used)

---

## Troubleshooting

### Common Issues

#### Frontend Won't Start
```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run dev
```

#### Backend Connection Refused
```bash
# Check if port 3000 is available
lsof -i :3000

# Kill existing process
kill -9 <PID>

# Restart server
npm run server
```

#### Database Errors
```bash
# Check database file exists
ls -la server/database.sqlite

# If corrupted, backup and recreate
cp server/database.sqlite server/database.sqlite.bak
rm server/database.sqlite
# Restart server (will recreate)
npm run server
```

#### Lab Tests Not Loading
- Verify `Lab_database.txt` exists in root directory
- Check server logs for "Loaded X lab tests from database"
- Restart server if needed

#### LLM Not Responding
1. Check LLM settings (provider, model, API key)
2. Verify API endpoint is accessible
3. Check browser console for errors
4. For local LLMs: ensure LM Studio/Ollama is running

#### Authentication Failures
- Check JWT_SECRET is set in `.env`
- Clear browser local storage
- Check token expiration (default: 24h)
- Verify user exists in database

### Log Files

**Check Browser Console:**
- Chrome: F12 → Console
- Firefox: F12 → Console
- Safari: Develop → Show JavaScript Console

**Check Server Logs:**
```bash
# Server logs printed to terminal
npm run server

# Or run in background and redirect
npm run server > server.log 2>&1 &
```

**Check Database:**
```bash
# Open SQLite database
sqlite3 server/database.sqlite

# Check users
SELECT * FROM users;

# Check sessions
SELECT * FROM sessions ORDER BY start_time DESC LIMIT 10;

# Check logs
SELECT * FROM login_logs ORDER BY timestamp DESC LIMIT 10;
```

### Performance Issues

**Slow Response Times:**
- Check database size (large event_log table)
- Enable indexes on frequently queried columns
- Consider archiving old sessions

**High Memory Usage:**
- Lab database cached in memory (normal)
- Each session stores state (monitor, alarms)
- Consider session cleanup for inactive sessions

### Getting Help

1. **Check Documentation:** Review relevant guide files
2. **Search Issues:** Look through existing GitHub issues (if applicable)
3. **Check Logs:** Server console and browser console
4. **Contact:** Mohammed Saqr - [www.saqr.me](https://www.saqr.me)

---

## System Status

### Current Version: 2.0.0

**Status:** ✅ Production Ready

### Recent Updates (January 2026)

✅ **Laboratory System 2.0**
- Default labs toggle
- Add by group functionality
- Flexible value resolution
- 77 lab tests available

✅ **Scenario Repository**
- Database-backed scenarios
- Reusable templates
- Public/private scenarios
- 6 built-in scenarios

✅ **Alarm System**
- Real-time monitoring
- Audio alarms
- Acknowledge & snooze
- Configurable thresholds

✅ **Comprehensive Logging**
- Event tracking
- Session analytics
- CSV export
- Login/logout logs

✅ **Authentication System**
- JWT tokens
- Role-based access
- Batch user creation
- Profile management

### Known Limitations

- Single-threaded Node.js (one process)
- SQLite concurrent write limitations
- No real-time WebSocket updates (polling used)
- Audio alarms require user interaction (browser policy)
- Large sessions may impact performance

### Planned Enhancements

- WebSocket integration for real-time updates
- PostgreSQL/MySQL support for scaling
- Mobile responsive design improvements
- Advanced analytics dashboard
- Multi-language support
- Case sharing/marketplace

---

## Credits

**Created & Maintained by:**  
Mohammed Saqr  
Professor of Computer Science  
University of Eastern Finland  
[www.saqr.me](https://www.saqr.me)

**License:** MIT

**Contributors:**
- Mohammed Saqr - Lead Developer & Designer
- University of Eastern Finland - Institutional Support

**Third-Party Libraries:**
- React, Express, SQLite, Tailwind CSS
- Lucide Icons, bcrypt, jsonwebtoken
- And many others (see package.json)

---

## License

MIT License

Copyright (c) 2026 Mohammed Saqr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Quick Reference

### Essential Links

- **Main Documentation:** [System Documentation](system-documentation.md) (this file)
- **Quick Start:** [Quick Start](../getting-started/quickstart.md)
- **Lab System:** [Laboratory System](../guides/laboratory-system.md)
- **Scenarios:** [Scenario System](../guides/scenario-system.md)

### Ports

- Frontend (Dev): http://localhost:5173
- Backend: http://localhost:3000

### Default Credentials

- **First User:** Auto-becomes admin
- **Subsequent Users:** Register as standard users
- **Admin can:** Create more admins via user management

### Support

- **Website:** [www.saqr.me](https://www.saqr.me)
- **Documentation:** All guides in project root
- **Database:** `server/database.sqlite`
- **Logs:** Browser console + Terminal output

---

**End of Central Documentation**

*For specific features, consult the detailed guides linked throughout this document.*
