import { Link, useRouterState } from '@tanstack/react-router';
import {
  BarChart3,
  HelpCircle,
  ListChecks,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/*
 * TopMenu — horizontal workflow nav. Replaces the LeftRail. Calibrate is
 * folded into Settings (the calibrate flow needs the live runtime; routing
 * to a dedicated screen was always a detour).
 */

interface MenuItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const items: ReadonlyArray<MenuItem> = [
  { to: '/live', label: 'Live', icon: Sparkles },
  { to: '/analyze', label: 'Analyze', icon: BarChart3 },
  { to: '/sessions', label: 'Sessions', icon: ListChecks },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/help', label: 'Help', icon: HelpCircle },
];

export function TopMenu() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Workflow"
      className="flex items-center gap-1 border-b border-line bg-surface-1 px-4 py-1.5"
    >
      <ul className="flex items-center gap-0.5" role="list">
        {items.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <li key={item.to}>
              <Link
                to={item.to}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-status-info-dim text-status-info font-medium'
                    : 'text-ink-1 hover:bg-surface-2',
                )}
                activeProps={{ 'aria-current': 'page' }}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
