import pkg from '../../package.json';

// Centred "Rohy <major>.<minor>" badge that sits at the top of every
// screen. Mounted once at the entry point (src/main.jsx) so it covers
// every App render path — login, main chat, full-page settings, persona
// editor, exam / investigations / debrief surfaces, all of them.
//
// Version string is derived from package.json so a `npm version` bump is
// the only place a release number lives. The badge displays major.minor
// only (patch revs don't earn a UI mention).

const [major, minor] = pkg.version.split('.');
const LABEL = `Rohy ${major}.${minor}`;

export default function VersionBadge() {
    return (
        <div
            aria-hidden="true"
            className="fixed top-3 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none select-none px-5 py-2 rounded-full bg-neutral-900/80 backdrop-blur-md border border-neutral-700/60 text-neutral-100 text-base font-semibold uppercase tracking-[0.14em] shadow-lg"
        >
            {LABEL}
        </div>
    );
}
