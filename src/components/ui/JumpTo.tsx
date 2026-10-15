import * as React from 'react';
import { cn } from '@/lib/utils';

const JumpToContext = React.createContext<{
  parentRef: React.RefObject<HTMLDivElement | null> | null;
}>({
  parentRef: null,
});

function JumpTo({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  const parentRef = React.useRef<HTMLDivElement | null>(null);
  return (
    <JumpToContext.Provider value={{ parentRef }}>
      <div className={cn('sticky top-6 flex w-[256px] flex-col gap-3', className)} ref={parentRef}>
        <span className="font-sans text-base text-[var(--slate-11)] whitespace-nowrap font-normal">
          Jump to...
        </span>
        <div className="flex max-h-[320px] flex-col gap-3 overflow-auto">{children}</div>
      </div>
    </JumpToContext.Provider>
  );
}

function JumpToItem({
  selected = false,
  onClick,
  children,
  className,
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  const { parentRef } = React.useContext(JumpToContext);
  if (!parentRef) throw new Error('Cannot render JumpToItem outside of JumpTo!');

  const selfRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (!selected || !parentRef.current || !selfRef.current) return;
    const parentRect = parentRef.current.getBoundingClientRect();
    const selfRect = selfRef.current.getBoundingClientRect();
    const diff = selfRect.y - parentRect.y;
    if (diff < selfRect.height || diff > parentRect.height) selfRef.current.scrollIntoView();
  }, [parentRef, selected]);

  return (
    <button
      ref={selfRef}
      className={cn(
        'font-sans text-base text-[var(--slate-11)] shrink-0 grow-0 border-l border-l-2 border-l-transparent pl-3 text-left',
        'overflow-hidden text-ellipsis whitespace-nowrap',
        {
          'border-l-primary text-[var(--slate-12)]': selected,
          'hover:opacity-80 active:opacity-60': !selected,
        },
        className,
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function JumpToController({
  sectionToWrapperMapping,
  onChangeVisibleSection,
  scrollParentRef,
  children,
}: {
  sectionToWrapperMapping: React.MutableRefObject<Map<string, HTMLElement>>;
  onChangeVisibleSection: (section: string | null) => void;
  scrollParentRef?: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const current = React.useRef(new Map<string, boolean>());

  React.useEffect(() => {
    const el = scrollParentRef != null ? scrollParentRef : scrollRef;
    if (!el.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, intersectionRatio } of entries) {
          const isIntersecting = intersectionRatio <= 0;
          const entry = Array.from(sectionToWrapperMapping.current).find(
            ([, wrapper]) => wrapper === target,
          );
          if (!entry) return;
          const section = entry[0];
          current.current.set(section, !isIntersecting);
        }
        for (const [section, visible] of current.current.entries()) {
          if (visible) {
            onChangeVisibleSection(section);
            break;
          }
        }
      },
      { root: el.current },
    );

    const targets = Array.from(sectionToWrapperMapping.current.values());
    for (const target of targets) observer.observe(target);
    return () => {
      for (const target of targets) observer.unobserve(target);
    };
  }, [sectionToWrapperMapping, onChangeVisibleSection, scrollParentRef]);

  return (
    <div ref={scrollRef} className="h-full w-full overflow-auto">
      {children}
    </div>
  );
}

export { JumpTo, JumpToItem, JumpToController };
