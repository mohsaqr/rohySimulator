// Client-side entry point for the LLM provider + model catalogue.
// The canonical module lives at server/shared/llmCatalogue.js because the
// Docker runtime image ships server/ but not src/ — see the comment there.
// Client code imports from HERE so the bundler owns the cross-tree path in
// exactly one place (mirrors src/i18n/languages.js).
export * from '../../server/shared/llmCatalogue.js';
