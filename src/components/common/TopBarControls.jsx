import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Settings, ChevronDown, User, LogOut, Activity, HelpCircle, Check, BookOpen, Stethoscope, ListChecks, ScanEye, Bug, Lightbulb, List, Globe, BarChart3 } from 'lucide-react';
import { LANGUAGES } from '../../i18n/languages';

// The single persistent top-bar menu: ONE trigger (gear + current-language
// flag) opening ONE panel that holds the Cases shortcut, profile/settings/help,
// the language switcher, analytics, and logout. Built ONCE in MainApp and
// passed into every screen's header via the `roomNav`-style prop convention, so
// everything is reachable from every authenticated screen — not just the chat
// room where these controls used to be nested inside PatientVisual.
//
// Previously this was TWO separate triggers (a globe language switcher + the
// gear menu); they were merged into one on user request so students in
// particular have a single obvious place for "switch language / open settings /
// jump to cases".
//
// Handlers stay owned by MainApp (they drive MainApp-local route state); this
// component is purely presentational + owns its own open/close state.
//
// The dropdown PANEL is rendered through a portal to document.body. The room
// screens (exam/lab/discussion) use backdrop-blur "glass" panels, and
// backdrop-filter creates a new stacking context that paints OVER anything
// z-indexed inside the header — so a panel rendered in the header flow gets
// hidden behind the glass. Portalling to <body> with a high z-index escapes
// every local stacking context and keeps the menu on top everywhere.
//
// Two sections fold in place (disclosures, aria-expanded on their row): the
// language list, whose row shows the current language, and the educator/admin
// tools. Both start collapsed every time the menu opens. With all eight
// languages and four tools listed inline the panel ran off a laptop screen
// (2026-10-12); folded, it is the everyday items plus two rows.

const PANEL_MIN_WIDTH = 240;

// Anchor a fixed-position panel just under a trigger button, clamped to the
// viewport so it never runs off the right/left edge regardless of whether the
// trigger sits at the far-left (chat room) or far-right (other room headers).
function anchorTo(el) {
   const r = el.getBoundingClientRect();
   const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_MIN_WIDTH - 8));
   return { top: r.bottom + 8, left };
}

