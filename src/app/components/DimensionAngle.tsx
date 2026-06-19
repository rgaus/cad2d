'use client';

import { extend } from '@pixi/react';
import { Graphics, Sprite } from 'pixi.js';
import { useMemo } from 'react';
import { angleVec2, degreesToRadians, midPoint, normVec2, scaleVec2, subVec2 } from '@/lib/math';
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
};

const LINE_WIDTH_PX = 1;

const ANGLE_ARC_SIZE_PX = 24;

export default function DImensionAngle({
  pointA,
  pointCenter,
  pointB,
  viewportScale,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  showConflictIcon = false,
}: DimensionLineConstraitProps) {
  const vA = useMemo(() => pointA.toWorld(), [pointA]);
  const vCenter = useMemo(() => pointCenter.toWorld(), [pointCenter]);
  const vB = useMemo(() => pointB.toWorld(), [pointB]);

  const angleDegrees = useMemo(() => {
    const pointANormalized = normVec2(subVec2(pointA, pointCenter));
    const pointBNormalized = normVec2(subVec2(pointB, pointCenter));
    return angleVec2(subVec2(pointBNormalized, pointANormalized)) * 2;
  }, [pointA, pointCenter, pointB]);

  const vaCenterMid = useMemo(() => midPoint(vA, vCenter), [vA, vCenter]);
  const vaVbMid = useMemo(() => midPoint(vA, vB), [vA, vB]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  return (
    <>
      <pixiGraphics
        draw={(graphics: Graphics) => {
          graphics.clear();

          graphics.setStrokeStyle({ color, width: lineWidth });

          // Draw line edges
          graphics.moveTo(vA.x, vA.y);
          graphics.lineTo(vCenter.x, vCenter.y);
          graphics.lineTo(vB.x, vB.y);

          // Draw angular part
          const vANormalized = normVec2(subVec2(vA, vCenter));
          const vBNormalized = normVec2(subVec2(vB, vCenter));
          const arcEndA = scaleVec2(vANormalized, ANGLE_ARC_SIZE_PX / viewportScale);
          const arcEndB = scaleVec2(vBNormalized, ANGLE_ARC_SIZE_PX / viewportScale);
          console.log('ANGLE', angleDegrees, arcEndA, arcEndB)
          if (angleDegrees % 90 === 0) {
            // graphics.rect(arcEndB.x, arcEndB.y, 24, 24);
            // graphics.rect(arcEndA.x, arcEndA.y, (arcEndB.x - arcEndA.x), (arcEndB.y - arcEndA.y));
          } else {
            graphics.moveTo(arcEndA.x, arcEndA.y);
            // NOTE: this isn't quite right
            graphics.arc(vCenter.x, vCenter.y, ANGLE_ARC_SIZE_PX / viewportScale, degreesToRadians(angleDegrees), 0);
          }

          graphics.stroke();
        }}
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
