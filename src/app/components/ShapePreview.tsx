'use client';

import { Entity, FillColorComponent, GeometryComponent, PolygonSegment } from '@/lib/entity';
import { BoundingBox, DeCasteljau } from '@/lib/math';

/**
 * Builds an SVG path string from a list of polygon segments.
 * Handles both line segments and quadratic/cubic arcs.
 *
 * @param segments - The polygon segments to convert.
 * @param toSvg - Coordinate transform function from sheet units to SVG viewBox coordinates.
 * @param closed - Whether the polygon is closed (includes closing segment back to start).
 * @returns SVG path data string (e.g., "M 10,20 L 30,40 Q 50,60 70,80 ...").
 */
function buildPolygonPath(
  segments: Array<PolygonSegment>,
  toSvg: (x: number, y: number) => [number, number],
  closed: boolean,
): string {
  if (segments.length === 0) return '';
  const parts: Array<string> = [];
  const [startX, startY] = toSvg(segments[0].point.x, segments[0].point.y);
  parts.push(`M ${startX},${startY}`);
  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const [ex, ey] = toSvg(seg.point.x, seg.point.y);
    if (seg.type === 'point') {
      parts.push(`L ${ex},${ey}`);
    } else if (seg.type === 'arc-quadratic') {
      const [cx, cy] = toSvg(seg.controlPoint.x, seg.controlPoint.y);
      parts.push(`Q ${cx},${cy} ${ex},${ey}`);
    } else if (seg.type === 'arc-cubic') {
      const [c1x, c1y] = toSvg(seg.controlPointA.x, seg.controlPointA.y);
      const [c2x, c2y] = toSvg(seg.controlPointB.x, seg.controlPointB.y);
      parts.push(`C ${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`);
    }
  }
  if (closed) {
    const lastSeg = segments[segments.length - 1];
    const [firstX, firstY] = toSvg(segments[0].point.x, segments[0].point.y);
    if (lastSeg.type === 'arc-cubic') {
      const [c1x, c1y] = toSvg(lastSeg.controlPointB.x, lastSeg.controlPointB.y);
      parts.push(`C ${c1x},${c1y} ${firstX},${firstY} ${firstX},${firstY}`);
    } else if (lastSeg.type === 'arc-quadratic') {
      const [cx, cy] = toSvg(lastSeg.controlPoint.x, lastSeg.controlPoint.y);
      parts.push(`Q ${cx},${cy} ${firstX},${firstY}`);
    } else {
      parts.push('Z');
    }
  }
  return parts.join(' ');
}

export type ShapePreviewEditingDimension =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'origin'
  | 'radiusX'
  | 'radiusY';

const selectedVertexSizeInPx = 6;
const vertexSizeInPx = 4;

export type ShapePreviewHighlight =
  | { type: 'point'; index: number; color?: string }
  | { type: 'segment'; index: number; color?: string };

type ShapePreviewProps = {
  shape: Entity<GeometryComponent>;
  highlight?: ShapePreviewHighlight | null;
  hoveredPointIndex?: number;
  editingDimension?: ShapePreviewEditingDimension | null;
};

