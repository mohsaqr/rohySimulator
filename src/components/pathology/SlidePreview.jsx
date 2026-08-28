import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { dziThumbnailUrl, parseDziDescriptor } from './slideThumbnail.js';

/**
 * The picture of a slide, taken from the pyramid that is already there.
 *
 * Shared by the editor and the case library so both show the same thing. One
 * descriptor fetch per DZI for the life of the page: a grid of cards would
 * otherwise re-read the same `.dzi` once per card, and again on every render.
 */
const thumbnailCache = new Map();

export function slideThumbnail(dziUrl) {
    if (!thumbnailCache.has(dziUrl)) {
        const pending = fetch(dziUrl)
            .then((response) => {
                if (!response.ok) throw new Error(`${response.status} ${response.statusText || 'request failed'}`);
                return response.text();
            })
            .then((xml) => dziThumbnailUrl(dziUrl, parseDziDescriptor(xml)))
            // A failure is not cached: a slide behind a server that was briefly
            // down should show on the next render, not never.
            .catch((error) => { thumbnailCache.delete(dziUrl); throw error; });
        thumbnailCache.set(dziUrl, pending);
    }
    return thumbnailCache.get(dziUrl);
}

/**
 * @param {object} props
 * @param {string|null} props.dziUrl    the tiled rendition to draw from
 * @param {string|null} props.imageUrl  a plain image to use instead (a gross plate)
 * @returns {import('react').ReactElement} the picture, a skeleton, or a refusal
 */
export function SlidePreview({ dziUrl, imageUrl = null, alt, className = 'h-32' }) {
    const [url, setUrl] = useState(imageUrl);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (imageUrl) { setUrl(imageUrl); setFailed(false); return undefined; }
        if (!dziUrl) { setUrl(null); setFailed(true); return undefined; }
        let live = true;
        setUrl(null);
        setFailed(false);
        slideThumbnail(dziUrl).then(
            (found) => { if (live) setUrl(found); },
            () => { if (live) setFailed(true); },
        );
        return () => { live = false; };
    }, [dziUrl, imageUrl]);

    if (failed) {
        return (
            <div className={`flex ${className} w-full items-center justify-center gap-2 bg-slate-950 text-[11px] text-slate-600`}>
                <ImageOff className="h-5 w-5" aria-hidden="true" />No preview
            </div>
        );
    }
    if (!url) return <div className={`${className} w-full animate-pulse bg-slate-800/60`} aria-hidden="true" />;
    return <img src={url} alt={alt} loading="lazy" onError={() => setFailed(true)} className={`${className} w-full bg-slate-950 object-cover`} />;
}
