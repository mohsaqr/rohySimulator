import { timeMs } from '../../../../server/shared/time.js';

// Small presentational helpers shared across the Users workspace.

export function initials(name, username) {
    const src = (name || username || '?').trim();
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
}

const AVATAR_CLASSES = [
    'bg-teal-100 text-teal-800',
    'bg-blue-100 text-blue-800',
    'bg-violet-100 text-violet-800',
    'bg-amber-100 text-amber-800',
    'bg-rose-100 text-rose-800',
    'bg-cyan-100 text-cyan-800',
];

export function avatarClass(seed) {
    const s = String(seed || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_CLASSES[h % AVATAR_CLASSES.length];
}

export function roleBadgeClass(role) {
    switch (role) {
        case 'admin': return 'rohy-badge-violet';
        case 'educator': return 'rohy-badge-blue';
        case 'reviewer': return 'rohy-badge-cyan';
        default: return 'rohy-badge-neutral';
    }
}

export function statusBadgeClass(status) {
    switch (status) {
        case 'active': return 'rohy-badge-green';
        case 'suspended': return 'rohy-badge-red';
        default: return 'rohy-badge-amber';
    }
}

export function relativeTime(iso) {
    if (!iso) return '—';
    // timeMs, not Date.parse: `users.last_login` was written with
    // CURRENT_TIMESTAMP, and V8 reads that space-separated shape as LOCAL time
    // although sqlite stores it as UTC. Last Active was therefore stale by
    // exactly the viewer's UTC offset — the "3 hours behind" in the v2.9.82
    // report. The writer is fixed and the rows migrated, but this must still
    // read both shapes: a row can arrive from any deployment that has not yet
    // run 0051.
    const then = timeMs(iso);
    if (then == null) return '—';
    const secs = Math.max(0, (Date.now() - then) / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
}

export function formatDate(iso) {
    if (!iso) return '—';
    const t = timeMs(iso);
    if (t == null) return '—';
    return new Date(t).toLocaleDateString();
}
