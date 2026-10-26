// Lesson video iframe + lesson HTML hardening (security audit 2026-10-26, L5-05, L5-08).
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@tiptap/react', () => ({
    NodeViewWrapper: ({ children, as: Tag = 'div', ...rest }) => <Tag {...rest}>{children}</Tag>,
}));
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k, o) => o?.defaultValue ?? k }),
}));
vi.mock('../../../services/videoXapi', () => ({
    trackUploadedVideo: vi.fn(() => () => {}),
    trackYouTubeEmbed: vi.fn(() => () => {}),
    isYouTubeEmbed: (src) => /(?:www\.)?youtube(?:-nocookie)?\.com\/embed\//.test(src),
    withJsApi: (src) => src,
}));

const { VideoNodeView, VIDEO_IFRAME_SANDBOX } = await import('./VideoNodeView.jsx');
const { safeVideoEmbedSrc } = await import('../../../utils/safeUrl.js');
const { sanitizeHtml } = await import('../../../utils/sanitize.js');

const renderVideo = (src) => render(
    <VideoNodeView node={{ attrs: { mode: 'embed', src } }} deleteNode={() => {}} editor={{ isEditable: false }} />,
);

describe('lecture video iframe', () => {
    // Regression lock: the video iframe had no sandbox and accepted any http(s) page.
    it('sandboxes a YouTube embed', () => {
        const { container } = renderVideo('https://www.youtube.com/embed/abc123');
        const frame = container.querySelector('iframe');
        expect(frame).toBeTruthy();
        expect(frame.getAttribute('sandbox')).toBe(VIDEO_IFRAME_SANDBOX);
        expect(frame.getAttribute('src')).toBe('https://www.youtube.com/embed/abc123');
        expect(VIDEO_IFRAME_SANDBOX).not.toMatch(/allow-top-navigation|allow-forms/);
    });

    it.each([
        'https://evil.example/fake-login.html',
        'https://rohy.example.org/uploads/x.html',
        '/uploads/x.html',
        'http://www.youtube.com/embed/abc',
        'javascript:alert(1)',
        'https://www.youtube.com.evil.example/embed/x',
    ])('refuses %s (no iframe at all)', (src) => {
        const { container } = renderVideo(src);
        expect(container.querySelector('iframe')).toBeNull();
        expect(container.textContent).toContain('This embed URL is not allowed.');
    });

    it('admits Vimeo and youtube-nocookie players', () => {
        expect(safeVideoEmbedSrc('https://player.vimeo.com/video/1')).toBe('https://player.vimeo.com/video/1');
        expect(safeVideoEmbedSrc('https://www.youtube-nocookie.com/embed/x')).toBe('https://www.youtube-nocookie.com/embed/x');
    });
});

describe('lesson HTML sanitiser', () => {
    // Regression lock: `class` passed untouched, so app utilities could build a full-screen overlay.
    it('drops overlay utility classes and ids, keeps lesson classes', () => {
        const out = sanitizeHtml('<div id="root" class="fixed inset-0 z-50 rohy-lesson-note"><a href="https://x.example" class="text-cyan-600 underline bg-red-500">x</a></div><pre><code class="language-js">1</code></pre>');
        expect(out).not.toMatch(/\bid=/);
        expect(out).not.toMatch(/fixed|inset-0|z-50|bg-red-500/);
        expect(out).toContain('class="rohy-lesson-note"');
        expect(out).toContain('class="text-cyan-600 underline"');
        expect(out).toContain('class="language-js"');
    });

    it('removes a class attribute that has nothing left', () => {
        expect(sanitizeHtml('<p class="fixed inset-0">hi</p>')).toBe('<p>hi</p>');
    });

    it('does not change DOMPurify for the rest of the app', async () => {
        const DOMPurify = (await import('dompurify')).default;
        expect(DOMPurify.sanitize('<p class="fixed">a</p>')).toBe('<p class="fixed">a</p>');
    });
});
