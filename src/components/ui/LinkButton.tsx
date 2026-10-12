'use client';

import { Link2Icon, Link2OffIcon } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/Button';

/** A thin wrapper over {@link Button} that shows a link / unlink icon. */
export function LinkButton({ linked, ...props }: ButtonProps & { linked: boolean }) {
  return (
    <Button
      variant="ghost"
      leadingIcon={linked ? (
        <Link2Icon size={14} color="var(--red-10)" />
      ) : (
        <Link2OffIcon size={14} />
      )}
      {...props}
    />
  );
}
