import { Slot } from '@radix-ui/react-slot';
import { type VariantProps, cva } from 'class-variance-authority';
import Link from 'next/link';
import * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center whitespace-nowrap rounded-sm text-sm font-sans font-normal',
    'ring-offset-[var(--slate-1)] transition-colors focus-visible:outline-none focus-visible:ring-2',
    'focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none',
    'disabled:text-[var(--slate-11)] disabled:opacity-50 select-none',
  ),
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-[var(--slate-12)] border border-[var(--white-a4)] disabled:text-[var(--slate-12)]/50 disabled:bg-primary/50 hover:opacity-90 active:opacity-70',
        secondary:
          'bg-[var(--slate-2)] text-[var(--slate-12)] hover:bg-primary/89 border border-[var(--white-a4)] hover:opacity-90 active:opacity-70',
        ghost:
          'text-[var(--slate-12)] border border-transparent hover:border-[var(--white-a4)] active:opacity-60',
      },
      size: {
        xs: 'h-5 px-1 text-xs',
        sm: 'h-6 px-2',
        default: 'h-8 px-3',
        lg: 'h-10 px-3',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    href?: string;
    leadingIcon?: React.ReactNode;
    trailingIcon?: React.ReactNode;
  };

const ICON_ONLY_SIZES: Record<NonNullable<ButtonProps['size']>, string> = {
  xs: 'w-5',
  sm: 'w-6',
  default: 'w-8',
  lg: 'w-12',
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'default',
      asChild = false,
      leadingIcon,
      trailingIcon,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp: React.ElementType = props.href ? Link : asChild ? Slot : 'button';
    const iconOnly = (leadingIcon || trailingIcon) && !children;
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size: size ?? 'default', className }),
          iconOnly && 'px-0',
          iconOnly && ICON_ONLY_SIZES[size ?? 'default'],
          iconOnly && 'grow-0 shrink-0',
        )}
        ref={ref}
        {...props}
      >
        {leadingIcon || trailingIcon ? (
          <>
            {leadingIcon ? (
              <div
                className={cn({
                  'pr-2': children || trailingIcon,
                  'text-[var(--slate-11)]': children,
                  'text-[var(--slate-12)]': children && variant === 'primary',
                })}
              >
                {leadingIcon}
              </div>
            ) : null}
            {children}
            {trailingIcon ? (
              <div
                className={cn({
                  'pl-2': leadingIcon || children,
                  'text-[var(--slate-11)]': children,
                  'text-[var(--slate-12)]': children && variant === 'primary',
                })}
              >
                {trailingIcon}
              </div>
            ) : null}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
