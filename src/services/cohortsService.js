// Thin wrapper over the Phase-3a cohorts API (server/routes/cohorts-routes.js).
// Every call rides the shared apiClient so the bearer token / CSRF header /
// ApiError contract come for free — callers branch on ApiError.status.

import { apiGet, apiPost, apiPatch, apiDelete } from './apiClient';

export const listCohorts = () => apiGet('/cohorts');

export const getCohort = (id) => apiGet(`/cohorts/${id}`);

export const createCohort = (name) => apiPost('/cohorts', { name });

export const renameCohort = (id, name) => apiPatch(`/cohorts/${id}`, { name });

export const deleteCohort = (id) => apiDelete(`/cohorts/${id}`);

export const addCohortMember = (id, identifier) =>
    apiPost(`/cohorts/${id}/members`, { identifier });

export const removeCohortMember = (id, userId) =>
    apiDelete(`/cohorts/${id}/members/${userId}`);

export const rotateJoinCode = (id) => apiPost(`/cohorts/${id}/join-code`);

export const disableJoinCode = (id) => apiDelete(`/cohorts/${id}/join-code`);

export const joinCohort = (joinCode) =>
    apiPost('/cohorts/join', { join_code: joinCode });
