import { ClipboardList } from 'lucide-react';
import { caseRequest } from './requisition.js';

/**
 * The pathology request, above both modules so it is in front of the reader
 * whether they start at the bench (Gross) or the microscope.
 *
 * A native <details>: keyboard and screen-reader behaviour come for free, and
 * a reader who has taken the history in can fold it away to get the slide
 * height back. Open by default — a request nobody sees is not a request.
 */
export function CaseRequest({ viewerCase, t = (key, fallback) => fallback ?? key }) {
    const request = caseRequest(viewerCase);
    if (!request) return null;
    return (
        <details open className="group shrink-0 border-b border-slate-800/80 bg-slate-950/60 px-3 py-1.5 text-xs text-slate-300">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-fuchsia-400">
                <ClipboardList className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <span className="font-semibold text-slate-200">{t('pathology_request', 'Request')}</span>
                {request.accession && <span className="tabular-nums text-slate-400">{request.accession}</span>}
                {request.specimen && <span className="min-w-0 truncate text-slate-400">{request.specimen}</span>}
            </summary>
            <dl className="mt-1.5 grid max-h-32 grid-cols-[auto_1fr] gap-x-3 gap-y-1 overflow-y-auto pb-1">
                {request.accession && (
                    <>
                        <dt className="text-slate-500">{t('accession', 'Accession')}</dt>
                        <dd className="tabular-nums">{request.accession}</dd>
                    </>
                )}
                {request.specimen && (
                    <>
                        <dt className="text-slate-500">{t('specimen_summary', 'Specimen summary')}</dt>
                        <dd>{request.specimen}</dd>
                    </>
                )}
                {request.history && (
                    <>
                        <dt className="text-slate-500">{t('clinical_history', 'Clinical history')}</dt>
                        <dd className="whitespace-pre-line">{request.history}</dd>
                    </>
                )}
            </dl>
        </details>
    );
}