function hexToFill(hex: number | null): string {
  if (hex === null) return 'none';
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
  hoveredPointIndex,
  editingDimension,
}: ShapePreviewProps) {
  const viewBox = '0 0 60 60';
  const padding = 8;
  const usableSize = 60 - padding * 2;

  let bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  let points: Array<{ x: number; y: number }> = [];

  const geometryData = GeometryComponent.get(shape);
  switch (geometryData.type) {
    case 'polygon':
      const polygonBounds = BoundingBox.fromPoints(
        geometryData.points.flatMap((point, index) => {
          const nextPoint = geometryData.points[index + 1];
          if (PolygonSegment.isQuadratic(point) && nextPoint) {
            return [
              point.point,
              // Use midpoint of curve to get bounding box extents:
              DeCasteljau.getQuadraticBezierPointAt(
                { start: point.point, end: nextPoint.point, controlPoint: point.controlPoint },
                0.5,
              ),
            ];
          } else if (PolygonSegment.isCubic(point) && nextPoint) {
            return [
              point.point,
              // Use midpoint of curve to get bounding box extents:
              DeCasteljau.getCubicBezierPointAt(
                {
                  start: point.point,
                  end: nextPoint.point,
                  controlPointA: point.controlPointA,
                  controlPointB: point.controlPointB,
                },
                0.5,
              ),
            ];
          } else {
            return [point.point];
          }
        }),
      );
      bounds = {
        minX: polygonBounds.position.x,
        minY: polygonBounds.position.y,
        maxX: polygonBounds.position.x + polygonBounds.width,
        maxY: polygonBounds.position.y + polygonBounds.height,
        width: polygonBounds.width,
        height: polygonBounds.height,
      };
      points = geometryData.points.map((s: PolygonSegment) => ({ x: s.point.x, y: s.point.y }));
      break;
    case 'rectangle':
      bounds = {
        minX: geometryData.upperLeft.x,
        minY: geometryData.upperLeft.y,
        maxX: geometryData.lowerRight.x,
        maxY: geometryData.lowerRight.y,
        width: geometryData.lowerRight.x - geometryData.upperLeft.x,
        height: geometryData.lowerRight.y - geometryData.upperLeft.y,
      };
      points = [
        { x: geometryData.upperLeft.x, y: geometryData.upperLeft.y },
        { x: geometryData.lowerRight.x, y: geometryData.upperLeft.y },
        { x: geometryData.lowerRight.x, y: geometryData.lowerRight.y },
        { x: geometryData.upperLeft.x, y: geometryData.lowerRight.y },
      ];
      break;
    case 'ellipse':
      bounds = {
        minX: geometryData.center.x - geometryData.radiusX,
        minY: geometryData.center.y - geometryData.radiusY,
        maxX: geometryData.center.x + geometryData.radiusX,
        maxY: geometryData.center.y + geometryData.radiusY,
        width: geometryData.radiusX * 2,
        height: geometryData.radiusY * 2,
      };
      break;
    default:
      geometryData satisfies never;
      throw new Error(`ShapePreview: Unknown geometry data type ${(geometryData as any).type}`);
  }

  const boundsWidth = bounds.maxX - bounds.minX || 1;
  const boundsHeight = bounds.maxY - bounds.minY || 1;
  const scale = Math.min(usableSize / boundsWidth, usableSize / boundsHeight);
  const offsetX = padding + (usableSize - boundsWidth * scale) / 2;
  const offsetY = padding + (usableSize - boundsHeight * scale) / 2;

  function toSvg(x: number, y: number): [number, number] {
    return [toSvgX(x), toSvgY(y)];
  }
  function toSvgX(x: number) {
    return offsetX + (x - bounds.minX) * scale;
  }
  function toSvgY(y: number) {
    return offsetY + (y - bounds.minY) * scale;
  }

  const fillColor = FillColorComponent.getOptional(shape);
  const fill = typeof fillColor === 'number' ? hexToFill(fillColor) : 'none';
  const stroke = hexToStroke(0x000000);

  return (
    <svg
      viewBox={viewBox}
      className="w-full aspect-square"
      style={{ backgroundColor: '#fafafa', borderRadius: '4px' }}
    >
      {GeometryComponent.isRectangle(shape) && (
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
      {GeometryComponent.isEllipse(shape) && (
        <ellipse
          cx={toSvg((bounds.minX + bounds.maxX) / 2, 0)[0]}
          cy={toSvg(0, (bounds.minY + bounds.maxY) / 2)[1]}
          rx={(boundsWidth * scale) / 2}
          ry={(boundsHeight * scale) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth="1"
        />
      )}
      {GeometryComponent.isPolygon(shape) && (
        <>
          {points.length >= 2 ? (
            <path
              d={buildPolygonPath(
                GeometryComponent.get(shape).points,
                toSvg,
                GeometryComponent.get(shape).closed,
              )}
              fill={GeometryComponent.get(shape).closed && fill !== 'none' ? fill : 'none'}
              stroke={stroke}
              strokeWidth="1"
              strokeLinejoin="round"
            />
          ) : null}
          {highlight?.type === 'segment' &&
          typeof points[highlight.index]?.x !== 'undefined' &&
          typeof points[highlight.index]?.y !== 'undefined' ? (
            <line
              x1={toSvg(points[highlight.index].x, points[highlight.index].y)[0]}
              y1={toSvg(points[highlight.index].x, points[highlight.index].y)[1]}
              x2={
                toSvg(
                  (points[highlight.index + 1] ?? points[0]).x,
                  (points[highlight.index + 1] ?? points[0]).y,
                )[0]
              }
              y2={
                toSvg(
                  (points[highlight.index + 1] ?? points[0]).x,
                  (points[highlight.index + 1] ?? points[0]).y,
                )[1]
              }
              stroke={highlight?.color ?? stroke}
              strokeWidth="4"
            />
          ) : null}
          {points.map((p, i) => {
            const [sx, sy] = toSvg(p.x, p.y);
            const isHighlighted = highlight?.type === 'point' && highlight.index === i;
            const isHovered = hoveredPointIndex === i;
            const sizeInPx = isHighlighted || isHovered ? selectedVertexSizeInPx : vertexSizeInPx;
            const handleColor = isHovered ? '#3498db' : 'white';
            return (
              <rect
                key={i}
                x={sx - sizeInPx / 2}
                y={sy - sizeInPx / 2}
                width={sizeInPx}
                height={sizeInPx}
                fill={handleColor}
                stroke={(isHighlighted && highlight?.color) || '#000'}
                strokeWidth={isHighlighted ? 2 : 1}
              />
            );
          })}
        </>
      )}

      {/* Dimension line for editing width */}
      {editingDimension === 'width' ? (
        <polyline
          points={[
            [toSvgX(bounds.minX), toSvgY(bounds.maxY) + 2],
            [toSvgX(bounds.minX), toSvgY(bounds.maxY) + 5],
            [toSvgX(bounds.maxX), toSvgY(bounds.maxY) + 5],
            [toSvgX(bounds.maxX), toSvgY(bounds.maxY) + 2],
          ]
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'radiusX' && GeometryComponent.isEllipse(shape) ? (
        <polyline
          points={[
            [toSvgX(GeometryComponent.get(shape).center.x), toSvgY(bounds.minY) - 2],
            [toSvgX(GeometryComponent.get(shape).center.x), toSvgY(bounds.minY) - 5],
            [toSvgX(bounds.minX), toSvgY(bounds.minY) - 5],
            [toSvgX(bounds.minX), toSvgY(bounds.minY) - 2],
          ]
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'height' ? (
        <polyline
          points={[
            [toSvgX(bounds.minX) - 2, toSvgY(bounds.minY)],
            [toSvgX(bounds.minX) - 5, toSvgY(bounds.minY)],
            [toSvgX(bounds.minX) - 5, toSvgY(bounds.maxY)],
            [toSvgX(bounds.minX) - 2, toSvgY(bounds.maxY)],
          ]
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'radiusY' && GeometryComponent.isEllipse(shape) ? (
        <polyline
          points={[
            [toSvgX(bounds.minX) - 2, toSvgY(GeometryComponent.get(shape).center.y)],
            [toSvgX(bounds.minX) - 5, toSvgY(GeometryComponent.get(shape).center.y)],
            [toSvgX(bounds.minX) - 5, toSvgY(bounds.minY)],
            [toSvgX(bounds.minX) - 2, toSvgY(bounds.minY)],
          ]
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'origin' && GeometryComponent.isEllipse(shape) ? (
        <>
          <line
            x1={toSvgX(GeometryComponent.get(shape).center.x)}
            y1={toSvgY(bounds.minY)}
            x2={toSvgX(GeometryComponent.get(shape).center.x)}
            y2={toSvgY(bounds.maxY)}
            stroke="rgba(0,0,0,0.2)"
            strokeWidth={1}
          />
          <line
            x1={toSvgX(bounds.minX)}
            y1={toSvgY(GeometryComponent.get(shape).center.y)}
            x2={toSvgX(bounds.maxX)}
            y2={toSvgY(GeometryComponent.get(shape).center.y)}
            stroke="rgba(0,0,0,0.2)"
            strokeWidth={1}
          />
          <rect
            x={toSvgX(GeometryComponent.get(shape).center.x) - vertexSizeInPx / 2}
            y={toSvgY(GeometryComponent.get(shape).center.y) - vertexSizeInPx / 2}
            width={vertexSizeInPx}
            height={vertexSizeInPx}
            fill="white"
            stroke="#000"
            strokeWidth={1}
          />
        </>
      ) : null}
      {editingDimension === 'origin' && GeometryComponent.isRectangle(shape) ? (
        <rect
          x={toSvgX(bounds.minX) - vertexSizeInPx / 2}
          y={toSvgY(bounds.minY) - vertexSizeInPx / 2}
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
