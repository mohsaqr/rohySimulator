import { describe, it, expect } from 'vitest';
import { friendlyLlmError, extractUpstreamDetail } from './llmErrorMessage';

// `t` echoes the key (plus interpolated detail) so assertions check which
// friendly bucket a raw error was routed to, without needing real i18n.
const t = (key, vars) => (vars?.detail !== undefined ? `${key}:${vars.detail}` : key);

describe('extractUpstreamDetail', () => {
    it('pulls the message out of the OpenAI-style nested error body', () => {
        const raw = `LLM API returned 400: { "error": { "message": "Multiple models are loaded. Please specify a model by providing a 'model' field.", "type": "invalid_request_error" } }`;
        expect(extractUpstreamDetail(raw)).toBe("Multiple models are loaded. Please specify a model by providing a 'model' field.");
    });

    it('handles a flat {message} body', () => {
        expect(extractUpstreamDetail('returned 404: {"message":"model not found"}')).toBe('model not found');
    });

    it('falls back to the raw text when there is no JSON', () => {
        expect(extractUpstreamDetail('fetch failed')).toBe('fetch failed');
    });

    it('is safe on empty / non-string input', () => {
        expect(extractUpstreamDetail('')).toBe('');
        expect(extractUpstreamDetail(null)).toBe('');
    });
});

describe('friendlyLlmError', () => {
    it('maps "multiple models loaded" to the pick-a-model guidance', () => {
        const raw = `LLM API returned 400: { "error": { "message": "Multiple models are loaded. Please specify a model by providing a 'model' field." } }`;
        expect(friendlyLlmError(raw, t)).toBe('err_llm_multiple_models');
    });

    it('maps an unknown-model error to the detect-and-pick guidance', () => {
        expect(friendlyLlmError('returned 404: {"error":{"message":"The model `foo` does not exist"}}', t)).toBe('err_llm_model_not_found');
    });

    it('maps insufficient_quota to the billing message', () => {
        const raw = `LLM API returned 429: { "error": { "message": "You exceeded your current quota", "type": "insufficient_quota" } }`;
        expect(friendlyLlmError(raw, t)).toBe('err_llm_quota');
    });

    it('maps an auth failure to the bad-key message', () => {
        expect(friendlyLlmError('LLM API returned 401: {"error":{"message":"Invalid API key provided"}}', t)).toBe('err_llm_bad_key');
    });

    it('maps a network failure to the unreachable message', () => {
        expect(friendlyLlmError('connect ECONNREFUSED 127.0.0.1:1234', t)).toBe('err_llm_unreachable');
    });

    it('falls back to a wrapped detail for anything unrecognised', () => {
        expect(friendlyLlmError('LLM API returned 500: {"error":{"message":"kernel panic"}}', t)).toBe('err_llm_generic:kernel panic');
    });
});
