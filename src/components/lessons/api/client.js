// apiClient — rohy seam adaptation. Delegates to rohy's shared apiFetch
// (Bearer token + CSRF + ApiError on non-2xx) while exposing the axios-like
// surface the vendored lesson callers use: `apiClient.get/post/put/delete`
// resolving to `{ data }`, and rejecting with an Error that carries
// `err.response.data` so callers reading `err.response.data.message` work.
import { apiFetch } from '../../../services/apiClient';

/**
 * Resolve a file URL. rohy serves /uploads/* and /api paths from the same
 * origin, so relative paths pass through unchanged (identity passthrough).
 */
export const resolveFileUrl = (fileUrl) => fileUrl || '';

function withErrorShape(promise) {
  return promise.catch((err) => {
    // Mirror axios's err.response.data shape so vendored callers reading
    // err.response.data.message still surface real server messages.
    err.response = { data: err.body };
    throw err;
  });
}

export const apiClient = {
  get: (url) => withErrorShape(apiFetch(url, { method: 'GET' }).then((data) => ({ data }))),
  post: (url, body) => withErrorShape(apiFetch(url, { method: 'POST', json: body }).then((data) => ({ data }))),
  put: (url, body) => withErrorShape(apiFetch(url, { method: 'PUT', json: body }).then((data) => ({ data }))),
  delete: (url) => withErrorShape(apiFetch(url, { method: 'DELETE' }).then((data) => ({ data }))),
};

export default apiClient;
