// Single-sourced help article manifest (Stage 4 — P1).
//
// Each article points at a page on the VitePress docs site rather than
// duplicating prose — the docs are the one source of truth (DOCUMENTATION
// -PLAN §2.3). The Help Center filters this list by the viewer's role so a
// student never sees admin/operator articles.
//
// Role gating uses the same rank ladder as the server
// (guest<student<reviewer<educator<admin). `minRank` is the lowest rank
// that should see the article.

export const HELP_ROLE_RANKS = Object.freeze({
  guest: 0,
  student: 1,
  reviewer: 2,
  educator: 3,
  admin: 4,
});

// Where the docs site is served. Behind the deploy hub it is /rohy/docs/;
// overridable for other hosts via Vite env.
export const DOCS_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_DOCS_BASE) ||
  '/rohy/docs/';

/** Build an absolute docs URL from a site-relative path. */
export function docsUrl(path) {
  const clean = String(path).replace(/^\/+/, '');
  return `${DOCS_BASE}${clean}`;
}

export const HELP_ARTICLES = Object.freeze([
  // Trainee (everyone rank >= student)
  { id: 'getting-started', title: 'Getting started', group: 'Using the simulator', minRank: 1, path: 'trainee/getting-started' },
  { id: 'rooms', title: 'The five rooms', group: 'Using the simulator', minRank: 1, path: 'trainee/rooms' },
  { id: 'history', title: 'Taking a history', group: 'Using the simulator', minRank: 1, path: 'trainee/history' },
  { id: 'examination', title: 'Physical examination', group: 'Using the simulator', minRank: 1, path: 'trainee/examination' },
  { id: 'investigations', title: 'Ordering labs & imaging', group: 'Using the simulator', minRank: 1, path: 'trainee/investigations' },
  { id: 'treatments', title: 'Treatments & medications', group: 'Using the simulator', minRank: 1, path: 'trainee/treatments' },
  { id: 'vitals', title: 'Vitals & alarms', group: 'Using the simulator', minRank: 1, path: 'trainee/vitals' },
  { id: 'voice', title: 'Voice mode', group: 'Using the simulator', minRank: 1, path: 'trainee/voice' },
  { id: 'debrief', title: 'Debrief', group: 'Using the simulator', minRank: 1, path: 'trainee/debrief' },
  { id: 'trainee-faq', title: 'FAQ & troubleshooting', group: 'Using the simulator', minRank: 1, path: 'trainee/faq' },
  // Educator (rank >= educator)
  { id: 'cohorts', title: 'Classes & join codes', group: 'Teaching', minRank: 3, path: 'educator/cohorts' },
  { id: 'case-wizard', title: 'Authoring a case', group: 'Teaching', minRank: 3, path: 'educator/case-wizard' },
  { id: 'reporting', title: 'Reporting & analytics', group: 'Teaching', minRank: 3, path: 'educator/reporting' },
  { id: 'classroom-policy', title: 'Classroom policy', group: 'Teaching', minRank: 3, path: 'educator/classroom-policy' },
  { id: 'educator-faq', title: 'Educator FAQ', group: 'Teaching', minRank: 3, path: 'educator/faq' },
  // Admin (rank >= admin)
  { id: 'first-week', title: 'First-week checklist', group: 'Administration', minRank: 4, path: 'admin/first-week' },
  { id: 'users-roles', title: 'Users & roles', group: 'Administration', minRank: 4, path: 'admin/users-roles' },
  { id: 'platform-settings', title: 'Platform settings', group: 'Administration', minRank: 4, path: 'admin/platform-settings' },
]);

/**
 * Articles visible to a given role, grouped for display.
 * @param {string} role one of the rank ladder keys (defaults to student)
 * @returns {{group:string, articles:Array}[]}
 */
export function articlesForRole(role) {
  const rank = HELP_ROLE_RANKS[role] ?? HELP_ROLE_RANKS.student;
  const visible = HELP_ARTICLES.filter((a) => rank >= a.minRank);
  const groups = [];
  for (const a of visible) {
    let g = groups.find((x) => x.group === a.group);
    if (!g) {
      g = { group: a.group, articles: [] };
      groups.push(g);
    }
    g.articles.push(a);
  }
  return groups;
}
