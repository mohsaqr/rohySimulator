import { Fragment } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  BarChart3,
  Camera,
  FlaskConical,
  HelpCircle,
  Info,
  ListChecks,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useConsent } from '@/lib/consentStore';
import { Brand } from './Brand';
import { MenuPopover } from './MenuPopover';
import { FilterControls } from './FilterBar';
import { SessionContextPanel } from './SessionContextPanel';
import { useFilteredWindows } from '@/lib/useFilteredWindows';
import { useCameraDock } from '@/lib/CameraDockContext';

/*
 * TopMenu — the app's ONE bar.
 *
 * It replaces five stacked bands that between them ate ~194 px before any
 * content appeared:
 *
 *   TopBar        brand + 8 session-context pills   -> "Session" popover
 *   TopMenu       5 workflow links                  -> stays, inline
 *   FilterBar     scope / sessions / users          -> "Scope" popover
 *   PageHeader    eyebrow + title + description     -> deleted
 *   domain tabs   9 Analytics domains               -> <SubNav>, contextual
 *
 * The principle: a band earns permanent vertical space only if you look at it
 * on most screens. Session provenance and filter scope do not — they are
 * reference material, needed sometimes and read rarely, so they became
 * triggers costing one click and no pixels.
 *
 * NAVIGATION is the exception, and it stays visible. Analytics, Group and
 * Settings are plain links here; their destinations appear in a horizontal
 * <SubNav> row beneath this bar while you are inside them. Putting them in dropdowns
 * fixed the level count but hid the map — you could no longer see what a
 * section contained without opening something. Two bands inside those
 * sections, one everywhere else.
 */

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

/*
 * Below 1280 px the labels step aside and the icons carry the bar; the full
 * bar needs 1264 px, so `xl` is the first breakpoint that actually fits it.
 *
 * `sr-only`, deliberately, NOT `hidden`. The text stays in the DOM and stays
 * the element's accessible name, so a screen reader announces "Diagnostics"
 * at every width — only the pixels are reclaimed. `hidden` would have left
 * eight identically-unnamed icon buttons.
 */
const NAV_LABEL = 'sr-only xl:not-sr-only';

/*
 * "Analytics", not "Analyze" — the section is a place you go to look at
 * results, not an action you perform. The ROUTE stays /analyze so every
 * existing deep link keeps working.
 */
/*
 * Order (owner, 2026-11-14): Live (with the camera Preview beside it),
 * Analytics, Group, then the tools (Settings, Diagnostics), the information
 * pages (Help, Consent, About), and Sessions last — beside the windows scope
 * on the right, which narrows by session too.
 */
export const ITEMS: ReadonlyArray<NavItem> = [
  { to: '/live', label: 'Live', icon: Sparkles },
  { to: '/analyze', label: 'Analytics', icon: BarChart3 },
  { to: '/group', label: 'Group', icon: Users },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/diagnostics', label: 'Diagnostics', icon: FlaskConical },
  { to: '/help', label: 'Help', icon: HelpCircle },
  { to: '/about', label: 'About', icon: Info },
  { to: '/sessions', label: 'Sessions', icon: ListChecks },
];

/** The camera-preview toggle: beside Live in the main nav, on the right where the nav is hidden (phones). */
function PreviewToggle({ className }: { className?: string }) {
  const cameraDock = useCameraDock();
  return (
    <button
      type="button"
      onClick={() => cameraDock.setVisible((visible) => !visible)}
      className={cn(
        'touch-target inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
        cameraDock.visible
          ? 'text-ink-1 hover:bg-surface-2'
          : 'bg-status-info-dim font-medium text-status-info hover:brightness-110',
        className,
      )}
      aria-label={cameraDock.visible ? 'Hide camera preview' : 'Show camera preview'}
      aria-pressed={cameraDock.visible}
      title={cameraDock.visible ? 'Hide camera preview' : 'Show camera preview'}
    >
      <Camera className="size-4" aria-hidden="true" />
      <span className="sr-only lg:not-sr-only">Preview</span>
    </button>
  );
}

/*
 * The four destinations that earn a permanent slot in the phone tab bar.
 *
 * Five slots is the practical ceiling for a thumb-reachable bar at 390 px, and
 * the fifth is spent on "More" rather than a fifth destination — with seven
 * items, a bar that showed five would still need an overflow affordance, and
 * two half-hidden lists are worse than one honest one.
 *
 * Diagnostics, Help, About and Consent are the ones that move into More: they
 * are places you visit deliberately and once, not places you switch between
 * while a capture is running.
 *
 * Declared here, beside ITEMS, so the phone bar and the desktop bar cannot
 * disagree about what the app's destinations ARE — MobileTabBar derives both
 * of its lists from this pair rather than restating any route.
 */
export const PHONE_PRIMARY: ReadonlyArray<string> = [
  '/live',
  '/analyze',
  '/sessions',
  '/settings',
];

