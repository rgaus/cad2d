import { EventMode, FederatedPointerEvent, Rectangle, Texture } from 'pixi.js';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { SPRITE_SCALE_FACTOR, TOUCH_HANDLE_HIT_SIZE_PX } from '@/lib/textures';
import { SheetPosition } from '@/lib/viewport/types';

type HandleSpritesProps = {
  points: Array<SheetPosition>;
  handleTexture: Texture;
  viewportScale: number;
  onHandleEnter?: (event: FederatedPointerEvent, index: number) => void;
  onHandleLeave?: (event: FederatedPointerEvent, index: number) => void;
  onHandlePointerDown?: (event: FederatedPointerEvent, index: number) => void;
  firstHandleEventMode?: EventMode;
  lastHandleEventMode?: EventMode;
  isDragging?: boolean;
};

/** A utility for rendering a list of handles around the perimeter of a geometry like a polygon,
 * rectangle, etc. */
export const HandleSprites: React.FunctionComponent<HandleSpritesProps> = ({
  points,
  handleTexture,
  viewportScale,
  onHandleEnter,
  onHandleLeave,
  onHandlePointerDown,
  firstHandleEventMode,
  lastHandleEventMode,
  isDragging,
}) => {
  const spriteScale = 1 / (viewportScale * SPRITE_SCALE_FACTOR);
  if (points.length === 0) {
    return null;
  }

  // Size of the invisible enlarged hit area in local sprite coordinates. The sprite is scaled by
  // `spriteScale`, so dividing the desired on-screen size by that scale gives the local size.
  const hitAreaLocalSize = TOUCH_HANDLE_HIT_SIZE_PX * viewportScale * SPRITE_SCALE_FACTOR;
  const hitHalfSize = hitAreaLocalSize / 2;

  return (
    <>
      {points.map((point, index) => {
        let eventMode: EventMode = 'none';
        let cursor = 'default';

        if (isDragging) {
          eventMode = 'none';
          cursor = 'default';
        } else {
          if (onHandlePointerDown) {
            cursor = 'pointer';
          }
          if (onHandlePointerDown || onHandleEnter || onHandleLeave) {
            eventMode = 'static';
          }
          if (index === 0 && firstHandleEventMode) {
            eventMode = firstHandleEventMode;
          }
          if (index === points.length - 1 && lastHandleEventMode) {
            eventMode = lastHandleEventMode;
          }
        }

        return (
          <pixiSprite
            key={index}
            texture={handleTexture}
            x={point.x * SHEET_UNITS_TO_PIXELS}
            y={point.y * SHEET_UNITS_TO_PIXELS}
            anchor={0.5}
            scale={spriteScale}
            eventMode={eventMode}
            hitArea={
              eventMode !== 'none'
                ? new Rectangle(-hitHalfSize, -hitHalfSize, hitAreaLocalSize, hitAreaLocalSize)
                : undefined
            }
            cursor={cursor}
            onPointerDown={
              onHandlePointerDown
                ? (e: FederatedPointerEvent) => onHandlePointerDown(e, index)
                : undefined
            }
            onPointerEnter={
              onHandleEnter ? (e: FederatedPointerEvent) => onHandleEnter(e, index) : undefined
            }
            onPointerLeave={
              onHandleLeave ? (e: FederatedPointerEvent) => onHandleLeave(e, index) : undefined
            }
          />
        );
      })}
    </>
  );
};
