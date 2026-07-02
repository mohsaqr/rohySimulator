import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const useHttps = process.env.OYON_HTTPS === '1';
const key = resolve('.cert/localhost-key.pem');
const cert = resolve('.cert/localhost-cert.pem');

export default defineConfig({
  server: {
    https: useHttps && existsSync(key) && existsSync(cert)
      ? { key, cert }
      : undefined,
  },
});
