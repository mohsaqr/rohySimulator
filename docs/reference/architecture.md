# Virtual Patient Platform (VipSim) - Architectural Guide

This document provides a comprehensive overview of the Virtual Patient Platform's architecture, design decisions, and data flow. It is intended for developers who wish to extend this codebase or rebuild it from scratch.

---

## 1. Overview
VipSim is a high-fidelity medical simulation platform designed for clinical training. It combines real-time vital sign monitoring with an AI-driven "Simulated Patient" (LLM) that maintains a consistent persona and hidden medical history.

---

## 2. Technical Stack
*   **Frontend**: React (Vite), Tailwind CSS, Lucide Icons.
*   **Backend**: Node.js, Express.
*   **Database**: SQLite (for cases, sessions, and chat logs).
*   **LLM Connectivity**: Open-AI compatible API format (Ollama, LM Studio, OpenAI).
*   **Real-time Logic**: High-frequency interval-based Vital Sign generator (ECG, Pulse, Resp).

---

## 3. Core Architecture & Data Flow

### A. The "Source of Truth"
The application state is anchored in `App.jsx`.
*   **`activeCase`**: The single most important piece of state. It contains the current case's name, description, system prompt, and a `config` object (demographics, vitals, clinical pages).
*   When a user loads a case, it propagates down to `PatientMonitor` (vitals), `PatientVisual` (UI Context), and `ChatInterface` (AI Prompt).

### B. LLM Connectivity & The Proxy Solution
To bypass browser **CORS restrictions** when connecting to local LLMs (LM Studio/Ollama), the platform uses a **Backend Proxy**:
1.  **Frontend**: Calls `LLMService.sendMessage()`.
2.  **LLMService**: Sends a POST request to `localhost:3000/api/proxy/llm`.
3.  **Backend (Node.js)**: Receives the request and performs a server-side `fetch` to the actual LLM (e.g., `localhost:1234`).
4.  **Result**: Eliminates "Connection Refused" and "CORS Policy" errors from the browser.

---

## 4. Case Management (The Wizard)
Cases are built using a 3-step Wizard in `ConfigPanel.jsx`:

1.  **Persona & Behavior**: Sets the AI's "vibe," constraints, and initial greeting.
2.  **Case Details**: Sets patient demographics (Age, Gender) and display name.
3.  **Clinical Records**: Allows adding "Hidden Context" pages (History, Medications, Results).

### How the AI "Knows" the Case:
In `ChatInterface.jsx`, every message sent to the AI is preceded by a **Rich System Prompt** constructed on the fly:
```markdown
## PERSONA
Role: {persona_type}
Name: {patient_name}
Demographics: {age} year old {gender}

## INSTRUCTIONS
{system_prompt}

## CONSTRAINTS
{constraints}

---
## PATIENT MEDICAL RECORD (Hidden Context)
### History
...
### Meds
...
```

---

## 5. Component Breakdown

### `PatientMonitor.jsx`
*   **Simulation Engine**: Uses a `requestAnimationFrame` loop or `setInterval` to generate waves.
*   **SVG Rendering**: Renders real-time ECG ( Sinus, AFib, VTach, etc. ), Plethysmography, and Respiratory waves.
*   **Prop-driven**: Accepts `caseParams` to set initial HR and Rhythm.

### `PatientVisual.jsx`
*   **Aesthetics**: Displays the patient avatar.
*   **Overlay**: Uses a backdrop-blur floating bubble to show patient demographics and a brief case summary.

### `ChatInterface.jsx`
*   **Persistence**: Automatically calls the backend to start a session and logs every interaction (user and assistant) to the SQLite database.
*   **Session-based**: Resets when `activeCase` changes.

### `ConfigPanel.jsx`
*   **LLM Settings**: Global configuration for Provider, Base URL, and Model.
*   **Case Wizard**: The CRUD interface for medical scenarios.

---

## 6. Backend API Reference (`server/routes.js`)
*   `GET /api/cases`: Fetch all available scenarios.
*   `POST /api/cases`: Create/Update a scenario.
*   `POST /api/sessions`: Start a student session.
*   `POST /api/interactions`: Log a chat message.
*   `POST /api/proxy/llm`: The proxy endpoint for LLM communication.

---

## 7. Rebuilding from Scratch - Steps
1.  **Setup Node/Express**: Initialize `sqlite3` and create the `cases`, `sessions`, and `interactions` tables.
2.  **LLM Service**: Implement the proxy route in Express and the `fetch` logic in the frontend.
3.  **Signal Generator**: Create a function that produces Sinus and Arrhythmia waves using mathematical functions (Gaussian for QRS).
4.  **Context Injection**: Implement the logic in the Chat component that strings together the case data into a single System Prompt.
5.  **Persistence**: Ensure every chat message is saved so it can be reviewed later (Analytics).

---

## 8. Directory Structure
```text
/server
  /db.js          - SQLite initialization
  /routes.js      - API and LLM Proxy
  /server.js      - Express entry point
/src
  /components
    /monitor      - Pulse/ECG logic
    /patient      - Visuals/Overlays
    /chat         - Chat UI and Persistence
    /settings     - ConfigPanel & Case Wizard
  /services
    /llmService.js- LLM API Abstraction
  App.jsx         - Layout and Global State
```
