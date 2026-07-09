// TODO(mount): react-router removed during vendoring; breadcrumb links use
// plain <a href>. Wire real client-side navigation when the router is mounted.
import { useTranslation } from 'react-i18next';
import { ChevronRight, Home } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

export const Breadcrumb = ({ items, className = '', homeHref = '/dashboard', showHome = true }) => {
  const { t } = useTranslation(['common']);
  const { isDark } = useTheme();

  const colors = {
    homeLink: isDark ? '#64748b' : '#94a3b8',
    homeLinkHover: isDark ? '#cbd5e1' : '#64748b',
    separator: isDark ? '#475569' : '#cbd5e1',
    activeText: isDark ? '#f1f5f9' : '#0f172a',
    linkText: isDark ? '#94a3b8' : '#64748b',
    linkHover: isDark ? '#5eecec' : '#088F8F',
  };

  return (
    <nav className={`flex items-center text-sm ${className}`} aria-label="Breadcrumb">
      <ol className="flex items-center gap-1 overflow-hidden">
        {/* Home link */}
        {showHome && (
          <li>
            <a
              href={homeHref}
              className="transition-colors"
              style={{ color: colors.homeLink }}
              title={t('dashboard')}
            >
              <Home className="w-4 h-4" />
            </a>
          </li>
        )}

        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={index} className="flex items-center">
              <ChevronRight className="w-4 h-4 mx-1 flex-shrink-0" style={{ color: colors.separator }} />
              {isLast || !item.href ? (
                <span
                  className="flex items-center gap-1.5 font-medium truncate max-w-[300px]"
                  style={{ color: colors.activeText }}
                >
                  {item.icon}
                  {item.label}
                </span>
              ) : (
                <a
                  href={item.href}
                  className="flex items-center gap-1.5 transition-colors truncate max-w-[300px] hover:underline"
                  style={{ color: colors.linkText }}
                >
                  {item.icon}
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
