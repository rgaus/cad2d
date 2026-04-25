/** An element used for rendering keyboard shortcuts. */
export const KeyboardShortcut: React.FunctionComponent<{
  children: React.ReactNode,
  active?: boolean;
  disabled?: boolean,
  label?: React.ReactNode,
}> = ({ children, active, label, disabled }) => {
  const kbdElement = (
    <kbd
      className="rounded-sm px-1"
      style={{
        // Deeper blue when active so it reads as a deliberate state, not just
        // the raw accent color. Border shifts to match rather than staying grey.
        backgroundColor: active ? '#1a6fa8' : '#333',
        border: `1px solid ${active ? '#2980b9' : '#666'}`,
        color: active ? '#ffffff' : '#cccccc',
        fontSize: 9,
        opacity: disabled ? 0.5 : 1,
        // Subtle shadow gives the badge a bit more presence at small sizes
        boxShadow: active ? '0 0 0 2px rgba(52, 152, 219, 0.25)' : 'none',
      }}
    >{children}</kbd>
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
