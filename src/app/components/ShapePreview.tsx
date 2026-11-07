'use client';
import { Fragment, useMemo } from 'react';
import {
  AnchorPointComponent,
  Entity,
  FillColorComponent,
  FrameComponent,
  GeometryComponent,
  PolygonSegment,
} from '@/lib/entity';
import { FilterComponent } from '@/lib/entity/components/FilterComponent';
import { Filter } from '@/lib/entity/filters';
import { PatternFilter } from '@/lib/entity/filters/pattern';
import { RectangleData } from '@/lib/entity/geometry/rectangle';
import { RenderShape } from '@/lib/entity/render-shape';
import { OrientedBoundingBox, rotatePointAround } from '@/lib/math';
import {
  type ShapePreviewEditingDimension,
  type ShapePreviewHighlight,
} from '@/lib/selection/ShapePreviewManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { OrientedRect, SheetPosition } from '@/lib/viewport/types';

export { type ShapePreviewEditingDimension, type ShapePreviewHighlight };

/**
 * Builds an SVG path string from a list of polygon segments.
 * Handles both line segments and quadratic/cubic arcs.
 *
 * @param segments - The polygon segments to convert.
 * @param toSvg - Coordinate transform function from sheet units to SVG viewBox coordinates.
 * @param closed - Whether the polygon is closed (includes closing segment back to start).
 * @returns SVG path data string (e.g., "M 10,20 L 30,40 Q 50,60 70,80 ...").
 */
export function buildPolygonPath(
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
    parts.push('Z');
  }
  return parts.join(' ');
}

const selectedVertexSizeInPx = 6;
const vertexSizeInPx = 4;

const PREVIEW_VIEWBOX_SIZE = 60;
const PREVIEW_PADDING = 8;

export type ShapePreviewProjection = {
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  scale: number;
  offsetX: number;
  offsetY: number;
  toSvg: (x: number, y: number) => [number, number];
  toSvgX: (x: number) => number;
  toSvgY: (y: number) => number;
};

/** Computes the bounds and viewBox projection for every render shape in the preview. */
export function computePreviewProjection(renderShapes: Array<RenderShape>): ShapePreviewProjection {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const renderShape of renderShapes) {
    const bbox = RenderShape.boundingBox(renderShape);
    minX = Math.min(minX, bbox.position.x);
    minY = Math.min(minY, bbox.position.y);
    maxX = Math.max(maxX, bbox.position.x + bbox.width);
    maxY = Math.max(maxY, bbox.position.y + bbox.height);
  }

  if (
    !Number.isFinite(minX) ||
    !Number.isFinite(minY) ||
    !Number.isFinite(maxX) ||
    !Number.isFinite(maxY)
  ) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }

  const usableSize = PREVIEW_VIEWBOX_SIZE - PREVIEW_PADDING * 2;
  const boundsWidth = maxX - minX || 1;
  const boundsHeight = maxY - minY || 1;
  const scale = Math.min(usableSize / boundsWidth, usableSize / boundsHeight);
  const offsetX = PREVIEW_PADDING + (usableSize - boundsWidth * scale) / 2;
  const offsetY = PREVIEW_PADDING + (usableSize - boundsHeight * scale) / 2;

  const toSvgX = (x: number) => offsetX + (x - minX) * scale;
  const toSvgY = (y: number) => offsetY + (y - minY) * scale;
  const toSvg = (x: number, y: number): [number, number] => [toSvgX(x), toSvgY(y)];

  return {
    bounds: { minX, minY, maxX, maxY },
    scale,
    offsetX,
    offsetY,
    toSvg,
    toSvgX,
    toSvgY,
  };
}

/** Returns the handle positions for a render shape in rendered sheet space. Ellipses expose their
 * four rotated extremity points. */
export function getRenderShapeHandlePoints(renderShape: RenderShape): Array<SheetPosition> {
  switch (renderShape.shape) {
    case 'polygon':
      return renderShape.points.map((segment) => segment.point);
    case 'rectangle':
      return OrientedBoundingBox.cornersToArray(RenderShape.orientedBoundingBox(renderShape));
    case 'ellipse': {
      const { center, radiusX, radiusY, angleDegrees } = renderShape;
      return [
        rotatePointAround(new SheetPosition(center.x, center.y - radiusY), center, angleDegrees),
        rotatePointAround(new SheetPosition(center.x + radiusX, center.y), center, angleDegrees),
        rotatePointAround(new SheetPosition(center.x, center.y + radiusY), center, angleDegrees),
        rotatePointAround(new SheetPosition(center.x - radiusX, center.y), center, angleDegrees),
      ];
    }
    case 'point':
      return [renderShape.position];
    default:
      renderShape satisfies never;
      throw new Error(
        `getRenderShapeHandlePoints: Unknown render shape ${(renderShape as any).shape}`,
      );
  }
}

