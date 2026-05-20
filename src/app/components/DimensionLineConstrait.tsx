"use client";

import { useMemo } from "react";
import { extend } from "@pixi/react";
import { FederatedPointerEvent, Graphics, Sprite } from "pixi.js";
import { SheetPosition } from "@/lib/viewport/types";
import { getDimensionTextTexture } from "@/lib/viewport/dimensionUtils";
import { Length } from "@/lib/units/length";
import { subVec2, normVec2, perpVec2, scaleVec2, addVec2, midPoint } from "@/lib/math";
import { Sheet } from "@/lib/sheet/Sheet";

extend({
  Sprite,
});

type DimensionLineConstraitProps = {
  pointA: SheetPosition;
  pointB: SheetPosition;
  viewportScale: number;
  sheetDefaultUnit: Sheet["defaultUnit"];
  color?: number;
  bgColor?: number;
  offsetPx?: number;
  showLabel?: boolean;
  onPointerDown?: (e: FederatedPointerEvent) => void;
};

const TICK_HALF_SIZE_PX = 8;
const LINE_WIDTH_PX = 1;

export default function DimensionLineConstrait({
  pointA,
  pointB,
  viewportScale,
  sheetDefaultUnit,
  color = 0x666666,
  bgColor,
  offsetPx = 0,
  showLabel = true,
  onPointerDown,
}: DimensionLineConstraitProps) {
  const texture = useMemo(() => {
    if (!showLabel) {
      return null;
    }
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const lengthObj = Length.fromSheetUnits(sheetDefaultUnit, length);
    const displayText = lengthObj.toDisplayString();
    return getDimensionTextTexture(
      displayText,
      bgColor ? `#${bgColor.toString(16)}` : undefined,
    );
  }, [showLabel, sheetDefaultUnit, pointA, pointB, bgColor]);

  const va = useMemo(() => pointA.toWorld(), [pointA]);
  const vb = useMemo(() => pointB.toWorld(), [pointB]);

  const mid = useMemo(() => midPoint(va, vb), [va, vb]);

  const lineDir = useMemo(() => normVec2(subVec2(vb, va)), [va, vb]);
  const perpDir = useMemo(() => perpVec2(lineDir), [lineDir]);

  const offset = useMemo(() => scaleVec2(perpDir, offsetPx / viewportScale), [perpDir, offsetPx, viewportScale]);

  const offsetMid = useMemo(() => addVec2(mid, offset), [mid, offset]);

  const tickHalfSize = TICK_HALF_SIZE_PX / viewportScale;
  const lineWidth = LINE_WIDTH_PX / viewportScale;
  const spriteScale = 1 / viewportScale;

  const tickAOffsetStart = useMemo(() => addVec2(va, scaleVec2(perpDir, tickHalfSize + offsetPx / viewportScale)), [va, perpDir, offsetPx, viewportScale]);
  const tickAOffsetEnd = useMemo(() => addVec2(va, scaleVec2(perpDir, -tickHalfSize)), [va, perpDir]);

  const tickANormalStart = useMemo(() => addVec2(va, scaleVec2(perpDir, tickHalfSize)), [va, perpDir]);
  const tickANormalEnd = useMemo(() => addVec2(va, scaleVec2(perpDir, -tickHalfSize)), [va, perpDir]);

  const tickBOffsetStart = useMemo(() => addVec2(vb, scaleVec2(perpDir, tickHalfSize + offsetPx / viewportScale)), [vb, perpDir, offsetPx, viewportScale]);
  const tickBOffsetEnd = useMemo(() => addVec2(vb, scaleVec2(perpDir, -tickHalfSize)), [vb, perpDir]);

  const tickBNormalStart = useMemo(() => addVec2(vb, scaleVec2(perpDir, tickHalfSize)), [vb, perpDir]);
  const tickBNormalEnd = useMemo(() => addVec2(vb, scaleVec2(perpDir, -tickHalfSize)), [vb, perpDir]);

  const lineStart = useMemo(() => addVec2(va, offset), [va, offset]);
  const lineEnd = useMemo(() => addVec2(vb, offset), [vb, offset]);

  return (
    <>
      <pixiGraphics
        draw={(graphics: Graphics) => {
          graphics.clear();

          graphics.setStrokeStyle({ color, width: lineWidth });

          graphics.moveTo(lineStart.x, lineStart.y);
          graphics.lineTo(lineEnd.x, lineEnd.y);
          graphics.stroke();

          if (offsetPx > 0) {
            graphics.moveTo(tickAOffsetStart.x, tickAOffsetStart.y);
            graphics.lineTo(tickAOffsetEnd.x, tickAOffsetEnd.y);
            graphics.stroke();

            graphics.moveTo(tickBOffsetStart.x, tickBOffsetStart.y);
            graphics.lineTo(tickBOffsetEnd.x, tickBOffsetEnd.y);
            graphics.stroke();
          } else if (offsetPx < 0) {
            graphics.moveTo(tickAOffsetStart.x, tickAOffsetStart.y);
            graphics.lineTo(tickAOffsetEnd.x, tickAOffsetEnd.y);
            graphics.stroke();

            graphics.moveTo(tickBOffsetStart.x, tickBOffsetStart.y);
            graphics.lineTo(tickBOffsetEnd.x, tickBOffsetEnd.y);
            graphics.stroke();
          }

          graphics.moveTo(tickANormalStart.x, tickANormalStart.y);
          graphics.lineTo(tickANormalEnd.x, tickANormalEnd.y);
          graphics.stroke();

          graphics.moveTo(tickBNormalStart.x, tickBNormalStart.y);
          graphics.lineTo(tickBNormalEnd.x, tickBNormalEnd.y);
          graphics.stroke();
        }}
      />
      {texture ? (
        <pixiSprite
          texture={texture}
          x={offsetMid.x}
          y={offsetMid.y}
          anchor={0.5}
          scale={spriteScale}
          eventMode={onPointerDown ? "static" : "none"}
          onPointerDown={onPointerDown}
        />
      ) : null}
    </>
  );
}
