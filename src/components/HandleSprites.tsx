import { SHEET_UNITS_TO_PIXELS } from "@/lib/sheet/Sheet";
import { SheetPosition } from "@/lib/viewport/types";
import { EventMode, FederatedPointerEvent, Texture } from "pixi.js";

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
  const spriteScale = 1 / viewportScale;
  if (points.length === 0) {
    return null;
  }

  return (
    <>
      {points.map((point, index) => {
        let eventMode: EventMode = "none";
        let cursor = "default";

        if (isDragging) {
          eventMode = "none";
          cursor = "default";
        } else {
          if (onHandlePointerDown) {
            cursor = "pointer";
          }
          if (onHandlePointerDown || onHandleEnter || onHandleLeave) {
            eventMode = "static";
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
            cursor={cursor}
            onPointerDown={onHandlePointerDown ? (e: FederatedPointerEvent) => onHandlePointerDown(e, index) : undefined}
            onPointerEnter={onHandleEnter ? (e: FederatedPointerEvent) => onHandleEnter(e, index) : undefined}
            onPointerLeave={onHandleLeave ? (e: FederatedPointerEvent) => onHandleLeave(e, index) : undefined}
          />
        );
      })}
    </>
  );
};
