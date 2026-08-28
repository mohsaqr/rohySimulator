/**
 * Resolve the tile source a viewer can open from either the legacy flattened
 * slide shape or the versioned asset-reference shape used by Case Studio.
 *
 * Keeping this pure is important: source adapters may resolve DZI, IIIF or a
 * host-provided OpenSeadragon descriptor, while SlideCanvas should only care
 * about the final tile source it was handed.
 *
 * @param {object} slide
 * @returns {string|object|null}
 */
export function tileSourceForSlide(slide) {
    if (!slide || typeof slide !== 'object') return null;
    return slide.dzi
        ?? slide.tileSource
        ?? slide.resolvedAsset?.tileSource
        ?? slide.resolvedAsset?.rendition?.uri
        ?? null;
}

/**
 * OpenSeadragon network options for a slide source.
 *
 * Anonymous CORS is the safe default for CDN tiles. Without it, a remote slide
 * may render but taints the viewer canvas, making snapshot export fail at the
 * later `toDataURL()` call. Credentialed cross-origin tiles are deliberately
 * not supported by the package: a host that needs protected images should
 * expose a same-origin authenticated tile proxy or a signed URL.
 *
 * @param {object} slide
 * @returns {{crossOriginPolicy:'Anonymous'|'use-credentials'|false,ajaxWithCredentials:boolean}}
 */
export function slideNetworkOptions(slide) {
    const requested = slide?.network?.crossOriginPolicy ?? slide?.crossOriginPolicy ?? 'Anonymous';
    if (!['Anonymous', 'use-credentials', false].includes(requested)) {
        throw new TypeError(
            'slideNetworkOptions(): crossOriginPolicy must be "Anonymous", "use-credentials", or false',
        );
    }
    const withCredentials = requested === 'use-credentials';
    return { crossOriginPolicy: requested, ajaxWithCredentials: withCredentials };
}

