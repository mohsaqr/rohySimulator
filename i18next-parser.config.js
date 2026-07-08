// i18next-parser config (I18N_PLAN.md §6 tooling).
//
// Scans JSX/JS for t() calls and keeps src/locales/en/*.json in sync —
// extraction is CI-verifiable (npm run i18n:check fails if a t() call has
// no catalogue entry), not a manual audit.
//
// Conventions the codebase follows (enforced by this config):
//   - Namespace comes from useTranslation('<ns>'); namespaces mirror
//     student-facing component domains (chat, monitor, investigations, …).
//   - STATIC keys only — t(variable) is invisible to the parser. Enum-ish
//     labels use an explicit key map next to the component.
//   - Defaults live in en/<ns>.json (canonical), not inline in t() calls.
//   - analytics/ is excluded: it still uses the laila i18nShim (deferred
//     per the student-facing scope decision) and its t() calls must not
//     pollute the real catalogues.

export default {
    locales: ['en'],
    output: 'src/locales/$LOCALE/$NAMESPACE.json',
    input: [
        'src/**/*.{js,jsx}',
        '!src/**/*.test.{js,jsx}',
        '!src/components/analytics/**',
        '!src/i18n/**',
        '!src/locales/**'
    ],
    defaultNamespace: 'common',
    keySeparator: '.',
    namespaceSeparator: ':',
    contextSeparator: '_',
    // false: plurals are ICU-style INSIDE the message ({count, plural, …});
    // suffix-key generation (_one/_other) would create empty junk entries.
    pluralSeparator: false,
    sort: true,
    // true: enum-style lookups (t(KEY_MAP[x])) are invisible to the parser;
    // pruning would delete their catalogue entries on every extract. Dead
    // keys accumulate harmlessly instead, and i18n:check still fails on
    // *missing* keys (the dangerous direction).
    keepRemoved: true,
    createOldCatalogs: false,
    // A key found in code but missing from the catalogue lands as '' —
    // i18n:check treats any change as failure, so CI catches it either way.
    defaultValue: '',
    verbose: false,
    failOnWarnings: false,
    lexers: {
        js: ['JavascriptLexer'],
        jsx: ['JsxLexer'],
        default: ['JavascriptLexer']
    }
};
