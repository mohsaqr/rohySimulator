import type { Page } from '@playwright/test';

/*
 * Shared E2E helpers.
 *
 * SYNTHETIC CAMERA — overrides getUserMedia with a canvas-drawn face that
 * MediaPipe genuinely detects (verified: FaceLandmarker finds the blob face
 * and HSEmotion classifies it). Two hard-won rules encoded here:
 *   1. Mint a FRESH stream per getUserMedia call — CameraController.stop()
 *      ends the tracks, and handing back a dead stream makes every
 *      restart test fail with missing_face_ratio = 1.
 *   2. Track created streams on window.__oyonStreams so tests can assert
 *      teardown (all tracks ended) after stop()/element removal.
 */
const SYNTHETIC_CAMERA = `
  (() => {
    window.__oyonStreams = [];
    const mint = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d');
      setInterval(() => {
        ctx.fillStyle = '#8a7a6a'; ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = '#d9b99b';
        ctx.beginPath(); ctx.ellipse(320, 240, 110, 150, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3a2a1a';
        ctx.beginPath(); ctx.ellipse(280, 200, 14, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(360, 200, 14, 9, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9a6a5a';
        ctx.beginPath(); ctx.ellipse(320, 300, 35, 12, 0, 0, Math.PI * 2); ctx.fill();
      }, 100);
      const stream = canvas.captureStream(15);
      window.__oyonStreams.push(stream);
      return stream;
    };
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = async () => mint();
  })();
`;

export async function installSyntheticCamera(page: Page): Promise<void> {
  await page.addInitScript(SYNTHETIC_CAMERA);
}

/** All getUserMedia tracks handed out so far are ended (camera released). */
export async function allCameraTracksEnded(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const streams = (window as unknown as { __oyonStreams?: MediaStream[] }).__oyonStreams ?? [];
    if (streams.length === 0) return false;
    return streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'));
  });
}

export interface StoredWindowProbe {
  count: number;
  sessions: string[];
  users: string[];
  last: Record<string, unknown> | null;
}

/**
 * Read every persisted window the app's read path would see: the
 * `emotion_windows` IDB store merged with the localStorage fallback key.
 * Never CREATES the IDB database (a versionless open from a probe was the
 * cause of a false-negative during manual testing — the store list is
 * checked instead).
 */
export async function readStoredWindows(page: Page): Promise<StoredWindowProbe> {
  return page.evaluate(async () => {
    const rows: Record<string, unknown>[] = [];
    const dbs = await indexedDB.databases();
    if (dbs.some((d) => d.name === 'oyon-app')) {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('oyon-app');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      if ([...db.objectStoreNames].includes('emotion_windows')) {
        const all = await new Promise<Record<string, unknown>[]>((res, rej) => {
          const tx = db.transaction('emotion_windows', 'readonly')
            .objectStore('emotion_windows').getAll();
          tx.onsuccess = () => res(tx.result as Record<string, unknown>[]);
          tx.onerror = () => rej(tx.error);
        });
        rows.push(...all);
      }
      db.close();
    }
    const raw = localStorage.getItem('oyon-app-windows');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) rows.push(...parsed);
      } catch { /* ignore */ }
    }
    const sessions = [...new Set(rows.map((r) => String(r.session_id ?? '')))].filter(Boolean);
    const users = [...new Set(rows.map((r) => String(r.user_id ?? '')))].filter(Boolean);
    return {
      count: rows.length,
      sessions,
      users,
      last: rows[rows.length - 1] ?? null,
    };
  });
}

/**
 * Seed deterministic windows through the localStorage leg of the app's
 * read path (useStoredWindows merges it with IDB). Avoids racing the
 * IndexedDbOyonStore's own schema/versioning. Call BEFORE page load or
 * reload afterwards so react-query picks them up.
 */
export async function seedStoredWindows(
  page: Page,
  windows: Array<Record<string, unknown>>,
): Promise<void> {
  await page.evaluate((rows) => {
    localStorage.setItem('oyon-app-windows', JSON.stringify(rows));
  }, windows);
}

/** A minimal valid stored-window record for seeding. */
export function makeWindow(opts: {
  session: string;
  user: string;
  emotion: string;
  endMs: number;
}): Record<string, unknown> {
  return {
    window_id: `seed_${opts.session}_${opts.endMs}`,
    id: `seed_${opts.session}_${opts.endMs}`,
    session_id: opts.session,
    user_id: opts.user,
    window_start: new Date(opts.endMs - 10_000).toISOString(),
    window_end: new Date(opts.endMs).toISOString(),
    duration_ms: 10_000,
    dominant_emotion: opts.emotion,
    probabilities: { [opts.emotion]: 0.8, neutral: 0.2 },
    confidence: 0.8,
    valence: 0.1,
    arousal: 0.2,
    valid_frames: 8,
    missing_face_ratio: 0,
    model_name: 'e2e-seed',
    model_version: 'e2e',
  };
}