/** Returns the rendered anchor handle position for a geometry, if it has an anchor point. */
export function getPreviewAnchorPointPosition(
  geometry: Entity<GeometryComponent>,
): SheetPosition | null {
  if (!Entity.hasComponents(geometry, GeometryComponent, AnchorPointComponent)) {
    return null;
  }
  return AnchorPointComponent.getHandlePosition(geometry);
}

function edgeOutwardNormal(
  a: [number, number],
  b: [number, number],
  center: [number, number],
): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return [0, 0];
  }
  let nx = -dy / length;
  let ny = dx / length;
  const midX = (a[0] + b[0]) / 2;
  const midY = (a[1] + b[1]) / 2;
  if ((midX - center[0]) * nx + (midY - center[1]) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

function offsetByNormal(
  point: [number, number],
  normal: [number, number],
  distance: number,
): [number, number] {
  return [point[0] + normal[0] * distance, point[1] + normal[1] * distance];
}

function guidePoints(
  a: [number, number],
  b: [number, number],
  normal: [number, number],
): Array<[number, number]> {
  return [
    offsetByNormal(a, normal, 2),
    offsetByNormal(a, normal, 5),
    offsetByNormal(b, normal, 5),
    offsetByNormal(b, normal, 2),
  ];
}

function midpointSvg(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

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

  const projection = useMemo(() => computePreviewProjection(renderShapes), [renderShapes]);
  const { scale, toSvg, toSvgX, toSvgY } = projection;

  const points = useMemo(() => {
    return primaryRenderShape ? getRenderShapeHandlePoints(primaryRenderShape) : [];
  }, [primaryRenderShape]);

  const editingBBox = useMemo((): OrientedRect<SheetPosition> | null => {
    if (!primaryRenderShape) {
      return null;
    }
    if (primaryRenderShape.shape === 'polygon') {
      return Entity.orientedBoundingBoxInSheet(geometry);
    }
    return RenderShape.orientedBoundingBox(primaryRenderShape);
  }, [primaryRenderShape, geometry]);

  const anchorPointPosition = useMemo(() => getPreviewAnchorPointPosition(geometry), [geometry]);

  const fillColor = FillColorComponent.getOptional(geometry);
  const fill = typeof fillColor === 'number' ? hexToFill(fillColor) : 'none';
  const stroke = '#000000';

  return (
    <svg
      viewBox={`0 0 ${PREVIEW_VIEWBOX_SIZE} ${PREVIEW_VIEWBOX_SIZE}`}
      className="w-full aspect-square"
      style={{ backgroundColor: '#fafafa', borderRadius: '4px' }}
    >
      {[...renderShapes]
        .sort((a, b) => {
          // Render primary shapes last, so they are above non primary shapes
          return (a.primary ? 1 : -1) - (b.primary ? 1 : -1);
        })
        .map((renderShape) => {
          switch (renderShape.shape) {
            case 'rectangle': {
              const [x, y] = toSvg(renderShape.upperLeft.x, renderShape.upperLeft.y);
              const transform =
                renderShape.angleDegrees === 0
                  ? undefined
                  : `rotate(${renderShape.angleDegrees} ${x} ${y})`;
              return (
                <rect
                  key={renderShape.key}
                  data-preview-shape="rectangle"
                  transform={transform}
                  x={x}
                  y={y}
                  width={(renderShape.lowerRight.x - renderShape.upperLeft.x) * scale}
                  height={(renderShape.lowerRight.y - renderShape.upperLeft.y) * scale}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth="1"
                  opacity={renderShape.primary ? 1 : 0.5}
                />
              );
            }
            case 'ellipse': {
              const [cx, cy] = toSvg(renderShape.center.x, renderShape.center.y);
              const transform =
                renderShape.angleDegrees === 0
                  ? undefined
                  : `rotate(${renderShape.angleDegrees} ${cx} ${cy})`;
              return (
                <ellipse
                  key={renderShape.key}
                  data-preview-shape="ellipse"
                  transform={transform}
                  cx={cx}
                  cy={cy}
                  rx={renderShape.radiusX * scale}
                  ry={renderShape.radiusY * scale}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth="1"
                  opacity={renderShape.primary ? 1 : 0.5}
                />
              );
            }
            case 'polygon':
              return (
                <Fragment key={renderShape.key}>
                  {renderShape.points.length >= 2 ? (
                    <path
                      data-preview-shape="polygon"
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
            case 'point':
              return (
                <ellipse
                  key={renderShape.key}
                  data-preview-shape="point"
                  cx={toSvg(renderShape.position.x, renderShape.position.y)[0]}
                  cy={toSvg(renderShape.position.x, renderShape.position.y)[1]}
                  rx={2} // (Arbitrary size)
                  ry={2}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth="1"
                  opacity={renderShape.primary ? 1 : 0.5}
                />
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
          case 'pattern':
            switch (filterData.mode) {
              case 'grid': {
                if (!Entity.hasComponent(filter, FrameComponent)) {
                  return null;
                }
                const frameData = FrameComponent.get(filter);
                const [upperLeftX, upperLeftY] = toSvg(
                  frameData.upperLeft.x,
                  frameData.upperLeft.y,
                );
                const [lowerRightX, lowerRightY] = toSvg(
                  frameData.lowerRight.x,
                  frameData.lowerRight.y,
                );
                return (
                  <rect
                    key={filter.id}
                    x={upperLeftX}
                    y={upperLeftY}
                    width={lowerRightX - upperLeftX}
                    height={lowerRightY - upperLeftY}
                    fill="none"
                    stroke="rgba(0,0,0,0.4)"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                );
              }
              case 'radial': {
                const [leftCorner, rightCorner] = PatternFilter.getRadialCornerPoints(filterData);
                return (
                  <polygon
                    key={filter.id}
                    points={[filterData.center, rightCorner, leftCorner]
                      .map((pt) => toSvg(pt.x, pt.y).join(','))
                      .join(' ')}
                    fill="none"
                    stroke="rgba(0,0,0,0.4)"
                    strokeWidth="1"
                    strokeDasharray="2,2"
                  />
                );
              }
              default:
                filterData satisfies never;
                throw new Error(
                  `ShapePreview filter render: No filter with type=pattern and mode=${(filterData as any).mode} known!`,
                );
            }
          default:
            filterData satisfies never;
            throw new Error(
              `ShapePreview filter render: No filter with type=${(filterData as any).type} known!`,
            );
        }
      })}

      {points.length > 0 ? (
        <>
          {GeometryComponent.isPolygon(geometry) &&
          highlight?.type === 'segment' &&
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
                data-preview-handle-index={i}
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

      {anchorPointPosition ? (
        <rect
          data-preview-anchor="true"
          x={toSvg(anchorPointPosition.x, anchorPointPosition.y)[0] - vertexSizeInPx / 2}
          y={toSvg(anchorPointPosition.x, anchorPointPosition.y)[1] - vertexSizeInPx / 2}
          width={vertexSizeInPx}
          height={vertexSizeInPx}
          fill="#f39c12"
          stroke="#fff"
          strokeWidth={1}
        />
      ) : null}

      {/* Dimension line for editing width */}
      {editingDimension === 'width' && editingBBox ? (
        <polyline
          data-preview-dimension="width"
          points={(() => {
            const corners = OrientedBoundingBox.corners(editingBBox);
            const lowerLeft = toSvg(corners.lowerLeft.x, corners.lowerLeft.y);
            const lowerRight = toSvg(corners.lowerRight.x, corners.lowerRight.y);
            const center = toSvg(
              (corners.upperLeft.x + corners.lowerRight.x) / 2,
              (corners.upperLeft.y + corners.lowerRight.y) / 2,
            );
            const normal = edgeOutwardNormal(lowerLeft, lowerRight, center);
            return guidePoints(lowerLeft, lowerRight, normal);
          })()
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'radiusX' &&
      GeometryComponent.isEllipse(geometry) &&
      primaryRenderShape?.shape === 'ellipse' &&
      editingBBox ? (
        <polyline
          data-preview-dimension="radiusX"
          points={(() => {
            const corners = OrientedBoundingBox.corners(editingBBox);
            const upperLeft = toSvg(corners.upperLeft.x, corners.upperLeft.y);
            const upperRight = toSvg(corners.upperRight.x, corners.upperRight.y);
            const topCenter = midpointSvg(upperLeft, upperRight);
            const center = toSvg(primaryRenderShape.center.x, primaryRenderShape.center.y);
            const normal = edgeOutwardNormal(upperLeft, upperRight, center);
            return guidePoints(topCenter, upperLeft, normal);
          })()
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'height' && editingBBox ? (
        <polyline
          data-preview-dimension="height"
          points={(() => {
            const corners = OrientedBoundingBox.corners(editingBBox);
            const upperLeft = toSvg(corners.upperLeft.x, corners.upperLeft.y);
            const lowerLeft = toSvg(corners.lowerLeft.x, corners.lowerLeft.y);
            const center = toSvg(
              (corners.upperLeft.x + corners.lowerRight.x) / 2,
              (corners.upperLeft.y + corners.lowerRight.y) / 2,
            );
            const normal = edgeOutwardNormal(upperLeft, lowerLeft, center);
            return guidePoints(upperLeft, lowerLeft, normal);
          })()
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'radiusY' &&
      GeometryComponent.isEllipse(geometry) &&
      primaryRenderShape?.shape === 'ellipse' &&
      editingBBox ? (
        <polyline
          data-preview-dimension="radiusY"
          points={(() => {
            const corners = OrientedBoundingBox.corners(editingBBox);
            const upperLeft = toSvg(corners.upperLeft.x, corners.upperLeft.y);
            const lowerLeft = toSvg(corners.lowerLeft.x, corners.lowerLeft.y);
            const leftCenter = midpointSvg(upperLeft, lowerLeft);
            const center = toSvg(primaryRenderShape.center.x, primaryRenderShape.center.y);
            const normal = edgeOutwardNormal(upperLeft, lowerLeft, center);
            return guidePoints(leftCenter, upperLeft, normal);
          })()
            .map((p) => p.join(','))
            .join(' ')}
          fill="transparent"
          stroke="#3498db"
          strokeWidth="2"
        />
      ) : null}
      {editingDimension === 'origin' &&
      GeometryComponent.isEllipse(geometry) &&
      primaryRenderShape?.shape === 'ellipse' &&
      editingBBox ? (
        <>
          {(() => {
            const corners = OrientedBoundingBox.corners(editingBBox);
            const upperLeft = toSvg(corners.upperLeft.x, corners.upperLeft.y);
            const upperRight = toSvg(corners.upperRight.x, corners.upperRight.y);
            const lowerLeft = toSvg(corners.lowerLeft.x, corners.lowerLeft.y);
            const lowerRight = toSvg(corners.lowerRight.x, corners.lowerRight.y);
            const leftCenter = midpointSvg(upperLeft, lowerLeft);
            const rightCenter = midpointSvg(upperRight, lowerRight);
            const topCenter = midpointSvg(upperLeft, upperRight);
            const bottomCenter = midpointSvg(lowerLeft, lowerRight);
            const [centerX, centerY] = toSvg(
              primaryRenderShape.center.x,
              primaryRenderShape.center.y,
            );
            return (
              <>
                <line
                  data-preview-origin-guide="ellipse-x"
                  x1={leftCenter[0]}
                  y1={leftCenter[1]}
                  x2={rightCenter[0]}
                  y2={rightCenter[1]}
                  stroke="rgba(0,0,0,0.2)"
                  strokeWidth={1}
                />
                <line
                  data-preview-origin-guide="ellipse-y"
                  x1={topCenter[0]}
                  y1={topCenter[1]}
                  x2={bottomCenter[0]}
                  y2={bottomCenter[1]}
                  stroke="rgba(0,0,0,0.2)"
                  strokeWidth={1}
                />
                <rect
                  data-preview-origin="ellipse"
                  x={centerX - vertexSizeInPx / 2}
                  y={centerY - vertexSizeInPx / 2}
                  width={vertexSizeInPx}
                  height={vertexSizeInPx}
                  fill="white"
                  stroke="#000"
                  strokeWidth={1}
                />
              </>
            );
          })()}
        </>
      ) : null}
      {editingDimension === 'origin' && primaryRenderShape?.shape === 'rectangle' ? (
        <rect
          data-preview-origin="rectangle"
          x={
            toSvg(primaryRenderShape.upperLeft.x, primaryRenderShape.upperLeft.y)[0] -
            vertexSizeInPx / 2
          }
          y={
            toSvg(primaryRenderShape.upperLeft.x, primaryRenderShape.upperLeft.y)[1] -
            vertexSizeInPx / 2
          }
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
