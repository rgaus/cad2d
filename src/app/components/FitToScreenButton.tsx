"use client";

import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";

type FitToScreenButtonProps = {
  onClick: () => void;
};

export default function FitToScreenButton({ onClick }: FitToScreenButtonProps) {
  return (
    <div
      className="fixed bottom-6 right-6 rounded-[4px] px-2 py-2 bg-[var(--slate-1)]"
      style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={onClick}
        title="Fit to screen"
      >
        <FitToScreenIcon />
      </Button>
    </div>
  );
}

function FitToScreenIcon() {
  return <Maximize2 size={20} />;
}
