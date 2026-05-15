// Thin wrapper over the Phase-3a cohorts API (server/routes/cohorts-routes.js).
// Every call rides the shared apiClient so the bearer token / CSRF header /
// ApiError contract come for free — callers branch on ApiError.status.

import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from './apiClient';

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

// --- Phase-4 read-only reporting (all requireEducator, own-cohort scoped) ---

// → { cohort:{id,name}, roster:[{id,username,name,role,session_count,
//     cases_attempted,cases_completed,last_activity}] }
export const getCohortRoster = (id) => apiGet(`/cohorts/${id}/roster`);

// → { cohort:{id,name}, students:[{id,username,name}],
//     cases:[{id,name}], cells:{ [userId]:{ [caseId]:{attempted,completed,
//     last_activity} } } }
export const getCohortGrid = (id) => apiGet(`/cohorts/${id}/grid`);

// → { cohort:{id,name}, student:{id,username,name,role},
//     sessions:[{id,case_id,case_name,start_time,end_time,status,completed}],
//     events:[{id,session_id,case_id,timestamp,verb,object_type,object_id,
//              object_name,component,result,duration_ms,room,severity,
//              category}] }
export const getCohortStudent = (id, userId, limit) =>
    apiGet(`/cohorts/${id}/student/${userId}${limit ? `?limit=${limit}` : ''}`);

// `since` is a numeric learning_events.id cursor (exclusive). →
// { cohort:{id,name}, events:[…], next_since:<number|null> }
export const getCohortFeed = (id, since) => {
    const qs = since != null && since !== '' ? `?since=${encodeURIComponent(since)}` : '';
    return apiGet(`/cohorts/${id}/feed${qs}`);
};

// Auth'd CSV download. Mirrors src/components/analytics/SessionsTable.jsx:
// apiFetch(parseAs:'blob') → object URL → anchor click → revoke. The bearer
// token rides via apiFetch so the attachment download is authenticated
// without exposing the token in a query string.
export async function downloadCohortExport(id, cohortName) {
    const blob = await apiFetch(`/cohorts/${id}/export?format=csv`, {
        parseAs: 'blob',
    });
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement('a');
        a.href = url;
        const safe = String(cohortName || `cohort-${id}`)
            .replace(/[^\w.-]+/g, '_')
            .slice(0, 60);
        a.download = `${safe}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    } finally {
        URL.revokeObjectURL(url);
    }
}