export default function TopBarControls({
   isAdminUser = false,
   canSeeOyonAnalytics = false,
   onOpenCases,
   onOpenProfile,
   onOpenSettings,
   onOpenHelp,
   onOpenLessons,
   onOpenEmotionAnalytics,
   onOpenOyonDashboard,
   onOpenCaseAnalytics,
   onOpenSetup,
   onLogout,
   // Report a problem (hooks/useReportProblem.js): { available, news, onReport, onFeature, onMine }. The three
   // rows (Report a problem…, Request a feature…, My reports) sit under Help & Support; an amber dot on the
   // trigger and "· N new" on My reports when a report has news.
   reportProblem = null,
   uiLanguage,
   onSetLanguage,
   // Rendered after the menu and logout, in the same row. The case screens
   // put the on-call phone here, so it sits in the one header every room
   // shares instead of floating over the room's content.
   trailing = null,
}) {
   const { t } = useTranslation('app');
   const [showMenu, setShowMenu] = useState(false);
   const [menuPos, setMenuPos] = useState(null);
   const [languagesOpen, setLanguagesOpen] = useState(false);
   const [toolsOpen, setToolsOpen] = useState(false);
   const menuBtnRef = useRef(null);

   const closeAll = useCallback(() => setShowMenu(false), []);

   // Escape closes the menu and hands focus back to the trigger.
   //
   // Without this the only way out was a mouse click on the backdrop — and
   // that backdrop is a full-screen z-9998 layer, so a keyboard user who
   // opened the menu could neither dismiss it nor reach anything underneath
   // it (2026-08-30 UI review, #16: it stopped three automation agents dead,
   // which is exactly what it does to anyone driving the app from the
   // keyboard). WAI-ARIA menu-button pattern: Escape dismisses, focus
   // returns to the button that opened it.
   useEffect(() => {
      if (!showMenu) return undefined;
      const onKeyDown = (e) => {
         if (e.key !== 'Escape') return;
         e.stopPropagation();
         setShowMenu(false);
         menuBtnRef.current?.focus();
      };
      document.addEventListener('keydown', onKeyDown);
      return () => document.removeEventListener('keydown', onKeyDown);
   }, [showMenu]);

   const toggleMenu = () => {
      setShowMenu((v) => {
         if (!v) {
            // Every open starts folded: the menu's height is the point.
            setLanguagesOpen(false);
            setToolsOpen(false);
            if (menuBtnRef.current) setMenuPos(anchorTo(menuBtnRef.current));
         }
         return !v;
      });
   };

   const langLabel = (lang) =>
      lang.native === lang.name ? lang.native : `${lang.native} (${lang.name})`;

   const currentLanguage = LANGUAGES[uiLanguage] || LANGUAGES.en;
   const currentFlag = currentLanguage.flag;
   const showTools = canSeeOyonAnalytics || isAdminUser;

   // Portalled panel: an invisible full-screen backdrop for click-away plus the
   // fixed-position menu, both above all in-page stacking contexts.
   const panel = (pos, id, children) =>
      createPortal(
         <>
            {/* Click-away. mousedown as well as click: a mousedown that
                starts on the backdrop and ends elsewhere never fires a
                click, which left the backdrop swallowing input. */}
            <div className="fixed inset-0 z-[9998]" onMouseDown={closeAll} onClick={closeAll} />
            <div
               id={id}
               role="menu"
               className="rohy-menu rohy-topbar-menu-panel"
               // Expanded, the folds can still outgrow a short screen: the
               // panel scrolls rather than running off the bottom edge.
               style={{
                  position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: PANEL_MIN_WIDTH,
                  maxHeight: `calc(100vh - ${pos.top + 8}px)`, overflowY: 'auto',
               }}
            >
               {children}
            </div>
         </>,
         document.body,
      );

   // Test hooks (`data-testid`): every item that LEAVES the case's rooms — for
   // a full-page surface or by signing out — carries one, because its
   // accessible name is translated and the seeded monkey walker
   // (tests/monkey/) must recognise it in any UI language. The language
   // items deliberately carry none: switching language mid-case is part of
   // what the walker exercises. The two fold rows (`menu-language`,
   // `menu-tools`) carry one so tests can open them; they leave nothing.
   // The tools' items render only while their fold is open — a test that
   // presses one presses `menu-tools` first.
   return (
      <div className="flex items-center gap-2">
         <div className="relative">
            <button
               ref={menuBtnRef}
               type="button"
               onClick={toggleMenu}
               data-testid="topbar-menu"
               aria-expanded={showMenu}
               aria-controls="app-main-menu"
               aria-label={t('settings_menu_aria')}
               className={`rohy-topbar-menu-trigger relative text-sm ${showMenu ? 'rohy-topbar-menu-trigger-open' : ''}`}
            >
               {reportProblem?.available && reportProblem.news > 0 && (
                  <span
                     data-testid="report-news-dot"
                     title={t('report_news')}
                     className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-600 border-2 border-white"
                  />
               )}
               <Settings className="w-4 h-4 text-[var(--rohy-accent)]" />
               {/* Current language flag rides on the trigger so the language
                   switch is still glanceable now that the globe is gone. */}
               <span aria-hidden="true">{currentFlag}</span>
               <ChevronDown className={`w-4 h-4 text-[var(--rohy-muted)] transition-transform ${showMenu ? 'rotate-180' : ''}`} />
            </button>
            {/* ISSUE-0018: logout used to live ONLY as the last item of the
                dropdown, below Language / Analytics / Setup — pilot testers
                could not find it. A direct button sits beside the trigger;
                the menu item stays for anyone who looks there first. */}
            {onLogout && (
               <button
                  type="button"
                  onClick={() => onLogout()}
                  data-testid="logout"
                  aria-label={t('logout')}
                  title={t('logout')}
                  className="rohy-topbar-menu-trigger text-sm ml-2"
               >
                  <LogOut className="w-4 h-4 text-[var(--rohy-muted)]" />
                  <span className="max-lg:sr-only">{t('logout')}</span>
               </button>
            )}
            {showMenu && menuPos && panel(menuPos, 'app-main-menu',
               <>
                  {/* Cases shortcut — first item, the quick jump students want. */}
                  {onOpenCases && (
                     <button
                        type="button"
                        onClick={() => { onOpenCases?.(); closeAll(); }}
                        data-testid="menu-cases"
                        role="menuitem"
                        className="rohy-topbar-menu-item"
                     >
                        <Stethoscope className="w-4 h-4" />
                        {t('menu_cases')}
                     </button>
                  )}
                  <button
                     type="button"
                     onClick={() => { onOpenProfile?.(); closeAll(); }}
                     data-testid="menu-profile"
                     role="menuitem"
                     className="rohy-topbar-menu-item"
                  >
                     <User className="w-4 h-4" />
                     {t('my_profile')}
                  </button>
                  <button
                     type="button"
                     onClick={() => { onOpenSettings?.(); closeAll(); }}
                     data-testid="menu-settings"
                     role="menuitem"
                     className="rohy-topbar-menu-item"
                  >
                     <Settings className="w-4 h-4" />
                     {t('open_settings')}
                  </button>
                  <button
                     type="button"
                     onClick={() => { onOpenHelp?.(); closeAll(); }}
                     data-testid="menu-help"
                     role="menuitem"
                     className="rohy-topbar-menu-item"
                  >
                     <HelpCircle className="w-4 h-4" />
                     {t('help_support')}
                  </button>
                  {reportProblem?.available && (
                     <>
                        <button
                           type="button"
                           onClick={() => { closeAll(); reportProblem.onReport?.(); }}
                           data-testid="menu-report-problem"
                           role="menuitem"
                           className="rohy-topbar-menu-item"
                        >
                           <Bug className="w-4 h-4" />
                           {t('report_problem')}
                        </button>
                        <button
                           type="button"
                           onClick={() => { closeAll(); reportProblem.onFeature?.(); }}
                           data-testid="menu-request-feature"
                           role="menuitem"
                           className="rohy-topbar-menu-item"
                        >
                           <Lightbulb className="w-4 h-4" />
                           {t('request_feature')}
                        </button>
                        <button
                           type="button"
                           onClick={() => { closeAll(); reportProblem.onMine?.(); }}
                           data-testid="menu-my-reports"
                           role="menuitem"
                           className="rohy-topbar-menu-item"
                        >
                           <List className="w-4 h-4" />
                           {t('my_reports')}
                           {reportProblem.news > 0 && (
                              <span data-testid="my-reports-new" className="ml-auto text-[11px] font-bold rounded-full px-2 bg-amber-100 text-amber-900">
                                 {t('my_reports_new', { count: reportProblem.news })}
                              </span>
                           )}
                        </button>
                     </>
                  )}
                  {onOpenLessons && (
                     <button
                        type="button"
                        onClick={() => { onOpenLessons?.(); closeAll(); }}
                        data-testid="menu-lessons"
                        role="menuitem"
                        className="rohy-topbar-menu-item"
                     >
                        <BookOpen className="w-4 h-4" />
                        {t('lessons', { defaultValue: 'Lessons' })}
                     </button>
                  )}

                  {/* Language — the old globe menu, as ONE row naming the
                      current language that unfolds the list in place. */}
                  <div className="rohy-menu-divider" />
                  <button
                     type="button"
                     onClick={() => setLanguagesOpen((v) => !v)}
                     data-testid="menu-language"
                     role="menuitem"
                     aria-expanded={languagesOpen}
                     aria-controls="app-main-menu-languages"
                     className="rohy-topbar-menu-item"
                  >
                     <Globe className="w-4 h-4" />
                     {t('menu_language')}
                     <span data-testid="menu-language-current" className="ml-auto font-normal text-[var(--rohy-muted)] whitespace-nowrap">
                        {currentLanguage.flag} {currentLanguage.native}
                     </span>
                     <ChevronDown aria-hidden="true" className={`w-4 h-4 shrink-0 text-[var(--rohy-muted)] transition-transform ${languagesOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {languagesOpen && (
                     <div id="app-main-menu-languages" role="group" aria-label={t('menu_language')}>
                        {Object.entries(LANGUAGES).map(([code, lang]) => (
                           <button
                              key={code}
                              type="button"
                              role="menuitemradio"
                              aria-checked={uiLanguage === code}
                              onClick={() => { onSetLanguage?.(code); closeAll(); }}
                              className="rohy-topbar-menu-item rohy-topbar-menu-subitem"
                           >
                              <Check className={`w-4 h-4 ${uiLanguage === code ? 'opacity-100 text-[var(--rohy-accent)]' : 'opacity-0'}`} />
                              {lang.flag} {langLabel(lang)}
                           </button>
                        ))}
                     </div>
                  )}

                  {/* Educator/admin tools — one row, folded by default; the
                      items inside keep their own visibility rules. */}
                  {showTools && (
                     <button
                        type="button"
                        onClick={() => setToolsOpen((v) => !v)}
                        data-testid="menu-tools"
                        role="menuitem"
                        aria-expanded={toolsOpen}
                        aria-controls="app-main-menu-tools"
                        className="rohy-topbar-menu-item"
                     >
                        <BarChart3 className="w-4 h-4" />
                        {t('menu_tools')}
                        <ChevronDown aria-hidden="true" className={`ml-auto w-4 h-4 shrink-0 text-[var(--rohy-muted)] transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
                     </button>
                  )}
                  {showTools && toolsOpen && (
                     <div id="app-main-menu-tools" role="group" aria-label={t('menu_tools')}>
                        {canSeeOyonAnalytics && (
                           <button
                              type="button"
                              onClick={() => { onOpenEmotionAnalytics?.(); closeAll(); }}
                              data-testid="menu-emotion-analytics"
                              role="menuitem"
                              className="rohy-topbar-menu-item rohy-topbar-menu-subitem"
                           >
                              <Activity className="w-4 h-4" />
                              {t('emotion_analytics')}
                           </button>
                        )}
                        {/* The named Oyon dashboard: Oyon's OWN Analyze
                            dashboards over server data. Sits beside Emotion
                            Analytics (Rohy's own dashboard) rather than
                            replacing it, and shares its educator+ gate. */}
                        {canSeeOyonAnalytics && (
                           <button
                              type="button"
                              onClick={() => { onOpenOyonDashboard?.(); closeAll(); }}
                              data-testid="menu-oyon-dashboard"
                              role="menuitem"
                              className="rohy-topbar-menu-item rohy-topbar-menu-subitem"
                           >
                              <ScanEye className="w-4 h-4" />
                              {t('oyon:dashboard')}
                           </button>
                        )}
                        {isAdminUser && (
                           <button
                              type="button"
                              onClick={() => { onOpenCaseAnalytics?.(); closeAll(); }}
                              data-testid="menu-case-analytics"
                              role="menuitem"
                              className="rohy-topbar-menu-item rohy-topbar-menu-subitem"
                           >
                              <Activity className="w-4 h-4" />
                              {t('case_analytics')}
                           </button>
                        )}
                        {/* Recall the first-run setup checklist — it is
                            dismissible, so it must stay reachable forever. */}
                        {isAdminUser && onOpenSetup && (
                           <button
                              type="button"
                              onClick={() => { onOpenSetup(); closeAll(); }}
                              data-testid="menu-setup"
                              role="menuitem"
                              className="rohy-topbar-menu-item rohy-topbar-menu-subitem"
                           >
                              <ListChecks className="w-4 h-4" />
                              {t('menu_setup')}
                           </button>
                        )}
                     </div>
                  )}

                  <div className="rohy-menu-divider" />
                  <button
                     type="button"
                     onClick={() => { onLogout?.(); closeAll(); }}
                     data-testid="logout"
                     role="menuitem"
                     className="rohy-topbar-menu-item rohy-topbar-menu-item-danger"
                  >
                     <LogOut className="w-4 h-4" />
                     {t('logout')}
                  </button>
               </>
            )}
         </div>
         {trailing}
      </div>
   );
}
