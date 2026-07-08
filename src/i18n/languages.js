// Client-side entry point for the language registry (I18N_PLAN.md §2).
// The canonical module lives at server/shared/languages.js because the
// Docker runtime image ships server/ but not src/ — see the comment there.
// Client code imports from HERE so the bundler owns the cross-tree path in
// exactly one place.
export * from '../../server/shared/languages.js';
