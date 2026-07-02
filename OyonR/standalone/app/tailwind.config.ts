import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/*
 * Tailwind theme is built on top of the CSS variables in src/styles/tokens.css.
 * This lets us swap themes (light/dark) by toggling [data-theme] on <html>
 * without rebuilding Tailwind classes — and keeps the published tokens.css
 * usable from any future non-React surface that wants the same palette.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        ink: {
          0: 'var(--ink-0)',
          1: 'var(--ink-1)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
        },
        line: {
          DEFAULT: 'var(--line)',
          strong: 'var(--line-strong)',
        },
        status: {
          ok: 'var(--status-ok)',
          'ok-dim': 'var(--status-ok-dim)',
          'ok-strong': 'var(--status-ok-strong)',
          warn: 'var(--status-warn)',
          'warn-dim': 'var(--status-warn-dim)',
          bad: 'var(--status-bad)',
          'bad-dim': 'var(--status-bad-dim)',
          info: 'var(--status-info)',
          'info-dim': 'var(--status-info-dim)',
          null: 'var(--status-null)',
          'null-dim': 'var(--status-null-dim)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        popover: 'var(--shadow-popover)',
      },
      // Named scales mapped to the tokens.css vars. Deliberately NOT the
      // numeric keys (1,2,…) so Tailwind's default spacing scale stays
      // intact — these are additive (`p-space-3`, `z-overlay`) and cause no
      // visual change until a class is explicitly switched over in Stage 6.
      spacing: {
        'space-1': 'var(--space-1)',
        'space-2': 'var(--space-2)',
        'space-3': 'var(--space-3)',
        'space-4': 'var(--space-4)',
        'space-5': 'var(--space-5)',
        'space-6': 'var(--space-6)',
      },
      zIndex: {
        base: 'var(--z-base)',
        dock: 'var(--z-dock)',
        overlay: 'var(--z-overlay)',
        modal: 'var(--z-modal)',
        toast: 'var(--z-toast)',
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [animate],
} satisfies Config;
