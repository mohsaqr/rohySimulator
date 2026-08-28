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
    const canonicalInput = !!initialCase?.manifest || !!initialCase?.schemaVersion;
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
