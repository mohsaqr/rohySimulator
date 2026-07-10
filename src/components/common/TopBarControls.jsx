import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Settings, ChevronDown, User, LogOut, Activity, HelpCircle, Globe, Check, BookOpen } from 'lucide-react';
import { LANGUAGES } from '../../i18n/languages';

// Persistent top-bar controls: a language switcher (globe) + the settings/
// account menu (gear). Built ONCE in MainApp and passed into every screen's
// header via the same `roomNav`-style prop convention, so the settings menu
// and language switch are reachable from every authenticated screen — not
// just the chat room where they used to be nested inside PatientVisual.
//
// Handlers stay owned by MainApp (they drive MainApp-local route state);
// this component is purely presentational + owns its own open/close state.
//
// The dropdown PANELS are rendered through a portal to document.body. The
// room screens (exam/lab/discussion) use backdrop-blur "glass" panels, and
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
   const [showLang, setShowLang] = useState(false);
   const [langPos, setLangPos] = useState(null);
   const [menuPos, setMenuPos] = useState(null);
   const langBtnRef = useRef(null);
   const menuBtnRef = useRef(null);

   const closeAll = useCallback(() => {
      setShowMenu(false);
      setShowLang(false);
   }, []);

   const toggleLang = () => {
      setShowMenu(false);
      setShowLang((v) => {
         if (!v && langBtnRef.current) setLangPos(anchorTo(langBtnRef.current));
         return !v;
      });
   };
   const toggleMenu = () => {
      setShowLang(false);
      setShowMenu((v) => {
         if (!v && menuBtnRef.current) setMenuPos(anchorTo(menuBtnRef.current));
         return !v;
      });
   };

   const langLabel = (lang) =>
      lang.native === lang.name ? lang.native : `${lang.native} (${lang.name})`;

   // Portalled panel: an invisible full-screen backdrop for click-away plus
   // the fixed-position menu, both above all in-page stacking contexts.
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
         {/* Language switcher — small globe, opens a native-language list.
             System-wide: writes the single global UI language via the same
             setUiLanguage the login screen and profile use. */}
         <div className="relative">
            <button
               ref={langBtnRef}
               type="button"
               onClick={toggleLang}
               aria-expanded={showLang}
               aria-controls="app-language-menu"
               aria-label={t('language_menu_aria')}
               className={`rohy-topbar-menu-trigger text-sm ${showLang ? 'rohy-topbar-menu-trigger-open' : ''}`}
            >
               <Globe className="w-4 h-4 text-[var(--rohy-accent)]" />
               <span aria-hidden="true">{(LANGUAGES[uiLanguage] || LANGUAGES.en).flag}</span>
               <ChevronDown className={`w-4 h-4 text-[var(--rohy-muted)] transition-transform ${showLang ? 'rotate-180' : ''}`} />
            </button>
            {showLang && langPos && panel(langPos, 'app-language-menu',
               Object.entries(LANGUAGES).map(([code, lang]) => (
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
               ))
            )}
         </div>

         {/* Settings / account menu — the gear. Now persistent across every
             screen (previously only rendered inside the chat room). */}
         <div className="relative">
            <button
               ref={menuBtnRef}
               type="button"
               onClick={toggleMenu}
               aria-expanded={showMenu}
               aria-controls="app-user-menu"
               aria-label={t('settings_menu_aria')}
               className={`rohy-topbar-menu-trigger text-sm ${showMenu ? 'rohy-topbar-menu-trigger-open' : ''}`}
            >
               <Settings className="w-4 h-4 text-[var(--rohy-accent)]" />
               <span>{t('settings')}</span>
               <ChevronDown className={`w-4 h-4 text-[var(--rohy-muted)] transition-transform ${showMenu ? 'rotate-180' : ''}`} />
            </button>
            {showMenu && menuPos && panel(menuPos, 'app-user-menu',
               <>
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
                  {(canSeeOyonAnalytics || isAdminUser) && (
                     <div className="rohy-menu-divider" />
                  )}
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
                  {(canSeeOyonAnalytics || isAdminUser) && (
                     <div className="rohy-menu-divider" />
                  )}
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
