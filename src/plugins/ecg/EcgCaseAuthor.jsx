import { CaseAuthor } from '../../components/ecg/ui/CaseAuthor.jsx';

/**
 * The host shell around Cardoyon's authoring studio — the same seam, for the
 * same two reasons, as PacsCaseEditor and EcgRoom:
 *
 * THE CHROME. PluginAuthorSurface hands its Done/Discard controls down as
 * camelCase `topBarControls`; the vendored CaseAuthor destructures snake_case
 * `top_bar_controls`. Without this rename the buttons silently vanished and
 * an educator who opened the ECG studio could neither commit nor leave it.
 *
 * THE SCROLL. PluginAuthorSurface mounts the editor in a `fixed inset-0`
 * overlay with no scrolling element; standalone Cardoyon scrolls the BODY,
 * which does not exist as a scroller inside the overlay — so a studio taller
 * than the viewport was simply cut off. The pane below is that scroller.
 */
export function EcgCaseAuthor({ topBarControls = null, caseTitle = null, ...props }) {
    return (
        <div className="flex h-full w-full flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-y-auto">
                <CaseAuthor
                    {...props}
                    top_bar_controls={(
                        <>
                            {caseTitle && (
                                <span className="max-w-56 truncate text-sm text-slate-300 max-lg:hidden">
                                    {caseTitle}
                                </span>
                            )}
                            {topBarControls}
                        </>
                    )}
                />
            </div>
        </div>
    );
}

export default EcgCaseAuthor;
