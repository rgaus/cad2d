'use client';

import { Maximize2Icon } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type FitToScreenButtonProps = {
  onClick: () => void;
};

export default function FitToScreenButton({ onClick }: FitToScreenButtonProps) {
  return (
    <div
      className="fixed bottom-4 right-4 z-20 rounded-[4px] px-2 py-2 bg-[var(--slate-1)]"
      style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
    >
      <Button
        variant="ghost"
        onClick={onClick}
        title="Fit to screen"
        leadingIcon={<Maximize2Icon size={20} />}
      />
    </div>
  );
}
