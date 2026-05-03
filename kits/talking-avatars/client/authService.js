// Minimal auth shim. The kit's voiceService passes the result of
// AuthService.getToken() as a Bearer token on every /api/tts call. If your
// app isn't auth-gated, just return null — the server-side route can then
// be configured without authenticateToken middleware.
//
// If you DO have auth, replace this file with a getter that returns your
// JWT (or whatever token shape your backend expects). Most apps end up
// with something like:
//
//   export const AuthService = {
//       getToken: () => localStorage.getItem('your_app_token'),
//   };

export const AuthService = {
    getToken() {
        // Default: try a few common token-storage conventions, then null.
        if (typeof localStorage === 'undefined') return null;
        return localStorage.getItem('token')
            || localStorage.getItem('auth_token')
            || localStorage.getItem('access_token')
            || null;
    },
};
