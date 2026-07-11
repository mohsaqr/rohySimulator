import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Settings, ChevronDown, User, LogOut, Activity, HelpCircle, Check, BookOpen, Stethoscope } from 'lucide-react';
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
   onOpenCaseAnalytics,
   onLogout,
   uiLanguage,
   onSetLanguage,
}) {
   const { t } = useTranslation('app');
   const [showMenu, setShowMenu] = useState(false);
   const [menuPos, setMenuPos] = useState(null);
   const menuBtnRef = useRef(null);

   const closeAll = useCallback(() => setShowMenu(false), []);

   const toggleMenu = () => {
      setShowMenu((v) => {
         if (!v && menuBtnRef.current) setMenuPos(anchorTo(menuBtnRef.current));
         return !v;
      });
   };

   const langLabel = (lang) =>
      lang.native === lang.name ? lang.native : `${lang.native} (${lang.name})`;

   const currentFlag = (LANGUAGES[uiLanguage] || LANGUAGES.en).flag;

   // Portalled panel: an invisible full-screen backdrop for click-away plus the
   // fixed-position menu, both above all in-page stacking contexts.
   const panel = (pos, id, children) =>
      createPortal(
         <>
            <div className="fixed inset-0 z-[9998]" onClick={closeAll} />
            <div
               id={id}
               role="menu"
               className="rohy-menu rohy-topbar-menu-panel"
               style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, minWidth: PANEL_MIN_WIDTH }}
            >
               {children}
            </div>
         </>,
         document.body,
      );

   return (
      <div className="flex items-center gap-2">
         <div className="relative">
            <button
               ref={menuBtnRef}
               type="button"
               onClick={toggleMenu}
               aria-expanded={showMenu}
               aria-controls="app-main-menu"
               aria-label={t('settings_menu_aria')}
               className={`rohy-topbar-menu-trigger text-sm ${showMenu ? 'rohy-topbar-menu-trigger-open' : ''}`}
            >
               <Settings className="w-4 h-4 text-[var(--rohy-accent)]" />
               {/* Current language flag rides on the trigger so the language
                   switch is still glanceable now that the globe is gone. */}
               <span aria-hidden="true">{currentFlag}</span>
               <ChevronDown className={`w-4 h-4 text-[var(--rohy-muted)] transition-transform ${showMenu ? 'rotate-180' : ''}`} />
            </button>
            {showMenu && menuPos && panel(menuPos, 'app-main-menu',
               <>
                  {/* Cases shortcut — first item, the quick jump students want. */}
                  {onOpenCases && (
                     <button
                        type="button"
                        onClick={() => { onOpenCases?.(); closeAll(); }}
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
                     role="menuitem"
                     className="rohy-topbar-menu-item"
                  >
                     <User className="w-4 h-4" />
                     {t('my_profile')}
                  </button>
                  <button
                     type="button"
                     onClick={() => { onOpenSettings?.(); closeAll(); }}
                     role="menuitem"
                     className="rohy-topbar-menu-item"
                  >
                     <Settings className="w-4 h-4" />
                     {t('open_settings')}
                  </button>
                  <button
                     type="button"
                     onClick={() => { onOpenHelp?.(); closeAll(); }}
                     role="menuitem"
                     className="rohy-topbar-menu-item"
                  >
                     <HelpCircle className="w-4 h-4" />
                     {t('help_support')}
                  </button>
                  {onOpenLessons && (
                     <button
                        type="button"
                        onClick={() => { onOpenLessons?.(); closeAll(); }}
                        role="menuitem"
                        className="rohy-topbar-menu-item"
                     >
                        <BookOpen className="w-4 h-4" />
                        {t('lessons', { defaultValue: 'Lessons' })}
                     </button>
                  )}

                  {/* Language section — the old globe menu, folded inline. */}
                  <div className="rohy-menu-divider" />
                  <div className="rohy-menu-section-label">{t('menu_language')}</div>
                  {Object.entries(LANGUAGES).map(([code, lang]) => (
                     <button
                        key={code}
                        type="button"
                        role="menuitemradio"
                        aria-checked={uiLanguage === code}
                        onClick={() => { onSetLanguage?.(code); closeAll(); }}
                        className="rohy-topbar-menu-item"
                     >
                        <Check className={`w-4 h-4 ${uiLanguage === code ? 'opacity-100 text-[var(--rohy-accent)]' : 'opacity-0'}`} />
                        {lang.flag} {langLabel(lang)}
                     </button>
                  ))}

                  {(canSeeOyonAnalytics || isAdminUser) && (
                     <>
                        <div className="rohy-menu-divider" />
                        {canSeeOyonAnalytics && (
                           <button
                              type="button"
                              onClick={() => { onOpenEmotionAnalytics?.(); closeAll(); }}
                              role="menuitem"
                              className="rohy-topbar-menu-item"
                           >
                              <Activity className="w-4 h-4" />
                              {t('emotion_analytics')}
                           </button>
                        )}
                        {isAdminUser && (
                           <button
                              type="button"
                              onClick={() => { onOpenCaseAnalytics?.(); closeAll(); }}
                              role="menuitem"
                              className="rohy-topbar-menu-item"
                           >
                              <Activity className="w-4 h-4" />
                              {t('case_analytics')}
                           </button>
                        )}
                     </>
                  )}

                  <div className="rohy-menu-divider" />
                  <button
                     type="button"
                     onClick={() => { onLogout?.(); closeAll(); }}
                     role="menuitem"
                     className="rohy-topbar-menu-item rohy-topbar-menu-item-danger"
                  >
                     <LogOut className="w-4 h-4" />
                     {t('logout')}
                  </button>
               </>
            )}
         </div>
      </div>
   );
}
