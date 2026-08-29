import { useState } from 'react';
import { CaseStudio } from './CaseStudio.jsx';
import { studioReaderCase, toStudioDocument } from './caseStudioModel.js';

/**
 * Compatibility wrapper for the original uncontrolled CaseAuthor contract.
 * New hosts should mount controlled CaseStudio directly.
 */
export function CaseAuthor({
    initialCase,
    onChange,
    topBarControls = null,
    assetService = null,
    onSaveDraft,
    onSubmitReview,
    onPublish,
}) {
    // What shape does this host speak? A host that handed us a legacy flat
    // case gets one back, because that is the contract it was written against.
    //
    // A host that handed us NOTHING is starting a new case, and has no legacy
    // expectation to honour — so it gets the canonical document. This matters:
    // the legacy projection is lossy (it drops the rubric, which is where every
    // expected answer and ROI lives), and a host that stored it would silently
    // lose the assessment half of every case it created.
    const canonicalInput = initialCase === null || initialCase === undefined
        || !!initialCase?.manifest || !!initialCase?.schemaVersion;
    const [document, setDocument] = useState(() => toStudioDocument(initialCase));
    const outward = (next) => (canonicalInput ? next : studioReaderCase(next));
    const change = (next) => {
        setDocument(next);
        onChange?.(outward(next));
    };

    return (
        <CaseStudio
            document={document}
            onChange={change}
            assetService={assetService}
            onSaveDraft={onSaveDraft ?? (() => onChange?.(outward(document)))}
            onSubmitReview={onSubmitReview}
            onPublish={onPublish}
            topBarControls={topBarControls}
        />
    );
}
