"use client";

import { type Rectangle, type Ellipse, type Polygon } from "@/lib/tools/types";
import { boundingBox, cornersToList, rectCorners } from "@/lib/math";
import { type Rect } from "@/lib/viewport/types";
import { SheetPosition } from "@/lib/viewport/types";

export type ShapePreviewEditingDimension = 'x' | 'y' | 'width' | 'height' | 'origin' | 'radiusX' | 'radiusY';

const selectedVertexSizeInPx = 6;
const vertexSizeInPx = 4;

type ShapePreviewProps = {
  shape: Rectangle | Ellipse | Polygon;
  highlight?: { type: 'point'; index: number } | { type: 'segment'; index: number };
  editingDimension?: ShapePreviewEditingDimension | null;
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

export default function ShapePreview({
  shape,
  highlight,
  editingDimension,
}: ShapePreviewProps) {
  const viewBoxSize = 60;
  const padding = 8;
  const usableSize = viewBoxSize - padding * 2;

  let bounds: Rect<SheetPosition>;
  let points: Array<SheetPosition> = [];

  if ("upperLeft" in shape) {
    const rect = shape as Rectangle;
    bounds = {
      position: rect.upperLeft,
      width: rect.lowerRight.x - rect.upperLeft.x,
      height: rect.lowerRight.y - rect.upperLeft.y,
    };
    points = cornersToList(rectCorners(bounds));
  } else if ("center" in shape) {
    const ellipse = shape as Ellipse;
    bounds = {
      position: new SheetPosition(ellipse.center.x - ellipse.radiusX, ellipse.center.y - ellipse.radiusY),
      width: ellipse.radiusX * 2,
      height: ellipse.radiusY * 2,
    };
  } else {
    const polygon = shape as Polygon;
    bounds = boundingBox(polygon.points.map(s => s.point));
    points = polygon.points.map(s => s.point);
  }

  const boundsMinX = bounds.position.x;
  const boundsMinY = bounds.position.y;
  const boundsWidth = bounds.width || 1;
  const boundsHeight = bounds.height || 1;
  const boundsMaxX = boundsMinX + boundsWidth;
  const boundsMaxY = boundsMinY + boundsHeight;

  const scale = Math.min(usableSize / boundsWidth, usableSize / boundsHeight);
  const scaledWidth = boundsWidth * scale;
  const scaledHeight = boundsHeight * scale;
  const offsetX = padding + (usableSize - scaledWidth) / 2;
  const offsetY = padding + (usableSize - scaledHeight) / 2;

  const toSvgX = (x: number) => offsetX + (x - boundsMinX) * scale;
  const toSvgY = (y: number) => offsetY + (y - boundsMinY) * scale;

  const toSvg = (x: number, y: number): [number, number] => [toSvgX(x), toSvgY(y)];

  const fill = "fillColor" in shape ? hexToFill(shape.fillColor) : "none";
  const stroke = hexToStroke(0x000000);

  const svgLeft = toSvgX(boundsMinX);
  const svgTop = toSvgY(boundsMinY);
  const svgRight = toSvgX(boundsMaxX);
  const svgBottom = toSvgY(boundsMaxY);
  const svgCenterX = toSvgX((boundsMinX + boundsMaxX) / 2);
  const svgCenterY = toSvgY((boundsMinY + boundsMaxY) / 2);

  return (
    <svg
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      className="w-full max-w-[80px] mx-auto"
      style={{ backgroundColor: "#fafafa", borderRadius: "4px" }}
    >
      {"upperLeft" in shape && (
        <rect
          x={svgLeft}
          y={svgTop}
          width={scaledWidth}
          height={scaledHeight}
          fill={fill}
          stroke={stroke}
          strokeWidth="1"
        />
      )}
      {"center" in shape && (
        <ellipse
          cx={svgCenterX}
          cy={svgCenterY}
          rx={scaledWidth / 2}
          ry={scaledHeight / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth="1"
        />
      )}
      {"points" in shape && (
        <>
          {points.length >= 2 ? (
            <polyline
              points={points.map(p => toSvg(p.x, p.y).join(",")).join(" ")}
              fill={shape.closed && fill !== "none" ? fill : "none"}
              stroke={stroke}
              strokeWidth="1"
              strokeLinejoin="round"
            />
          ) : null}
          {highlight?.type === 'segment' && points[highlight.index] ? (
            <line
              x1={toSvgX(points[highlight.index].x)}
              y1={toSvgY(points[highlight.index].y)}
              x2={toSvgX((points[highlight.index + 1] ?? points[0]).x)}
              y2={toSvgY((points[highlight.index + 1] ?? points[0]).y)}
              stroke={stroke}
              strokeWidth="4"
            />
          ) : null}
          {points.map((p, i) => {
            const [sx, sy] = toSvg(p.x, p.y);
            const isHighlighted = highlight?.type === 'point' && highlight.index === i;
            const sizeInPx = isHighlighted ? selectedVertexSizeInPx : vertexSizeInPx;
            return (
              <rect
                key={i}
                x={sx - (sizeInPx / 2)}
                y={sy - (sizeInPx / 2)}
                width={sizeInPx}
                height={sizeInPx}
                fill="white"
                stroke="#000"
                strokeWidth={isHighlighted ? 2 : 1}
              />
            );
          })}
        </>
      )}

      {editingDimension === 'width' || editingDimension === 'radiusX' ? (
        <polyline
          points={[
            [svgLeft, svgBottom + 2],
            [svgLeft, svgBottom + 5],
            [svgRight, svgBottom + 5],
            [svgRight, svgBottom + 2],
          ].map(p => p.join(',')).join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'height' || editingDimension === 'radiusY' ? (
        <polyline
          points={[
            [svgLeft - 2, svgTop],
            [svgLeft - 5, svgTop],
            [svgLeft - 5, svgBottom],
            [svgLeft - 2, svgBottom],
          ].map(p => p.join(',')).join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'origin' && 'center' in shape ? (
        <>
          <line
            x1={toSvgX(shape.center.x)}
            y1={svgTop}
            x2={toSvgX(shape.center.x)}
            y2={svgBottom}
            stroke="rgba(0,0,0,0.2)"
            strokeWidth={1}
          />
          <line
            x1={svgLeft}
            y1={toSvgY(shape.center.y)}
            x2={svgRight}
            y2={toSvgY(shape.center.y)}
            stroke="rgba(0,0,0,0.2)"
            strokeWidth={1}
          />
          <rect
            x={toSvgX(shape.center.x) - (vertexSizeInPx / 2)}
            y={toSvgY(shape.center.y) - (vertexSizeInPx / 2)}
            width={vertexSizeInPx}
            height={vertexSizeInPx}
            fill="white"
            stroke="#000"
            strokeWidth={1}
          />
        </>
      ) : null}
      {editingDimension === 'origin' && 'upperLeft' in shape ? (
        <rect
          x={svgLeft - (vertexSizeInPx / 2)}
          y={svgTop - (vertexSizeInPx / 2)}
          width={vertexSizeInPx}
          height={vertexSizeInPx}
          fill="white"
          stroke="#000"
          strokeWidth={1}
        />
      ) : null}
    </svg>
  );
}
