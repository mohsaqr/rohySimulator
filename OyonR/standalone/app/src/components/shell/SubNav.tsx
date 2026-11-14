import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { cn } from '@/lib/cn';
import { analyzeSubTabs } from '@/lib/analyzeTabs';
import { groupSubTabs } from '@/lib/groupTabs';
import { SETTINGS_GROUPS, PIPELINE_SECTIONS } from '@/lib/settingsNav';
import { useSettings, type EditableSettings } from '@/lib/settingsStore';

/*
 * SubNav — the current section's destinations, laid out horizontally.
 *
 * This is the deliberate middle ground between the two things that were both
 * wrong. Five stacked bands was too many LEVELS. Burying the destinations in
 * dropdowns fixed the levels but hid the map: you could no longer see what
 * Analytics or Settings contained without opening something.
 *
 * So: one primary bar, plus ONE contextual row that appears only inside a
 * section that has sub-destinations. Two bands in Analytics, Group and
 * Settings, one everywhere else — against the five we started with — and nothing is hidden.
 *
 * Settings entries wrap rather than scroll. Thirteen items do not fit beside
 * the camera dock on a laptop, and a horizontally scrolling nav row hides
 * destinations behind a gesture with no affordance — exactly the burying this
 * row exists to undo. A second wrapped line is honest and still shows
 * everything.
 */
export function SubNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (pathname.startsWith('/analyze')) return <AnalyticsSubNav pathname={pathname} />;
  if (pathname.startsWith('/settings')) return <SettingsSubNav />;
  if (pathname === '/group' || pathname.startsWith('/group/')) return <GroupSubNav pathname={pathname} />;
  return null;
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <nav
      aria-label={label}
      /*
       * Wrapping is right on a laptop and wrong on a phone. The thirteen
       * Settings entries wrap to THREE stacked rows at 390 px — around 100 px
       * of navigation furniture above a screen only 844 px tall — so below
       * `md` the row scrolls horizontally on one line instead.
       *
       * This is the inverse of the reasoning above, and deliberately so: the
       * comment there rejects scrolling because it hides destinations behind a
       * gesture with no affordance. That objection assumes a mouse. On a touch
       * screen, swiping a nav strip IS the affordance — it is how every phone
       * app presents more tabs than fit — whereas spending an eighth of the
       * display on chrome is a cost the phone cannot absorb.
       */
      className="scroll-strip flex flex-nowrap items-center gap-x-1 gap-y-0.5 border-b border-line bg-surface-0 px-3 py-1 md:flex-wrap md:overflow-visible"
    >
      {children}
    </nav>
  );
}

const itemClass = (active: boolean) =>
  cn(
    // shrink-0 + nowrap: in the phone's single scrolling line, flex would
    // otherwise compress every label and break it mid-word rather than let
    // the row overflow — which is exactly what it is meant to do here.
    'shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm transition-colors md:py-1',
    active
      ? 'bg-status-info-dim font-medium text-status-info'
      : 'text-ink-2 hover:bg-surface-2 hover:text-ink-0',
  );

function AnalyticsSubNav({ pathname }: { pathname: string }) {
  return (
    <Row label="Analytics views">
      {analyzeSubTabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={itemClass(pathname === tab.to)}
          activeProps={{ 'aria-current': 'page' }}
        >
          {tab.label}
        </Link>
      ))}
    </Row>
  );
}

/* Group's sub-pages, the same row as Analytics: one link per page. */
function GroupSubNav({ pathname }: { pathname: string }) {
  return (
    <Row label="Group views">
      {groupSubTabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={itemClass(pathname === tab.to)}
          activeProps={{ 'aria-current': 'page' }}
        >
          {tab.label}
        </Link>
      ))}
    </Row>
  );
}

function SettingsSubNav() {
  const navigate = useNavigate();
  const hash = useRouterState({ select: (s) => s.location.hash }).replace(/^#/, '');
  const editable = useSettings();

  const sections = SETTINGS_GROUPS.flatMap((g) => g.sections);
  const active = sections.some((s) => s.id === hash) ? hash : sections[0].id;

  const enabledOf = (key?: string) =>
    key ? Boolean(editable[key as keyof EditableSettings]) : undefined;

  return (
    <Row label="Settings sections">
      {sections.map((section) => {
        const on = enabledOf(section.toggleKey);
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => navigate({ to: '/settings', hash: section.id })}
            aria-current={active === section.id ? 'page' : undefined}
            className={cn(itemClass(active === section.id), 'inline-flex items-center gap-1.5')}
          >
            {/* The dot answers "is this pipeline even on?" without opening the
                section — the one thing the old vertical column was good for. */}
            {on === undefined ? null : (
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  on ? 'bg-status-ok' : 'bg-surface-3 ring-1 ring-inset ring-line-strong',
                )}
                aria-hidden="true"
              />
            )}
            {section.label}
          </button>
        );
      })}
      {/* Hidden on a phone: `ml-auto` in a horizontally scrolling row does not
          pin anything to the right edge, it just appends a trailing summary
          the user has to swipe past. The same count is on the Settings page. */}
      <span className="hidden pl-2 text-mini tabular-nums text-ink-3 md:ml-auto md:inline">
        {PIPELINE_SECTIONS.filter((s) => enabledOf(s.toggleKey)).length}/
        {PIPELINE_SECTIONS.length} pipelines on
      </span>
    </Row>
  );
}
