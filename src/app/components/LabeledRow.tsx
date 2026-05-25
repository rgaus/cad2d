"use client";
import { cn } from "@/lib/utils";

type LabeledRowProps = {
  label: string;
  children: React.ReactNode;
  fullWidth?: boolean;
};

export default function LabeledRow({ label, children, fullWidth = true }: LabeledRowProps) {
  return (
    <div className="flex justify-between items-center gap-1 w-full">
      <span className="text-[var(--slate-12)] text-sm font-medium select-none" style={{ fontFamily: "var(--font-roboto-mono), monospace" }}>
        {label}
      </span>
      <div className={cn("max-w-[160px]", { "grow shrink": fullWidth })}>
        {children}
      </div>
    </div>
  );
}
