import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/*
 * The embed spec drives the BUILT element bundle (dist-element is
 * gitignored — produced at publish time). Build it when absent so a fresh
 * clone can run `npm run test:e2e` directly. When present it is reused;
 * run `npm run app:build:element` yourself after element changes.
 */
export default function globalSetup(): void {
  const bundle = resolve(
    HERE,
    '../../standalone/app/dist-element/oyon-app.element.js',
  );
  if (existsSync(bundle)) return;
  // eslint-disable-next-line no-console
  console.log('[e2e] dist-element missing — building the <oyon-app> bundle…');
  execSync('npm run app:build:element', {
    cwd: resolve(HERE, '../..'),
    stdio: 'inherit',
  });
}
