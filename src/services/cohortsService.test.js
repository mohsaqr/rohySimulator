// Unit tests for the cohorts API wrapper. apiClient is mocked so we assert
// the exact path / verb / body each helper sends — the wrapper is pure
// glue, so verifying the wire shape is what matters.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./apiClient', () => ({
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    apiPatch: vi.fn(),
    apiDelete: vi.fn(),
    apiFetch: vi.fn(),
}));

import { apiGet, apiPost, apiPatch, apiDelete, apiFetch } from './apiClient';
import {
    listCohorts,
    getCohort,
    createCohort,
    renameCohort,
    deleteCohort,
    addCohortMember,
    removeCohortMember,
    rotateJoinCode,
    disableJoinCode,
    joinCohort,
    getCohortRoster,
    getCohortGrid,
    getCohortStudent,
    getCohortFeed,
    downloadCohortExport,
} from './cohortsService.js';

beforeEach(() => {
    apiGet.mockReset().mockResolvedValue({ ok: true });
    apiPost.mockReset().mockResolvedValue({ ok: true });
    apiPatch.mockReset().mockResolvedValue({ ok: true });
    apiDelete.mockReset().mockResolvedValue({ ok: true });
    apiFetch.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('cohortsService — management helpers', () => {
    it('listCohorts → GET /cohorts', async () => {
        await listCohorts();
        expect(apiGet).toHaveBeenCalledWith('/cohorts');
    });

    it('getCohort → GET /cohorts/:id', async () => {
        await getCohort(42);
        expect(apiGet).toHaveBeenCalledWith('/cohorts/42');
    });

    it('createCohort → POST /cohorts with { name }', async () => {
        await createCohort('Cardiology 101');
        expect(apiPost).toHaveBeenCalledWith('/cohorts', { name: 'Cardiology 101' });
    });

    it('renameCohort → PATCH /cohorts/:id with { name }', async () => {
        await renameCohort(7, 'Renamed');
        expect(apiPatch).toHaveBeenCalledWith('/cohorts/7', { name: 'Renamed' });
    });

    it('deleteCohort → DELETE /cohorts/:id', async () => {
        await deleteCohort(7);
        expect(apiDelete).toHaveBeenCalledWith('/cohorts/7');
    });

    it('addCohortMember → POST /cohorts/:id/members with { identifier }', async () => {
        await addCohortMember(3, 'alice@example.com');
        expect(apiPost).toHaveBeenCalledWith('/cohorts/3/members', {
            identifier: 'alice@example.com',
        });
    });

    it('removeCohortMember → DELETE /cohorts/:id/members/:userId', async () => {
        await removeCohortMember(3, 99);
        expect(apiDelete).toHaveBeenCalledWith('/cohorts/3/members/99');
    });

    it('rotateJoinCode → POST /cohorts/:id/join-code', async () => {
        await rotateJoinCode(5);
        expect(apiPost).toHaveBeenCalledWith('/cohorts/5/join-code');
    });

    it('disableJoinCode → DELETE /cohorts/:id/join-code', async () => {
        await disableJoinCode(5);
        expect(apiDelete).toHaveBeenCalledWith('/cohorts/5/join-code');
    });

    it('joinCohort → POST /cohorts/join with { join_code }', async () => {
        await joinCohort('ABC123');
        expect(apiPost).toHaveBeenCalledWith('/cohorts/join', { join_code: 'ABC123' });
    });
});

describe('cohortsService — reporting helpers', () => {
    it('getCohortRoster → GET /cohorts/:id/roster', async () => {
        await getCohortRoster(8);
        expect(apiGet).toHaveBeenCalledWith('/cohorts/8/roster');
    });

    it('getCohortGrid → GET /cohorts/:id/grid', async () => {
        await getCohortGrid(8);
        expect(apiGet).toHaveBeenCalledWith('/cohorts/8/grid');
    });

    it('getCohortStudent without limit omits the query string', async () => {
        await getCohortStudent(8, 12);
        expect(apiGet).toHaveBeenCalledWith('/cohorts/8/student/12');
    });

    it('getCohortStudent with limit appends ?limit=', async () => {
        await getCohortStudent(8, 12, 25);
        expect(apiGet).toHaveBeenCalledWith('/cohorts/8/student/12?limit=25');
    });

    it('getCohortFeed without cursor omits ?since', async () => {
        await getCohortFeed(8);
        expect(apiGet).toHaveBeenCalledWith('/cohorts/8/feed');
    });

    it('getCohortFeed with empty-string cursor still omits ?since', async () => {
        await getCohortFeed(8, '');
        expect(apiGet).toHaveBeenCalledWith('/cohorts/8/feed');
    });

    it('getCohortFeed with a numeric cursor URL-encodes ?since', async () => {
        await getCohortFeed(8, 1500);
        expect(apiGet).toHaveBeenCalledWith('/cohorts/8/feed?since=1500');
    });
});

describe('downloadCohortExport', () => {
    let createObjectURL;
    let revokeObjectURL;
    let clickSpy;

    beforeEach(() => {
        createObjectURL = vi.fn(() => 'blob:fake-url');
        revokeObjectURL = vi.fn();
        // jsdom doesn't implement these — install spies.
        globalThis.URL.createObjectURL = createObjectURL;
        globalThis.URL.revokeObjectURL = revokeObjectURL;
        clickSpy = vi
            .spyOn(globalThis.HTMLAnchorElement.prototype, 'click')
            .mockImplementation(() => {});
    });

    it('fetches the CSV blob, builds a sanitised filename, clicks, and revokes', async () => {
        const blob = new Blob(['a,b,c'], { type: 'text/csv' });
        apiFetch.mockResolvedValue(blob);

        await downloadCohortExport(9, 'My Class / Spring 2026!!');

        expect(apiFetch).toHaveBeenCalledWith('/cohorts/9/export?format=csv', {
            parseAs: 'blob',
        });
        expect(createObjectURL).toHaveBeenCalledWith(blob);
        expect(clickSpy).toHaveBeenCalledTimes(1);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    });

    it('falls back to cohort-<id> when no name is given', async () => {
        apiFetch.mockResolvedValue(new Blob(['x']));
        // Capture the anchor download attribute via a click interceptor.
        let captured;
        clickSpy.mockImplementation(function clickImpl() {
            captured = this.getAttribute('download');
        });

        await downloadCohortExport(11, '');

        expect(captured).toMatch(/^cohort-11_\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it('revokes the object URL even if the click throws', async () => {
        apiFetch.mockResolvedValue(new Blob(['x']));
        clickSpy.mockImplementation(() => {
            throw new Error('click boom');
        });

        await expect(downloadCohortExport(1, 'C')).rejects.toThrow('click boom');
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    });
});