/** Shared active test — a section owns its own sub-routes. */
export function isNavActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/*
 * Consent sits in the nav but is NOT a route — it opens the agreement over
 * whatever you are looking at. A participant asking "what is this recording?"
 * should not have to leave the page to find out, and coming back from a
 * separate page would lose their place. Rendered between Help and About
 * because it belongs with the other "about this instrument" affordances.
 */
function ConsentNavButton() {
  return (
    <button
      type="button"
      onClick={() => useConsent.getState().requestGate()}
      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-1 transition-colors hover:bg-surface-2"
      title="Show what may be measured"
    >
      <ShieldCheck className="size-4" aria-hidden="true" />
      <span className={NAV_LABEL}>Consent</span>
    </button>
  );
}

export function TopMenu() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Scope only means something where stored windows are rendered.
  const showScope =
    pathname.startsWith('/analyze') || pathname.startsWith('/sessions');

  return (
    <header
      className="flex items-center gap-2 border-b border-line bg-surface-1 px-3 py-1.5 pt-safe"
      role="banner"
    >
      <Brand compact />

      {/*
       * The bar's intrinsic width is 1264 px on /analyze (brand 126 + nav 746
       * + scope/preview/session 352 + padding), so below that it used to widen
       * the document and scroll the whole PAGE sideways.
       *
       * Two guards, because one is not enough:
       *   min-w-0 + overflow-x-auto lets the nav scroll INSIDE itself instead
       *   of pushing its ancestors wider — the page can now never scroll
       *   horizontally at any width.
       *
       * `overflow-hidden` on the <header> would have been the obvious fix and
       * is wrong: the Scope and Session panels are absolutely positioned
       * descendants, and a clipping ancestor would cut them off.
       *
       * Hidden below `md`, where <MobileTabBar> owns navigation instead. This
       * row degrades badly on a phone rather than merely getting tight: the
       * labels are `sr-only` until `xl`, so at 390 px it renders as eight
       * visually identical unlabelled icons in a scroller with no affordance.
       * The tab bar shows four labelled destinations in the thumb zone.
       */}
      <nav
        aria-label="Main"
        className="hidden min-w-0 items-center gap-0.5 overflow-x-auto md:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ITEMS.map((item) => (
          <Fragment key={item.to}>
            {item.to === '/about' ? <ConsentNavButton /> : null}
            <NavLink item={item} pathname={pathname} />
            {item.to === '/live' ? <PreviewToggle /> : null}
          </Fragment>
        ))}
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {showScope ? <ScopeMenu /> : null}
        <PreviewToggle className="md:hidden" />
        <MenuPopover
          /*
           * The word drops below `sm`; the icon carries the trigger there.
           * With the brand, Scope and camera controls, the full-text bar is
           * 402 px against 366 px of usable width on a 390 px phone — and the
           * cluster is `shrink-0`, so the excess became document overflow
           * rather than a tighter bar.
           *
           * `ariaLabel` pins the accessible name to "Session" at every width,
           * so hiding the text cannot rename the control for a screen reader
           * (or for the e2e test that finds it by that name).
           */
          label={<span className="hidden sm:inline">Session</span>}
          ariaLabel="Session"
          icon={<UserRound className="size-4" aria-hidden="true" />}
          align="right"
          panelClassName="w-[22rem] p-3"
        >
          {() => <SessionContextPanel />}
        </MenuPopover>
      </div>
    </header>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = isNavActive(pathname, item.to);
  return (
    <Link
      to={item.to}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
        active
          ? 'bg-status-info-dim font-medium text-status-info'
          : 'text-ink-1 hover:bg-surface-2',
      )}
      activeProps={{ 'aria-current': 'page' }}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className={NAV_LABEL}>{item.label}</span>
    </Link>
  );
}

/*
 * The window count stays on the TRIGGER, not inside the panel. It is the one
 * number from the old filter bar worth seeing without asking: it says whether
 * a filter is hiding data, which is precisely the state in which you would
 * otherwise misread a dashboard.
 */
function ScopeMenu() {
  const { allWindows, filtered } = useFilteredWindows();
  const narrowed = filtered.length !== allWindows.length;

  return (
    <MenuPopover
      align="right"
      panelClassName="w-[26rem] p-2.5"
      active={narrowed}
      ariaLabel="Scope and filters"
      icon={<SlidersHorizontal className="size-4" aria-hidden="true" />}
      label={
        <span className="tabular-nums">
          {narrowed
            ? `${filtered.length} / ${allWindows.length}`
            : allWindows.length}
          {/* The COUNT is the signal — it says whether a filter is hiding
              data. The noun is context the icon already supplies, so it is
              the part that goes on a phone. */}
          <span className="hidden sm:inline"> windows</span>
        </span>
      }
    >
      {() => (
        <div className="flex flex-wrap items-center gap-2">
          <FilterControls compact />
        </div>
      )}
    </MenuPopover>
  );
}
