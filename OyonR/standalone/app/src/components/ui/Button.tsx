import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';

/*
 * <Button> follows the shadcn pattern (Radix Slot for `asChild`).
 * Variants map to the same semantic colors as StatusPill — `primary` for
 * the green capture-start action, `danger` for stop, `ghost` for toolbar.
 */

const button = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary:
          'bg-status-ok text-white shadow-sm hover:brightness-110 active:brightness-95',
        secondary:
          'bg-surface-2 text-ink-0 border border-line hover:bg-surface-3',
        ghost: 'text-ink-1 hover:bg-surface-2',
        danger:
          'bg-status-bad text-white shadow-sm hover:brightness-110 active:brightness-95',
        outline:
          'border border-line text-ink-1 hover:bg-surface-2',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3',
        lg: 'h-10 px-4',
        icon: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(button({ variant, size }), className)}
      {...props}
    />
  );
});
