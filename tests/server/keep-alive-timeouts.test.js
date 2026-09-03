// Regression lock: idle keep-alive sockets survive longer than a proxy pool.
//
// 2026-09-03: rohy.lacarm.com served Cloudflare 502 pages while the process
// was healthy. cloudflared reused pooled origin sockets that node had closed
// after its default 5 s keep-alive idle, so the request hit a TCP RST before
// Express saw it. server/config/keepAlive.js raises the idle window above
// cloudflared's 90 s pool. The spawned-server test below fails against the
// un-fixed listener: the second request on a socket left idle for 6 s gets
// ECONNRESET / an early close instead of a response.

import net from 'node:net';
import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer } from '../utils/startTestServer.js';
import {
    applyKeepAliveTimeouts,
    KEEP_ALIVE_TIMEOUT_MS,
    HEADERS_TIMEOUT_MS,
    PROXY_IDLE_TIMEOUT_MS,
} from '../../server/config/keepAlive.js';

// Node's http.Server default keep-alive idle window; the un-fixed listener
// closed sockets after this long.
const NODE_DEFAULT_KEEP_ALIVE_MS = 5_000;
const IDLE_GAP_MS = NODE_DEFAULT_KEEP_ALIVE_MS + 1_500;

describe('keep-alive timeouts (unit)', () => {
    it('orders the timeouts so the upstream outlives the proxy pool', () => {
        expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(PROXY_IDLE_TIMEOUT_MS);
        expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_TIMEOUT_MS);
    });

    it('applies both values to an http.Server and returns it', () => {
        const server = http.createServer();
        expect(server.keepAliveTimeout).toBe(NODE_DEFAULT_KEEP_ALIVE_MS);
        const returned = applyKeepAliveTimeouts(server);
        expect(returned).toBe(server);
        expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
        expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
        server.close();
    });

    it('rejects a non-server argument', () => {
        expect(() => applyKeepAliveTimeouts(null)).toThrow(TypeError);
        expect(() => applyKeepAliveTimeouts({})).toThrow(TypeError);
    });
});

/**
 * Send one HTTP/1.1 keep-alive GET on an open socket and resolve with the
 * status line once the full response (Content-Length honoured) has arrived.
 */
function requestOnSocket(socket, port) {
    return new Promise((resolve, reject) => {
        let buffer = '';
        const onData = (chunk) => {
            buffer += chunk.toString('latin1');
            const headerEnd = buffer.indexOf('\r\n\r\n');
            if (headerEnd === -1) return;
            const head = buffer.slice(0, headerEnd);
            const match = /content-length:\s*(\d+)/i.exec(head);
            const bodyLength = match ? Number(match[1]) : 0;
            if (buffer.length - (headerEnd + 4) < bodyLength) return;
            cleanup();
            resolve(head.split('\r\n')[0]);
        };
        const onError = (err) => { cleanup(); reject(err); };
        const onClose = () => { cleanup(); reject(new Error('socket closed before a response arrived')); };
        const cleanup = () => {
            socket.off('data', onData);
            socket.off('error', onError);
            socket.off('close', onClose);
        };
        socket.on('data', onData);
        socket.on('error', onError);
        socket.on('close', onClose);
        socket.write(
            `GET /api/health HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: keep-alive\r\n\r\n`,
        );
    });
}

describe('keep-alive timeouts (spawned server)', () => {
    let server;

    beforeAll(async () => {
        server = await startTestServer();
    }, 90_000);

    afterAll(async () => {
        if (server) await server.close();
    });

    it(
        `serves a second request on a socket left idle for ${IDLE_GAP_MS} ms`,
        async () => {
            const socket = net.createConnection({ host: '127.0.0.1', port: server.port });
            await new Promise((resolve, reject) => {
                socket.once('connect', resolve);
                socket.once('error', reject);
            });

            const first = await requestOnSocket(socket, server.port);
            expect(first).toMatch(/^HTTP\/1\.1 200/);

            await new Promise((resolve) => setTimeout(resolve, IDLE_GAP_MS));
            expect(socket.destroyed).toBe(false);

            const second = await requestOnSocket(socket, server.port);
            expect(second).toMatch(/^HTTP\/1\.1 200/);

            socket.destroy();
        },
        20_000,
    );
});
