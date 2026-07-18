import { EventMode, FederatedPointerEvent, Graphics } from 'pixi.js';
import { Fragment, useCallback, useMemo } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useClosestPointToSegment } from '@/hooks/useClosestPointToSegment';
import { useDraggingShapeState } from '@/hooks/useDraggingShapeState';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { FillColorComponent, GeometryComponent, PolygonSegment } from '@/lib/entity';
import { type Geometry } from '@/lib/entity/geometry';
import { BoundingBox, CohenSutherland } from '@/lib/math';
import { ListLayers, RendererLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import {
  HIGHLIGHT_COLOR_FILL,
  HIGHLIGHT_COLOR_STROKE,
  HIGHLIGHT_STROKE_WIDTH,
  SELECTION_HINT_WIDTH_PX,
  VertexHandleTexture,
} from '@/lib/textures';
import {
  CubicCurve,
  QuadraticCurve,
  Rect,
  ScreenPosition,
  SheetPosition,
} from '@/lib/viewport/types';
import { CurveControlPointHandlesSprites } from './CurveControlPointHandlesSprites';
import { CurveEdgeHitDetector } from './CurveEdgeHitDetector';
import { HandleSprites } from './HandleSprites';
import { LineSegmentEdgeHitDetector } from './LineSegmentEdgeHitDetector';
import { useGeometries } from '@/hooks/useGeoemtries';

/** Size of the center corsshairs rendered on ellipses. */
const CIRCLE_CENTER_MARKER_SIZE_PX = 8;

type GeometryShapeRendererCommonProps = {
  fillColor?: number | null;
  stroke?: number;
  strokeWidth?: number;
  viewportScale: number;
  showHintStroke?: boolean;
  onFillPointerDown?: (e: FederatedPointerEvent) => void;
  onFillPointerOver?: (e: FederatedPointerEvent) => void;
  onFillPointerOut?: (e: FederatedPointerEvent) => void;
  eventMode?: EventMode;
};

type GeometryShapeRendererProps =
  | (GeometryShapeRendererCommonProps & { type: 'polygon'; segments: Array<PolygonSegment>; closed?: boolean })
  | (GeometryShapeRendererCommonProps & { type: 'rectangle'; upperLeft: SheetPosition; lowerRight: SheetPosition })
  | (GeometryShapeRendererCommonProps & { type: 'ellipse'; center: SheetPosition; radiusX: number; radiusY: number; showCenterCrosshairs?: boolean });

/** Renders a polygon, ellipse, or rectangle shape to the screen. Just draws the shape - all other
 * extra ui elements are left to the caller to layer on top. */
export const GeometryShapeRenderer: React.FunctionComponent<GeometryShapeRendererProps> = (props) => {
  const drawPolygon = useCallback(
    (graphics: Graphics, segments: Array<PolygonSegment>, closed: boolean) => {
      if (segments.length < 2) {
        return;
      }

      const polygonBounds = BoundingBox.fromPoints(segments.map((s) => s.point));
      const polygonBoundsInPixels = {
        width: polygonBounds.width * SHEET_UNITS_TO_PIXELS * props.viewportScale,
        height: polygonBounds.height * SHEET_UNITS_TO_PIXELS * props.viewportScale,
      };

      graphics.clear();

      const viewportPoints = segments.map((s) => ({
        x: s.point.x * SHEET_UNITS_TO_PIXELS,
        y: s.point.y * SHEET_UNITS_TO_PIXELS,
      }));

      // When polygon is small enough in pixels, use fast poly() approximation for fill.
      // Otherwise, build the proper path with curve commands.
      const shouldUsePolyFill =
        polygonBoundsInPixels.width < MIN_POLYGON_HIGH_FIDELITY_SIZE_PX &&
        polygonBoundsInPixels.height < MIN_POLYGON_HIGH_FIDELITY_SIZE_PX;

      if (closed && typeof props.fillColor !== 'undefined') {
        if (props.fillColor !== null) {
          graphics.setFillStyle({ color: props.fillColor });
        } else {
          graphics.setFillStyle({ color: 0x000000, alpha: 0 });
        }
        if (shouldUsePolyFill) {
          graphics.poly(viewportPoints.flatMap((p) => [p.x, p.y]));
          graphics.fill();
        } else {
          // Build fill path with proper curve commands
          graphics.moveTo(viewportPoints[0].x, viewportPoints[0].y);
          for (let i = 1; i < segments.length; i += 1) {
            const seg = segments[i];
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
          // Close the fill path back to start
          if (segments.length >= 1) {
            const lastSeg = segments[segments.length - 1];
            if (lastSeg.type === 'arc-cubic') {
              graphics.bezierCurveTo(
                lastSeg.controlPointB.x * SHEET_UNITS_TO_PIXELS,
                lastSeg.controlPointB.y * SHEET_UNITS_TO_PIXELS,
                viewportPoints[0].x,
                viewportPoints[0].y,
                viewportPoints[0].x,
                viewportPoints[0].y,
              );
            } else if (lastSeg.type === 'arc-quadratic') {
              graphics.quadraticCurveTo(
                lastSeg.controlPoint.x * SHEET_UNITS_TO_PIXELS,
                lastSeg.controlPoint.y * SHEET_UNITS_TO_PIXELS,
                viewportPoints[0].x,
                viewportPoints[0].y,
              );
            } else {
              graphics.lineTo(viewportPoints[0].x, viewportPoints[0].y);
            }
          }
          graphics.closePath();
          graphics.fill();
        }
      }

      if (props.showHintStroke) {
        graphics.setStrokeStyle({
          color: props.stroke ?? 0x000000,
          width: SELECTION_HINT_WIDTH_PX / props.viewportScale,
          alpha: 0.3,
          alignment: 1,
        });
        graphics.moveTo(viewportPoints[0].x, viewportPoints[0].y);
        for (let i = 1; i < segments.length; i++) {
          const seg = segments[i];
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
        if (closed && segments.length >= 1) {
          const lastSeg = segments[segments.length - 1];
          if (lastSeg.type === 'arc-cubic') {
            const first = segments[0];
            graphics.bezierCurveTo(
              lastSeg.controlPointB.x * SHEET_UNITS_TO_PIXELS,
              lastSeg.controlPointB.y * SHEET_UNITS_TO_PIXELS,
              first.point.x * SHEET_UNITS_TO_PIXELS,
              first.point.y * SHEET_UNITS_TO_PIXELS,
              first.point.x * SHEET_UNITS_TO_PIXELS,
              first.point.y * SHEET_UNITS_TO_PIXELS,
            );
          } else if (lastSeg.type === 'arc-quadratic') {
            const first = segments[0];
            graphics.quadraticCurveTo(
              lastSeg.controlPoint.x * SHEET_UNITS_TO_PIXELS,
              lastSeg.controlPoint.y * SHEET_UNITS_TO_PIXELS,
              first.point.x * SHEET_UNITS_TO_PIXELS,
              first.point.y * SHEET_UNITS_TO_PIXELS,
            );
          } else {
            graphics.lineTo(viewportPoints[0].x, viewportPoints[0].y);
          }
        }
        graphics.stroke();
      }

      graphics.setStrokeStyle({
        color: props.stroke ?? 0x000000,
        width: (props.strokeWidth ?? 1) / props.viewportScale,
      });
      graphics.moveTo(viewportPoints[0].x, viewportPoints[0].y);
      for (let i = 1; i < segments.length; i += 1) {
        const seg = segments[i];
        if (seg.type === 'point') {
          graphics.lineTo(seg.point.x * SHEET_UNITS_TO_PIXELS, seg.point.y * SHEET_UNITS_TO_PIXELS);
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
      if (closed && segments.length >= 1) {
        const lastSeg = segments[segments.length - 1];
        if (lastSeg.type === 'arc-cubic') {
          const first = segments[0];
          graphics.bezierCurveTo(
            lastSeg.controlPointB.x * SHEET_UNITS_TO_PIXELS,
            lastSeg.controlPointB.y * SHEET_UNITS_TO_PIXELS,
            first.point.x * SHEET_UNITS_TO_PIXELS,
            first.point.y * SHEET_UNITS_TO_PIXELS,
            first.point.x * SHEET_UNITS_TO_PIXELS,
            first.point.y * SHEET_UNITS_TO_PIXELS,
          );
        } else if (lastSeg.type === 'arc-quadratic') {
          const first = segments[0];
          graphics.quadraticCurveTo(
            lastSeg.controlPoint.x * SHEET_UNITS_TO_PIXELS,
            lastSeg.controlPoint.y * SHEET_UNITS_TO_PIXELS,
            first.point.x * SHEET_UNITS_TO_PIXELS,
            first.point.y * SHEET_UNITS_TO_PIXELS,
          );
        } else {
          graphics.lineTo(viewportPoints[0].x, viewportPoints[0].y);
        }
      }
      graphics.stroke();
    },
    [
      props.viewportScale,
      props.fillColor,
      props.stroke,
      props.strokeWidth,
      props.showHintStroke,
    ],
  );

  const drawEllipse = useCallback(
    (graphics: Graphics, center: SheetPosition, args: { showCenterCrosshairs?: boolean; radiusX: number; radiusY: number }) => {
      graphics.clear();

      const centerX = center.x * SHEET_UNITS_TO_PIXELS;
      const centerY = center.y * SHEET_UNITS_TO_PIXELS;
      const radiusXPixels = args.radiusX * SHEET_UNITS_TO_PIXELS;
      const radiusYPixels = args.radiusY * SHEET_UNITS_TO_PIXELS;

      if (typeof props.fillColor !== 'undefined') {
        if (props.fillColor !== null) {
          graphics.setFillStyle({ color: props.fillColor });
        } else {
          graphics.setFillStyle({ color: 0x000000, alpha: 0 });
        }
        graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
        graphics.fill();
      }

      if (props.showHintStroke) {
        graphics.setStrokeStyle({
          color: props.stroke ?? 0x000000,
          width: SELECTION_HINT_WIDTH_PX / props.viewportScale,
          alpha: 0.3,
          alignment: 1,
        });
        graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
        graphics.stroke();
      }

      graphics.setStrokeStyle({
        color: props.stroke ?? 0x000000,
        width: (props.strokeWidth ?? 1) / props.viewportScale,
      });
      graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
      graphics.stroke();

      // For ellipses that are selected, render a little crosshairs marker at the geometry's center.
      if (args.showCenterCrosshairs) {
        graphics.setStrokeStyle({ color: 0x666666, width: 1 / props.viewportScale });
        graphics.moveTo(centerX - CIRCLE_CENTER_MARKER_SIZE_PX / props.viewportScale, centerY);
        graphics.lineTo(centerX + CIRCLE_CENTER_MARKER_SIZE_PX / props.viewportScale, centerY);
        graphics.moveTo(centerX, centerY - CIRCLE_CENTER_MARKER_SIZE_PX / props.viewportScale);
        graphics.lineTo(centerX, centerY + CIRCLE_CENTER_MARKER_SIZE_PX / props.viewportScale);
        graphics.stroke();
      }
    },
    [props.fillColor, props.stroke, props.strokeWidth, props.viewportScale, props.showHintStroke],
  );

  const drawRectangle = useCallback(
    (graphics: Graphics, upperLeft: SheetPosition, lowerRight: SheetPosition) => {
      graphics.clear();

      const x = upperLeft.x * SHEET_UNITS_TO_PIXELS;
      const y = upperLeft.y * SHEET_UNITS_TO_PIXELS;
      const width = (lowerRight.x - upperLeft.x) * SHEET_UNITS_TO_PIXELS;
      const height = (lowerRight.y - upperLeft.y) * SHEET_UNITS_TO_PIXELS;

      if (typeof props.fillColor !== 'undefined') {
        if (props.fillColor !== null) {
          graphics.setFillStyle({ color: props.fillColor });
        } else {
          graphics.setFillStyle({ color: 0x000000, alpha: 0 });
        }
        graphics.rect(x, y, width, height);
        graphics.fill();
      }

      if (props.showHintStroke) {
        graphics.setStrokeStyle({
          color: props.stroke ?? 0x000000,
          width: SELECTION_HINT_WIDTH_PX / props.viewportScale,
          alpha: 0.3,
          alignment: 1,
        });
        graphics.rect(x, y, width, height);
        graphics.stroke();
      }

      graphics.setStrokeStyle({
        color: props.stroke ?? 0x000000,
        width: (props.strokeWidth ?? 1) / props.viewportScale,
      });
      graphics.rect(x, y, width, height);
      graphics.stroke();
    },
    [props.fillColor, props.stroke, props.strokeWidth, props.viewportScale, props.showHintStroke],
  );

  const draw = useCallback((g: Graphics) => {
    switch (props.type) {
      case 'polygon':
        drawPolygon(g, props.segments, props.closed ?? false);
        break;
      case 'ellipse':
        drawEllipse(g, props.center, { showCenterCrosshairs: props.showCenterCrosshairs, radiusX: props.radiusX, radiusY: props.radiusY });
        break;
      case 'rectangle':
        drawRectangle(g, props.upperLeft, props.lowerRight);
        break;
      default:
        props satisfies never;
        break;
    }
  }, [props, drawPolygon, drawEllipse, drawRectangle]);

  return (
    <pixiGraphics
      draw={draw}
      eventMode={props.eventMode}
      onPointerDown={props.onFillPointerDown}
      onPointerOver={props.onFillPointerOver}
      onPointerOut={props.onFillPointerOut}
    />
  );
};

/**
 * Threshold (in pixels) below which polygon fill rendering falls back to the fast graphics.poly()
 * approach instead of using proper curve commands. Small polygons that would render tiny arcs
 * (especially when many are visible) are approximated with straight lines since users cannot
 * perceive the difference at that scale anyway. Increase to make more polygons use the fast
 * approximation, decrease for more accurate rendering.
 */
const MIN_POLYGON_HIGH_FIDELITY_SIZE_PX = 48;

/** Radius in pixels around the mouse cursor for proximity-based edge detector culling.
 * Only polygon segments that intersect this bounding box will have edge detectors rendered.
 * This makes it easier to select edges on non-closed, non-selected polygons. */
const PROXIMITY_EDGE_DETECTOR_RADIUS_PX = 64;

const GeometrySolid: React.FunctionComponent<{ geometry: Geometry }> = ({ geometry }) => {
  const { activeTool, viewportControls, viewportScale, mouseScreenPos, highlightedGeometryId } =
    useViewportContext();
  const geometryData = GeometryComponent.get(geometry);

  let fillColor = FillColorComponent.getOptional(geometry);
  let stroke = 0x000000;
  let strokeWidth = 1;
  if (highlightedGeometryId === geometry.id) {
    fillColor = HIGHLIGHT_COLOR_FILL;
    stroke = HIGHLIGHT_COLOR_STROKE;
    strokeWidth = HIGHLIGHT_STROKE_WIDTH;
  }

  const selectedIds = useSelectionManagerSelectedIds();
  const isSelected = selectedIds.includes(geometry.id);

  const onFillPointerDown = useCallback(
    (e: FederatedPointerEvent) => {
      if (!viewportControls) {
        return;
      }

      const shouldCancel = activeTool.handleGeometryFillPointerDown(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        geometry.id,
      );

      if (shouldCancel) {
        // Don't trigger handleMouseDown too
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [activeTool],
  );

  const onFillPointerOver = useCallback(() => {
    activeTool.handleGeometryFillEnter(geometry.id);
  }, [activeTool, geometry.id]);

  const onFillPointerOut = useCallback(() => {
    activeTool.handleGeometryFillLeave(geometry.id);
  }, [activeTool, geometry.id]);

  /** Bounding box for mouse proximity culling of edge detectors on non-selected, non-closed polygons.
   * Only computed in select mode when mouse position is available.
   * Uses Cohen-Sutherland algorithm to efficiently cull segments that don't intersect the mouse proximity area.
   */
  const mousePositionProximityAABB = useMemo((): Rect<SheetPosition> | null => {
    if (activeTool.type !== 'select') {
      return null;
    }
    if (!viewportControls) {
      return null;
    }
    if (!mouseScreenPos) {
      return null;
    }
    const worldPos = mouseScreenPos.toWorld(viewportControls.getState().viewport);
    const sheetPos = worldPos.toSheet();
    return BoundingBox.proximity(
      sheetPos,
      PROXIMITY_EDGE_DETECTOR_RADIUS_PX / SHEET_UNITS_TO_PIXELS / viewportScale,
    );
  }, [activeTool.type, viewportControls, viewportScale, mouseScreenPos]);

  switch (geometryData.type) {
    case 'polygon':
      return (
        <>
          <GeometryShapeRenderer
            type="polygon"
            segments={geometryData.points}
            closed={geometryData.closed}
            fillColor={fillColor}
            stroke={stroke}
            strokeWidth={strokeWidth}
            viewportScale={viewportScale}
            showHintStroke={isSelected && selectedIds.length > 1}
            eventMode="static"
            onFillPointerDown={onFillPointerDown}
            onFillPointerOver={onFillPointerOver}
            onFillPointerOut={onFillPointerOut}
          />

          {/* Edge detectors for non-closed, non-selected polygons based on mouse proximity.
           * Only renders detectors for segments that might intersect the proximity AABB.
           * This makes it easier to select edges on open polygons. */}
          {!closed && !isSelected && mousePositionProximityAABB ? (
            <>
              {geometryData.points.slice(1).map((seg, i) => {
                const prevSeg = geometryData.points[i];
                if (!prevSeg) {
                  return null;
                }

                // Use Cohen-Sutherland to quickly cull segments that don't intersect the proximity box
                if (seg.type === 'point') {
                  const segment = { start: prevSeg.point, end: seg.point };
                  if (
                    !CohenSutherland.lineSegmentMightIntersectBoundingBox(
                      segment,
                      mousePositionProximityAABB,
                    )
                  ) {
                    return null;
                  }
                  return (
                    <LineSegmentEdgeHitDetector
                      key={`prox-edge-${i}`}
                      startPosition={prevSeg.point}
                      endPosition={seg.point}
                      scale={viewportScale}
                      onPointerDown={onFillPointerDown}
                    />
                  );
                } else if (seg.type === 'arc-quadratic') {
                  const curve: QuadraticCurve<SheetPosition> = {
                    start: prevSeg.point,
                    end: seg.point,
                    controlPoint: seg.controlPoint,
                  };
                  if (
                    !CohenSutherland.quadraticCurveMightIntersectBoundingBox(
                      curve,
                      mousePositionProximityAABB,
                    )
                  ) {
                    return null;
                  }
                  return (
                    <CurveEdgeHitDetector
                      key={`prox-curve-edge-${i}`}
                      curve={curve}
                      scale={viewportScale}
                      onPointerDown={onFillPointerDown}
                    />
                  );
                } else if (seg.type === 'arc-cubic') {
                  const curve: CubicCurve<SheetPosition> = {
                    start: prevSeg.point,
                    end: seg.point,
                    controlPointA: seg.controlPointA,
                    controlPointB: seg.controlPointB,
                  };
                  if (
                    !CohenSutherland.cubicCurveMightIntersectBoundingBox(
                      curve,
                      mousePositionProximityAABB,
                    )
                  ) {
                    return null;
                  }
                  return (
                    <CurveEdgeHitDetector
                      key={`prox-curve-edge-${i}`}
                      curve={curve}
                      scale={viewportScale}
                      onPointerDown={onFillPointerDown}
                    />
                  );
                }
                return null;
              })}
            </>
          ) : null}
        </>
      );
    case 'rectangle':
      return (
        <GeometryShapeRenderer
          type="rectangle"
          upperLeft={geometryData.upperLeft}
          lowerRight={geometryData.lowerRight}
          fillColor={fillColor}
          stroke={stroke}
          strokeWidth={strokeWidth}
          viewportScale={viewportScale}
          showHintStroke={isSelected && selectedIds.length > 1}
          eventMode="static"
          onFillPointerDown={onFillPointerDown}
          onFillPointerOver={onFillPointerOver}
          onFillPointerOut={onFillPointerOut}
        />
      );
    case 'ellipse':
      return (
        <GeometryShapeRenderer
          type="ellipse"
          center={geometryData.center}
          radiusX={geometryData.radiusX}
          radiusY={geometryData.radiusY}
          showCenterCrosshairs={isSelected}
          fillColor={fillColor}
          stroke={stroke}
          strokeWidth={strokeWidth}
          viewportScale={viewportScale}
          showHintStroke={isSelected && selectedIds.length > 1}
          eventMode="static"
          onFillPointerDown={onFillPointerDown}
          onFillPointerOver={onFillPointerOver}
          onFillPointerOut={onFillPointerOut}
        />
      );
    default:
      geometryData satisfies never;
      break;
  }
};

type PolygonDecorationsRendererProps = {
  segments: Array<PolygonSegment>;
  closed: boolean;
  viewportScale: number;

  onVertexPointerDown?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  onVertexEnter?: (event: FederatedPointerEvent, index: number) => void;
  onVertexLeave?: (event: FederatedPointerEvent, index: number) => void;
  onControlPointerDown?: (
    event: FederatedPointerEvent,
    segmentIndex: number,
    pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB',
  ) => void;
  firstHandleEventMode?: EventMode;
  lastHandleEventMode?: EventMode;

  isDragging?: boolean;
};

function BezierLines({ segments, scale }: { segments: Array<PolygonSegment>; scale: number }) {
  const lineWidth = 1 / scale;
  const strokeColor = 0xaaaaaa;

  return (
    <pixiGraphics
      draw={(graphics: Graphics) => {
        graphics.clear();
        graphics.setStrokeStyle({ color: strokeColor, width: lineWidth });

        for (let index = 0; index < segments.length; index += 1) {
          const seg = segments[index];
          const prevSeg = index > 0 ? segments[index - 1] : undefined;
          switch (seg.type) {
            case 'arc-cubic': {
              const cpBX = seg.controlPointB.x * SHEET_UNITS_TO_PIXELS;
              const cpBY = seg.controlPointB.y * SHEET_UNITS_TO_PIXELS;
              const endX = seg.point.x * SHEET_UNITS_TO_PIXELS;
              const endY = seg.point.y * SHEET_UNITS_TO_PIXELS;
              graphics.moveTo(cpBX, cpBY);
              graphics.lineTo(cpBX, cpBY);
              graphics.stroke();
              graphics.moveTo(cpBX, cpBY);
              graphics.lineTo(endX, endY);
              graphics.stroke();

              if (prevSeg) {
                const cpAX = seg.controlPointA.x * SHEET_UNITS_TO_PIXELS;
                const cpAY = seg.controlPointA.y * SHEET_UNITS_TO_PIXELS;
                const startX = prevSeg.point.x * SHEET_UNITS_TO_PIXELS;
                const startY = prevSeg.point.y * SHEET_UNITS_TO_PIXELS;
                graphics.moveTo(cpAX, cpAY);
                graphics.lineTo(cpAX, cpAY);
                graphics.stroke();
                graphics.moveTo(cpAX, cpAY);
                graphics.lineTo(startX, startY);
                graphics.stroke();
              }
              break;
            }
            case 'arc-quadratic': {
              if (!prevSeg) {
                continue;
              }
              const startX = prevSeg.point.x * SHEET_UNITS_TO_PIXELS;
              const startY = prevSeg.point.y * SHEET_UNITS_TO_PIXELS;
              const controlX = seg.controlPoint.x * SHEET_UNITS_TO_PIXELS;
              const controlY = seg.controlPoint.y * SHEET_UNITS_TO_PIXELS;
              const endX = seg.point.x * SHEET_UNITS_TO_PIXELS;
              const endY = seg.point.y * SHEET_UNITS_TO_PIXELS;
              graphics.moveTo(startX, startY);
              graphics.lineTo(controlX, controlY);
              graphics.lineTo(endX, endY);
              graphics.stroke();
              break;
            }
          }
        }
      }}
    />
  );
}

/** Renders visual accessories on top of the polygon, like handles, bezier lines, etc. */
export const PolygonDecorationsRenderer: React.FunctionComponent<PolygonDecorationsRendererProps> = ({
  segments,
  closed,
  viewportScale,

  onVertexPointerDown,
  onVertexEnter,
  onVertexLeave,
  onControlPointerDown,
  firstHandleEventMode,
  lastHandleEventMode,

  isDragging = false,
}) => {
  return (
    <>
      <CurveControlPointHandlesSprites
        segments={segments}
        scale={viewportScale}
        onControlPointerDown={onControlPointerDown}
        isDragging={isDragging}
      />
      <HandleSprites
        points={(closed
          ? // NOTE: don't render the last handle because it's the same as the first handle
            segments.slice(0, -1)
          : segments
        ).map((seg) => seg.point)}
        handleTexture={VertexHandleTexture.get()}
        viewportScale={viewportScale}
        onHandlePointerDown={onVertexPointerDown}
        onHandleEnter={onVertexEnter}
        onHandleLeave={onVertexLeave}
        isDragging={isDragging}
        lastHandleEventMode={lastHandleEventMode}
        firstHandleEventMode={firstHandleEventMode}
      />
      <BezierLines segments={segments} scale={viewportScale} />
    </>
  );
};

const PolygonOverlay: React.FunctionComponent = () => {
  const { activeTool, viewportControls, geometryStore, viewportScale } = useViewportContext();
  const selectedIds = useSelectionManagerSelectedIds();
  const draggingShapeState = useDraggingShapeState();
  const closestPointToSegment = useClosestPointToSegment();

  const geometries = useGeometries(geometryStore);
  const idPolygonDataPairs = useMemo(
    () => geometries.flatMap((g) => {
      const data = GeometryComponent.get(g);
      if (data.type === 'polygon') {
        return [[g.id, data] as const];
      } else {
        return [];
      }
    }),
    [geometries],
  );
  const selectedIdPolygonDataPairs = useMemo(
    () => idPolygonDataPairs.filter(([id, _data]) => {
      return selectedIds.includes(id);
    }),
    [idPolygonDataPairs, selectedIds],
  );

  const onLineSegmentEdgeHitDetectorPointerDown = useCallback(
    (polygonId: Geometry['id'], segmentIndex: number) => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      if (!closestPointToSegment) {
        return;
      }
      activeTool.addPointOnLineSegmentEdge(polygonId, segmentIndex, closestPointToSegment.point);
    },
    [activeTool, viewportControls, closestPointToSegment],
  );
  const onLineSegmentEdgeHitDetectorEnter = useCallback(
    (polygonId: Geometry['id'], segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onEnterPolygonSegment(viewportControls, polygonId, segmentIndex);
      }
    },
    [viewportControls],
  );
  const onLineSegmentEdgeHitDetectorLeave = useCallback(
    (polygonId: Geometry['id'], segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onLeavePolygonSegment(viewportControls, polygonId, segmentIndex);
      }
    },
    [activeTool, viewportControls],
  );
  const onQuadraticEdgeHitDetectorPointerDown = useCallback(
    (polygonId: Geometry['id'], segmentIndex: number) => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      if (!closestPointToSegment) {
        return;
      }
      activeTool.addPointOnQuadraticEdge(polygonId, segmentIndex, closestPointToSegment.point);
    },
    [activeTool, viewportControls, closestPointToSegment],
  );
  const onQuadraticEdgeHitDetectorEnter = useCallback(
    (polygonId: Geometry['id'], segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onEnterPolygonSegment(viewportControls, polygonId, segmentIndex);
      }
    },
    [activeTool, viewportControls],
  );
  const onQuadraticEdgeHitDetectorLeave = useCallback(
    (polygonId: Geometry['id'], segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onLeavePolygonSegment(viewportControls, polygonId, segmentIndex);
      }
    },
    [viewportControls, activeTool],
  );
  const onCubicEdgeHitDetectorPointerDown = useCallback(
    (polygonId: Geometry['id'], segmentIndex: number) => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      if (!closestPointToSegment) {
        return;
      }
      activeTool.addPointOnCubicEdge(polygonId, segmentIndex, closestPointToSegment.point);
    },
    [activeTool, viewportControls, closestPointToSegment],
  );
  const onCubicEdgeHitDetectorEnter = useCallback(
    (polygonId: Geometry['id'], segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onEnterPolygonSegment(viewportControls, polygonId, segmentIndex);
      }
    },
    [activeTool, viewportControls],
  );
  const onCubicEdgeHitDetectorLeave = useCallback(
    (polygonId: Geometry['id'], segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onLeavePolygonSegment(viewportControls, polygonId, segmentIndex);
      }
    },
    [activeTool, viewportControls],
  );

  // By default, render decorations for all selected polygons
  let decoratedPolygons = selectedIdPolygonDataPairs;
  if (activeTool.type === 'polygon') {
    // If the polygon tool is active though, render decorations for all non closed polygons
    // This is needed so that a user can extend a polygon from any point
    //
    // FIXME: actually though, what is really wanted here is I think only rendering the start / end
    // ppint of non closed polygons in this situation...
    decoratedPolygons = idPolygonDataPairs.filter(([_id, data]) => !data.closed);
  }

  return (
    <>
      {decoratedPolygons.map(([id, polygonData]) => {
        const segments = polygonData.points;

        return (
          <Fragment key={id}>
            {activeTool.type === 'select' ? (
              <>
                {/* line segment edge detectors */}
                {segments.slice(1).map((seg, i) => {
                  if (seg.type !== 'point') {
                    return null;
                  }
                  const prevSeg = segments[i];
                  if (!prevSeg) {
                    return null;
                  }
                  return (
                    <LineSegmentEdgeHitDetector
                      key={`edge-${i}`}
                      startPosition={prevSeg.point}
                      endPosition={seg.point}
                      scale={viewportScale}
                      onPointerEnter={() => onLineSegmentEdgeHitDetectorEnter(id, i)}
                      onPointerLeave={() => onLineSegmentEdgeHitDetectorLeave(id, i)}
                      onPointerDown={() => onLineSegmentEdgeHitDetectorPointerDown(id, i)}
                    />
                  );
                })}

                {/* quadratic / cubic edge detectors */}
                {segments.slice(1).map((seg, i) => {
                  if (seg.type === 'point') {
                    return null;
                  }
                  const prevSeg = segments[i];
                  if (!prevSeg) {
                    return null;
                  }

                  if (seg.type === 'arc-quadratic' && onQuadraticEdgeHitDetectorPointerDown) {
                    const curve: QuadraticCurve<SheetPosition> = {
                      start: prevSeg.point,
                      end: seg.point,
                      controlPoint: seg.controlPoint,
                    };
                    return (
                      <CurveEdgeHitDetector
                        key={`curve-edge-${i}`}
                        curve={curve}
                        scale={viewportScale}
                        onPointerEnter={() => onQuadraticEdgeHitDetectorEnter(id, i)}
                        onPointerLeave={() => onQuadraticEdgeHitDetectorLeave(id, i)}
                        onPointerDown={() => onQuadraticEdgeHitDetectorPointerDown(id, i)}
                      />
                    );
                  } else if (seg.type === 'arc-cubic' && onCubicEdgeHitDetectorPointerDown) {
                    const curve: CubicCurve<SheetPosition> = {
                      start: prevSeg.point,
                      end: seg.point,
                      controlPointA: seg.controlPointA,
                      controlPointB: seg.controlPointB,
                    };
                    return (
                      <CurveEdgeHitDetector
                        key={`curve-edge-${i}`}
                        curve={curve}
                        scale={viewportScale}
                        onPointerEnter={() => onCubicEdgeHitDetectorEnter(id, i)}
                        onPointerLeave={() => onCubicEdgeHitDetectorLeave(id, i)}
                        onPointerDown={() => onCubicEdgeHitDetectorPointerDown(id, i)}
                      />
                    );
                  }
                  return null;
                })}
              </>
            ) : null}

            <PolygonDecorationsRenderer
              segments={polygonData.points}
              closed={polygonData.closed}
              viewportScale={viewportScale}
              isDragging={
                draggingShapeState?.type === 'polygon' &&
                draggingShapeState.polygonId === id
              }
              onVertexEnter={(_e, index) => {
                if (activeTool.type === 'polygon') {
                  if (index === 0) {
                    activeTool.setHoveringEndpointOfPolygon({
                      polygonId: id,
                      pointIndex: 0,
                      isStartPoint: true,
                    });
                  }
                  if (index === polygonData.points.length - 1) {
                    activeTool.setHoveringEndpointOfPolygon({
                      polygonId: id,
                      pointIndex: 0,
                      isStartPoint: false,
                    });
                  }
                }
              }}
              onVertexLeave={(_e, index) => {
                if (activeTool.type === 'polygon') {
                  if (index === 0) {
                    activeTool.setHoveringEndpointOfPolygon(null);
                  }
                  if (index === polygonData.points.length - 1) {
                    activeTool.setHoveringEndpointOfPolygon(null);
                  }
                }
              }}
              onVertexPointerDown={(e, segmentIndex) => {
                if (activeTool.type !== 'select') {
                  return;
                }
                if (!viewportControls) {
                  return;
                }
                activeTool.onVertexPointerDown(
                  new ScreenPosition(e.clientX, e.clientY),
                  viewportControls,
                  id,
                  segmentIndex,
                );
              }}
              onControlPointerDown={(e, segmentIndex, pointKey) => {
                if (activeTool.type !== 'select') {
                  return;
                }
                if (!viewportControls) {
                  return;
                }
                activeTool.onControlPointerDown(
                  new ScreenPosition(e.clientX, e.clientY),
                  viewportControls,
                  id,
                  segmentIndex,
                  pointKey,
                );
              }}
            />
          </Fragment>
        );
      })}
    </>
  );
};

/** Renders all polygons currently on the sheet. */
export const GeometryLayers: ListLayers<Geometry, React.ReactNode> = {
  [RendererLayers.Solids]: (geometry) => <GeometrySolid geometry={geometry} />,
  [RendererLayers.Overlays]: <PolygonOverlay />,
};
