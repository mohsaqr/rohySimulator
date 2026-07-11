// Contract for the shared model picker (ModelSelect) used by both the admin
// LLM screen and the per-user AI tab. It is a single editable combobox:
//   1. One editable text field — always typeable.
//   2. The catalogue is offered as <datalist> suggestions for the provider.
//   3. Typing any value (on- or off-catalogue) is reported.
//   4. A saved off-catalogue model is shown as-is (never lost).
//   5. A provider with no catalogue has no suggestion list, just the box.
//   6. Switching provider swaps the suggestion list.

import React, { useState } from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ModelSelect from './ModelSelect';

// Controlled wrapper so onChange actually updates the rendered value, the way
// the real parents (ConfigPanel / UserProfilePanel) wire it.
function Harness({ provider: initialProvider, model: initialModel }) {
    const [provider, setProvider] = useState(initialProvider);
    const [model, setModel] = useState(initialModel);
    return (
        <div>
            <button onClick={() => { setProvider('lmstudio'); setModel(''); }}>to-lmstudio</button>
            <button onClick={() => { setProvider('openai'); setModel('gpt-5.6-sol'); }}>to-openai</button>
            <ModelSelect provider={provider} value={model} onChange={setModel} id="m" />
            <output data-testid="model">{model}</output>
        </div>
    );
}

// datalist <option> elements aren't exposed with a reliable ARIA role, so query
// the suggestion list directly.
const suggestions = (container) =>
    Array.from(container.querySelectorAll('datalist option')).map((o) => o.value);

describe('ModelSelect', () => {
    it('offers the provider catalogue as datalist suggestions', () => {
        const { container } = render(<Harness provider="anthropic" model="claude-opus-4-8" />);
        const ids = suggestions(container);
        expect(ids).toContain('claude-opus-4-8');
        expect(ids).toContain('claude-sonnet-5');
        // the input is wired to that datalist
        const input = screen.getByLabelText('Model name');
        expect(input.getAttribute('list')).toBe('m-options');
    });

    it('is always editable and reports what is typed', () => {
        render(<Harness provider="anthropic" model="claude-opus-4-8" />);
        const input = screen.getByLabelText('Model name');
        expect(input).toHaveValue('claude-opus-4-8');
        // edit to a dated snapshot the catalogue does not list
        fireEvent.change(input, { target: { value: 'claude-opus-4-8-20260601' } });
        expect(screen.getByTestId('model')).toHaveTextContent('claude-opus-4-8-20260601');
    });

    it('shows a saved off-catalogue model as-is without losing it', () => {
        render(<Harness provider="anthropic" model="claude-legacy-xyz" />);
        expect(screen.getByLabelText('Model name')).toHaveValue('claude-legacy-xyz');
    });

    it('has no suggestion list for a provider with no curated catalogue', () => {
        const { container } = render(<Harness provider="lmstudio" model="local-model" />);
        expect(suggestions(container)).toEqual([]);
        const input = screen.getByLabelText('Model name');
        expect(input).toHaveValue('local-model');
        expect(input.hasAttribute('list')).toBe(false);
    });

    it('swaps the suggestion list when the provider changes', () => {
        const { container } = render(<Harness provider="anthropic" model="claude-opus-4-8" />);
        expect(suggestions(container)).toContain('claude-opus-4-8');
        // switch to lmstudio (no catalogue) → no suggestions
        fireEvent.click(screen.getByText('to-lmstudio'));
        expect(suggestions(container)).toEqual([]);
        // switch to openai → openai suggestions appear
        fireEvent.click(screen.getByText('to-openai'));
        const ids = suggestions(container);
        expect(ids).toContain('gpt-5.6-sol');
        expect(ids).toContain('gpt-4.1-mini');
    });
});
