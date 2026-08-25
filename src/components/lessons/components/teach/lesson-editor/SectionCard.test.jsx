// Tests for the authoring-side file section of SectionCard.
//
// src/components/lessons/** is a vendored module (ported from LAILA) and had
// no tests at all; this file covers only the inline media preview added for
// the 2.9.37 report, not the vendored module's wider behaviour.
//
// CONTRACT (locked from SectionCard.jsx + utils/filePreview.js):
//   - A `file` section renders a FileCard. FileCard already offers a "View"
//     action for previewable types (previewKind !== null) that opens the file
//     in a new tab — nothing about that changes here.
//   - The lesson EDITOR additionally renders an inline <img> above the card
//     when the attachment is an image, so an author can confirm the material
//     without leaving the page. Non-image attachments (pdf, docx, …) get no
//     inline preview — a PDF in an <img> is a broken-image icon, which is
//     worse than the card alone.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { SectionCard } from './SectionCard.jsx';

// The rich-text branch is never reached for a `file` section, but SectionCard
// imports SectionBodyEditor at module scope — stub it so the TipTap stack
// (and its jsdom-hostile DOM APIs) stays out of this test.
vi.mock('./SectionBodyEditor', () => ({
    SectionBodyEditor: () => <div data-testid="body-editor" />,
}));

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_k, o) => o?.defaultValue ?? _k }),
}));

vi.mock('../../../hooks/useTheme', () => ({
    useTheme: () => ({ isDark: false }),
}));

const fileSection = (over = {}) => ({
    id: 1,
    type: 'file',
    title: 'Imaging',
    content: '',
    fileName: 'CT Abdomen (non-contrast).png',
    fileType: 'image/png',
    fileUrl: '/uploads/123-CT_Abdomen.png',
    fileSize: 51200,
    ...over,
});

const renderSection = (section) => render(
    <SectionCard
        section={section}
        index={0}
        courseId={9}
        isFirst
        isLast
        onMoveUp={() => {}}
        onMoveDown={() => {}}
        onDragStart={() => {}}
        onDragOverRow={() => {}}
        onDropRow={() => {}}
        onDragEnd={() => {}}
        onTitleCommit={() => {}}
        onFileDescCommit={() => {}}
        onRequestDelete={() => {}}
        registerFlush={() => {}}
    />,
);

describe('SectionCard — inline media preview for file sections', () => {
    // Regression lock: an uploaded image could not be previewed on the lesson
    // creation page — the author had to open a new tab to confirm they had
    // attached the right file (2.9.37 report, bug 3).
    it('renders an inline image preview for an image attachment', () => {
        renderSection(fileSection());

        const img = screen.getByAltText('CT Abdomen (non-contrast).png');
        expect(img).toBeInTheDocument();
        expect(img.getAttribute('src')).toBe('/uploads/123-CT_Abdomen.png');
    });

    it('does not inline-preview a non-image attachment', () => {
        renderSection(fileSection({
            fileName: 'protocol.pdf', fileType: 'application/pdf',
            fileUrl: '/uploads/456-protocol.pdf',
        }));

        expect(screen.queryByAltText('protocol.pdf')).not.toBeInTheDocument();
        // The card itself still lists the file.
        expect(screen.getByText('protocol.pdf')).toBeInTheDocument();
    });

    it('does not render a preview when the attachment has no url', () => {
        renderSection(fileSection({ fileUrl: null }));

        expect(screen.queryByAltText('CT Abdomen (non-contrast).png')).not.toBeInTheDocument();
    });
});
