import { Microscope } from 'lucide-react';
import { PathologyRoom } from './PathologyRoom.jsx';

/**
 * Screen chrome for the Pathology room, mirroring InvestigationsScreen and
 * DiscussionScreen: a header carrying the room name plus the case title, the
 * room body, and the shared bottom RoomNavigator passed down from App.jsx.
 *
 * This wrapper exists so `PathologyRoom` stays chrome-free and therefore
 * reusable inside a lesson embed, where there is no room navigator and no
 * full-screen header.
 *
 * TRANSLATION IS INJECTED, NOT IMPORTED. This file used to call
 * `useTranslation()` from react-i18next, which is a reach for a host
 * singleton: the hook reads a React context the embedding app must have
 * provided, so the package could not render outside Rohy at all. Taking `t` as
 * a prop — defaulting to "use the fallback string" — makes i18n optional
 * without making the labels worse, and it is the shape RPS-1 already hands
 * every plugin as `ctx.t`. With this gone the package imports react,
 * openseadragon and lucide-react, and nothing else — a guarantee
 * `tests/portability.test.js` now enforces rather than describes.
 *
 * @param {Function} [props.t]  (key, fallback) => string; the host's translator
 */
export function PathologyScreen({
    pathologyCase,
    rubric = null,
    caseTitle,
    eventLogger,
    onAnnotationsChange,
    initialAnnotations,
    onReportsChange,
    initialReports,
    examMode = false,
    topBarControls = null,
    roomNav,
    t = (key, fallback) => fallback,
}) {
    return (
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 text-slate-100">
            <header className="flex items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-6 py-3 shadow-lg shadow-black/20 backdrop-blur">
                {/* Capped like the other screens so the title never runs under
                    the fixed, centred Oyon capture pill on a tablet. */}
                <div className="flex min-w-0 items-center gap-3 max-lg:max-w-[40%]">
                    <Microscope className="h-6 w-6 shrink-0 text-fuchsia-300" />
                    <div className="flex min-w-0 items-baseline gap-2 text-sm">
                        <span className="whitespace-nowrap text-base font-semibold text-slate-100">
                            {t('room_pathology', 'Pathology')}
                        </span>
                        {caseTitle && (
                            <>
                                <span className="text-slate-500 max-lg:hidden">·</span>
                                <span className="truncate text-slate-300 max-lg:hidden">{caseTitle}</span>
                            </>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">{topBarControls}</div>
            </header>

            <PathologyRoom
                pathologyCase={pathologyCase}
                rubric={rubric}
                eventLogger={eventLogger}
                onAnnotationsChange={onAnnotationsChange}
                initialAnnotations={initialAnnotations}
                onReportsChange={onReportsChange}
                initialReports={initialReports}
                examMode={examMode}
            />

            {/* Bottom RoomNavigator — rendered by App.jsx and passed in so the
                bar stays consistent across every room. */}
            {roomNav}
        </div>
    );
}
