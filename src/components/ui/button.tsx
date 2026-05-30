'use client';

import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-[4px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-8 disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-[var(--slate-12)] text-[var(--slate-1)] hover:bg-[var(--slate-11)]':
              variant === 'default',
            'bg-red-500 text-white hover:bg-red-600': variant === 'destructive',
            'border border-[var(--slate-6)] bg-transparent hover:bg-[var(--slate-5)] hover:text-[var(--slate-12)]':
              variant === 'outline',
            'bg-[var(--slate-5)] text-[var(--slate-12)] hover:bg-[var(--slate-6)]':
              variant === 'secondary',
            'bg-transparent hover:bg-[var(--slate-5)] text-[var(--slate-12)]': variant === 'ghost',
            'text-[var(--slate-11)] underline-offset-4 hover:underline': variant === 'link',
          },
          {
            'h-9 px-4 py-2': size === 'default',
            'h-8 rounded-md px-3 text-xs': size === 'sm',
            'h-10 rounded-md px-8': size === 'lg',
            'h-9 w-9': size === 'icon',
          },
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button };
