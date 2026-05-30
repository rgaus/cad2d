import { FederatedPointerEvent, Graphics } from 'pixi.js';
import { useCallback } from 'react';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { CubicCurve, QuadraticCurve, SheetPosition, isCubicCurve } from '@/lib/viewport/types';
import { LINEAR_RESIZER_WIDTH_PX } from './LinearResizer';

type CurveEdgeHitDetectorProps = {
  curve: QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
  scale: number;
  onPointerEnter?: (event: FederatedPointerEvent) => void;
  onPointerLeave?: (event: FederatedPointerEvent) => void;
  onPointerDown?: (event: FederatedPointerEvent) => void;
};

export const CurveEdgeHitDetector: React.FunctionComponent<CurveEdgeHitDetectorProps> = ({
  curve,
  scale,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
}) => {
  const hitWidth = LINEAR_RESIZER_WIDTH_PX / scale;

  const drawHitArea = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      if (isCubicCurve(curve)) {
        graphics.moveTo(curve.start.x, curve.start.y);
        graphics.bezierCurveTo(
          curve.controlPointA.x,
          curve.controlPointA.y,
          curve.controlPointB.x,
          curve.controlPointB.y,
          curve.end.x,
          curve.end.y,
        );
        graphics.stroke({ width: hitWidth, color: 0xffffff });
      } else {
        graphics.moveTo(
          curve.start.x * SHEET_UNITS_TO_PIXELS,
          curve.start.y * SHEET_UNITS_TO_PIXELS,
        );
        graphics.quadraticCurveTo(
          curve.controlPoint.x * SHEET_UNITS_TO_PIXELS,
          curve.controlPoint.y * SHEET_UNITS_TO_PIXELS,
          curve.end.x * SHEET_UNITS_TO_PIXELS,
          curve.end.y * SHEET_UNITS_TO_PIXELS,
        );
        graphics.stroke({ width: hitWidth, color: 0xffffff });
      }
    },
    [curve, hitWidth],
  );

  return (
    <pixiGraphics
      draw={drawHitArea}
      eventMode="static"
      // tint={0x00ff00}
      alpha={0}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
    />
  );
};
