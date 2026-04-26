"use client";

type FloatingPanelProps = {
  title?: string;
  children: React.ReactNode;
  className?: string;
};

export default function FloatingPanel({ title, children, className = "" }: FloatingPanelProps) {
  return (
    <div
      className={`bg-[#333] rounded-[4px] min-w-[256px] ${className}`}
      style={{ fontFamily: "var(--font-roboto-mono), monospace" }}

      // Keep these events from propagating and effecting the viewport state at all
      onWheel={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      onMouseUp={e => e.stopPropagation()}
    >
      {typeof title !== 'undefined' ? (
        <div className="px-3 py-2 bg-[#111] border-b border-[#888]">
          <h2 className="text-white text-sm font-semibold m-0">
            {title}
          </h2>
        </div>
      ) : null}
      <div className="px-3 py-3">
        {children}
      </div>
    </div>
  );
}
