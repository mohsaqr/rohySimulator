import { getAuthToken } from './auth';

/**
 * Upload a single file via XHR to `endpoint`, reporting 0–100 progress through
 * `onProgress`, and resolve to the stored file's URL. Shared by the lesson and
 * course editors so upload/auth/response handling lives in one place.
 * Rejects on non-2xx, network error, or a 2xx response with no url/path.
 */
export const uploadWithProgress = (
  endpoint,
  file,
  onProgress,
) =>
  new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    const token = getAuthToken();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = ev => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const j = JSON.parse(xhr.responseText);
          const d = j.data || j;
          const url = d.url || d.path;
          if (url) resolve(url);
          else reject(new Error('upload response missing url'));
        } catch {
          reject(new Error('bad upload response'));
        }
      } else reject(new Error('upload failed'));
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(form);
  });
