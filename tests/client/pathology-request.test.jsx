// Regression lock: FI0010.CONTENT.02 — the pathology request never reached the learner.
//
// The case editor files accession, specimen summary and clinical history under
// "Clinical metadata — public context every learner sees", but the viewer case
// dropped the history and the room rendered none of the three. This walks the
// whole path a learner's request takes: the server's learner projection of the
// case config, the client's learnerCase(), and the room's request panel.
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { createStudioDocument, updateStudioMetadata } from '../../src/components/pathology/caseStudioModel.js';
import { learnerCase } from '../../src/components/pathology/hostDocument.js';
import { CaseRequest } from '../../src/components/pathology/CaseRequest.jsx';
import { projectCaseConfigForRole } from '../../server/services/caseProjection.js';
import { PLUGIN_MANIFESTS } from '../../server/shared/plugins/manifests.generated.js';

afterEach(cleanup);

function ids() {
    const count = new Map();
    return (kind) => {
        const next = (count.get(kind) ?? 0) + 1;
        count.set(kind, next);
        return `${kind}-${next}`;
    };
}

const ACCESSION = 'PAT-26-0751';
const SPECIMEN = 'A: sigmasuolen resektaatti · B: välikarsinan imusolmukkeet · C: maksan kiilabiopsia';
const HISTORY = '75-vuotias mies, jolla verenpainetauti, kihti. Pyydetään histologinen diagnoosi.';

function fi0010Document() {
    const document = createStudioDocument({
        idFactory: ids(), now: () => '2026-10-13T12:00:00.000Z', createdBy: 'tester',
    });
    return updateStudioMetadata(document, {
        title: 'Sigmasuolen resektaatti', accession: ACCESSION, specimenSummary: SPECIMEN, history: HISTORY,
    });
}

describe('the pathology request reaches the learner', () => {
    it('survives the server learner projection and the client viewer case', () => {
        const config = projectCaseConfigForRole({ pathology: fi0010Document() }, PLUGIN_MANIFESTS, 'student');
        const viewer = learnerCase(config.pathology);
        expect(viewer).toMatchObject({ accession: ACCESSION, specimen: SPECIMEN, history: HISTORY });
    });

    it('renders accession, specimen summary and clinical history, open by default', () => {
        const config = projectCaseConfigForRole({ pathology: fi0010Document() }, PLUGIN_MANIFESTS, 'student');
        const { container } = render(<CaseRequest viewerCase={learnerCase(config.pathology)} />);
        expect(container.querySelector('details')?.open).toBe(true);
        expect(screen.getByText('Clinical history')).toBeTruthy();
        expect(screen.getByText(HISTORY)).toBeTruthy();
        expect(screen.getAllByText(ACCESSION).length).toBeGreaterThan(0);
        expect(screen.getAllByText(SPECIMEN).length).toBeGreaterThan(0);
    });

    it('draws nothing for a case with no request', () => {
        const blank = createStudioDocument({ idFactory: ids(), now: () => '2026-10-13T12:00:00.000Z', createdBy: 'tester' });
        const { container } = render(<CaseRequest viewerCase={learnerCase(blank)} />);
        expect(container.innerHTML).toBe('');
    });
});
