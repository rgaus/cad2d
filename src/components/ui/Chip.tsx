import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'error';
  size?: 'xs' | 'sm' | 'default' | 'lg';
}

const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  ({ variant = 'primary', size = 'default', className, children, ...props }, ref) => (
    <span
      ref={ref}
      className={cn('inline-block', {
        'h-5': size === 'xs',
        'h-6': size === 'sm',
        'h-8': size === 'default',
        'h-10': size === 'lg',
      })}
    >
      <span
        className={cn(
          'font-sans text-sm inline-block inline-flex h-full select-none items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border font-normal',
          {
            'min-w-5 px-1': size === 'xs',
            'min-w-6 px-1.5': size === 'sm',
            'min-w-8 px-1.5': size === 'default',
            'min-w-12 px-2': size === 'lg',
            'text-[var(--slate-12)] bg-primary border-primary': variant === 'primary',
            'text-[var(--slate-11)] bg-[var(--slate-1)] border-[var(--white-a4)]':
              variant === 'secondary',
            'text-[var(--slate-11)] bg-[var(--slate-3)] border-[var(--slate-3)]':
              variant === 'tertiary',
            'text-[var(--slate-11)] border-transparent bg-transparent': variant === 'ghost',
            'text-[var(--slate-12)] border-[var(--red-9)] bg-[var(--red-9)]': variant === 'error',
          },
          className,
        )}
        {...props}
      >
        {children}
      </span>
    </span>
  ),
);
Chip.displayName = 'Chip';

export { Chip };
