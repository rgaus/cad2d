'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useCallback, useMemo } from 'react';
import { EllipseComponent, Entity, PolygonComponent, RectangleComponent } from '@/lib/geometry';
import { Vector2 } from '@/lib/math';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import { MirrorFilterIconTexture, SPRITE_SCALE_FACTOR } from '@/lib/textures';
import { SheetPosition, WorldPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

type MirrorFilterIndicatorProps = {
  pointA: SheetPosition | null;
  pointB: SheetPosition | null;
  targetGeometry: Entity | null;
  viewportScale: number;
  color?: number;
  lineWidthPx?: number;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
  onPointerEnter?: (e: FederatedPointerEvent) => void;
  onPointerLeave?: (e: FederatedPointerEvent) => void;
};

const LINE_WIDTH_PX = 1;

const MIRROR_ICON_OFFSET_PX = 16;

export default function MirrorFilterIndicator({
  pointA,
  pointB,
  targetGeometry,
  viewportScale,
  color = 0x666666,
  lineWidthPx = LINE_WIDTH_PX,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: MirrorFilterIndicatorProps) {
  const vA = useMemo(() => (pointA ? pointA.toWorld() : null), [pointA]);
  const vB = useMemo(() => (pointB ? pointB.toWorld() : null), [pointB]);

  const hasAxis = vA !== null && vB !== null;

  // Midpoint and perpendicular offset for the icon sprite position
  const iconPos = useMemo((): { x: number; y: number } | null => {
    if (!hasAxis) {
      return null;
    }
    const mid = Vector2.midpoint(vA, vB);
    const dir = Vector2.sub(vB, vA);
    const perp = new WorldPosition(-dir.y, dir.x);
    const perpLen = Vector2.len(perp);
    if (perpLen === 0) {
      return mid;
    }
    const perpNorm = Vector2.norm(perp);
    return Vector2.add(mid, Vector2.scale(perpNorm, MIRROR_ICON_OFFSET_PX / viewportScale));
  }, [vA, vB, viewportScale, hasAxis]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();

      // Draw mirror axis line
      if (hasAxis) {
        graphics.setStrokeStyle({ color, width: lineWidth });
        graphics.moveTo(vA.x, vA.y);
        graphics.lineTo(vB.x, vB.y);
        graphics.stroke();
      }

      // Draw target geometry wireframe
      if (targetGeometry) {
        graphics.setStrokeStyle({ color, width: lineWidth });

        if (Entity.hasComponent(targetGeometry, PolygonComponent)) {
          const polygonData = PolygonComponent.get(targetGeometry);
          const pts = polygonData.points.map((s) => ({
            x: s.point.x * SHEET_UNITS_TO_PIXELS,
            y: s.point.y * SHEET_UNITS_TO_PIXELS,
          }));

          if (pts.length >= 2) {
            graphics.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < polygonData.points.length; i++) {
              const seg = polygonData.points[i];
              if (seg.type === 'point') {
                graphics.lineTo(
                  seg.point.x * SHEET_UNITS_TO_PIXELS,
                  seg.point.y * SHEET_UNITS_TO_PIXELS,
                );
              } else if (seg.type === 'arc-quadratic') {
                graphics.quadraticCurveTo(
                  seg.controlPoint.x * SHEET_UNITS_TO_PIXELS,
                  seg.controlPoint.y * SHEET_UNITS_TO_PIXELS,
                  seg.point.x * SHEET_UNITS_TO_PIXELS,
                  seg.point.y * SHEET_UNITS_TO_PIXELS,
                );
              } else if (seg.type === 'arc-cubic') {
                graphics.bezierCurveTo(
                  seg.controlPointA.x * SHEET_UNITS_TO_PIXELS,
                  seg.controlPointA.y * SHEET_UNITS_TO_PIXELS,
                  seg.controlPointB.x * SHEET_UNITS_TO_PIXELS,
                  seg.controlPointB.y * SHEET_UNITS_TO_PIXELS,
                  seg.point.x * SHEET_UNITS_TO_PIXELS,
                  seg.point.y * SHEET_UNITS_TO_PIXELS,
                );
              }
            }
            if (polygonData.closed && pts.length >= 1) {
              graphics.lineTo(pts[0].x, pts[0].y);
            }
            graphics.stroke();
          }
        } else if (Entity.hasComponent(targetGeometry, RectangleComponent)) {
          const rect = RectangleComponent.get(targetGeometry);
          const x = rect.upperLeft.x * SHEET_UNITS_TO_PIXELS;
          const y = rect.upperLeft.y * SHEET_UNITS_TO_PIXELS;
          const w = (rect.lowerRight.x - rect.upperLeft.x) * SHEET_UNITS_TO_PIXELS;
          const h = (rect.lowerRight.y - rect.upperLeft.y) * SHEET_UNITS_TO_PIXELS;
          graphics.rect(x, y, w, h);
          graphics.stroke();
        } else if (Entity.hasComponent(targetGeometry, EllipseComponent)) {
          const ellipseData = EllipseComponent.get(targetGeometry);
          const cx = ellipseData.center.x * SHEET_UNITS_TO_PIXELS;
          const cy = ellipseData.center.y * SHEET_UNITS_TO_PIXELS;
          const rx = ellipseData.radiusX * SHEET_UNITS_TO_PIXELS;
          const ry = ellipseData.radiusY * SHEET_UNITS_TO_PIXELS;
          graphics.ellipse(cx, cy, rx, ry);
          graphics.stroke();
        }
      }
    },
    [vA, vB, targetGeometry, color, lineWidth, hasAxis],
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
        texture={MirrorFilterIconTexture.get()}
        x={iconPos?.x ?? 0}
        y={iconPos?.y ?? 0}
        anchor={0.5}
        scale={spriteScale / SPRITE_SCALE_FACTOR}
        cursor="pointer"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        eventMode={
          onPointerDown || onPointerUp || onPointerEnter || onPointerLeave ? 'static' : 'none'
        }
      />
    </>
  );
}
