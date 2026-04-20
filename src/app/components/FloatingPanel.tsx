"use client";

type FloatingPanelProps = {
  title: string;
  children: React.ReactNode;
  className?: string;
};

export default function FloatingPanel({ title, children, className = "" }: FloatingPanelProps) {
  return (
    <div
      className={`bg-[#333] rounded-[4px] overflow-hidden ${className}`}
      style={{ fontFamily: "var(--font-roboto-mono), monospace" }}
    >
      <div className="px-3 py-2 bg-[#111] border-b border-[#888]">
        <h2 className="text-white text-sm font-semibold m-0">
          {title}
        </h2>
      </div>
      <div className="px-3 py-3">
        {children}
      </div>
    </div>
  );
}
