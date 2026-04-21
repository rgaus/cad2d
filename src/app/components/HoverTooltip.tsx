import { ScreenPosition } from "@/lib/tools/types";

const HOVER_TOOLTIP_OFFSET_X_PX = 16;
const HOVER_TOOLTIP_OFFSET_Y_PX = -16;

/** A tooltip used to show the current status of the user's current drawing action. */
export const HoverTooltip: React.FunctionComponent<{ position: ScreenPosition, children: React.ReactNode }> = ({ position, children }) => (
  <div
    style={{
      position: 'absolute',
      left: position.x + HOVER_TOOLTIP_OFFSET_X_PX,
      top: position.y + HOVER_TOOLTIP_OFFSET_Y_PX,
      pointerEvents: 'none',
      backgroundColor: '#111',
      color: 'white',
      padding: '4px 8px',
      borderRadius: 4,
      fontSize: 12,
      fontFamily: "var(--font-roboto-mono), monospace",
      fontWeight: 500,
      whiteSpace: 'nowrap',
      zIndex: 10,
    }}
  >
    {children}
  </div>
);
