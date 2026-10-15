import * as SelectPrimitive from '@radix-ui/react-select';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

const Select = SelectPrimitive.Root;

const SelectValue = SelectPrimitive.Value;

const SelectGroup = SelectPrimitive.Group;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  Omit<React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>, 'onFocus' | 'onBlur'> & {
    size?: 'xs' | 'sm' | 'default' | 'lg';
    leadingIcon?: React.ReactNode;
    trailingIcon?: React.ReactNode;
    invalid?: boolean;
    caretVisible?: boolean;
    onFocus?: (e: React.FocusEvent) => void;
    onBlur?: (e: React.FocusEvent) => void;
  }
>(
  (
    {
      className,
      children,
      onFocus,
      onBlur,
      size = 'default',
      leadingIcon,
      trailingIcon,
      disabled = false,
      invalid = false,
      caretVisible = true,
      ...props
    },
    ref,
  ) => {
    const [focused, setFocused] = React.useState(false);
    return (
      <SelectPrimitive.Trigger
        ref={ref}
        className={cn(
          'flex w-full items-center justify-between rounded-sm',
          'text-sm text-[var(--slate-12)] ring-offset-[var(--slate-1)] placeholder:text-[var(--slate-11)] focus:outline-none',
          'focus:ring-ring focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed',
          'disabled:opacity-50 [&>span]:line-clamp-1',
          'border-[var(--slate-6)] bg-[var(--slate-1)] font-sans border',
          'ring-offset-[var(--slate-1)]',
          {
            'h-5 px-1': size === 'xs',
            'h-6 px-2': size === 'sm',
            'h-8 px-3': size === 'default',
            'h-10 px-3': size === 'lg',
            'ring-primary outline-none ring-2 ring-offset-2': focused,
            'disabled:opacity-50': disabled,
            'border-[var(--red-9)]': invalid,
            'pl-0': leadingIcon,
            'pr-0': trailingIcon,
          },
          className,
        )}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...props}
      >
        <div className="flex items-center">
          {leadingIcon ? (
            <div className="font-sans text-base text-[var(--slate-11)] ml-2 select-none pr-2 font-normal">
              {leadingIcon}
            </div>
          ) : null}
          {children}
        </div>
        <div className="flex items-center">
          {caretVisible ? (
            <SelectPrimitive.Icon asChild>
              <ChevronDownIcon className="h-4 w-4 opacity-50" />
            </SelectPrimitive.Icon>
          ) : null}
          {trailingIcon ? (
            <div className="font-sans text-base text-[var(--slate-11)] mr-3 select-none pl-2 font-normal">
              {trailingIcon}
            </div>
          ) : null}
        </div>
      </SelectPrimitive.Trigger>
    );
  },
);
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronUpIcon className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn('flex cursor-default items-center justify-center py-1', className)}
    {...props}
  >
    <ChevronDownIcon className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={cn(
        'border-[var(--slate-6)] bg-[var(--slate-2)] font-sans relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-sm border',
        'text-[var(--slate-12)] data-[state=open]:animate-in shadow-md',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
        'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        position === 'popper' &&
          'data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        className,
      )}
      position={position}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('font-sans text-sm select-none py-1.5 pl-8 pr-2 font-semibold', className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      'text-sm focus:bg-[var(--slate-3)] focus:text-[var(--slate-12)] relative flex w-full cursor-default cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <CheckIcon className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn('bg-muted -mx-1 my-1 h-px', className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectValue,
  SelectGroup,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
