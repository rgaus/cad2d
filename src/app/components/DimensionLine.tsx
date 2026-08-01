'use client';

import { extend } from '@pixi/react';
import { FederatedPointerEvent, Graphics, Sprite } from 'pixi.js';
import { useMemo } from 'react';
import { Vector2 } from '@/lib/math';
import { Sheet } from '@/lib/sheet/Sheet';
import { ConflictIconTexture, SPRITE_SCALE_FACTOR } from '@/lib/textures';
import { Length } from '@/lib/units/length';
import {
  TICK_NO_OFFSET_TAIL_OFFSET_PX,
  TICK_OFFSET_TAIL_OFFSET_PX,
} from '@/lib/viewport/dimension-line-utils';
import { getDimensionTextTexture } from '@/lib/viewport/dimensionUtils';
import { SheetPosition } from '@/lib/viewport/types';

extend({
  Sprite,
  Graphics,
});

type DimensionLineConstraitProps = {
  pointA: SheetPosition;
  pointB: SheetPosition;
  viewportScale: number;
  sheetDefaultUnit: Sheet['defaultUnit'];
  color?: number;
  bgColor?: number;
  offsetPx?: number;
  lineWidthPx?: number;
  showLabel?: boolean;
  showConflictIcon?: boolean;
  axis?: 'x' | 'y' | null;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
  onPointerEnter?: (e: FederatedPointerEvent) => void;
  onPointerLeave?: (e: FederatedPointerEvent) => void;
};

const LINE_WIDTH_PX = 1;

