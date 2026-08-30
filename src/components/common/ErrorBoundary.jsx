import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The app's one error boundary. Before it existed, a single render throw
 * anywhere — most concretely a legacy-shaped pathology slide whose viewer
 * throws on a missing optical profile — blanked the entire SPA, contradicting
 * RPS-1's peaceful-exclusion contract.
 *
 * Class component because React only exposes error boundaries through
 * lifecycle methods; the exported wrapper is a function component so callers
 * get i18n'd fallback copy without the class needing hooks.
 */
class Boundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
        this.reset = this.reset.bind(this);
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        // console.error deliberately: this is the one place a raw console
        // call is right — the boundary must not itself depend on services
        // that may be what just crashed.
        console.error('[ErrorBoundary]', this.props.scope || 'app', error, info?.componentStack);
        if (typeof this.props.onError === 'function') {
            try { this.props.onError(error, info); } catch { /* never rethrow from the handler */ }
        }
    }

    reset() {
        this.setState({ error: null });
    }

    render() {
        if (this.state.error === null) return this.props.children;
        const { title, body, retryLabel } = this.props;
        return (
            <div role="alert" className="flex flex-col items-center justify-center gap-3 p-8 text-center h-full min-h-[12rem]">
                <div className="text-lg font-semibold">{title}</div>
                <div className="text-sm opacity-80 max-w-prose">{body}</div>
                <button
                    type="button"
                    onClick={this.reset}
                    className="mt-2 px-4 py-2 rounded-lg border font-medium"
                >
                    {retryLabel}
                </button>
            </div>
        );
    }
}

/**
 * @param {object} props
 * @param {string} [props.scope]   short label for logs ("plugin:pathology", "app")
 * @param {Function} [props.onError] optional side-channel (event logging)
 * @param {import('react').ReactNode} props.children
 */
export default function ErrorBoundary({ scope, onError, children }) {
    const { t } = useTranslation('common');
    return (
        <Boundary
            scope={scope}
            onError={onError}
            title={t('error_boundary_title')}
            body={t('error_boundary_body')}
            retryLabel={t('error_boundary_retry')}
        >
            {children}
        </Boundary>
    );
}
