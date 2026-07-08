import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// i18next must initialize before any component calls useTranslation —
// English is bundled eagerly, other locales lazy-load on switch.
import './i18n/index.js'
import App from './App.jsx'

// VersionBadge moved out of the global mount — the centred stamp was
// overlapping the patient-monitor header (Oyon widget + name). It now
// renders inline inside PatientMonitor next to the session timer where the
// user expects it. See components/VersionBadge.jsx + components/monitor/PatientMonitor.jsx.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
