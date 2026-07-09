import { useTheme } from '../../../hooks/useTheme';

/**
 * Per-accent color tokens with light/dark variants. Mirrors the tinted-card
 * language used across the app (StatTile, ContentCard) so the in-lesson
 * blocks read as one cohesive, professional family.
 */
const ACCENTS = {
  teal: {
    light: { bg: '#f0fdfa', border: '#99f6e4', chipBg: '#ccfbf1', fg: '#0f766e' },
    dark: { bg: 'rgba(13,148,136,0.10)', border: 'rgba(13,148,136,0.35)', chipBg: 'rgba(13,148,136,0.25)', fg: '#5eead4' },
  },
  violet: {
    light: { bg: '#faf5ff', border: '#e9d5ff', chipBg: '#ede9fe', fg: '#7c3aed' },
    dark: { bg: 'rgba(167,139,250,0.10)', border: 'rgba(167,139,250,0.30)', chipBg: 'rgba(167,139,250,0.22)', fg: '#c4b5fd' },
  },
  cyan: {
    light: { bg: '#f0fdfa', border: '#a5f3fc', chipBg: '#cffafe', fg: '#0e7490' },
    dark: { bg: 'rgba(8,145,178,0.10)', border: 'rgba(8,145,178,0.32)', chipBg: 'rgba(8,145,178,0.24)', fg: '#67e8f9' },
  },
  sky: {
    light: { bg: '#f0f9ff', border: '#bae6fd', chipBg: '#e0f2fe', fg: '#0369a1' },
    dark: { bg: 'rgba(2,132,199,0.10)', border: 'rgba(2,132,199,0.32)', chipBg: 'rgba(2,132,199,0.24)', fg: '#7dd3fc' },
  },
  amber: {
    light: { bg: '#fffbeb', border: '#fde68a', chipBg: '#fef3c7', fg: '#b45309' },
    dark: { bg: 'rgba(217,119,6,0.10)', border: 'rgba(217,119,6,0.32)', chipBg: 'rgba(217,119,6,0.24)', fg: '#fcd34d' },
  },
  rose: {
    light: { bg: '#fff1f2', border: '#fecdd3', chipBg: '#ffe4e6', fg: '#be123c' },
    dark: { bg: 'rgba(225,29,72,0.10)', border: 'rgba(225,29,72,0.32)', chipBg: 'rgba(225,29,72,0.24)', fg: '#fda4af' },
  },
};

/**
 * Shared presentational shell for an in-lesson content block (MCQ, AI agent,
 * file, video). Rounded tinted card with an icon chip, title, optional badge,
 * an actions slot, and a body. Theme-aware. Purely presentational — all
 * behavior lives in the wrapped node view.
 */
export const BlockCard = ({
  icon: Icon, accent, title, badge, actions, children, className = '',
}) => {
  const { isDark } = useTheme();
  const c = ACCENTS[accent][isDark ? 'dark' : 'light'];

  return (
    <div
      className={`rounded-xl border overflow-hidden ${className}`}
      style={{ backgroundColor: c.bg, borderColor: c.border }}
    >
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span
          className="inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0"
          style={{ backgroundColor: c.chipBg, color: c.fg }}
        >
          <Icon className="w-4 h-4" />
        </span>
        <span className="text-sm font-semibold truncate min-w-0 flex-1" style={{ color: c.fg }} title={title}>
          {title}
        </span>
        {badge && (
          <span
            className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: c.chipBg, color: c.fg }}
          >
            {badge}
          </span>
        )}
        {actions && <span className="ml-auto inline-flex items-center gap-1">{actions}</span>}
      </div>
      <div className="px-3.5 pb-3.5">{children}</div>
    </div>
  );
};
