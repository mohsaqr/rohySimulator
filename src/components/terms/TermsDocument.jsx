// Renders the terms-of-use text from its markdown subset ("#"/"##"/"###"
// headings, paragraphs, "-" lists, "|" tables, "```" fences, "---" rules,
// **bold**, `code`, [links](https://…)) as React elements — never as HTML, so
// an administrator's text cannot inject markup. The parser is shared with the
// server (server/shared/terms.js). The About dialog reuses it for LICENSE and
// NOTICE.md.

import React, { useMemo } from 'react';
import { inlineSegments, parseTermsBody } from '../../../server/shared/terms.js';

function Inline({ text }) {
    return inlineSegments(text).map((seg, i) => {
        let node = seg.text;
        if (seg.code) node = <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[0.8125rem] text-neutral-100">{node}</code>;
        if (seg.bold) node = <strong className="font-semibold text-neutral-100">{node}</strong>;
        if (seg.href) {
            node = (
                <a href={seg.href} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline underline-offset-2 hover:text-sky-300 break-words">
                    {node}
                </a>
            );
        }
        return <React.Fragment key={i}>{node}</React.Fragment>;
    });
}

export default function TermsDocument({ body }) {
    const blocks = useMemo(() => parseTermsBody(body), [body]);
    return (
        <div className="space-y-3 text-sm leading-relaxed text-neutral-300">
            {blocks.map((block, i) => {
                if (block.type === 'title') {
                    return <h2 key={i} className="text-lg font-bold text-neutral-100">{block.text}</h2>;
                }
                if (block.type === 'heading') {
                    return <h3 key={i} className="pt-3 text-base font-semibold text-neutral-100">{block.text}</h3>;
                }
                if (block.type === 'subheading') {
                    return <h4 key={i} className="pt-2 text-sm font-semibold text-neutral-100">{block.text}</h4>;
                }
                if (block.type === 'rule') {
                    return <hr key={i} className="border-neutral-700" />;
                }
                if (block.type === 'code') {
                    return (
                        <pre key={i} className="overflow-x-auto rounded-lg border border-neutral-700 bg-neutral-900 p-3 font-mono text-xs text-neutral-200">
                            {block.text}
                        </pre>
                    );
                }
                if (block.type === 'table') {
                    return (
                        <div key={i} className="overflow-x-auto rounded-lg border border-neutral-700">
                            <table className="min-w-full text-left text-xs">
                                {block.header && (
                                    <thead className="bg-neutral-800">
                                        <tr>
                                            {block.header.map((cell, j) => (
                                                <th key={j} scope="col" className="px-3 py-2 font-semibold text-neutral-100"><Inline text={cell} /></th>
                                            ))}
                                        </tr>
                                    </thead>
                                )}
                                <tbody>
                                    {block.rows.map((row, r) => (
                                        <tr key={r} className="border-t border-neutral-700 align-top">
                                            {row.map((cell, j) => <td key={j} className="px-3 py-2"><Inline text={cell} /></td>)}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
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