export default function DimensionLine({
  pointA,
  pointB,
  viewportScale,
  sheetDefaultUnit,
  color = 0x666666,
  bgColor,
  offsetPx = 0,
  lineWidthPx = LINE_WIDTH_PX,
  showLabel = true,
  showConflictIcon = false,
  axis,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
}: DimensionLineConstraitProps) {
  const texture = useMemo(() => {
    if (!showLabel) {
      return null;
    }
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    let length: number;
    if (axis === 'x') {
      length = Math.abs(dx);
    } else if (axis === 'y') {
      length = Math.abs(dy);
    } else {
      length = Math.sqrt(dx * dx + dy * dy);
    }
    const lengthObj = Length.fromSheetUnits(sheetDefaultUnit, length);
    const displayText = lengthObj.toDisplayString();
    return getDimensionTextTexture(displayText, bgColor ? `#${bgColor.toString(16)}` : undefined);
  }, [showLabel, sheetDefaultUnit, pointA, pointB, bgColor, axis]);

  const va = useMemo(() => pointA.toWorld(), [pointA]);
  const vb = useMemo(() => pointB.toWorld(), [pointB]);

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / (viewportScale * SPRITE_SCALE_FACTOR);

  const lineGeom = useMemo(() => {
    if (axis === 'x') {
      const minX = Math.min(va.x, vb.x);
      const maxX = Math.max(va.x, vb.x);
      const offsetY = (va.y + vb.y) / 2 + offsetPx / viewportScale;
      return {
        lineStart: new SheetPosition(minX, offsetY),
        lineEnd: new SheetPosition(maxX, offsetY),
        midpoint: new SheetPosition((minX + maxX) / 2, offsetY),
        tickAStart: new SheetPosition(va.x, offsetY),
        tickAEnd: new SheetPosition(va.x, va.y),
        tickBStart: new SheetPosition(vb.x, offsetY),
        tickBEnd: new SheetPosition(vb.x, vb.y),
      };
    }
    if (axis === 'y') {
      const minY = Math.min(va.y, vb.y);
      const maxY = Math.max(va.y, vb.y);
      const offsetX = (va.x + vb.x) / 2 + offsetPx / viewportScale;
      return {
        lineStart: new SheetPosition(offsetX, minY),
        lineEnd: new SheetPosition(offsetX, maxY),
        midpoint: new SheetPosition(offsetX, (minY + maxY) / 2),
        tickAStart: new SheetPosition(offsetX, va.y),
        tickAEnd: new SheetPosition(va.x, va.y),
        tickBStart: new SheetPosition(offsetX, vb.y),
        tickBEnd: new SheetPosition(vb.x, vb.y),
      };
    }

    // Default: diagonal
    const mid = Vector2.midpoint(va, vb);
    const lineDir = Vector2.norm(Vector2.sub(vb, va));
    const perpDir = Vector2.perp(lineDir);
    const offset = Vector2.scale(perpDir, offsetPx / viewportScale);
    const offsetMid = Vector2.add(mid, offset);
    const lineStart = Vector2.add(va, offset);
    const lineEnd = Vector2.add(vb, offset);

    const tickAStart =
      offsetPx === 0
        ? Vector2.add(
            lineStart,
            Vector2.scale(perpDir, TICK_NO_OFFSET_TAIL_OFFSET_PX / viewportScale),
          )
        : va;
    const tickAEnd =
      offsetPx === 0
        ? Vector2.add(
            lineStart,
            Vector2.scale(perpDir, (-1 * TICK_NO_OFFSET_TAIL_OFFSET_PX) / viewportScale),
          )
        : offsetPx > 0
          ? Vector2.add(
              lineStart,
              Vector2.scale(perpDir, TICK_OFFSET_TAIL_OFFSET_PX / viewportScale),
            )
          : Vector2.add(
              lineStart,
              Vector2.scale(perpDir, (-1 * TICK_OFFSET_TAIL_OFFSET_PX) / viewportScale),
            );

    const tickBStart =
      offsetPx === 0
        ? Vector2.add(
            lineEnd,
            Vector2.scale(perpDir, TICK_NO_OFFSET_TAIL_OFFSET_PX / viewportScale),
          )
        : vb;
    const tickBEnd =
      offsetPx === 0
        ? Vector2.add(
            lineEnd,
            Vector2.scale(perpDir, (-1 * TICK_NO_OFFSET_TAIL_OFFSET_PX) / viewportScale),
          )
        : offsetPx > 0
          ? Vector2.add(lineEnd, Vector2.scale(perpDir, TICK_OFFSET_TAIL_OFFSET_PX / viewportScale))
          : Vector2.add(
              lineEnd,
              Vector2.scale(perpDir, (-1 * TICK_OFFSET_TAIL_OFFSET_PX) / viewportScale),
            );

    return {
      lineStart,
      lineEnd,
      midpoint: offsetMid,
      tickAStart,
      tickAEnd,
      tickBStart,
      tickBEnd,
    };
  }, [va, vb, axis, offsetPx, viewportScale]);

  return (
    <>
      <pixiGraphics
        draw={(graphics: Graphics) => {
          graphics.clear();

          graphics.setStrokeStyle({ color, width: lineWidth });

          graphics.moveTo(lineGeom.lineStart.x, lineGeom.lineStart.y);
          graphics.lineTo(lineGeom.lineEnd.x, lineGeom.lineEnd.y);
          graphics.stroke();

          graphics.moveTo(lineGeom.tickAStart.x, lineGeom.tickAStart.y);
          graphics.lineTo(lineGeom.tickAEnd.x, lineGeom.tickAEnd.y);
          graphics.stroke();

          graphics.moveTo(lineGeom.tickBStart.x, lineGeom.tickBStart.y);
          graphics.lineTo(lineGeom.tickBEnd.x, lineGeom.tickBEnd.y);
          graphics.stroke();
        }}
      />
      {texture ? (
        <pixiSprite
          texture={texture}
          x={lineGeom.midpoint.x}
          y={lineGeom.midpoint.y}
          anchor={0.5}
          scale={spriteScale}
          eventMode={
            onPointerDown || onPointerUp || onPointerEnter || onPointerLeave ? 'static' : 'none'
          }
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        />
      ) : null}
      {showConflictIcon ? (
        <pixiSprite
          texture={ConflictIconTexture.get()}
          x={lineGeom.lineStart.x + (lineGeom.midpoint.x - lineGeom.lineStart.x) / 2}
          y={lineGeom.lineStart.y + (lineGeom.midpoint.y - lineGeom.lineStart.y) / 2}
          anchor={0.5}
          scale={spriteScale}
        />
      ) : null}
    </>
  );
}
