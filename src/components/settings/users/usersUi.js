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
    const then = Date.parse(iso);
    if (Number.isNaN(then)) return '—';
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
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '—';
    return new Date(t).toLocaleDateString();
}
