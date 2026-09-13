'use client';

import { XIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type FloatingPanelProps = {
  title?: string;
  children: React.ReactNode;
  noXPadding?: boolean;
  className?: string;
  /** When provided, renders a close ("x") button in the header corner. */
  onClose?: () => void;
};

export default function FloatingPanel({
  title,
  children,
  noXPadding = false,
  className = '',
  onClose,
}: FloatingPanelProps) {
  return (
    <Card
      className={className}
      // Keep these events from propagating and effecting the viewport state at all
      onWheel={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {typeof title !== 'undefined' ? (
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="mb-0">{title}</CardTitle>
          {typeof onClose !== 'undefined' ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-2 w-5 h-5 flex items-center justify-center rounded-[4px] text-[var(--slate-11)] hover:bg-[var(--slate-4)] transition-colors"
            >
              <XIcon size={16} />
            </button>
          ) : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn({ 'px-0': noXPadding })}>{children}</CardContent>
    </Card>
  );
}
