// Endpoint helpers. Swap the implementations to match your project's API
// host. The kit only assumes:
//   - apiUrl(path)  → returns the URL for an API call.   e.g. fetch(apiUrl('/tts'))
//   - baseUrl(path) → returns the URL for a static asset. e.g. <img src={baseUrl('/avatars/heads/x.glb')}>
//
// Defaults assume same-origin: the API is mounted under /api/ and static
// assets are served from / on the same host. That covers Vite + Express on
// the same port, or a reverse-proxied production setup. Override either via
// import.meta.env.VITE_API_BASE / VITE_PUBLIC_BASE if your hosts differ.

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE)
    || ''; // empty = same origin
const PUBLIC_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_BASE)
    || ''; // empty = same origin

export function apiUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE}/api${p}`;
}

export function baseUrl(path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${PUBLIC_BASE}${p}`;
}
