/** An element used for rendering keyboard shortcuts. */
export const KeyboardShortcut: React.FunctionComponent<{
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  label?: React.ReactNode;
}> = ({ children, active, label, disabled }) => {
  const kbdElement = (
    <kbd
      className="rounded-sm px-1"
      style={{
        // Deeper teal when active so it reads as a deliberate state, not just
        // the raw accent. Border shifts to match rather than staying grey.
        backgroundColor: active ? 'var(--teal-9)' : 'var(--slate-4)',
        border: `1px solid ${active ? 'var(--teal-8)' : 'var(--slate-7)'}`,
        color: active ? 'var(--slate-12)' : 'var(--slate-10)',
        fontSize: 9,
        opacity: disabled ? 0.5 : 1,
        // Subtle shadow gives the badge a bit more presence at small sizes
        boxShadow: active ? '0 0 0 2px color-mix(in oklab, var(--teal-9) 25%, transparent)' : 'none',
        fontFamily: 'var(--font-roboto-mono), monospace',
      }}
    >
      {children}
    </kbd>
  );
  if (label) {
    return (
      <div className="flex gap-1 items-center">
        {kbdElement}
        <span style={{ fontSize: 10, opacity: disabled ? 0.5 : 1 }}>{label}</span>
      </div>
    );
  } else {
    return kbdElement;
  }
};
