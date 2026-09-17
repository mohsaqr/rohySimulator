// Renders the terms-of-use text from its markdown subset ("##" headings,
// paragraphs, "-" lists, **bold**) as React elements — never as HTML, so an
// administrator's text cannot inject markup. The parser is shared with the
// server (server/shared/terms.js).

import React, { useMemo } from 'react';
import { inlineSegments, parseTermsBody } from '../../../server/shared/terms.js';

function Inline({ text }) {
    return inlineSegments(text).map((seg, i) => (seg.bold
        ? <strong key={i} className="font-semibold text-neutral-100">{seg.text}</strong>
        : <React.Fragment key={i}>{seg.text}</React.Fragment>));
}

export default function TermsDocument({ body }) {
    const blocks = useMemo(() => parseTermsBody(body), [body]);
    return (
        <div className="space-y-3 text-sm leading-relaxed text-neutral-300">
            {blocks.map((block, i) => {
                if (block.type === 'heading') {
                    return <h3 key={i} className="pt-3 text-base font-semibold text-neutral-100">{block.text}</h3>;
                }
                if (block.type === 'list') {
                    return (
                        <ul key={i} className="list-disc space-y-1 pl-5">
                            {block.items.map((item, j) => <li key={j}><Inline text={item} /></li>)}
                        </ul>
                    );
                }
                return <p key={i}><Inline text={block.text} /></p>;
            })}
        </div>
    );
}
