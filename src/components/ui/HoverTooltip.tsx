import { ScreenPosition } from '@/lib/viewport/types';

const HOVER_TOOLTIP_OFFSET_X_PX = 16;
const HOVER_TOOLTIP_OFFSET_Y_PX = -16;

/** A tooltip used to show the current status of the user's current drawing action. */
export const HoverTooltip: React.FunctionComponent<{
  variant?: 'primary' | 'secondary';
  size?: 'xs' | 'sm' | 'default' | 'lg';
  position?: ScreenPosition;
  children: React.ReactNode;
}> = ({ variant = 'primary', size = 'default', position, children }) => {
  const isPrimary = variant === 'primary';
  const fontSize = { xs: 9, sm: 10, default: 12, lg: 12 }[size];
  return (
    <div
      style={{
        position: typeof position !== 'undefined' ? 'absolute' : undefined,
        left: typeof position !== 'undefined' ? position.x + HOVER_TOOLTIP_OFFSET_X_PX : undefined,
        top: typeof position !== 'undefined' ? position.y + HOVER_TOOLTIP_OFFSET_Y_PX : undefined,
        pointerEvents: 'none',
        backgroundColor: isPrimary ? 'var(--slate-1)' : '#fff',
        border: isPrimary ? '1px solid var(--slate-3)' : '1px solid var(--slate-10)',
        color: isPrimary ? 'var(--slate-12)' : 'var(--slate-5)',
        padding: { xs: '2px 6px', sm: '3px 4px', default: '4px 8px', lg: '8px 10px' }[size],
        borderRadius: { xs: 10, sm: 4, default: 4, lg: 4 }[size],
        fontSize,
        fontFamily: 'var(--font-roboto-mono), monospace',
        fontWeight: 500,
        whiteSpace: 'nowrap',
        zIndex: 10,
      }}
    >
      {children}
    </div>
  );
};
