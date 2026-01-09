# Rohy - Virtual Patient Simulation Platform

A comprehensive medical simulation platform featuring realistic patient monitoring, ECG visualization, and AI-powered patient interactions.

---

**Created and Maintained by:**  
**Mohammed Saqr**  
Professor of Computer Science  
University of Eastern Finland  
🌐 [www.saqr.me](https://www.saqr.me)

---

## Features

- **Realistic Patient Monitor**: Full ICU monitor with ECG, SpO2, respiratory waveforms
- **ECG Pattern Library**: STEMI, NSTEMI, arrhythmias, electrolyte abnormalities
- **AI Patient Interaction**: LLM-powered patient responses
- **Case Management**: Create, import, export patient cases
- **User Management**: Role-based access (admin/user) with authentication
- **Comprehensive Logging**: Track all user activity, sessions, and interactions
- **Settings Persistence**: Save configurations as JSON or browser storage

## Quick Start

### Prerequisites
- Node.js (v18+)
- npm

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
./SETUP_ENV.sh  # Mac/Linux
# or
SETUP_ENV.bat   # Windows

# Start the application
npm run dev
```

### Access

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3000

### First Time Setup

1. Register first user (becomes admin automatically)
2. Configure LLM settings (LM Studio, Ollama, or OpenAI)
3. Create or import patient cases
4. Start simulating!

## Documentation

- `QUICKSTART.md` - Getting started guide
- `AUTH_SETUP.md` - Authentication system documentation
- `LOGGING_SYSTEM.md` - Logging and analytics guide
- `ECG_PATTERNS_GUIDE.md` - Clinical ECG patterns reference
- `MONITOR_SETTINGS_GUIDE.md` - Monitor configuration guide
- `JSON_IMPORT_EXPORT_GUIDE.md` - Data portability guide

## Technology Stack

- **Frontend**: React, Vite, TailwindCSS
- **Backend**: Node.js, Express
- **Database**: SQLite
- **Authentication**: JWT with bcrypt
- **UI Icons**: Lucide React

## Author & Maintainer

**Mohammed Saqr, PhD**  
Professor of Computer Science  
University of Eastern Finland  
🌐 Website: [www.saqr.me](https://www.saqr.me)  
📧 Contact: Available via website

## License

All rights reserved.

## Version

1.0.0 - January 2026
