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
            {/*
              `--ecg-shell-height: 100%` is the package's documented embedding
              seam (INTEGRATION.md, "The shell's height is the host's to
              declare"). `.ecg-screen` defaults to `100vh` because standalone
              Cardoyon owns the viewport; here it does not — this column also
              carries the RoomNavigator, so the box is a navigator shorter than
              the viewport. Left at the default the shell overflowed its box by
              exactly the navigator's height, and because the surplus had to go
              somewhere the workstation stopped behaving like a workstation: its
              own `overflow: auto` panes went slack, the room became one tall
              document, and reading to the end of the findings list scrolled the
              tracing — and rohy's top-bar controls with it — off the screen.

              With the height declared, the package scrolls internally, so this
              wrapper deliberately does NOT scroll: `overflow-hidden` is what
              makes a slack shell a visible bug here instead of a silent
              regression that a host scrollbar papers over.
            */}
            <div className="min-h-0 flex-1 overflow-hidden" style={{ '--ecg-shell-height': '100%' }}>
                <ECGScreen
                    {...props}
                    top_bar_controls={(
                        // `.ecg-topbar-actions` is a plain block, so two
                        // children stack. The case title and rohy's controls
                        // are two children — hence the row.
                        <span className="flex items-center gap-3">
                            {caseTitle && (
                                <span className="max-w-56 truncate text-sm text-slate-300 max-lg:hidden">
                                    {caseTitle}
                                </span>
                            )}
                            {topBarControls}
                        </span>
                    )}
                />
            </div>
            {/* Bottom RoomNavigator — rendered by App.jsx and passed in so the
                bar stays consistent across every room. `shrink-0` because the
                way out of a room must not be negotiable: however tall the
                plugin's content becomes, the navigator keeps its height. */}
            <div className="shrink-0">{roomNav}</div>
        </div>
    );
}

export default EcgRoom;
