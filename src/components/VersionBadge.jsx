import pkg from '../../package.json';

// "Rohy <version>" wordmark. Bold teal with a soft drop-shadow — the
// embossed / 3D-printed look the project has used since launch. Mounted
// inline inside the PatientMonitor header next to the session timer
// (see monitor/PatientMonitor.jsx); positioning is the caller's job so the
// badge can be re-used elsewhere without inheriting hard-coded coordinates.
//
// Shows the FULL pkg.version (major.minor.patch). The previous truncation
// to major.minor meant patch bumps (2.1.0 → 2.1.1 → 2.1.2) silently failed
// to surface in the UI.

const LABEL = `Rohy ${pkg.version}`;

export default function VersionBadge() {
    return (
        <div
            aria-hidden="true"
            className="pointer-events-none select-none text-2xl font-bold tracking-tight text-teal-300"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.6)' }}
        >
            {LABEL}
        </div>
    );
}
