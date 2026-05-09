import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRohyFerAttachment } from '../adapters/rohyAttach.js';

export function useRohyFer(options) {
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [lastWindow, setLastWindow] = useState(null);
  const attachmentRef = useRef(null);
  const enabled = options?.enabled ?? true;

  const attachment = useMemo(() => {
    if (!enabled) return null;
    return createRohyFerAttachment({
      ...options,
      mount: runtime => {
        runtime.on('status', payload => setStatus(payload?.state || 'unknown'));
        runtime.on('error', err => {
          setError(err);
          setStatus('error');
        });
        runtime.on('window', events => setLastWindow(events?.[events.length - 1] || null));
        options?.mount?.(runtime);
      },
    });
  }, [
    enabled,
    options?.apiBaseUrl,
    options?.getSession,
    options?.getToken,
    options?.consentProvider,
    options?.runtimeOptions,
    options?.mount,
  ]);

  useEffect(() => {
    attachmentRef.current = attachment;
    return () => {
      attachment?.detach?.().catch(err => {
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

