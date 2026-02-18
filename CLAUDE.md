# Rohy — Virtual Patient Simulation Platform

## Overview
Medical education simulation platform where students interact with virtual clinical cases. Built with React 19 + Vite frontend and Express 5 + SQLite3 backend. ES modules throughout (`"type": "module"`).

## Project Structure

```
server/
  server.js          -- Express entry point
  routes.js          -- All API routes (~7600 lines, single file)
  db.js              -- SQLite schema, initialization, seeder
  middleware/auth.js  -- JWT auth (authenticateToken, requireAdmin, requireAuth)
  services/          -- labDatabase.js, etc.
  data/              -- JSON seed data (radiology, labs)
  .env               -- JWT_SECRET, PORT (not committed)

src/
  main.jsx           -- App entry
  config/api.js      -- apiUrl() helper, prepends BASE_URL + /api
  contexts/          -- AuthContext, ToastContext
  services/
    authService.js   -- Token storage, login/logout
    eventLogger.js   -- xAPI learning event logger (50+ verb types)
    llmService.js    -- LLM integration
    AgentService.js  -- Agent API client
  components/
    settings/        -- ConfigPanel (admin settings hub), editors
    analytics/       -- SessionLogViewer, tna/ (TNA dashboard)
    auth/            -- Login components
    chat/            -- Chat interface
    monitor/         -- Vital signs, alarms, EventLog
    orders/          -- Medication, lab, treatment orders
    examination/     -- Physical exam interface
    investigations/  -- Lab investigation panels
    patient/         -- Patient info views
    treatments/      -- Treatment management
    common/          -- Shared UI components
```

## Key Patterns

### API Calls
```jsx
import { apiUrl } from '../../config/api';
import { AuthService } from '../../services/authService';

const token = AuthService.getToken();
fetch(apiUrl('/endpoint'), {
  headers: { 'Authorization': `Bearer ${token}` }
})
```

### Route Authentication
Routes use middleware from `server/middleware/auth.js`:
- `authenticateToken` — verifies JWT
- `requireAdmin` — admin role check
- `requireAuth` — any authenticated user

### ConfigPanel Tabs
Admin settings panel at `src/components/settings/ConfigPanel.jsx` (~4860 lines). To add a new tab:
1. Import the component (line ~19)
2. Add sidebar button inside the `isAdmin()` block (after line ~311)
3. Add tab content before `</div>` closing the content area (around line ~855)

The `activeTab` state controls which tab renders. `Activity` icon is already imported from lucide-react.

### Learning Events
- Table: `learning_events` (session_id, user_id, case_id, verb, object_type, timestamp, etc.)
- Verbs defined in `src/services/eventLogger.js` (50+ xAPI-style verbs)
- POST endpoint: `/api/learning-events`
- TNA endpoint: `/api/analytics/tna-sequences` (merges verbs into 10 clinical labels)

### Database
- SQLite3 (async callback API, not better-sqlite3)
- Schema in `server/db.js` — tables auto-created on startup
- Seeder creates default admin/student users and sample cases

## Dev Commands
```bash
npm run dev          # Runs both server (port 3000) and Vite client (port 5173)
npm run build        # Production build to dist/, copies to frontend/
npm run server       # Server only
npm run client       # Vite dev server only
```

## Default Credentials (dev only)
- admin: `admin / admin123`
- student: `student / student123`

## Style
- Tailwind CSS v4 (via @tailwindcss/postcss)
- Dark theme: `bg-neutral-900` cards, `border-neutral-700`, white/neutral-300 text
- Icons: lucide-react
- No state management library — React useState/useEffect/useContext only
- No data fetching library — plain fetch with AuthService token

## TNA Analytics Dashboard
Located in `src/components/analytics/tna/`:
- `tnaUtils.js` — `tna()`, `prune()`, `maxWeight()` pure computation functions
- `tnaColors.js` — 9-color palette, `getNodeColor()`, edge/arrow color constants
- `NetworkGraph.jsx` — Circular SVG network graph with donut nodes, Bezier edges, self-loops, polygon arrows, collapsible settings
- `DistributionPlot.jsx` — SVG stacked bar chart (action proportions per timestep)
- `FrequencyChart.jsx` — SVG horizontal bar chart (action frequency counts)
- `TnaDashboard.jsx` — Container with filters, stats, data fetching, memoized TNA computation

Backend: `GET /api/analytics/tna-sequences` in `server/routes.js` (admin-only). Merges 50+ raw verbs into 10 clinical labels via `TNA_VERB_MERGE_MAP`, filters rare verbs, collapses consecutive duplicates. Guide spec: `tnadepguide.md`.

## Important Notes
- `server/routes.js` is very large (~7700 lines). Use grep/search to find sections, don't try to read it all.
- Vite proxies `/api` requests to `http://localhost:3000` in dev mode.
- Production build uses `--base=/rohy/` for deployment under a subpath.
- The `.env` file (`server/.env`) is required for JWT_SECRET. Copy from `.env.example`.
- When adding new analytics visualizations, follow the TNA pattern: backend endpoint extracts/transforms data, frontend computes model in `useMemo`, SVG components render with `viewBox` + `width="100%"` for responsiveness.
