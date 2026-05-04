"use client";

type LabeledRowProps = {
  label: string;
  children: React.ReactNode;
};

export default function LabeledRow({ label, children }: LabeledRowProps) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-[var(--slate-12)] text-sm font-medium pr-1" style={{ fontFamily: "var(--font-roboto-mono), monospace" }}>
        {label}
      </span>
      <div className="flex-1 max-w-[160px]">
        {children}
      </div>
    </div>
  );
}
