import { mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const keyPath = resolve('.cert/localhost-key.pem');
const certPath = resolve('.cert/localhost-cert.pem');

if (existsSync(keyPath) && existsSync(certPath)) {
  process.exit(0);
}

mkdirSync(dirname(keyPath), { recursive: true });

const result = spawnSync('openssl', [
  'req',
  '-x509',
  '-newkey',
  'rsa:2048',
  '-nodes',
  '-sha256',
  '-days',
  '365',
  '-subj',
  '/CN=localhost',
  '-addext',
  'subjectAltName=DNS:localhost,IP:127.0.0.1',
  '-keyout',
  keyPath,
  '-out',
  certPath,
], { stdio: 'inherit' });

if (result.status !== 0) {
  console.error('Failed to generate localhost HTTPS certificate. Install openssl or provide .cert/localhost-key.pem and .cert/localhost-cert.pem.');
  process.exit(result.status || 1);
}
