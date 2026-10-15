import * as React from 'react';

export function Statistics({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-[var(--slate-2)] flex h-[96px] w-full items-center gap-16 rounded-sm px-8">
      {children}
    </div>
  );
}

export function StatisticsItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="font-sans text-sm text-[var(--slate-11)] font-normal">{label}</span>
      <div className="font-sans text-lg text-[var(--slate-12)] font-medium">{children}</div>
    </div>
  );
}
