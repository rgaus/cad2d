'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  fieldSize?: 'sm' | 'md';
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, fieldSize = 'md', ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex w-full min-w-[64px] rounded-[4px] border border-[var(--slate-5)] bg-[var(--slate-3)] hover:bg-[var(--slate-4)] focus:bg-[var(--slate-4)] px-2 py-1 text-sm text-[var(--slate-12)] font-mono outline-none transition-colors placeholder:text-[var(--slate-7)] focus:border-[var(--slate-8)] disabled:cursor-not-allowed disabled:opacity-50',
          {
            'h-8': fieldSize === 'md',
            'h-6': fieldSize === 'sm',
          },
          className,
        )}
        style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
