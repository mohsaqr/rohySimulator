/**
 * API Configuration
 * Central place to configure API endpoints
 */

// Try to use Vite's environment variables, fallback to defaults
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default {
    API_BASE_URL,
    // Helper to build full API URLs
    url: (path) => `${API_BASE_URL}${path.startsWith('/') ? path : '/' + path}`
};
