import { Loader2 } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

export const Loading = ({ size = 'md', text, fullScreen = false }) => {
  const { isDark } = useTheme();

  const colors = {
    text: isDark ? '#94a3b8' : '#64748b',
  };

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  const content = (
    <div className="flex flex-col items-center justify-center gap-3">
      <Loader2 className={`${sizeClasses[size]} animate-spin text-primary-500`} />
      {text && <p className="text-sm" style={{ color: colors.text }}>{text}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        {content}
      </div>
    );
  }

  return content;
};
