// A reverse proxy that serves rohy under a base path, the way an install
// behind Caddy's `handle_path /rohy/*` does (vprohy.net/rohy): /rohy/… is
// forwarded to rohy with the prefix stripped, /rohy is redirected to /rohy/,
// and every other path is a 404 — so an address that forgot the base path
// fails here exactly as it fails on a real install.
import http from 'node:http';

const PORT = Number(process.env.PROXY_PORT || 4832);
const TARGET = Number(process.env.TARGET_PORT || 4831);
const BASE = (process.env.BASE_PATH || '/rohy').replace(/\/$/, '');

http.createServer((req, res) => {
    if (req.url === BASE) {
        res.writeHead(301, { location: `${BASE}/` });
        return res.end();
    }
    if (!req.url.startsWith(`${BASE}/`)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end(`outside ${BASE}/: ${req.url}`);
    }
    const upstream = http.request({
        host: '127.0.0.1', port: TARGET, method: req.method,
        path: req.url.slice(BASE.length), headers: { ...req.headers, host: `127.0.0.1:${TARGET}` },
    }, (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
    });
    upstream.on('error', (err) => { res.writeHead(502); res.end(String(err.message)); });
    req.pipe(upstream);
}).listen(PORT, '127.0.0.1', () => console.log(`[basepath-proxy] ${BASE}/ on :${PORT} → :${TARGET}`));
