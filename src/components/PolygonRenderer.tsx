import { EventMode, FederatedPointerEvent, Graphics } from 'pixi.js';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { useClosestPointToSegment } from '@/hooks/useClosestPointToSegment';
import { useDraggingShapeState } from '@/hooks/useDraggingShapeState';
import { usePolygons } from '@/hooks/usePolygons';
import { useSelectionManagerSelectedIds } from '@/hooks/useSelectionManagerSelectedIds';
import { useWorkingPolygon } from '@/hooks/useWorkingPolygon';
import { FillColorComponent, type Polygon, PolygonComponent, PolygonSegment } from '@/lib/geometry';
import { KeyCombo } from '@/lib/index-mapper';
import { BoundingBox, CohenSutherland } from '@/lib/math';
import { ListLayers, RendererLayers, SingleLayers } from '@/lib/renderer';
import { SHEET_UNITS_TO_PIXELS } from '@/lib/sheet/Sheet';
import {
  IntersectionVertexHandleTexture,
  SELECTION_HINT_WIDTH_PX,
  VertexHandleTexture,
} from '@/lib/textures';
import { PreviewSegmentIntersection } from '@/lib/tools/PolygonTool';
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

export const WorkingPolygonRenderer: React.FunctionComponent = () => {
  const { viewportScale, activeTool } = useViewportContext();
  const workingPolygon = useWorkingPolygon();

  const [previewSegmentIntersections, setPreviewSegmentIntersections] = useState<
    Array<PreviewSegmentIntersection>
  >([]);
  const [previewSegmentIntersectionsEnabled, setPreviewSegmentIntersectionsEnabled] = useState(
    new Set<KeyCombo>(),
  );
  const [committedIntersectionPoints, setCommittedIntersectionPoints] = useState<
    Array<SheetPosition>
  >([]);
  useEffect(() => {
    if (activeTool.type !== 'polygon') {
      return;
    }

    activeTool.on('previewSegmentIntersections', setPreviewSegmentIntersections);
    activeTool.on('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
    activeTool.on('committedIntersectionsChanged', setCommittedIntersectionPoints);
    return () => {
      activeTool.off('previewSegmentIntersections', setPreviewSegmentIntersections);
      activeTool.off('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
      activeTool.off('committedIntersectionsChanged', setCommittedIntersectionPoints);
    };
  }, [activeTool]);

  if (!workingPolygon || activeTool.type !== 'polygon') {
    return null;
  }

  return (
    <>
      <PolygonShapeRenderer segments={workingPolygon.points} viewportScale={viewportScale} />

      <PolygonDecorationsRenderer
        segments={workingPolygon.points}
        closed={false}
        viewportScale={viewportScale}
        onVertexEnter={(_e, index) => {
          if (
            workingPolygon.source.type === 'existing-polygon' &&
            workingPolygon.source.isStartPoint
          ) {
            if (index === workingPolygon.points.length - 1) {
              activeTool.setHoveringFirstHandle(true);
            }
          } else {
            if (index === 0) {
              activeTool.setHoveringFirstHandle(true);
            }
          }
        }}
        onVertexLeave={(_e, index) => {
          if (
            workingPolygon.source.type === 'existing-polygon' &&
            workingPolygon.source.isStartPoint
          ) {
            if (index === workingPolygon.points.length - 1) {
              activeTool.setHoveringFirstHandle(false);
            }
          } else {
            if (index === 0) {
              activeTool.setHoveringFirstHandle(false);
            }
          }
        }}
        // IMPORTANT: Make sure this is set so that clicks don't get "trapped" by the final
        // handle since it is always under the cursor.
        firstHandleEventMode={
          workingPolygon.source.type === 'existing-polygon' && workingPolygon.source.isStartPoint
            ? 'none'
            : undefined
        }
        lastHandleEventMode={
          workingPolygon.source.type === 'existing-polygon' && workingPolygon.source.isStartPoint
            ? undefined
            : 'none'
        }
      />

      {/* Render any intersection points. */}
      <HandleSprites
        points={[
          ...previewSegmentIntersections
            .filter((inters) => previewSegmentIntersectionsEnabled.has(inters.keyCombo))
            .map((inters) => inters.point),
          ...committedIntersectionPoints,
        ]}
        handleTexture={VertexHandleTexture.get()}
        viewportScale={viewportScale}
      />
      <HandleSprites
        points={previewSegmentIntersections
          .filter((inters) => !previewSegmentIntersectionsEnabled.has(inters.keyCombo))
          .map((inters) => inters.point)}
        handleTexture={IntersectionVertexHandleTexture.get()}
        viewportScale={viewportScale}
      />
    </>
  );
};

/** Renders the "working polygon" - the polygon currently being created by the user when using the
 * polygon tool. */
export const WorkingPolygonLayers: SingleLayers<React.ReactNode> = {
  [RendererLayers.Overlays]: <WorkingPolygonRenderer />,
};

type PolygonRendererProps = {
  segments: Array<PolygonSegment>;
  closed?: boolean;
  fillColor?: number | null;
  stroke?: number;
  viewportScale: number;
  showHintStroke?: boolean;
  onFillPointerDown?: (e: FederatedPointerEvent) => void;
  onFillPointerOver?: (e: FederatedPointerEvent) => void;
  onFillPointerOut?: (e: FederatedPointerEvent) => void;
  eventMode?: EventMode;
};

/** Renders a polygon shape to the screen. Just draws the polygon - all other extra ui elements are
 * left to the caller to layer on top. */
const PolygonShapeRenderer: React.FunctionComponent<PolygonRendererProps> = ({
  segments,
  closed = false,
  fillColor = null,
  stroke = 0x000000,
  viewportScale,
  showHintStroke = false,
  onFillPointerDown,
  onFillPointerOver,
  onFillPointerOut,
  eventMode,
}) => {
  const polygonBounds = useMemo(() => {
    return BoundingBox.fromPoints(segments.map((s) => s.point));
  }, [segments]);

  const polygonBoundsInPixels = useMemo(() => {
    return {
      width: polygonBounds.width * SHEET_UNITS_TO_PIXELS * viewportScale,
      height: polygonBounds.height * SHEET_UNITS_TO_PIXELS * viewportScale,
    };
  }, [polygonBounds, viewportScale]);

  const drawPolygon = useCallback(
    (graphics: Graphics) => {
      if (segments.length < 2) {
        return;
      }

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

      if (closed && typeof fillColor !== 'undefined') {
        if (fillColor !== null) {
          graphics.setFillStyle({ color: fillColor });
        } else {
          graphics.setFillStyle({ color: 0x000000, alpha: 0 });
        }
        if (shouldUsePolyFill) {
          graphics.poly(viewportPoints.flatMap((p) => [p.x, p.y]));
          graphics.fill();
        } else {
          // Build fill path with proper curve commands
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

      if (showHintStroke) {
        graphics.setStrokeStyle({
          color: stroke,
          width: SELECTION_HINT_WIDTH_PX / viewportScale,
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
        color: stroke,
        width: 1 / viewportScale,
      });
      graphics.moveTo(viewportPoints[0].x, viewportPoints[0].y);
      for (let i = 1; i < segments.length; i++) {
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
    [viewportScale, segments, closed, fillColor, stroke, polygonBoundsInPixels, showHintStroke],
  );

  return (
    <pixiGraphics
      draw={drawPolygon}
      eventMode={eventMode}
      onPointerDown={onFillPointerDown}
      onPointerOver={onFillPointerOver}
      onPointerOut={onFillPointerOut}
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

const PolygonSolid: React.FunctionComponent<{ polygon: Polygon }> = ({ polygon }) => {
  const { activeTool, viewportControls, viewportScale, mouseScreenPos } = useViewportContext();
  const polygonData = PolygonComponent.get(polygon);

  const draggingShapeState = useDraggingShapeState();

  const fillColor = FillColorComponent.getOptional(polygon);
  const stroke = 0x000000;
  const isDragging =
    draggingShapeState?.type === 'polygon' && draggingShapeState.polygonId === polygon.id;

  const selectedIds = useSelectionManagerSelectedIds();
  const isSelected = selectedIds.includes(polygon.id);
  const eventMode = activeTool.type === 'select' || isSelected ? 'static' : 'none';

  const onFillPointerDown = useCallback(
    (e: FederatedPointerEvent) => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      activeTool.onGeometryFillPointerDown?.(
        new ScreenPosition(e.clientX, e.clientY),
        viewportControls,
        polygon.id,
      );
    },
    [activeTool],
  );

  const onFillPointerOver = useCallback(() => {
    if (activeTool.type === 'select') {
      activeTool.onEnterGeometryFill(polygon.id);
    }
  }, [activeTool, polygon.id]);

  const onFillPointerOut = useCallback(() => {
    if (activeTool.type === 'select') {
      activeTool.onLeaveGeometryFill(polygon.id);
    }
  }, [activeTool, polygon.id]);

  const segments = polygonData.points;

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

  return (
    <>
      <PolygonShapeRenderer
        segments={polygonData.points}
        closed={polygonData.closed}
        fillColor={fillColor}
        stroke={stroke}
        viewportScale={viewportScale}
        showHintStroke={isSelected && selectedIds.length > 1}
        eventMode={isDragging ? 'none' : eventMode}
        onFillPointerDown={onFillPointerDown}
        onFillPointerOver={onFillPointerOver}
        onFillPointerOut={onFillPointerOut}
      />

      {/* Edge detectors for non-closed, non-selected polygons based on mouse proximity.
       * Only renders detectors for segments that might intersect the proximity AABB.
       * This makes it easier to select edges on open polygons. */}
      {!closed && !isSelected && mousePositionProximityAABB ? (
        <>
          {segments.slice(1).map((seg, i) => {
            const prevSeg = segments[i];
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
const PolygonDecorationsRenderer: React.FunctionComponent<PolygonDecorationsRendererProps> = ({
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

  const polygons = usePolygons(geometryStore);
  const selectedPolygons = useMemo(
    () => polygons.filter((e) => selectedIds.includes(e.id)),
    [polygons, selectedIds],
  );

  const onLineSegmentEdgeHitDetectorPointerDown = useCallback(
    (polygon: Polygon, segmentIndex: number) => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      if (!closestPointToSegment) {
        return;
      }
      activeTool.addPointOnLineSegmentEdge(polygon.id, segmentIndex, closestPointToSegment.point);
    },
    [activeTool, viewportControls, closestPointToSegment],
  );
  const onLineSegmentEdgeHitDetectorEnter = useCallback(
    (polygon: Polygon, segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onEnterPolygonSegment(viewportControls, polygon.id, segmentIndex);
      }
    },
    [viewportControls],
  );
  const onLineSegmentEdgeHitDetectorLeave = useCallback(
    (polygon: Polygon, segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onLeavePolygonSegment(viewportControls, polygon.id, segmentIndex);
      }
    },
    [activeTool, viewportControls],
  );
  const onQuadraticEdgeHitDetectorPointerDown = useCallback(
    (polygon: Polygon, segmentIndex: number) => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      if (!closestPointToSegment) {
        return;
      }
      activeTool.addPointOnQuadraticEdge(polygon.id, segmentIndex, closestPointToSegment.point);
    },
    [activeTool, viewportControls, closestPointToSegment],
  );
  const onQuadraticEdgeHitDetectorEnter = useCallback(
    (polygon: Polygon, segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onEnterPolygonSegment(viewportControls, polygon.id, segmentIndex);
      }
    },
    [activeTool, viewportControls],
  );
  const onQuadraticEdgeHitDetectorLeave = useCallback(
    (polygon: Polygon, segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onLeavePolygonSegment(viewportControls, polygon.id, segmentIndex);
      }
    },
    [viewportControls, activeTool],
  );
  const onCubicEdgeHitDetectorPointerDown = useCallback(
    (polygon: Polygon, segmentIndex: number) => {
      if (activeTool.type !== 'select') {
        return;
      }
      if (!viewportControls) {
        return;
      }
      if (!closestPointToSegment) {
        return;
      }
      activeTool.addPointOnCubicEdge(polygon.id, segmentIndex, closestPointToSegment.point);
    },
    [activeTool, viewportControls, closestPointToSegment],
  );
  const onCubicEdgeHitDetectorEnter = useCallback(
    (polygon: Polygon, segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onEnterPolygonSegment(viewportControls, polygon.id, segmentIndex);
      }
    },
    [activeTool, viewportControls],
  );
  const onCubicEdgeHitDetectorLeave = useCallback(
    (polygon: Polygon, segmentIndex: number) => {
      if (activeTool.type === 'select' && viewportControls) {
        activeTool.onLeavePolygonSegment(viewportControls, polygon.id, segmentIndex);
      }
    },
    [activeTool, viewportControls],
  );

  // By default, render decorations for all selected polygons
  let decoratedPolygons = selectedPolygons;
  if (activeTool.type === 'polygon') {
    // If the polygon tool is active though, render decorations for all non closed polygons
    // This is needed so that a user can extend a polygon from any point
    //
    // FIXME: actually though, what is really wanted here is I think only rendering the start / end
    // ppint of non closed polygons in this situation...
    decoratedPolygons = polygons.filter((p) => !PolygonComponent.get(p).closed);
  }

  return (
    <>
      {decoratedPolygons.map((polygon) => {
        const polygonData = PolygonComponent.get(polygon);
        const segments = polygonData.points;

        return (
          <Fragment key={polygon.id}>
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
                      onPointerEnter={() => onLineSegmentEdgeHitDetectorEnter(polygon, i)}
                      onPointerLeave={() => onLineSegmentEdgeHitDetectorLeave(polygon, i)}
                      onPointerDown={() => onLineSegmentEdgeHitDetectorPointerDown(polygon, i)}
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
                        onPointerEnter={() => onQuadraticEdgeHitDetectorEnter?.(polygon, i)}
                        onPointerLeave={() => onQuadraticEdgeHitDetectorLeave?.(polygon, i)}
                        onPointerDown={() => onQuadraticEdgeHitDetectorPointerDown?.(polygon, i)}
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
                        onPointerEnter={() => onCubicEdgeHitDetectorEnter?.(polygon, i)}
                        onPointerLeave={() => onCubicEdgeHitDetectorLeave?.(polygon, i)}
                        onPointerDown={() => onCubicEdgeHitDetectorPointerDown?.(polygon, i)}
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
                draggingShapeState.polygonId === polygon.id
              }
              onVertexEnter={(_e, index) => {
                if (activeTool.type === 'polygon') {
                  if (index === 0) {
                    activeTool.setHoveringEndpointOfPolygon({
                      polygonId: polygon.id,
                      pointIndex: 0,
                      isStartPoint: true,
                    });
                  }
                  if (index === polygonData.points.length - 1) {
                    activeTool.setHoveringEndpointOfPolygon({
                      polygonId: polygon.id,
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
                  polygon.id,
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
                  polygon.id,
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
export const PolygonLayers: ListLayers<Polygon, React.ReactNode> = {
  [RendererLayers.Solids]: (polygon) => <PolygonSolid polygon={polygon} />,
  [RendererLayers.Overlays]: <PolygonOverlay />,
};
