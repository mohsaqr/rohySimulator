// auth utils — shim for LAILA-v3 client/src/utils/auth.ts. LAILA stores a JWT
// in localStorage and sends it as a Bearer header; chatoyon authenticates with
// an httpOnly session cookie that the browser attaches automatically, so there
// is no token to read. Same exported surface so copied callers work unchanged.
export const getAuthToken = () => null;

export const isAuthenticated = () => true;

export const getAuthHeaders = () => ({});
