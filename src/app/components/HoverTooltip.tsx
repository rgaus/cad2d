import { ScreenPosition } from "@/lib/viewport/types";

const HOVER_TOOLTIP_OFFSET_X_PX = 16;
const HOVER_TOOLTIP_OFFSET_Y_PX = -16;

/** A tooltip used to show the current status of the user's current drawing action. */
export const HoverTooltip: React.FunctionComponent<{
  variant?: 'primary' | 'secondary';
  position?: ScreenPosition;
  children: React.ReactNode;
}> = ({ variant = 'primary', position, children }) => (
  <div
    style={{
      position: typeof position !== 'undefined' ? 'absolute' : undefined,
      left: typeof position !== 'undefined' ? position.x + HOVER_TOOLTIP_OFFSET_X_PX : undefined,
      top: typeof position !== 'undefined' ? position.y + HOVER_TOOLTIP_OFFSET_Y_PX : undefined,
      pointerEvents: 'none',
      backgroundColor: variant === 'primary' ? '#111' : '#fff',
      border: variant === 'secondary' ? '1px solid var(--slate-10)' : undefined,
      color: variant === 'primary' ? 'white' : 'var(--slate-5)',
      padding: variant === 'primary' ? '4px 8px' : '1px 3px',
      borderRadius: 4,
      fontSize: variant === 'secondary' ? 6 : 12,
      fontFamily: "var(--font-roboto-mono), monospace",
      fontWeight: 500,
      whiteSpace: 'nowrap',
      zIndex: 10,
    }}
  >
    {children}
  </div>
);
