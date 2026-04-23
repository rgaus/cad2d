/** An element used for rendering keyboard shortcuts. */
export const KeyboardShortcut: React.FunctionComponent<{
  children: React.ReactNode,
  disabled?: boolean,
  label?: React.ReactNode,
}> = ({ children, label, disabled }) => {
  const kbdElement = (
    <kbd
      className="bg-[#333] border border-[#666] rounded-sm px-1"
      style={{ fontSize: 9, opacity: disabled ? 0.5 : 1 }}
    >{children}</kbd>
  );

  if (label) {
    return (
      <div className="flex gap-1">
        {kbdElement}
        <span style={{ fontSize: 10, opacity: disabled ? 0.5 : 1 }}>{label}</span>
      </div>
    );
  } else {
    return kbdElement;
  }
};
