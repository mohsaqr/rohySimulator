import { useSyncExternalStore } from 'react';

/*
 * useMediaQuery — subscribe to a CSS media query from React.
 *
 * Most of the app's responsiveness is, and should stay, pure CSS: a
 * `md:grid-cols-2` needs no JavaScript and cannot desynchronise from the
 * viewport. This hook exists for the cases CSS genuinely cannot express —
 * where the phone layout differs STRUCTURALLY rather than visually:
 *
 *   - the camera dock is an inline column on a laptop and an overlay sheet on
 *     a phone, so it must DEFAULT to closed on a phone (a closed overlay is
 *     invisible; a closed column merely reclaims space);
 *   - the phone tab bar renders a different, shorter set of destinations than
 *     the desktop bar, so the markup itself differs.
 *
 * `useSyncExternalStore` rather than useState+useEffect: matchMedia is an
 * external mutable source, and the effect version paints one frame with the
 * wrong answer before correcting itself — on this shell that frame is a
 * 288 px dock flashing across a phone screen on every load.
 */

/*
 * Tailwind's `md` floor (768 px). Below it the shell switches to the phone
 * layout. Kept as a constant because the JS and the `md:` utilities MUST
 * agree — if they drift, the dock can be an overlay while `md:` still styles
 * it as a column, and nothing about the resulting layout is recoverable.
 */
export const PHONE_QUERY = '(max-width: 767px)';

/*
 * One MediaQueryList per query string, cached, plus the subscribe closure
 * that goes with it. Two separate reasons, both real:
 *
 *   - `useSyncExternalStore` resubscribes whenever the subscribe function's
 *     identity changes, so building a new closure each render would tear down
 *     and re-add a listener on every single render.
 *   - getSnapshot is called on every render and must be CHEAP. Calling
 *     `window.matchMedia()` there allocates a fresh MediaQueryList object each
 *     time — garbage on a hot path, for an object whose only use is to read
 *     one boolean. Matching against a cached list is a plain property read.
 */
const lists = new Map<string, MediaQueryList>();
const subscribers = new Map<string, (onChange: () => void) => () => void>();

function listFor(query: string): MediaQueryList {
  let list = lists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }
  return list;
}

function subscriberFor(query: string) {
  const cached = subscribers.get(query);
  if (cached) return cached;
  const subscribe = (onChange: () => void) => {
    const list = listFor(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };
  subscribers.set(query, subscribe);
  return subscribe;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscriberFor(query),
    () => listFor(query).matches,
    // Server snapshot: assume desktop. This app only ever runs in a browser,
    // but the custom-element build can be constructed before layout, and
    // "desktop" is the safe guess — it degrades to a scrollable page rather
    // than to a sheet pinned over content.
    () => false,
  );
}

/** True on phone-width viewports, where the shell changes structure. */
export function useIsPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}
