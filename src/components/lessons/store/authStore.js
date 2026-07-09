// authStore — rohy seam shim. The vendored lesson components only need "is
// someone signed in", which is always true here. MUST return a stable
// reference: consumers put `user` in useEffect deps (SurveyEmbed); a fresh
// literal per call re-fires those effects every render (infinite loop).
const STATE = { user: { id: 'session' }, token: null };

export function useAuthStore(sel) {
  return sel ? sel(STATE) : STATE;
}
