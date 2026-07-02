import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import {
  useStandaloneRuntime,
  GAZE_VIDEO_ELEMENT_ID,
  type UseStandaloneRuntimeResult,
} from './runtime';
import { useSessionContext } from './sessionContext';
import { useSettings } from './settingsStore';

/*
 * RuntimeProvider sits at AppShell level so the EmotionRuntime survives
 * route changes. Without this, navigating from /capture to /live would
 * reconstruct the runtime and re-prompt for camera permission.
 *
 * The provider also owns the *visible* <video> ref. CameraPreview imperatively
 * mounts the same DOM video into wherever it renders, but only one ref is
 * created per app lifetime — the React tree is allowed to move it around.
 */

interface RuntimeContextValue extends UseStandaloneRuntimeResult {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
}

const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function RuntimeProvider({ children }: { children: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const runtime = useStandaloneRuntime({ videoRef });
  const setContext = useSessionContext((s) => s.setContext);
  // Read the editable settings hash so the TopBar pill reflects user
  // edits live (rather than the frozen hash of the running runtime).
  const editedHash = useSettings((s) => s.settings_hash);

  // Bridge runtime → session context strip. The TopBar reads from
  // useSessionContext, so all of its pills update transparently when the
  // runtime starts, the model changes, or the user dials a slider.
  useEffect(() => {
    setContext({
      modelName: 'oyon',
      modelVersion: runtime.modelLabel,
      // Consent in standalone is implicit: the user must grant camera
      // permission to reach 'running'. Mirror that here.
      consent:
        runtime.status === 'running' ||
        runtime.status === 'paused' ||
        runtime.status === 'starting-camera' ||
        Boolean(runtime.cameraStream) ||
        runtime.windowCount > 0
          ? 'granted'
          : runtime.status === 'error'
            ? 'denied'
            : 'unset',
      sessionId:
        runtime.status === 'running' || runtime.status === 'paused'
          ? runtime.sessionId
          : null,
      settingsHash: editedHash,
    });
  }, [
    runtime.status,
    runtime.modelLabel,
    runtime.windowCount,
    runtime.sessionId,
    editedHash,
    setContext,
  ]);

  return (
    <RuntimeContext.Provider value={{ ...runtime, videoRef }}>
      {/*
        Dedicated, always-mounted, off-screen <video> for engines that need
        a DOM-owned video target (WebEyeTrack). WebGazer uses the runtime's
        camera stream directly, but keeping this element mounted makes engine
        switching deterministic across routes. Not display:none — some
        browsers pause/teardown a display:none video; off-screen + 1px keeps
        it live without being visible.
      */}
      <video
        id={GAZE_VIDEO_ELEMENT_ID}
        muted
        playsInline
        autoPlay
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      {children}
    </RuntimeContext.Provider>
  );
}

export function useRuntime(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext);
  if (!ctx) {
    throw new Error('useRuntime must be called inside <RuntimeProvider>.');
  }
  return ctx;
}
