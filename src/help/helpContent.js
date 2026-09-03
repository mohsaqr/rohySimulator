// Single-sourced help article manifest (Stage 4 — P1).
//
// Each article points at a page on the VitePress docs site rather than
// duplicating prose — the docs are the one source of truth (DOCUMENTATION
// -PLAN §2.3). The Help Center filters this list by the viewer's role so a
// student never sees admin/operator articles.
//
// Titles and group headings are CATALOGUE KEYS (`help` namespace), not prose:
// the drawer chrome is translated even though the linked docs pages are
// English-only for now. Keys are literal strings here — the explicit key map
// pattern i18next-parser.config.js documents for enum-style lookups.
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
  // Trainee (everyone rank >= student). Ordered the way a learner meets the
  // material, and the room entries follow the bottom navigator's own order
  // (RoomNavigator's `order` field) so the drawer and the navigator agree.
  //
  // The plugin rooms (3D, ECG, Pathology, PACS) are listed unconditionally.
  // A learner whose case does not enable one of them still benefits from the
  // article explaining why the tab is absent, and gating the list on the
  // running case would make the drawer's contents depend on which case
  // happened to be open.
  { id: 'getting-started', titleKey: 'article_getting_started', groupKey: 'group_using', minRank: 1, path: 'trainee/getting-started' },
  { id: 'rooms', titleKey: 'article_rooms', groupKey: 'group_using', minRank: 1, path: 'trainee/rooms' },
  { id: 'history', titleKey: 'article_history', groupKey: 'group_using', minRank: 1, path: 'trainee/history' },
  { id: 'bedside', titleKey: 'article_bedside', groupKey: 'group_using', minRank: 1, path: 'trainee/room-3d' },
  { id: 'examination', titleKey: 'article_examination', groupKey: 'group_using', minRank: 1, path: 'trainee/examination' },
  { id: 'investigations', titleKey: 'article_investigations', groupKey: 'group_using', minRank: 1, path: 'trainee/investigations' },
  { id: 'ecg', titleKey: 'article_ecg', groupKey: 'group_using', minRank: 1, path: 'trainee/ecg' },
  { id: 'pathology', titleKey: 'article_pathology', groupKey: 'group_using', minRank: 1, path: 'trainee/pathology' },
  { id: 'pacs', titleKey: 'article_pacs', groupKey: 'group_using', minRank: 1, path: 'trainee/imaging-reading-room' },
  { id: 'treatments', titleKey: 'article_treatments', groupKey: 'group_using', minRank: 1, path: 'trainee/treatments' },
  { id: 'vitals', titleKey: 'article_vitals', groupKey: 'group_using', minRank: 1, path: 'trainee/vitals' },
  { id: 'voice', titleKey: 'article_voice', groupKey: 'group_using', minRank: 1, path: 'trainee/voice' },
  { id: 'debrief', titleKey: 'article_debrief', groupKey: 'group_using', minRank: 1, path: 'trainee/debrief' },
  { id: 'courses', titleKey: 'article_courses', groupKey: 'group_using', minRank: 1, path: 'trainee/courses' },
  { id: 'trainee-faq', titleKey: 'article_trainee_faq', groupKey: 'group_using', minRank: 1, path: 'trainee/faq' },
  // Educator (rank >= educator)
  { id: 'cohorts', titleKey: 'article_cohorts', groupKey: 'group_teaching', minRank: 3, path: 'educator/cohorts' },
  { id: 'case-wizard', titleKey: 'article_case_wizard', groupKey: 'group_teaching', minRank: 3, path: 'educator/case-wizard' },
  { id: 'reporting', titleKey: 'article_reporting', groupKey: 'group_teaching', minRank: 3, path: 'educator/reporting' },
  { id: 'classroom-policy', titleKey: 'article_classroom_policy', groupKey: 'group_teaching', minRank: 3, path: 'educator/classroom-policy' },
  { id: 'educator-faq', titleKey: 'article_educator_faq', groupKey: 'group_teaching', minRank: 3, path: 'educator/faq' },
  // Admin (rank >= admin)
  { id: 'first-week', titleKey: 'article_first_week', groupKey: 'group_administration', minRank: 4, path: 'admin/first-week' },
  { id: 'users-roles', titleKey: 'article_users_roles', groupKey: 'group_administration', minRank: 4, path: 'admin/users-roles' },
  { id: 'platform-settings', titleKey: 'article_platform_settings', groupKey: 'group_administration', minRank: 4, path: 'admin/platform-settings' },
]);

/**
 * Articles visible to a given role, grouped for display.
 * @param {string} role one of the rank ladder keys (defaults to student)
 * @returns {{groupKey:string, articles:Array}[]}  groupKey is a `help` catalogue key
 */
export function articlesForRole(role) {
  const rank = HELP_ROLE_RANKS[role] ?? HELP_ROLE_RANKS.student;
  const visible = HELP_ARTICLES.filter((a) => rank >= a.minRank);
  const groups = [];
  for (const a of visible) {
    let g = groups.find((x) => x.groupKey === a.groupKey);
    if (!g) {
      g = { groupKey: a.groupKey, articles: [] };
      groups.push(g);
    }
    g.articles.push(a);
  }
  return groups;
}
