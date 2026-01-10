# Rohy - Virtual Patient Simulation System

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-production-brightgreen)

A comprehensive medical simulation platform featuring realistic patient monitoring, ECG visualization, AI-powered patient interactions, laboratory investigation system, and progressive scenario-based learning.

---

## 🚀 Quick Start

### Installation

```bash
# Install dependencies
npm install

# Set up environment
cp server/.env.example server/.env
# Edit server/.env with your settings

# Start application (frontend + backend)
npm run dev
```

### Access

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000

### First Time Setup

1. **Register** first user (auto-becomes admin)
2. **Configure** LLM settings (OpenAI, LM Studio, or Ollama)
3. **Create** a patient case or import demo
4. **Start** simulating!

📖 **Detailed Setup:** See [QUICKSTART.md](QUICKSTART.md)

---

## ✨ Key Features

### 🤖 **AI-Powered Patient Interaction**
- LLM-driven realistic patient conversations
- Context-aware responses based on clinical scenario
- Support for OpenAI, LM Studio, Ollama

### 📊 **Advanced Patient Monitor**
- Real-time vital signs display
- ECG waveform generation with multiple rhythms
- Customizable alarm system with audio alerts
- Progressive deterioration scenarios

### 🔬 **Laboratory Investigation System**
- **77 lab tests** from comprehensive database
- Gender-specific normal ranges
- Configurable abnormal values for cases
- Add individual tests or entire groups
- Beautiful results display with flags (↑ HIGH, ↓ LOW)

### 📈 **Scenario-Based Learning**
- Timeline-based patient progression
- Built-in scenarios: STEMI, Sepsis, Respiratory Failure, etc.
- Reusable scenario repository
- Instructor control during simulation

### 🎛️ **Instructor Tools**
- Real-time editing of vitals and lab values
- Manual scenario triggering
- Comprehensive analytics and logging
- Session recording and export

### 👥 **Multi-User Support**
- Role-based access (Admin/User)
- JWT authentication
- Session management
- Batch user creation

### 📝 **Comprehensive Logging**
- All interactions tracked
- Event timeline
- Export to CSV
- Analytics dashboard

---

## 📚 Documentation

### **📘 Start Here**
👉 **[ROHY_SYSTEM_DOCUMENTATION.md](ROHY_SYSTEM_DOCUMENTATION.md)** - **Central Documentation Hub**

This is your main resource containing:
- Complete system overview
- Architecture details
- All features explained
- API reference
- Database schema
- Troubleshooting
- Deployment guide

### **📖 Detailed Guides**

| Guide | Description |
|-------|-------------|
| [QUICKSTART.md](QUICKSTART.md) | Get up and running quickly |
| [LABORATORY_SYSTEM_GUIDE.md](LABORATORY_SYSTEM_GUIDE.md) | Complete lab system documentation |
| [SCENARIO_REPOSITORY_GUIDE.md](SCENARIO_REPOSITORY_GUIDE.md) | Scenario management |
| [MONITOR_SETTINGS_GUIDE.md](MONITOR_SETTINGS_GUIDE.md) | Vital signs configuration |
| [ECG_PATTERNS_GUIDE.md](ECG_PATTERNS_GUIDE.md) | ECG generation details |
| [AUTH_SETUP.md](AUTH_SETUP.md) | Authentication system |
| [LOGGING_SYSTEM.md](LOGGING_SYSTEM.md) | Event tracking & export |

---

## 🏗️ Technology Stack

**Frontend:**
- React 18 + Vite
- TailwindCSS
- Lucide Icons

**Backend:**
- Node.js + Express
- SQLite3
- JWT Authentication

**Integrations:**
- OpenAI API
- LM Studio (Local)
- Ollama (Local)

---

## 📦 Project Structure

```
VipSim/
├── server/              # Backend (Node.js + Express)
│   ├── server.js       # Entry point
│   ├── db.js           # Database schema
│   ├── routes.js       # API endpoints
│   └── services/       # Lab database, etc.
├── src/                # Frontend (React)
│   ├── components/     # UI components
│   ├── services/       # API services
│   ├── hooks/          # Custom hooks
│   └── contexts/       # React contexts
├── Lab_database.txt    # 77 lab tests database
└── Documentation/      # All guides (*.md files)
```

---

## 👤 User Roles

### **Student (User)**
- Start simulation sessions
- Interact with AI patient
- Order laboratory tests
- Monitor vital signs
- View own session history

### **Instructor (Admin)**
- All student features +
- Create/edit cases
- Configure lab values
- Real-time editing during simulation
- User management
- Full analytics access

---

## 🎓 Use Cases

- **Medical Education:** Train students in patient assessment
- **Clinical Simulation:** Practice diagnostic reasoning
- **Scenario Training:** Progressive deterioration cases
- **Assessment:** Track student performance
- **Research:** Study clinical decision-making

---

## 🚀 Deployment

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
NODE_ENV=production node server/server.js
```

**Production Checklist:**
- [ ] Set strong `JWT_SECRET` in `.env`
- [ ] Enable HTTPS
- [ ] Configure CORS for frontend domain
- [ ] Set up database backups
- [ ] Enable rate limiting

📖 **Full Deployment Guide:** [ROHY_SYSTEM_DOCUMENTATION.md](ROHY_SYSTEM_DOCUMENTATION.md#deployment)

---

## 🐛 Troubleshooting

**Common Issues:**

```bash
# Frontend won't start
rm -rf node_modules package-lock.json
npm install

# Backend connection refused
lsof -i :3000  # Check port
kill -9 <PID>  # Kill process

# Database errors
cp server/database.sqlite server/database.sqlite.bak
rm server/database.sqlite
npm run server  # Will recreate
```

📖 **Complete Troubleshooting:** [ROHY_SYSTEM_DOCUMENTATION.md](ROHY_SYSTEM_DOCUMENTATION.md#troubleshooting)

---

## 📈 Version History

**2.0.0** (January 2026)
- ✅ Laboratory System 2.0 (flexible configuration)
- ✅ Scenario Repository with database
- ✅ Advanced alarm system
- ✅ Comprehensive logging

**1.0.0** (Initial Release)
- Core simulation features
- AI patient interaction
- Basic monitoring

---

## 👨‍💻 Author & Maintainer

**Mohammed Saqr**  
Professor of Computer Science  
University of Eastern Finland

🌐 **Website:** [www.saqr.me](https://www.saqr.me)  
📧 **Contact:** Available via website

---

## 📄 License

**MIT License** - Copyright (c) 2026 Mohammed Saqr

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so.

See [LICENSE](LICENSE) file for full details.

---

## 🙏 Acknowledgments

- University of Eastern Finland for institutional support
- Open-source community for excellent libraries
- Medical educators for feedback and testing

---

## 📞 Support

- **Documentation:** [ROHY_SYSTEM_DOCUMENTATION.md](ROHY_SYSTEM_DOCUMENTATION.md)
- **Issues:** Check troubleshooting guide
- **Contact:** Mohammed Saqr via [www.saqr.me](https://www.saqr.me)

---

**⭐ If you find Rohy useful, please consider giving it a star!**

**📚 For complete documentation, start with [ROHY_SYSTEM_DOCUMENTATION.md](ROHY_SYSTEM_DOCUMENTATION.md)**
