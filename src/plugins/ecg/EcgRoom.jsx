import { ECGScreen } from '../../components/ecg/ui/ECGScreen.jsx';

// The package stylesheet — vendored and stamped like the source tree
// (`npm run vendor -- ecg-styles`). Scoped: every selector lives under the
// package's own component roots, so importing it here cannot restyle the
// rest of rohy.
import '../../components/ecg-styles/package.css';

/**
 * Host chrome around the vendored ECG workstation.
 *
 * The vendored ECGScreen destructures a closed prop list (snake_case, its own
 * convention) and knows nothing about rohy's top bar or room navigator — the
 * exact gap the PACS room shipped with and PacsRoom now closes. ECGScreen
 * already renders its own branded header with a `top_bar_controls` slot, so
 * unlike PacsRoom this wrapper adds no second header: it hands rohy's
 * controls (and the case title) into that slot and keeps the RoomNavigator
 * pinned below.
 *
 * Lives in its own file because a descriptor module that also exports a
 * component breaks React Fast Refresh for the whole module.
 */
export function EcgRoom({ topBarControls = null, caseTitle = null, roomNav = null, ...props }) {
    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-900">
            <div className="min-h-0 flex-1 overflow-auto">
                <ECGScreen
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
            {/* Bottom RoomNavigator — rendered by App.jsx and passed in so the
                bar stays consistent across every room. */}
            {roomNav}
        </div>
    );
}

export default EcgRoom;
