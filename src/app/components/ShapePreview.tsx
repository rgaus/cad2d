'use client';

import { Fragment, useMemo } from 'react';
import {
  Entity,
  FillColorComponent,
  GeometryComponent,
  PolygonSegment,
  RenderShape,
} from '@/lib/entity';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { Filter } from '@/lib/entity/filters';
import { Sheet } from '@/lib/sheet/Sheet';

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
  if (segments.length === 0) {
    return '';
  }

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
  geometry: Entity<GeometryComponent>;
  sheetDefaultUnit: Sheet['defaultUnit'];
  filters: Array<Filter>;
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

export default function ShapePreview({
  geometry,
  sheetDefaultUnit,
  filters,
  highlight,
  hoveredPointIndex,
  editingDimension,
}: ShapePreviewProps) {
  const renderShapes = useMemo(() => {
    return GeometryComponent.getRenderShapes(geometry, sheetDefaultUnit, filters, {
      combineNonClosedPolygons: false,
    });
  }, [geometry, sheetDefaultUnit, filters]);

  const primaryRenderShape = useMemo(() => renderShapes.find((s) => s.primary), [renderShapes]);
  const primaryRenderShapeBBox = useMemo(
    () => (primaryRenderShape ? RenderShape.boundingBox(primaryRenderShape) : null),
    [primaryRenderShape],
  );

  const bounds = useMemo(() => {
    if (!primaryRenderShapeBBox) {
      return {
        minX: Infinity,
        minY: Infinity,
        maxX: 0,
        maxY: 0,
      };
    }

    return {
      minX: primaryRenderShapeBBox.position.x,
      minY: primaryRenderShapeBBox.position.y,
      maxX: primaryRenderShapeBBox.position.x + primaryRenderShapeBBox.width,
      maxY: primaryRenderShapeBBox.position.y + primaryRenderShapeBBox.height,
    };
  }, [primaryRenderShapeBBox]);

  const points = useMemo(() => {
    let points: Array<{ x: number; y: number }> = [];

    const geometryData = GeometryComponent.get(geometry);
    switch (geometryData.type) {
      case 'polygon':
        points = geometryData.points.map((s: PolygonSegment) => ({ x: s.point.x, y: s.point.y }));
        break;
      case 'rectangle':
        points = [
          { x: geometryData.upperLeft.x, y: geometryData.upperLeft.y },
          { x: geometryData.lowerRight.x, y: geometryData.upperLeft.y },
          { x: geometryData.lowerRight.x, y: geometryData.lowerRight.y },
          { x: geometryData.upperLeft.x, y: geometryData.lowerRight.y },
        ];
        break;
      case 'ellipse':
        break;
      default:
        geometryData satisfies never;
        throw new Error(`ShapePreview: Unknown geometry data type ${(geometryData as any).type}`);
    }

    return points;
  }, [geometry]);

  const viewBox = '0 0 60 60';
  const padding = 8;
  const usableSize = 60 - padding * 2;

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

  const fillColor = FillColorComponent.getOptional(geometry);
  const fill = typeof fillColor === 'number' ? hexToFill(fillColor) : 'none';
  const stroke = '#000000';

  return (
    <svg
      viewBox={viewBox}
      className="w-full aspect-square"
      style={{ backgroundColor: '#fafafa', borderRadius: '4px' }}
    >
      {renderShapes
        .sort((a, b) => {
          // Render primary shapes last, so they are above non primary shapes
          return (a.primary ? 1 : -1) - (b.primary ? 1 : -1);
        })
        .map((renderShape) => {
          switch (renderShape.shape) {
            case 'rectangle':
              return (
                <rect
                  key={renderShape.key}
                  x={toSvg(renderShape.upperLeft.x, renderShape.upperLeft.y)[0]}
                  y={toSvg(renderShape.upperLeft.x, renderShape.upperLeft.y)[1]}
                  width={(renderShape.lowerRight.x - renderShape.upperLeft.x) * scale}
                  height={(renderShape.lowerRight.y - renderShape.upperLeft.y) * scale}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth="1"
                  opacity={renderShape.primary ? 1 : 0.5}
                />
              );
            case 'ellipse':
              return (
                <ellipse
                  key={renderShape.key}
                  cx={toSvg(renderShape.center.x, renderShape.center.y)[0]}
                  cy={toSvg(renderShape.center.x, renderShape.center.y)[1]}
                  rx={renderShape.radiusX * scale}
                  ry={renderShape.radiusY * scale}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth="1"
                  opacity={renderShape.primary ? 1 : 0.5}
                />
              );
            case 'polygon':
              return (
                <Fragment key={renderShape.key}>
                  {points.length >= 2 ? (
                    <path
                      d={buildPolygonPath(renderShape.points, toSvg, renderShape.closed)}
                      fill={renderShape.closed && fill !== 'none' ? fill : 'none'}
                      stroke={stroke}
                      strokeWidth="1"
                      strokeLinejoin="round"
                      opacity={renderShape.primary ? 1 : 0.5}
                    />
                  ) : null}
                </Fragment>
              );
            default:
              renderShape satisfies never;
              throw new Error(
                `ShapePreview render: No rendershape with shape=${(renderShape as any).shape} known!`,
              );
          }
        })}

      {/* Render some filters on top of shape */}
      {filters.map((filter) => {
        const filterData = FilterComponent.get(filter);
        switch (filterData.type) {
          case 'fillet':
          case 'chamfer':
            return null;
          case 'mirror':
            return (
              <line
                key={filter.id}
                x1={toSvg(filterData.pointA.x, filterData.pointA.y)[0]}
                y1={toSvg(filterData.pointA.x, filterData.pointA.y)[1]}
                x2={toSvg(filterData.pointB.x, filterData.pointB.y)[0]}
                y2={toSvg(filterData.pointB.x, filterData.pointB.y)[1]}
                stroke="rgba(0,0,0,0.4)"
                strokeWidth="1"
                strokeDasharray="2,2"
              />
            );
          default:
            filterData satisfies never;
            throw new Error(
              `ShapePreview filter render: No filter with type=${(filterData as any).type} known!`,
            );
        }
      })}

      {GeometryComponent.isPolygon(geometry) ? (
        <>
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
      ) : null}

      {/* Dimension line for editing width */}
      {editingDimension === 'width' && primaryRenderShapeBBox ? (
        <polyline
          points={[
            [
              toSvgX(primaryRenderShapeBBox.position.x),
              toSvgY(primaryRenderShapeBBox.position.y + primaryRenderShapeBBox.height) + 2,
            ],
            [
              toSvgX(primaryRenderShapeBBox.position.x),
              toSvgY(primaryRenderShapeBBox.position.y + primaryRenderShapeBBox.height) + 5,
            ],
            [
              toSvgX(primaryRenderShapeBBox.position.x + primaryRenderShapeBBox.width),
              toSvgY(primaryRenderShapeBBox.position.y + primaryRenderShapeBBox.height) + 5,
            ],
            [
              toSvgX(primaryRenderShapeBBox.position.x + primaryRenderShapeBBox.width),
              toSvgY(primaryRenderShapeBBox.position.y + primaryRenderShapeBBox.height) + 2,
            ],
          ]
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'radiusX' && GeometryComponent.isEllipse(geometry) ? (
        <polyline
          points={[
            [toSvgX(GeometryComponent.get(geometry).center.x), toSvgY(bounds.minY) - 2],
            [toSvgX(GeometryComponent.get(geometry).center.x), toSvgY(bounds.minY) - 5],
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
      {editingDimension === 'height' && primaryRenderShapeBBox ? (
        <polyline
          points={[
            [
              toSvgX(primaryRenderShapeBBox.position.x) - 2,
              toSvgY(primaryRenderShapeBBox.position.y),
            ],
            [
              toSvgX(primaryRenderShapeBBox.position.x) - 5,
              toSvgY(primaryRenderShapeBBox.position.y),
            ],
            [
              toSvgX(primaryRenderShapeBBox.position.x) - 5,
              toSvgY(primaryRenderShapeBBox.position.y + primaryRenderShapeBBox.height),
            ],
            [
              toSvgX(primaryRenderShapeBBox.position.x) - 2,
              toSvgY(primaryRenderShapeBBox.position.y + primaryRenderShapeBBox.height),
            ],
          ]
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'radiusY' && GeometryComponent.isEllipse(geometry) ? (
        <polyline
          points={[
            [toSvgX(bounds.minX) - 2, toSvgY(GeometryComponent.get(geometry).center.y)],
            [toSvgX(bounds.minX) - 5, toSvgY(GeometryComponent.get(geometry).center.y)],
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
      {editingDimension === 'origin' && GeometryComponent.isEllipse(geometry) ? (
        <>
          <line
            x1={toSvgX(GeometryComponent.get(geometry).center.x)}
            y1={toSvgY(bounds.minY)}
            x2={toSvgX(GeometryComponent.get(geometry).center.x)}
            y2={toSvgY(bounds.maxY)}
            stroke="rgba(0,0,0,0.2)"
            strokeWidth={1}
          />
          <line
            x1={toSvgX(bounds.minX)}
            y1={toSvgY(GeometryComponent.get(geometry).center.y)}
            x2={toSvgX(bounds.maxX)}
            y2={toSvgY(GeometryComponent.get(geometry).center.y)}
            stroke="rgba(0,0,0,0.2)"
            strokeWidth={1}
          />
          <rect
            x={toSvgX(GeometryComponent.get(geometry).center.x) - vertexSizeInPx / 2}
            y={toSvgY(GeometryComponent.get(geometry).center.y) - vertexSizeInPx / 2}
            width={vertexSizeInPx}
            height={vertexSizeInPx}
            fill="white"
            stroke="#000"
            strokeWidth={1}
          />
        </>
      ) : null}
      {editingDimension === 'origin' && GeometryComponent.isRectangle(geometry) ? (
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
