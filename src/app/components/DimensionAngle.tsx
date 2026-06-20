'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { addVec2, midPoint, normVec2, radiansToDegrees, scaleVec2, subVec2 } from '@/lib/math';
import { ConflictIconTexture, PerpendicularConstraintIconConflictTexture, PerpendicularConstraintIconTexture } from '@/lib/textures';
import { SheetPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

type DimensionLineConstraitProps = {
  pointA: SheetPosition;
  pointCenter: SheetPosition;
  pointB: SheetPosition;
  viewportScale: number;
  color?: number;
  lineWidthPx?: number;
  renderAngleMarkerType?: (angleInDegrees: number) => 'none' | 'arc' | 'elbow' | 'conflict';
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
};

const LINE_WIDTH_PX = 1;

const REGULAR_ANGLE_ARC_SIZE_PX = 24;
const RIGHT_ANGLE_ARC_SIZE_PX = 16;

const PERPENDICULAR_ICON_OFFSET_PX = 16;

const DEFAULT_RENDER_ANGLE_MARKER_TYPE = (angleDegrees: number) =>
  angleDegrees % 90 === 0 && angleDegrees % 180 !== 0 ? 'elbow' : 'arc';

export default function DimensionAngle({
  pointA,
  pointCenter,
  pointB,
  viewportScale,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  renderAngleMarkerType = DEFAULT_RENDER_ANGLE_MARKER_TYPE,
  onPointerDown,
  onPointerUp,
}: DimensionLineConstraitProps) {
  const vA = useMemo(() => pointA.toWorld(), [pointA]);
  const vCenter = useMemo(() => pointCenter.toWorld(), [pointCenter]);
  const vB = useMemo(() => pointB.toWorld(), [pointB]);

  const angleDegrees = useMemo(() => {
    const vADir = subVec2(pointA, pointCenter);
    const vBDir = subVec2(pointB, pointCenter);
    const dot = vADir.x * vBDir.x + vADir.y * vBDir.y;
    const cross = vADir.x * vBDir.y - vADir.y * vBDir.x;
    return Math.abs(radiansToDegrees(Math.atan2(cross, dot)));
  }, [pointA, pointCenter, pointB]);

  const vaCenterMid = useMemo(() => midPoint(vA, vCenter), [vA, vCenter]);

  const vANormalized = useMemo(() => normVec2(subVec2(vA, vCenter)), [vA, vCenter]);
  const vBNormalized = useMemo(() => normVec2(subVec2(vB, vCenter)), [vB, vCenter]);

  // Exterior bisector direction (opposite the angle interior)
  const exteriorDir = useMemo(() => {
    const sumX = vANormalized.x + vBNormalized.x;
    const sumY = vANormalized.y + vBNormalized.y;
    const len = Math.sqrt(sumX * sumX + sumY * sumY);
    if (len === 0) {
      return new SheetPosition(0, 0);
    }
    return new SheetPosition(-sumX / len, -sumY / len);
  }, [vANormalized, vBNormalized]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  const angleMarkerType = renderAngleMarkerType(angleDegrees);

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      // Draw angular part
      graphics.setStrokeStyle({ color: 0x666666, width: lineWidth });
      graphics.setFillStyle({ color: 0xffffff, width: lineWidth, alpha: 0.2 });
      graphics.moveTo(vCenter.x, vCenter.y);
      switch (angleMarkerType) {
        case 'elbow': {
          // Standard right-angle marker: a small square tucked into the vertex
          const arcEndA = addVec2(
            vCenter,
            scaleVec2(vANormalized, RIGHT_ANGLE_ARC_SIZE_PX / viewportScale),
          );
          const arcEndB = addVec2(
            vCenter,
            scaleVec2(vBNormalized, RIGHT_ANGLE_ARC_SIZE_PX / viewportScale),
          );
          const cornerPt = addVec2(
            arcEndA,
            scaleVec2(vBNormalized, RIGHT_ANGLE_ARC_SIZE_PX / viewportScale),
          );
          graphics.lineTo(arcEndA.x, arcEndA.y);
          graphics.lineTo(cornerPt.x, cornerPt.y);
          graphics.lineTo(arcEndB.x, arcEndB.y);
          break;
        }
        case 'arc': {
          // Draw a true circular arc centered on the vertex (pointCenter).
          // arcTo() rounds a corner by offsetting the arc's center away from
          // the corner point.
          const startAngle = Math.atan2(vANormalized.y, vANormalized.x);
          const endAngle = Math.atan2(vBNormalized.y, vBNormalized.x);

          // Wrap the sweep into (-PI, PI] so we always take the shorter,
          // interior angle (matching angleDegrees) rather than the reflex
          // angle the long way around.
          let delta = endAngle - startAngle;
          while (delta <= -Math.PI) {
            delta += Math.PI * 2;
          }
          while (delta > Math.PI) {
            delta -= Math.PI * 2;
          }

          const arcEndA = addVec2(
            vCenter,
            scaleVec2(vANormalized, REGULAR_ANGLE_ARC_SIZE_PX / viewportScale),
          );
          graphics.moveTo(arcEndA.x, arcEndA.y);
          graphics.arc(
            vCenter.x,
            vCenter.y,
            REGULAR_ANGLE_ARC_SIZE_PX / viewportScale,
            startAngle,
            startAngle + delta,
            delta < 0,
          );
          break;
        }
        case 'none':
        case 'conflict':
          break;
        default:
          angleMarkerType satisfies never;
          break;
      }
      graphics.lineTo(vCenter.x, vCenter.y);
      graphics.stroke();
      graphics.fill();

      graphics.setStrokeStyle({
        color: angleMarkerType === 'conflict' ? 0xe5484d : color,
        width: lineWidth,
      });

      // Draw line edges
      graphics.moveTo(vA.x, vA.y);
      graphics.lineTo(vCenter.x, vCenter.y);
      graphics.lineTo(vB.x, vB.y);
      graphics.stroke();
    },
    [vA, vCenter, vB, color, lineWidth, angleDegrees, angleMarkerType],
  );

  return (
    <>
      <pixiGraphics
        draw={draw}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />

      <pixiSprite
        texture={angleMarkerType === 'conflict' ? PerpendicularConstraintIconConflictTexture.get() : PerpendicularConstraintIconTexture.get()}
        x={vCenter.x + exteriorDir.x * (PERPENDICULAR_ICON_OFFSET_PX / viewportScale)}
        y={vCenter.y + exteriorDir.y * (PERPENDICULAR_ICON_OFFSET_PX / viewportScale)}
        anchor={0.5}
        scale={spriteScale}
        cursor="pointer"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />

      {angleMarkerType === 'conflict' ? (
        <pixiSprite
          texture={ConflictIconTexture.get()}
          x={vaCenterMid.x}
          y={vaCenterMid.y}
          anchor={0.5}
          scale={spriteScale}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
        />
      ) : null}
    </>
  );
}
