'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import {
  addVec2,
  midPoint,
  normVec2,
  radiansToDegrees,
  scaleVec2,
  subVec2,
} from '@/lib/math';
import { getConflictIconTexture } from '@/lib/textures';
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
  showConflictIcon?: boolean;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
};

const LINE_WIDTH_PX = 1;

const REGULAR_ANGLE_ARC_SIZE_PX = 24;
const RIGHT_ANGLE_ARC_SIZE_PX = 16;

export default function DimensionAngle({
  pointA,
  pointCenter,
  pointB,
  viewportScale,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  showConflictIcon = false,
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

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  const draw = useCallback((graphics: Graphics) => {
    graphics.clear();

    // Draw angular part
    const vANormalized = normVec2(subVec2(vA, vCenter));
    const vBNormalized = normVec2(subVec2(vB, vCenter));

    graphics.setStrokeStyle({ color: 0x666666, width: lineWidth });
    graphics.setFillStyle({ color: 0xffffff, width: lineWidth, alpha: 0.2 });
    graphics.moveTo(vCenter.x, vCenter.y);
    if (angleDegrees % 90 === 0 && angleDegrees % 180 !== 0) {
      // Standard right-angle marker: a small square tucked into the vertex
      const arcEndA = addVec2(vCenter, scaleVec2(vANormalized, RIGHT_ANGLE_ARC_SIZE_PX / viewportScale));
      const arcEndB = addVec2(vCenter, scaleVec2(vBNormalized, RIGHT_ANGLE_ARC_SIZE_PX / viewportScale));
      const cornerPt = addVec2(arcEndA, scaleVec2(vBNormalized, RIGHT_ANGLE_ARC_SIZE_PX / viewportScale));
      graphics.lineTo(arcEndA.x, arcEndA.y);
      graphics.lineTo(cornerPt.x, cornerPt.y);
      graphics.lineTo(arcEndB.x, arcEndB.y);
    } else {
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

      const arcEndA = addVec2(vCenter, scaleVec2(vANormalized, REGULAR_ANGLE_ARC_SIZE_PX / viewportScale));
      graphics.moveTo(arcEndA.x, arcEndA.y);
      graphics.arc(vCenter.x, vCenter.y, REGULAR_ANGLE_ARC_SIZE_PX / viewportScale, startAngle, startAngle + delta, delta < 0);
    }
    graphics.lineTo(vCenter.x, vCenter.y);
    graphics.stroke();
    graphics.fill();

    graphics.setStrokeStyle({ color, width: lineWidth });

    // Draw line edges
    graphics.moveTo(vA.x, vA.y);
    graphics.lineTo(vCenter.x, vCenter.y);
    graphics.lineTo(vB.x, vB.y);
    graphics.stroke();
  }, [vA, vCenter, vB, color, lineWidth, angleDegrees]);

  return (
    <>
      <pixiGraphics
        draw={draw}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        eventMode={onPointerDown || onPointerUp ? 'static' : 'none'}
      />
      {showConflictIcon ? (
        <pixiSprite
          texture={getConflictIconTexture()}
          x={vaCenterMid.x}
          y={vaCenterMid.y}
          anchor={0.5}
          scale={spriteScale}
        />
      ) : null}
    </>
  );
}
