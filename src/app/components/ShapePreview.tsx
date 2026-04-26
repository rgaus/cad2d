"use client";

import { type Rectangle, type Ellipse, type Polygon, type PolygonSegment } from "@/lib/tools/types";
import { boundingBox } from "@/lib/math";

type ShapePreviewProps = {
  shape: Rectangle | Ellipse | Polygon;
  highlightedSegmentIndex?: number;
  highlightedPointIndex?: number;
};

function hexToFill(hex: number | null): string {
  if (hex === null) return "none";
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

function hexToStroke(hex: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

export default function ShapePreview({ shape, highlightedSegmentIndex, highlightedPointIndex }: ShapePreviewProps) {
  const viewBox = "0 0 60 60";
  const padding = 8;
  const usableSize = 60 - padding * 2;

  let bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number };
  let points: Array<{ x: number; y: number }> = [];

  if ("upperLeft" in shape) {
    const rect = shape as Rectangle;
    bounds = {
      minX: rect.upperLeft.x,
      minY: rect.upperLeft.y,
      maxX: rect.lowerRight.x,
      maxY: rect.lowerRight.y,
      width: rect.lowerRight.x - rect.upperLeft.x,
      height: rect.lowerRight.y - rect.upperLeft.y,
    };
    points = [
      { x: rect.upperLeft.x, y: rect.upperLeft.y },
      { x: rect.lowerRight.x, y: rect.upperLeft.y },
      { x: rect.lowerRight.x, y: rect.lowerRight.y },
      { x: rect.upperLeft.x, y: rect.lowerRight.y },
    ];
  } else if ("center" in shape) {
    const ellipse = shape as Ellipse;
    bounds = {
      minX: ellipse.center.x - ellipse.radiusX,
      minY: ellipse.center.y - ellipse.radiusY,
      maxX: ellipse.center.x + ellipse.radiusX,
      maxY: ellipse.center.y + ellipse.radiusY,
      width: ellipse.radiusX * 2,
      height: ellipse.radiusY * 2,
    };
  } else {
    const polygon = shape as Polygon;
    const polygonBounds = boundingBox(polygon.points.map(s => s.point));
    bounds = {
      minX: polygonBounds.position.x,
      minY: polygonBounds.position.y,
      maxX: polygonBounds.position.x + polygonBounds.width,
      maxY: polygonBounds.position.y + polygonBounds.height,
      width: polygonBounds.width,
      height: polygonBounds.height,
    };
    points = polygon.points.map(s => ({ x: s.point.x, y: s.point.y }));
  }

  const boundsWidth = bounds.maxX - bounds.minX || 1;
  const boundsHeight = bounds.maxY - bounds.minY || 1;
  const scale = Math.min(usableSize / boundsWidth, usableSize / boundsHeight);
  const offsetX = padding + (usableSize - boundsWidth * scale) / 2;
  const offsetY = padding + (usableSize - boundsHeight * scale) / 2;

  function toSvg(x: number, y: number): [number, number] {
    return [offsetX + (x - bounds.minX) * scale, offsetY + (y - bounds.minY) * scale];
  }

  const fill = "fillColor" in shape ? hexToFill(shape.fillColor) : "none";
  const stroke = hexToStroke(0x000000);

  return (
    <svg
      viewBox={viewBox}
      className="w-full max-w-[80px] mx-auto"
      style={{ backgroundColor: "#fafafa", borderRadius: "4px" }}
    >
      {"upperLeft" in shape && (
        <rect
          x={toSvg(bounds.minX, bounds.minY)[0]}
          y={toSvg(bounds.minX, bounds.minY)[1]}
          width={boundsWidth * scale}
          height={boundsHeight * scale}
          fill={fill}
          stroke={stroke}
          strokeWidth="1"
        />
      )}
      {"center" in shape && (
        <ellipse
          cx={toSvg((bounds.minX + bounds.maxX) / 2, 0)[0]}
          cy={toSvg(0, (bounds.minY + bounds.maxY) / 2)[1]}
          rx={boundsWidth * scale / 2}
          ry={boundsHeight * scale / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth="1"
        />
      )}
      {"points" in shape && (
        <>
          {points.length >= 2 && (
            <polyline
              points={points.map(p => toSvg(p.x, p.y).join(",")).join(" ")}
              fill={shape.closed && fill !== "none" ? fill : "none"}
              stroke={stroke}
              strokeWidth="1"
              strokeLinejoin="round"
            />
          )}
          {points.map((p, i) => {
            const [sx, sy] = toSvg(p.x, p.y);
            const isHighlighted = highlightedPointIndex === i;
            const sizeInPx = isHighlighted ? 8 : 4;
            return (
              <rect
                key={i}
                x={sx - (sizeInPx/2)}
                y={sy - (sizeInPx/2)}
                width={sizeInPx}
                height={sizeInPx}
                fill="white"
                stroke="#000"
                strokeWidth="1"
              />
            );
          })}
        </>
      )}
    </svg>
  );
}
