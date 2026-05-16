import { SheetPosition } from "@/lib/viewport/types";
import { FederatedPointerEvent, Texture } from "pixi.js";
import { computeLineSpriteTransform, LINEAR_RESIZER_WIDTH_PX } from "./LinearResizer";
import { useMemo } from "react";

type LineSegmentEdgeHitDetectorProps = {
  startPosition: SheetPosition;
  endPosition: SheetPosition;
  scale: number;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onPointerDown?: (event: FederatedPointerEvent) => void;
};

export const LineSegmentEdgeHitDetector: React.FunctionComponent<LineSegmentEdgeHitDetectorProps> = ({
  startPosition,
  endPosition,
  scale,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
}) => {
  const transform = useMemo(() => {
    return computeLineSpriteTransform(startPosition, endPosition);
  }, [startPosition, endPosition]);

  return (
    <pixiSprite
      texture={Texture.WHITE}
      // tint={0xff0000}
      alpha={0}
      x={transform.centerX}
      y={transform.centerY}
      angle={transform.angleDegrees + 90}
      anchor={{ x: 0.5, y: 0.5 }}
      scale={{
        x: LINEAR_RESIZER_WIDTH_PX / scale,
        y: transform.length,
      }}
      eventMode="static"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
    />
  );
};
