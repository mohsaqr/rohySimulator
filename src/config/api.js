/**
 * API Configuration
 * Central place to configure API endpoints
 *
 * Handles BASE_URL from Vite which may or may not end with /
 * Examples: '/', '/app/', '/app'
 */

// Get the base URL, default to '/'
const rawBaseUrl = import.meta.env.BASE_URL || '/';

// Normalize: remove trailing slash for consistent joining
const BASE_URL = rawBaseUrl.endsWith('/') ? rawBaseUrl.slice(0, -1) : rawBaseUrl;

/**
 * Build a full API URL with the base path prepended
 * @param {string} path - API path (e.g., '/api/cases' or 'api/cases')
 * @returns {string} Full URL with base path
 */
export const apiUrl = (path) => {
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    return `${BASE_URL}${normalizedPath}`;
};

// For backwards compatibility
export const API_BASE_URL = BASE_URL;

export default {
    BASE_URL,
    API_BASE_URL,
    apiUrl,
    // Alias for convenience
    url: apiUrl
};
