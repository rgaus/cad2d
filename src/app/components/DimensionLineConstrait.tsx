"use client";

import { useMemo } from "react";
import { extend } from "@pixi/react";
import { Graphics, Sprite } from "pixi.js";
import { SheetPosition } from "@/lib/viewport/types";
import { getDimensionTextTexture } from "@/lib/viewport/dimensionUtils";
import { CentimetersLength } from "@/lib/units/length";
import { CM_TO_PIXELS } from "@/lib/sheet/Sheet";

extend({
  Sprite,
});

type DimensionLineConstraitProps = {
  pointA: SheetPosition;
  pointB: SheetPosition;
  viewportScale: number;
  color: number;
};

const TICK_SIZE_PX = 16;
const LINE_WIDTH_PX = 1;

export default function DimensionLineConstrait({
  pointA,
  pointB,
  viewportScale,
  color = 0x666666,
}: DimensionLineConstraitProps) {
  const texture = useMemo(() => {
    const length = Math.sqrt(
      Math.pow(pointB.x - pointA.x, 2) + Math.pow(pointB.y - pointA.y, 2)
    );
    const lengthObj = new CentimetersLength(length);
    const displayText = lengthObj.toDisplayString();
    return getDimensionTextTexture(displayText);
  }, [pointA, pointB]);

  const vaX = pointA.x * CM_TO_PIXELS;
  const vaY = pointA.y * CM_TO_PIXELS;
  const vbX = pointB.x * CM_TO_PIXELS;
  const vbY = pointB.y * CM_TO_PIXELS;

  const midX = (vaX + vbX) / 2;
  const midY = (vaY + vbY) / 2;

  const dx = vbX - vaX;
  const dy = vbY - vaY;
  const angle = Math.atan2(dy, dx);

  const tickSize = TICK_SIZE_PX / viewportScale;
  const perpAngle = angle + Math.PI / 2;

  const tickAStartX = vaX + Math.cos(perpAngle) * tickSize / 2;
  const tickAStartY = vaY + Math.sin(perpAngle) * tickSize / 2;
  const tickAEndX = vaX - Math.cos(perpAngle) * tickSize / 2;
  const tickAEndY = vaY - Math.sin(perpAngle) * tickSize / 2;

  const tickBStartX = vbX + Math.cos(perpAngle) * tickSize / 2;
  const tickBStartY = vbY + Math.sin(perpAngle) * tickSize / 2;
  const tickBEndX = vbX - Math.cos(perpAngle) * tickSize / 2;
  const tickBEndY = vbY - Math.sin(perpAngle) * tickSize / 2;

  const lineWidth = LINE_WIDTH_PX / viewportScale;

  const spriteScale = 1 / viewportScale;

  return (
    <>
      <pixiGraphics
        draw={(graphics: Graphics) => {
          graphics.clear();

          graphics.setStrokeStyle({ color, width: lineWidth });

          graphics.moveTo(vaX, vaY);
          graphics.lineTo(vbX, vbY);
          graphics.stroke();

          graphics.moveTo(tickAStartX, tickAStartY);
          graphics.lineTo(tickAEndX, tickAEndY);
          graphics.stroke();

          graphics.moveTo(tickBStartX, tickBStartY);
          graphics.lineTo(tickBEndX, tickBEndY);
          graphics.stroke();
        }}
      />
      <pixiSprite
        texture={texture}
        x={midX}
        y={midY}
        anchor={0.5}
        scale={spriteScale}
      />
    </>
  );
}
