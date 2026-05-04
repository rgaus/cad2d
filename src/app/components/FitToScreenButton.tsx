"use client";

import { Button } from "@/components/ui/button";

type FitToScreenButtonProps = {
  onClick: () => void;
};

export default function FitToScreenButton({ onClick }: FitToScreenButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title="Fit to screen"
      className="fixed bottom-6 right-6"
    >
      <FitToScreenIcon />
    </Button>
  );
}

function FitToScreenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <path d="M4 4h4v4H4zM16 4h4v4h-4zM4 16h4v4H4zM16 16h4v4h-4z" fill="none" />
    </svg>
  );
}
