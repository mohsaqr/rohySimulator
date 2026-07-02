import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createOyonAttachment } from '../adapters/oyonAttach.js';

/**
 * useOyon — host-neutral React hook for attaching Oyon to any app.
 *
 * Drop-in capture controls + live status for React hosts (Next.js, Vite, CRA).
 * Provide `getContext` (or `getSession`) returning your identity/context —
 * `session_id` is required, every other key rides along on each window.
 *
 *   const fer = useOyon({
 *     enabled: featureFlag,
 *     apiBaseUrl: '/api',
 *     getToken: () => auth.token,
 *     getContext: () => ({ session_id: lesson.id, user_id: user.id, course_id: course.id }),
 *     onWindow: (windows) => analytics.track(windows),
 *   });
 *
 * Next.js: import this only in a client component (`'use client'`) or behind a
 * `dynamic(..., { ssr: false })` boundary — the runtime touches `window` /
 * `navigator.mediaDevices` and must not run during server render.
 *
 * @param {object} [options] — createOyonAttachment options plus:
 * @param {boolean} [options.enabled=true] — when false, the hook is inert (no runtime)
 * @param {(windows: object[]) => void} [options.onWindow] — per-batch callback
 * @param {Function} [options.attachmentFactory] — internal: override the factory (Rohy wrapper uses this)
 */
export function useOyon(options) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [lastWindow, setLastWindow] = useState(null);
  const attachmentRef = useRef(null);
  const enabled = options?.enabled ?? true;
  const factory = options?.attachmentFactory || createOyonAttachment;

  const attachment = useMemo(() => {
    if (!enabled) return null;
    return factory({
      ...options,
      mount: (runtime) => {
        runtime.on('status', (payload) => setStatus(payload?.state || 'unknown'));
        runtime.on('error', (err) => {
          setError(err);
          setStatus('error');
        });
        runtime.on('window', (events) => {
          const latest = events?.[events.length - 1] || null;
          setLastWindow(latest);
          options?.onWindow?.(events);
        });
        options?.mount?.(runtime);
      },
    });
  }, [
    enabled,
    factory,
    options?.apiBaseUrl,
    options?.getContext,
    options?.getSession,
    options?.getToken,
    options?.consentProvider,
    options?.runtimeOptions,
    options?.onWindow,
    options?.mount,
  ]);

  useEffect(() => {
    attachmentRef.current = attachment;
    return () => {
      attachment?.detach?.().catch((err) => {
        setError(err);
      });
    };
  }, [attachment]);

  const start = useCallback(async () => {
    if (!attachmentRef.current) return;
    setError(null);
    setStatus('starting');
    try {
      await attachmentRef.current.attach();
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await attachmentRef.current?.detach();
      setStatus('stopped');
    } catch (err) {
      setError(err);
      setStatus('error');
    }
  }, []);

  const pause = useCallback(() => {
    attachmentRef.current?.runtime?.pause();
    setStatus('paused');
  }, []);

  const resume = useCallback(() => {
    attachmentRef.current?.runtime?.resume();
    setStatus('running');
  }, []);

  return {
    status,
    error,
    lastWindow,
    start,
    stop,
    pause,
    resume,
    runtime: attachmentRef.current?.runtime || null,
  };
}
