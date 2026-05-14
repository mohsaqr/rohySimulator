import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VersionBadge from './components/VersionBadge.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <VersionBadge />
  </StrictMode>,
)
