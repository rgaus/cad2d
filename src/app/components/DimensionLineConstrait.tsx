"use client";

import { useMemo } from "react";
import { extend } from "@pixi/react";
import { FederatedPointerEvent, Graphics, Sprite } from "pixi.js";
import { SheetPosition } from "@/lib/viewport/types";
import { getDimensionTextTexture } from "@/lib/viewport/dimensionUtils";
import { Length } from "@/lib/units/length";
import { subVec2, normVec2, perpVec2, scaleVec2, addVec2, midPoint } from "@/lib/math";
import { TICK_OFFSET_TAIL_OFFSET_PX, TICK_NO_OFFSET_TAIL_OFFSET_PX } from "@/lib/viewport/dimension-line-utils";
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
  lineWidthPx?: number;
  showLabel?: boolean;
  onPointerDown?: (e: FederatedPointerEvent) => void;
  onPointerUp?: (e: FederatedPointerEvent) => void;
};

const LINE_WIDTH_PX = 1;

export default function DimensionLineConstrait({
  pointA,
  pointB,
  viewportScale,
  sheetDefaultUnit,
  color = 0x666666,
  bgColor,
  offsetPx = 0,
  lineWidthPx = LINE_WIDTH_PX,
  showLabel = true,
  onPointerDown,
  onPointerUp,
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

  const lineWidth = lineWidthPx / viewportScale;
  const spriteScale = 1 / viewportScale;

  const lineStart = useMemo(() => addVec2(va, offset), [va, offset]);
  const lineEnd = useMemo(() => addVec2(vb, offset), [vb, offset]);

  const tickANormalStart = useMemo(() => {
    if (offsetPx === 0) {
      return addVec2(lineStart, scaleVec2(perpDir, TICK_NO_OFFSET_TAIL_OFFSET_PX / viewportScale));
    } else {
      return va;
    }
  }, [offsetPx, lineStart, perpDir, viewportScale, va]);

  const tickANormalEnd = useMemo(() => {
    if (offsetPx === 0) {
      return addVec2(lineStart, scaleVec2(perpDir, -1 * TICK_NO_OFFSET_TAIL_OFFSET_PX / viewportScale));
    }
    if (offsetPx > 0) {
      return addVec2(lineStart, scaleVec2(perpDir, TICK_OFFSET_TAIL_OFFSET_PX / viewportScale));
    } else {
      return addVec2(lineStart, scaleVec2(perpDir, -1 * TICK_OFFSET_TAIL_OFFSET_PX / viewportScale));
    }
  }, [offsetPx, lineStart, perpDir, viewportScale]);

  const tickBNormalStart = useMemo(() => {
    if (offsetPx === 0) {
      return addVec2(lineEnd, scaleVec2(perpDir, TICK_NO_OFFSET_TAIL_OFFSET_PX / viewportScale));
    } else {
      return vb;
    }
  }, [offsetPx, lineEnd, perpDir, viewportScale, vb]);

  const tickBNormalEnd = useMemo(() => {
    if (offsetPx === 0) {
      return addVec2(lineEnd, scaleVec2(perpDir, -1 * TICK_NO_OFFSET_TAIL_OFFSET_PX / viewportScale));
    }
    if (offsetPx > 0) {
      return addVec2(lineEnd, scaleVec2(perpDir, TICK_OFFSET_TAIL_OFFSET_PX / viewportScale));
    } else {
      return addVec2(lineEnd, scaleVec2(perpDir, -1 * TICK_OFFSET_TAIL_OFFSET_PX / viewportScale));
    }
  }, [offsetPx, lineEnd, perpDir, viewportScale]);

  return (
    <>
      <pixiGraphics
        draw={(graphics: Graphics) => {
          graphics.clear();

          graphics.setStrokeStyle({ color, width: lineWidth });

          graphics.moveTo(lineStart.x, lineStart.y);
          graphics.lineTo(lineEnd.x, lineEnd.y);
          graphics.stroke();

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
          eventMode={onPointerDown || onPointerUp ? "static" : "none"}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        />
      ) : null}
    </>
  );
}
