// apiClient — rohy seam adaptation. Delegates to rohy's shared apiFetch
// (Bearer token + CSRF + ApiError on non-2xx) while exposing the axios-like
// surface the vendored lesson callers use: `apiClient.get/post/put/delete`
// resolving to `{ data }`, and rejecting with an Error that carries
// `err.response.data` so callers reading `err.response.data.message` work.
import { apiFetch } from '../../../services/apiClient';
import { baseUrl } from '../../../config/api';

/**
 * Resolve a file URL. rohy serves /uploads/* and /api paths from the same
 * origin, but under the install's base path: a stored `/uploads/x.pdf` is
 * `/rohy/uploads/x.pdf` on an install served at '/rohy/'. Other addresses
 * (relative, or on another host) pass through unchanged.
 */
export const resolveFileUrl = (fileUrl) => {
  if (!fileUrl) return '';
  return /^\/(uploads|api)\//.test(fileUrl) ? baseUrl(fileUrl) : fileUrl;
};

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
