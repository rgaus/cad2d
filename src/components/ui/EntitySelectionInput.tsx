'use client';

import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Id } from '@/lib/entity';
import { Button } from './Button';

type EntitySelectionInputProps = {
  value: Id | null;
  /** When true, the field renders a "Cancel" button instead of the picked entity id. */
  isPicking: boolean;
  /** Whether an "x" clear button should be rendered next to the id. */
  clearable?: boolean;
  size?: 'xs' | 'sm' | 'default' | 'lg';
  /** Fired when the id / "Select..." button is clicked to activate picker mode. */
  onActivatePick: () => void;
  /** Fired when "Cancel" is clicked to leave picker mode. */
  onCancel: () => void;
  /** Fired when the "x" clear button is clicked. */
  onClear?: () => void;
};

const FONT = {
  xs: 'text-xs',
  sm: 'text-xs',
  default: 'text-sm',
  lg: 'text-sm',
} as const;

const ICON_PX = {
  xs: 10,
  sm: 12,
  default: 14,
  lg: 18,
} as const;

/** An input-sized field that shows the currently bound entity. Clicking the id enters picker mode
 *  (the id switches to a "Cancel" button); clicking "Cancel" fires onCancel. Mirrors the footprint
 *  of {@link Input} so it can be used inline with the other input controls. */
const EntitySelectionInput: React.FunctionComponent<EntitySelectionInputProps> = ({
  value,
  isPicking,
  clearable = false,
  size = 'default',
  onActivatePick,
  onCancel,
  onClear,
}) => {
  const height = {
    xs: 'h-5',
    sm: 'h-6',
    default: 'h-8',
    lg: 'h-10',
  }[size];

  const mainButtonClass = cn(
    'flex-1 rounded-sm flex items-center justify-start px-2 font-sans text-[var(--slate-12)] hover:bg-[var(--slate-3)] cursor-pointer',
    FONT[size],
    {
      'py-0.5': size === 'default',
      'py-1': size === 'lg',
    },
  );

  return (
    <div
      className={cn(
        'border-[var(--slate-6)] bg-[var(--slate-1)] flex gap-1 w-full items-center rounded-sm border px-1',
        'ring-offset-[var(--slate-1)]',
        height,
      )}
    >
      {isPicking ? (
        <div className="flex flex-row items-center justify-between w-full">
          <span className={cn("text-[var(--slate-11)] select-none", FONT[size], {
            'pl-1': size === 'sm',
            'pl-2': size === 'default' || size === 'lg',
          })}>
            Picking
          </span>
          <Button
            onClick={onCancel}
            aria-label="Clear entity selection"
            variant="secondary"
            size={{
              lg: "sm" as const,
              default: "sm" as const,
              sm: "xs" as const,
              xs: "xs" as const,
            }[size]}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <button type="button" onClick={onActivatePick} className={cn(mainButtonClass, "w-0 shrink-1 grow-1")}>
          {value === null ? (
            <span className="text-[var(--slate-11)]">Click to select...</span>
          ) : (
            <span className="font-bold whitespace-nowrap overflow-hidden overflow-ellipsis">{value}</span>
          )}
        </button>
      )}

      {clearable && !isPicking ? (
        <Button
          onClick={onClear}
          aria-label="Clear entity selection"
          leadingIcon={<XIcon size={ICON_PX[size]} />}
          variant="ghost"
          size={{
            lg: "sm" as const,
            default: "sm" as const,
            sm: "xs" as const,
            xs: "xs" as const,
          }[size]}
        />
      ) : null}
    </div>
  );
};

export default EntitySelectionInput;
