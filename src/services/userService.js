// Client API for the admin Users workspace. Mirrors cohortsService.js — thin
// wrappers over apiClient. All endpoints are admin-scoped and tenant-scoped
// server-side.
import { apiGet, apiPost, apiPut, apiPatch, apiDelete } from './apiClient';

export const listUsers = ({ includeMemberships = false } = {}) =>
    apiGet(`/users${includeMemberships ? '?include=memberships' : ''}`);

export const getUserDetail = (id) => apiGet(`/users/${id}/detail`);

export const createUser = (payload) => apiPost('/users/create', payload);

export const updateUser = (id, patch) => apiPut(`/users/${id}`, patch);

export const setUserStatus = (id, status) => apiPatch(`/users/${id}/status`, { status });

export const deleteUser = (id) => apiDelete(`/users/${id}`);

export const bulkUserAction = (action, ids, value) =>
    apiPost('/users/bulk-action', { action, ids, value });

export const importUsers = ({ rows, cohortId, dryRun }) =>
    apiPost('/users/import', { rows, cohortId, dryRun });

export const enrollUsersBulk = (cohortId, identifiers) =>
    apiPost(`/cohorts/${cohortId}/members/bulk`, { identifiers });

// Bulk module: enroll/unenroll a set of user_ids across a set of cohort_ids in
// one call. Returns { action, summary, results } — a full per-pair report.
export const bulkEnroll = ({ userIds, cohortIds, action }) =>
    apiPost('/cohorts/bulk-enroll', { user_ids: userIds, cohort_ids: cohortIds, action });

export const removeMembership = (cohortId, userId) =>
    apiDelete(`/cohorts/${cohortId}/members/${userId}`);

export const getEnforcementFlag = () => apiGet('/platform-settings/cohort-case-enforcement');

export const setEnforcementFlag = (enabled) =>
    apiPut('/platform-settings/cohort-case-enforcement', { enabled });
