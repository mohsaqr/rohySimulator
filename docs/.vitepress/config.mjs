// VitePress configuration for the Rohy enterprise documentation site.
//
// IA contract: nav is organised by AUDIENCE journey (trainee → educator →
// admin → operator → integrator → security), not by feature. See
// docs/DOCUMENTATION-PLAN.md §2.2 for the authoritative tree.
//
// Constraints honoured here:
//  - Local search only (built-in MiniSearch) — no external service, so the
//    site builds and searches fully offline for air-gapped self-hosters.
//  - base is overridable via DOCS_BASE so the same build serves at
//    /rohy/docs/ behind the deploy hub or at / in local preview.
import { defineConfig } from 'vitepress';

const base = process.env.DOCS_BASE || '/rohy/docs/';

export default defineConfig({
  base,
  lang: 'en-US',
  title: 'Rohy',
  description:
    'Rohy — Virtual Patient Simulation Platform. Enterprise documentation: ' +
    'trainee, educator, administrator, operator, integrator and security guides.',
  cleanUrls: true,
  lastUpdated: true,
  // The legacy operator manuals contain shell-style <placeholder> tokens
  // that the Vue SFC compiler reads as unclosed components. They remain the
  // authoritative source in-repo and on GitHub; Stage 3 (G4) reconciles them
  // into VitePress-safe runbook pages. Excluded from the build until then.
  srcExclude: [
    'INSTALL.md',
    'DEPLOY.md',
    'UPDATING.md',
    'UPDATE-STRATEGY.md',
    'ADMIN_FIRST_RUN.md',
    'DOCUMENTATION-PLAN.md',
    'audits/**',
  ],
  // Many section pages are scaffolded ahead of their authoring stage.
  // Dead-link enforcement is switched on in Stage 7 (CI) once content lands.
  ignoreDeadLinks: true,
  head: [
    ['meta', { name: 'robots', content: 'noindex' }],
    ['meta', { name: 'color-scheme', content: 'light dark' }],
  ],
  themeConfig: {
    siteTitle: 'Rohy Docs',
    outline: { level: [2, 3], label: 'On this page' },
    search: {
      provider: 'local',
    },
    nav: [
      { text: 'Trainee', link: '/trainee/' },
      { text: 'Educator', link: '/educator/' },
      { text: 'Admin', link: '/admin/' },
      { text: 'Operator', link: '/operator/' },
      { text: 'Integrator', link: '/integrator/' },
      {
        text: 'Reference',
        items: [
          { text: 'API', link: '/reference/api/' },
          { text: 'Data model', link: '/reference/data/' },
          { text: 'Config & env', link: '/reference/config/' },
          { text: 'CLI & ops', link: '/reference/cli/' },
          { text: 'Glossary', link: '/reference/glossary' },
        ],
      },
      { text: 'Security', link: '/security/' },
      { text: 'Release notes', link: '/release-notes/' },
    ],
    sidebar: {
      '/trainee/': [
        {
          text: 'Using the Simulator',
          items: [
            { text: 'Overview', link: '/trainee/' },
            { text: 'Getting started', link: '/trainee/getting-started' },
            { text: 'The five rooms', link: '/trainee/rooms' },
            { text: 'Taking a history', link: '/trainee/history' },
            { text: 'Physical examination', link: '/trainee/examination' },
            { text: 'Ordering labs & imaging', link: '/trainee/investigations' },
            { text: 'Treatments & medications', link: '/trainee/treatments' },
            { text: 'Vitals & alarms', link: '/trainee/vitals' },
            { text: 'Voice mode', link: '/trainee/voice' },
            { text: 'Debrief', link: '/trainee/debrief' },
            { text: 'FAQ & troubleshooting', link: '/trainee/faq' },
          ],
        },
      ],
      '/educator/': [
        {
          text: 'Teaching with Rohy',
          items: [
            { text: 'Overview', link: '/educator/' },
            { text: 'Classes (cohorts) & join codes', link: '/educator/cohorts' },
            { text: 'Assigning cases', link: '/educator/assigning-cases' },
            { text: 'Authoring a case (wizard)', link: '/educator/case-wizard' },
            { text: 'Agent personas', link: '/educator/agents' },
            { text: 'Scenario timelines', link: '/educator/scenarios' },
            { text: 'Reporting & analytics', link: '/educator/reporting' },
            { text: 'TNA analytics', link: '/educator/tna' },
            { text: 'Oyon emotion analytics', link: '/educator/oyon-analytics' },
            { text: 'Classroom policy', link: '/educator/classroom-policy' },
            { text: 'FAQ & troubleshooting', link: '/educator/faq' },
          ],
        },
      ],
      '/admin/': [
        {
          text: 'Administering Rohy',
          items: [
            { text: 'Overview', link: '/admin/' },
            { text: 'First-week checklist', link: '/admin/first-week' },
            { text: 'Users & roles (RBAC)', link: '/admin/users-roles' },
            { text: 'Platform settings', link: '/admin/platform-settings' },
            { text: 'Lab & medication editors', link: '/admin/catalogue-editors' },
            { text: 'Voice / TTS providers', link: '/admin/voice-providers' },
            { text: 'Multi-tenant operations', link: '/admin/multi-tenant' },
            { text: 'System logs', link: '/admin/system-logs' },
          ],
        },
      ],
      '/operator/': [
        {
          text: 'Running Rohy in Production',
          items: [
            { text: 'Overview', link: '/operator/' },
            { text: 'Install ↗', link: 'https://github.com/mohsaqr/rohy/blob/main/docs/INSTALL.md' },
            { text: 'Deploy & harden ↗', link: 'https://github.com/mohsaqr/rohy/blob/main/docs/DEPLOY.md' },
            { text: 'Update ↗', link: 'https://github.com/mohsaqr/rohy/blob/main/docs/UPDATING.md' },
            { text: 'Update strategy ↗', link: 'https://github.com/mohsaqr/rohy/blob/main/docs/UPDATE-STRATEGY.md' },
            { text: 'Backup & restore', link: '/operator/backup-restore' },
            { text: 'Migrations runbook', link: '/operator/migrations' },
            { text: 'Retention & purges', link: '/operator/retention' },
            { text: 'Observability', link: '/operator/observability' },
            { text: 'Incident playbooks', link: '/operator/incidents' },
          ],
        },
      ],
      '/integrator/': [
        {
          text: 'Building on Rohy',
          items: [
            { text: 'Overview', link: '/integrator/' },
            { text: 'Architecture seams', link: '/integrator/architecture' },
            { text: 'API authentication', link: '/integrator/api-auth' },
            { text: 'Embedding the avatar kit', link: '/integrator/embedding' },
            { text: 'Adding a TTS/LLM provider', link: '/integrator/providers' },
            { text: 'Contributing & tests', link: '/integrator/contributing' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference (generated)',
          items: [
            { text: 'API', link: '/reference/api/' },
            { text: 'Data model', link: '/reference/data/' },
            { text: 'Config & env', link: '/reference/config/' },
            { text: 'CLI & ops', link: '/reference/cli/' },
            { text: 'Glossary', link: '/reference/glossary' },
          ],
        },
      ],
      '/security/': [
        {
          text: 'Security & Compliance',
          items: [
            { text: 'Overview', link: '/security/' },
            { text: 'RBAC & auth model', link: '/security/rbac' },
            { text: 'Audit chain', link: '/security/audit-chain' },
            { text: 'Redaction & PII', link: '/security/redaction' },
            { text: 'Data retention', link: '/security/retention' },
            { text: 'Oyon & EU AI Act', link: '/security/oyon-ai-act' },
            { text: 'Medical-training disclaimer', link: '/security/disclaimer' },
            { text: 'Hardening checklist', link: '/security/hardening' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/mohsaqr' },
    ],
    footer: {
      message:
        'Rohy is a medical-education simulation tool. It does not provide ' +
        'medical advice and must not be used for real patient care.',
      copyright: 'MIT licensed · © Mohammed Saqr',
    },
    docFooter: { prev: true, next: true },
    editLink: {
      pattern:
        'https://github.com/mohsaqr/rohy/edit/main/docs/:path',
      text: 'Edit this page',
    },
  },
});
