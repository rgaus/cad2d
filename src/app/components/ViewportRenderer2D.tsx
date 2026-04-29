"use client";

import { useCallback, useEffect, useRef, useState, useMemo, createContext, useContext } from "react";
import { Application, extend } from "@pixi/react";
import { Container, EventMode, FederatedPointerEvent, Graphics, Sprite, Texture } from "pixi.js";
import { ViewportControls } from "@/lib/viewport/ViewportControls";
import { Rect, ScreenPosition, SheetPosition, ViewportControlsState, QuadraticCurve, CubicCurve } from "@/lib/viewport/types";
import { getGridAtScale } from "@/lib/viewport/grid";
import { type Tool, ToolManager } from "@/lib/tools/ToolManager";
import { SelectionManager } from "@/lib/tools/SelectionManager";
import { SHEET_UNITS_TO_PIXELS, Sheets, type Sheet } from "@/lib/sheet/Sheet";
import { type Polygon, type WorkingPolygon, type PolygonSegment, type Rectangle, type WorkingRectangle, type Ellipse, type WorkingEllipse } from "@/lib/tools/types";
import { boundingBox, cornersToList, midPoint, quadraticBezierControlFromMidpoint, rectCorners, rectInset, CohenSutherland, proximityBoundingBox } from "@/lib/math";
import DimensionLineConstrait from "./DimensionLineConstrait";
import { getVertexHandleTexture, getCurveControlPointHandleTexture, getSelectionCornerHandleTexture, getIntersectionVertexHandleTexture, SELECTION_COLOR } from "@/lib/textures";
import { HoverTooltip } from "./HoverTooltip";
import { PolygonTool, PreviewSegmentIntersections } from "@/lib/tools/PolygonTool";
import { KeyboardShortcut } from "./KeyboardShortcut";
import FitToScreenButton from "./FitToScreenButton";
import { SELECTED_OUTSET_PX } from "@/lib/tools/SelectTool";
import { type DraggingShapeState } from "@/lib/tools/types";
import { KeyCombo } from "@/lib/index-mapper";

extend({
  Container,
  Graphics,
  Sprite,
});

type ViewportRenderer2DProps = {
  sheet: Sheet;
  toolManager: ToolManager;
  selectionManager: SelectionManager;
};

function HandleSprites({ points, handleTexture, viewportScale, onFirstHandleClick, onFirstHandleEnter, onFirstHandleLeave, onVertexPointerDown, lastHandleEventMode, isDragging }: {
  points: Array<SheetPosition>;
  handleTexture: Texture;
  viewportScale: number;
  onFirstHandleClick?: (event: FederatedPointerEvent) => void;
  onFirstHandleEnter?: () => void;
  onFirstHandleLeave?: () => void;
  onVertexPointerDown?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  lastHandleEventMode?: EventMode;
  isDragging?: boolean;
}) {
  const spriteScale = 1 / viewportScale;
  if (points.length === 0) {
    return null;
  }

  return (
    <>
      {points.map((point, index) => {
        let eventMode: EventMode = "none";
        let cursor = "default";

        if (isDragging) {
          eventMode = "none";
          cursor = "default";
        } else if (onVertexPointerDown) {
          eventMode = "static";
          cursor = "pointer";
        } else {
          if (index === 0 && (onFirstHandleClick || onFirstHandleEnter || onFirstHandleLeave)) {
            eventMode = "static";
          }
          if (index === points.length - 1 && lastHandleEventMode) {
            eventMode = lastHandleEventMode;
          }
        }

        return (
          <pixiSprite
            key={index}
            texture={handleTexture}
            x={point.x * SHEET_UNITS_TO_PIXELS}
            y={point.y * SHEET_UNITS_TO_PIXELS}
            anchor={0.5}
            scale={spriteScale}
            eventMode={eventMode}
            cursor={cursor}
            {...(onVertexPointerDown ? {
              onPointerDown: (e: FederatedPointerEvent) => {
                onVertexPointerDown(e, index);
              }
            } : (index === 0 ? {
              ...(onFirstHandleClick ? { onPointerDown: onFirstHandleClick } : {}),
              ...(onFirstHandleEnter ? { onPointerEnter: onFirstHandleEnter } : {}),
              ...(onFirstHandleLeave ? { onPointerLeave: onFirstHandleLeave } : {}),
            } : {}))}
          />
        );
      })}
    </>
  );
}

function CurveControlPointHandlesSprites({ segments, scale, onControlPointerDown, isDragging }: {
  segments: Array<PolygonSegment>;
  scale: number;
  onControlPointerDown?: (event: FederatedPointerEvent, segmentIndex: number, pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB') => void;
  isDragging?: boolean;
}) {
  const spriteScale = 1 / scale;
  const controlPointInfos: Array<{ point: SheetPosition; segmentIndex: number; pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB' }> = [];
  
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'arc-quadratic') {
      controlPointInfos.push({ point: seg.controlPoint, segmentIndex: i, pointKey: 'controlPoint' });
    } else if (seg.type === 'arc-cubic') {
      controlPointInfos.push({ point: seg.controlPointA, segmentIndex: i, pointKey: 'controlPointA' });
      controlPointInfos.push({ point: seg.controlPointB, segmentIndex: i, pointKey: 'controlPointB' });
    }
  }

  if (controlPointInfos.length === 0) return null;

  const effectiveEventMode = isDragging ? "none" : (onControlPointerDown ? "static" : "none");
  const effectiveCursor = isDragging ? "default" : (onControlPointerDown ? "pointer" : "default");

  return (
    <>
      {controlPointInfos.map((info, index) => (
        <pixiSprite
          key={index}
          texture={getCurveControlPointHandleTexture()}
          x={info.point.x * SHEET_UNITS_TO_PIXELS}
          y={info.point.y * SHEET_UNITS_TO_PIXELS}
          anchor={0.5}
          scale={spriteScale}
          eventMode={effectiveEventMode}
          cursor={effectiveCursor}
          {...(onControlPointerDown && !isDragging ? {
            onPointerDown: (e: FederatedPointerEvent) => {
              onControlPointerDown(e, info.segmentIndex, info.pointKey);
            }
          } : {})}
        />
      ))}
    </>
  );
}

/** Width in pixels of edge hit detectors for selected polygons (used for resizing handles). */
const LINEAR_RESIZER_WIDTH_PX = 16;

/** Radius in pixels around the mouse cursor for proximity-based edge detector culling.
 * Only polygon segments that intersect this bounding box will have edge detectors rendered.
 * This makes it easier to select edges on non-closed, non-selected polygons. */
const PROXIMITY_EDGE_DETECTOR_RADIUS_PX = 64;

/**
 * Computes the position, length, and angle for rendering a sprite along a line segment.
 * Returns { centerX, centerY, length, angleDegrees } all in pixel coordinates.
 */
function computeLineSpriteTransform(startPosition: SheetPosition, endPosition: SheetPosition): {
  centerX: number;
  centerY: number;
  length: number;
  angleDegrees: number;
} {
  const startX = startPosition.x * SHEET_UNITS_TO_PIXELS;
  const startY = startPosition.y * SHEET_UNITS_TO_PIXELS;
  const endX = endPosition.x * SHEET_UNITS_TO_PIXELS;
  const endY = endPosition.y * SHEET_UNITS_TO_PIXELS;

  const centerX = (startX + endX) / 2;
  const centerY = (startY + endY) / 2;

  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);

  const angleRadians = Math.atan2(dy, dx);
  const angleDegrees = angleRadians * (180 / Math.PI);

  return { centerX, centerY, length, angleDegrees };
}

const LinearResizer: React.FunctionComponent<{
  startPosition: SheetPosition;
  endPosition: SheetPosition;
  scale: number;
  onPointerDown?: (event: FederatedPointerEvent) => void;
}> = ({
  startPosition,
  endPosition,
  scale,
  onPointerDown,
}) => {
  const transform = useMemo(() => {
    return computeLineSpriteTransform(startPosition, endPosition);
  }, [startPosition, endPosition]);

  const cursor = useMemo(() => {
    let normalizedAngleDegrees = transform.angleDegrees;
    while (normalizedAngleDegrees > 360) { normalizedAngleDegrees -= 360; }
    while (normalizedAngleDegrees < 0) { normalizedAngleDegrees += 360; }

    if (normalizedAngleDegrees < 45) {
      return "ns-resize";
    } else if (normalizedAngleDegrees < 90) {
      return "ne-resize";
    } else if (normalizedAngleDegrees < 90+45) {
      return "ew-resize";
    } else if (normalizedAngleDegrees < 180) {
      return "se-resize";
    } else if (normalizedAngleDegrees < 180+45) {
      return "ns-resize";
    } else if (normalizedAngleDegrees < 120) {
      return "sw-resize";
    } else if (normalizedAngleDegrees < 270+45) {
      return "ew-resize";
    } else {
      return "nw-resize";
    }
  }, [transform.angleDegrees]);

  return (
    <pixiSprite
      texture={Texture.WHITE}
      alpha={0}
      x={transform.centerX}
      y={transform.centerY}
      angle={transform.angleDegrees + 90}
      anchor={{ x: 0.5, y: 0.5 }}
      scale={{
        x: LINEAR_RESIZER_WIDTH_PX / scale,
        y: transform.length,
      }}
      eventMode="static"
      cursor={cursor}
      onPointerDown={onPointerDown}
    />
  );
}

type LineSegmentEdgeHitDetectorProps = {
  startPosition: SheetPosition;
  endPosition: SheetPosition;
  scale: number;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onPointerDown?: (event: FederatedPointerEvent) => void;
};

const LineSegmentEdgeHitDetector: React.FunctionComponent<LineSegmentEdgeHitDetectorProps> = ({
  startPosition,
  endPosition,
  scale,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
}) => {
  const transform = useMemo(() => {
    return computeLineSpriteTransform(startPosition, endPosition);
  }, [startPosition, endPosition]);

  return (
    <pixiSprite
      texture={Texture.WHITE}
      // tint={0xff0000}
      alpha={0}
      x={transform.centerX}
      y={transform.centerY}
      angle={transform.angleDegrees + 90}
      anchor={{ x: 0.5, y: 0.5 }}
      scale={{
        x: LINEAR_RESIZER_WIDTH_PX / scale,
        y: transform.length,
      }}
      eventMode="static"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
    />
  );
};

type CurveEdgeHitDetectorProps = {
  curve: QuadraticCurve<SheetPosition> | CubicCurve<SheetPosition>;
  scale: number;
  onPointerEnter?: (event: FederatedPointerEvent) => void;
  onPointerLeave?: (event: FederatedPointerEvent) => void;
  onPointerDown?: (event: FederatedPointerEvent) => void;
};

const CurveEdgeHitDetector: React.FunctionComponent<CurveEdgeHitDetectorProps> = ({
  curve,
  scale,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
}) => {
  const hitWidth = LINEAR_RESIZER_WIDTH_PX / scale;

  const drawHitArea = useCallback((graphics: Graphics) => {
    graphics.clear();

    if ('controlPointA' in curve) {
      graphics.moveTo(curve.start.x, curve.start.y);
      graphics.bezierCurveTo(
        curve.controlPointA.x, curve.controlPointA.y,
        curve.controlPointB.x, curve.controlPointB.y,
        curve.end.x, curve.end.y,
      );
      graphics.stroke({ width: hitWidth, color: 0xffffff });
    } else {
      graphics.moveTo(curve.start.x * SHEET_UNITS_TO_PIXELS, curve.start.y * SHEET_UNITS_TO_PIXELS);
      graphics.quadraticCurveTo(
        curve.controlPoint.x * SHEET_UNITS_TO_PIXELS, curve.controlPoint.y * SHEET_UNITS_TO_PIXELS,
        curve.end.x * SHEET_UNITS_TO_PIXELS, curve.end.y * SHEET_UNITS_TO_PIXELS,
      );
      graphics.stroke({ width: hitWidth, color: 0xffffff });
    }
  }, [curve, hitWidth]);

  return (
    <pixiGraphics
      draw={drawHitArea}
      eventMode="static"
      // tint={0x00ff00}
      alpha={0}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
    />
  );
};

type SelectionBoundingBoxProps = {
  boundingBox: Rect<SheetPosition>;
  viewportScale: number;
  onLinearResizerPointerDown?: (edge: 'top' | 'bottom' | 'left' | 'right') => void;
  onCornerHandlePointerDown?: (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => void;
};

const SelectionBoundingBox: React.FunctionComponent<SelectionBoundingBoxProps> = ({
  boundingBox,
  viewportScale,
  onLinearResizerPointerDown,
  onCornerHandlePointerDown,
}) => {
  const polygonBoundsCorners = useMemo(() => rectCorners(
    rectInset(boundingBox, -1 * (SELECTED_OUTSET_PX / SHEET_UNITS_TO_PIXELS / viewportScale))
  ), [boundingBox, viewportScale]);
  const polygonBoundsPoints = useMemo(() => cornersToList(polygonBoundsCorners), [polygonBoundsCorners]);

  const drawPolygonSelection = useCallback((graphics: Graphics) => {
    graphics.clear();

    graphics.setStrokeStyle({ color: SELECTION_COLOR, width: 1 / viewportScale });
    graphics.poly(polygonBoundsPoints.flatMap(p => [
      p.x * SHEET_UNITS_TO_PIXELS,
      p.y * SHEET_UNITS_TO_PIXELS,
    ]));
    graphics.stroke();
  }, [polygonBoundsPoints, viewportScale]);

  return (
    <pixiContainer>
      <pixiGraphics draw={drawPolygonSelection} eventMode="none" />

      <LinearResizer
        startPosition={polygonBoundsCorners.upperLeft}
        endPosition={polygonBoundsCorners.upperRight}
        scale={viewportScale}
        onPointerDown={() => onLinearResizerPointerDown?.('top')}
      />
      <LinearResizer
        startPosition={polygonBoundsCorners.upperRight}
        endPosition={polygonBoundsCorners.lowerRight}
        scale={viewportScale}
        onPointerDown={() => onLinearResizerPointerDown?.('right')}
      />
      <LinearResizer
        startPosition={polygonBoundsCorners.lowerLeft}
        endPosition={polygonBoundsCorners.lowerRight}
        scale={viewportScale}
        onPointerDown={() => onLinearResizerPointerDown?.('bottom')}
      />
      <LinearResizer
        startPosition={polygonBoundsCorners.upperLeft}
        endPosition={polygonBoundsCorners.lowerLeft}
        scale={viewportScale}
        onPointerDown={() => onLinearResizerPointerDown?.('left')}
      />

      <HandleSprites
        points={polygonBoundsPoints}
        handleTexture={getSelectionCornerHandleTexture()}
        viewportScale={viewportScale}
        onVertexPointerDown={(_e, index) => {
          switch (index) {
            case 0:
              return onCornerHandlePointerDown?.('top-left');
            case 1:
              return onCornerHandlePointerDown?.('top-right');
            case 2:
              return onCornerHandlePointerDown?.('bottom-right');
            case 3:
              return onCornerHandlePointerDown?.('bottom-left');
          }
        }}
      />
    </pixiContainer>
  );
};

function BezierLines({ segments, scale }: {
  segments: Array<PolygonSegment>;
  scale: number;
}) {
  const lineWidth = 1 / scale;
  const strokeColor = 0xaaaaaa;

  return (
    <pixiGraphics
      draw={(graphics: Graphics) => {
        graphics.clear();
        graphics.setStrokeStyle({ color: strokeColor, width: lineWidth });

        for (let index = 0; index < segments.length; index += 1) {
          const seg = segments[index];
          const prevSeg = index > 0 ? segments[index-1] : undefined;
          switch (seg.type) {
            case "arc-cubic": {
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
            case "arc-quadratic": {
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

function getStatusText(
  workingPolygon: WorkingPolygon | null,
  isHoveringFirstHandle: boolean,
  altHeld: boolean,
  arcDrawMode: "quadratic" | "cubic"
): string {
  if (!workingPolygon || workingPolygon.points.length === 0) {
    return 'Place first point';
  }
  if (workingPolygon.pendingArcEndPoint !== null) {
    const isClosingArc = workingPolygon.points.length > 0 &&
      workingPolygon.pendingArcEndPoint.x === workingPolygon.points[0].point.x &&
      workingPolygon.pendingArcEndPoint.y === workingPolygon.points[0].point.y;
    if (isClosingArc) {
      return arcDrawMode === 'quadratic'
        ? 'Arc: close with quadratic [b=cubic]'
        : 'Arc: close with cubic [m=quadratic]';
    }
    return arcDrawMode === 'quadratic'
      ? 'Arc: quadratic [b=cubic]'
      : 'Arc: cubic [m=quadratic]';
  }
  if (isHoveringFirstHandle) {
    return altHeld ? 'Arc: close with...' : 'Close polygon';
  }
  if (altHeld) {
    return 'Place arc endpoint';
  }
  return 'Place next point';
}

function getRectangleStatusText(
  workingRectangle: WorkingRectangle | null,
  isCenterMode: boolean,
  shiftHeld: boolean,
): string {
  if (!workingRectangle || workingRectangle.firstPoint === null) {
    return isCenterMode ? 'Click to set center' : 'Click to set first corner';
  }
  if (shiftHeld) {
    return 'Click to set opposite corner (square)';
  }
  return 'Click to set opposite corner';
}

function getEllipseStatusText(
  workingEllipse: WorkingEllipse | null,
  isCenterMode: boolean,
  shiftHeld: boolean,
): string {
  if (!workingEllipse || workingEllipse.firstPoint === null) {
    return isCenterMode ? 'Click to set center' : 'Click to set bounding box corner';
  }
  if (shiftHeld) {
    return 'Click to set radius (circle)';
  }
  return 'Click to set radius point';
}

type ViewportContextData = {
  viewportScale: number;
  sheet: Sheet;
  toolManager: ToolManager;
  activeTool: Tool;
  selectionManager: SelectionManager;
};
const ViewportContext = createContext<ViewportContextData | null>(null);
const useViewportContext = () => {
  const data = useContext(ViewportContext);
  if (!data) {
    throw new Error('useViewportContext: Not used from within a ViewportContext.');
  }
  return data;
};
const ViewportContextProvider = ViewportContext.Provider;

/**
 * Threshold (in pixels) below which polygon fill rendering falls back to the fast graphics.poly()
 * approach instead of using proper curve commands. Small polygons that would render tiny arcs
 * (especially when many are visible) are approximated with straight lines since users cannot
 * perceive the difference at that scale anyway. Increase to make more polygons use the fast
 * approximation, decrease for more accurate rendering.
 */
const MIN_POLYGON_HIGH_FIDELITY_SIZE_PX = 48;

type PolygonRendererProps = { 
  segments: Array<PolygonSegment>;
  closed?: boolean;

  fillColor?: number | null;
  stroke?: number;

  showHandles?: boolean;
  showDimensions?: boolean;

  selected?: boolean;
  
  /** Bounding box in sheet coordinates for mouse proximity culling.
   * When provided, only renders edge detectors for segments that might intersect this box.
   * Used to make selection easier for non-closed, non-selected polygons.
   */
  mousePositionProximityAABB?: Rect<SheetPosition> | null;
  
  onVertexPointerDown?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  onControlPointerDown?: (event: FederatedPointerEvent, segmentIndex: number, pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB') => void;

  onFirstHandleClick?: (event: FederatedPointerEvent) => void;
  onFirstHandleEnter?: () => void;
  onFirstHandleLeave?: () => void;
  onFillPointerDown?: (event: FederatedPointerEvent) => void;
  onCornerHandlePointerDown?: (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => void;
  onLinearResizerPointerDown?: (edge: 'top' | 'bottom' | 'left' | 'right') => void;
  onLineSegmentEdgeHitDetectorPointerDown?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  onLineSegmentEdgeHitDetectorEnter?: (segmentIndex: number) => void;
  onLineSegmentEdgeHitDetectorLeave?: () => void;
  onQuadraticEdgeHitDetectorPointerDown?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  onQuadraticEdgeHitDetectorEnter?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  onQuadraticEdgeHitDetectorLeave?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  onCubicEdgeHitDetectorPointerDown?: (event: FederatedPointerEvent, segmentIndex: number, sheetPos: SheetPosition) => void;
  onCubicEdgeHitDetectorEnter?: (segmentIndex: number, sheetPos: SheetPosition) => void;
  onCubicEdgeHitDetectorLeave?: () => void;
  isDragging?: boolean;
};

const PolygonRenderer: React.FunctionComponent<PolygonRendererProps> = ({
  segments,
  closed = false,
  fillColor = null,
  stroke = 0x000000,
  showHandles,
  showDimensions,
  selected,
  mousePositionProximityAABB,
  onVertexPointerDown,
  onControlPointerDown,
  onFirstHandleClick,
  onFirstHandleEnter,
  onFirstHandleLeave,
  onFillPointerDown,
  onCornerHandlePointerDown,
  onLinearResizerPointerDown,
  onLineSegmentEdgeHitDetectorPointerDown,
  onLineSegmentEdgeHitDetectorEnter,
  onLineSegmentEdgeHitDetectorLeave,
  onQuadraticEdgeHitDetectorPointerDown,
  onQuadraticEdgeHitDetectorEnter,
  onQuadraticEdgeHitDetectorLeave,
  onCubicEdgeHitDetectorPointerDown,
  onCubicEdgeHitDetectorEnter,
  onCubicEdgeHitDetectorLeave,
  isDragging,
}) => {
  const { viewportScale, activeTool, sheet } = useViewportContext();

  const isSelectMode = activeTool.type === 'select';

  const polygonBounds = useMemo(() => {
    return boundingBox(segments.map(s => s.point));
  }, [segments]);

  const polygonBoundsInPixels = useMemo(() => {
    return {
      width: polygonBounds.width * SHEET_UNITS_TO_PIXELS * viewportScale,
      height: polygonBounds.height * SHEET_UNITS_TO_PIXELS * viewportScale,
    };
  }, [polygonBounds, viewportScale]);

  const drawPolygon = useCallback((graphics: Graphics) => {
    if (segments.length < 2) {
      return;
    }

    graphics.clear();

    const viewportPoints = segments.map(s => ({
      x: s.point.x * SHEET_UNITS_TO_PIXELS,
      y: s.point.y * SHEET_UNITS_TO_PIXELS,
    }));

    // When polygon is small enough in pixels, use fast poly() approximation for fill.
    // Otherwise, build the proper path with curve commands.
    const shouldUsePolyFill = polygonBoundsInPixels.width < MIN_POLYGON_HIGH_FIDELITY_SIZE_PX &&
                              polygonBoundsInPixels.height < MIN_POLYGON_HIGH_FIDELITY_SIZE_PX;

    if (closed && fillColor !== null) {
      graphics.setFillStyle({ color: fillColor });
      if (shouldUsePolyFill) {
        graphics.poly(viewportPoints.flatMap(p => [p.x, p.y]));
        graphics.fill();
      } else {
        // Build fill path with proper curve commands
        graphics.moveTo(viewportPoints[0].x, viewportPoints[0].y);
        for (let i = 1; i < segments.length; i++) {
          const seg = segments[i];
          if (seg.type === "point") {
            graphics.lineTo(seg.point.x * SHEET_UNITS_TO_PIXELS, seg.point.y * SHEET_UNITS_TO_PIXELS);
          } else if (seg.type === "arc-quadratic") {
            graphics.quadraticCurveTo(
              seg.controlPoint.x * SHEET_UNITS_TO_PIXELS,
              seg.controlPoint.y * SHEET_UNITS_TO_PIXELS,
              seg.point.x * SHEET_UNITS_TO_PIXELS,
              seg.point.y * SHEET_UNITS_TO_PIXELS,
            );
          } else if (seg.type === "arc-cubic") {
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
          if (lastSeg.type === "arc-cubic") {
            graphics.bezierCurveTo(
              lastSeg.controlPointB.x * SHEET_UNITS_TO_PIXELS,
              lastSeg.controlPointB.y * SHEET_UNITS_TO_PIXELS,
              viewportPoints[0].x,
              viewportPoints[0].y,
              viewportPoints[0].x,
              viewportPoints[0].y,
            );
          } else if (lastSeg.type === "arc-quadratic") {
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

    graphics.setStrokeStyle({ color: stroke, width: 1 / viewportScale });
    graphics.moveTo(viewportPoints[0].x, viewportPoints[0].y);
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.type === "point") {
        graphics.lineTo(seg.point.x * SHEET_UNITS_TO_PIXELS, seg.point.y * SHEET_UNITS_TO_PIXELS);
      } else if (seg.type === "arc-quadratic") {
        graphics.quadraticCurveTo(
          seg.controlPoint.x * SHEET_UNITS_TO_PIXELS,
          seg.controlPoint.y * SHEET_UNITS_TO_PIXELS,
          seg.point.x * SHEET_UNITS_TO_PIXELS,
          seg.point.y * SHEET_UNITS_TO_PIXELS,
        );
      } else if (seg.type === "arc-cubic") {
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
      if (lastSeg.type === "arc-cubic") {
        const first = segments[0];
        graphics.bezierCurveTo(
          lastSeg.controlPointB.x * SHEET_UNITS_TO_PIXELS,
          lastSeg.controlPointB.y * SHEET_UNITS_TO_PIXELS,
          first.point.x * SHEET_UNITS_TO_PIXELS,
          first.point.y * SHEET_UNITS_TO_PIXELS,
          first.point.x * SHEET_UNITS_TO_PIXELS,
          first.point.y * SHEET_UNITS_TO_PIXELS,
        );
      } else if (lastSeg.type === "arc-quadratic") {
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
  }, [viewportScale, segments, closed, fillColor, stroke, polygonBoundsInPixels]);

  return (
    <pixiContainer>
      <pixiGraphics
        draw={drawPolygon}
        eventMode={isDragging ? 'none' : (isSelectMode || selected ? 'static' : 'none')}
        onPointerDown={onFillPointerDown}
      />
      {selected ? (
        <SelectionBoundingBox
          boundingBox={polygonBounds}
          viewportScale={viewportScale}
          onLinearResizerPointerDown={onLinearResizerPointerDown}
          onCornerHandlePointerDown={onCornerHandlePointerDown}
        />
      ) : null}

      {selected && onLineSegmentEdgeHitDetectorPointerDown ? (
        <>
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
                onPointerEnter={() => onLineSegmentEdgeHitDetectorEnter?.(i)}
                onPointerLeave={onLineSegmentEdgeHitDetectorLeave}
                onPointerDown={(e: FederatedPointerEvent) => onLineSegmentEdgeHitDetectorPointerDown?.(e, i)}
              />
            );
          })}
        </>
      ) : null}

      {selected && (onQuadraticEdgeHitDetectorPointerDown || onCubicEdgeHitDetectorPointerDown) ? (
        <>
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
                  onPointerEnter={(event) => onQuadraticEdgeHitDetectorEnter?.(event, i)}
                  onPointerLeave={(event) => onQuadraticEdgeHitDetectorLeave?.(event, i)}
                  onPointerDown={(event) => onQuadraticEdgeHitDetectorPointerDown?.(event, i)}
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
                  onPointerEnter={(event) => onQuadraticEdgeHitDetectorEnter?.(event, i)}
                  onPointerLeave={(event) => onQuadraticEdgeHitDetectorLeave?.(event, i)}
                  onPointerDown={(event) => onQuadraticEdgeHitDetectorPointerDown?.(event, i)}
                />
              );
            }
            return null;
          })}
        </>
      ) : null}

      {/* Edge detectors for non-closed, non-selected polygons based on mouse proximity.
       * Only renders detectors for segments that might intersect the proximity AABB.
       * This makes it easier to select edges on open polygons. */}
      {!closed && !selected && mousePositionProximityAABB && onFillPointerDown ? (
        <>
          {segments.slice(1).map((seg, i) => {
            const prevSeg = segments[i];
            if (!prevSeg) {
              return null;
            }

            // Use Cohen-Sutherland to quickly cull segments that don't intersect the proximity box
            if (seg.type === 'point') {
              const segment = { start: prevSeg.point, end: seg.point };
              if (!CohenSutherland.lineSegmentMightIntersectBoundingBox(segment, mousePositionProximityAABB)) {
                return null;
              }
              if (!onLineSegmentEdgeHitDetectorPointerDown) {
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
              if (!CohenSutherland.quadraticCurveMightIntersectBoundingBox(curve, mousePositionProximityAABB)) {
                return null;
              }
              if (!onQuadraticEdgeHitDetectorPointerDown) {
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
              if (!CohenSutherland.cubicCurveMightIntersectBoundingBox(curve, mousePositionProximityAABB)) {
                return null;
              }
              if (!onCubicEdgeHitDetectorPointerDown) {
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

      {showDimensions && segments.length >= 2 ? (
        <>
          {segments.slice(0, -1).map((seg, i) => (
            <DimensionLineConstrait
              key={`dim-${i}`}
              pointA={seg.point}
              pointB={segments[i + 1].point}
              viewportScale={viewportScale}
              sheet={sheet}
              offsetPx={16}
            />
          ))}
        </>
      ) : null}

      {showHandles ? (
        <>
          <CurveControlPointHandlesSprites
            segments={segments}
            scale={viewportScale}
            onControlPointerDown={onControlPointerDown}
            isDragging={isDragging}
          />
          <HandleSprites
            points={(closed ? (
              // NOTE: don't render the last handle because it's the same as the first handle
              segments.slice(0, -1)
            ) : segments).map(seg => seg.point)}
            handleTexture={getVertexHandleTexture()}
            viewportScale={viewportScale}
            onFirstHandleClick={onFirstHandleClick}
            onFirstHandleEnter={onFirstHandleEnter}
            onFirstHandleLeave={onFirstHandleLeave}
            onVertexPointerDown={onVertexPointerDown}
            isDragging={isDragging}
            // IMPOTANT: Make sure this is set so that clicks don't get "trapped" by the final
            // handle since it is always under the cursor.
            lastHandleEventMode="none"
          />
          <BezierLines segments={segments} scale={viewportScale} />
        </>
      ) : null}
    </pixiContainer>
  );
};

type WorkingPolygonRendererProps = { 
  polygonTool: PolygonTool;
  workingPolygon: WorkingPolygon;
  viewportScale: number;
};

const WorkingPolygonRenderer: React.FunctionComponent<WorkingPolygonRendererProps> = ({ polygonTool, workingPolygon, viewportScale }) => {
  const [arcDrawMode, setArcDrawMode] = useState<"quadratic" | "cubic">(polygonTool.arcDrawMode);
  const [previewSegmentIntersections, setPreviewSegmentIntersections] = useState(polygonTool.previewSegmentIntersections);
  const [previewSegmentIntersectionsEnabled, setPreviewSegmentIntersectionsEnabled] = useState(new Set<KeyCombo>());
  useEffect(() => {
    polygonTool.on('arcDrawModeChange', setArcDrawMode);
    polygonTool.on('previewSegmentIntersections', setPreviewSegmentIntersections);
    polygonTool.on('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
    return () => {
      polygonTool.off('arcDrawModeChange', setArcDrawMode);
      polygonTool.off('previewSegmentIntersections', setPreviewSegmentIntersections);
      polygonTool.off('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
    };
  }, [polygonTool]);

  const workingPolygonSegments = useMemo(() => {
    if (!workingPolygon.previewPoint) {
      return workingPolygon.points;
    }

    if (workingPolygon.pendingArcEndPoint) {
      // An arc is being drawn, previewPoint = arc control point, NOT the arc end point
      switch (arcDrawMode) {
        case "cubic":
          const lastSeg = workingPolygon.points[workingPolygon.points.length - 1];

          // FIXME: figure out how to make control point b settable in the polygon drawing workflow
          const controlPointA = workingPolygon.previewPoint;
          const controlPointB = quadraticBezierControlFromMidpoint(
            lastSeg.point,
            workingPolygon.pendingArcEndPoint,
            midPoint(lastSeg.point, workingPolygon.pendingArcEndPoint),
          );

          return [
            ...workingPolygon.points,
            {
              type: "arc-cubic" as const,
              point: workingPolygon.pendingArcEndPoint,
              controlPointA,
              controlPointB,
            },
          ];
        case "quadratic":
          return [
            ...workingPolygon.points,
            {
              type: "arc-quadratic" as const,
              point: workingPolygon.pendingArcEndPoint,
              controlPoint: workingPolygon.previewPoint,
            },
          ];
      }
    }

    // A segment is being drawn, previewPoint = next segment end point
    return [
      ...workingPolygon.points,
      { type: "point" as const, point: workingPolygon.previewPoint },
    ];
  }, [workingPolygon, arcDrawMode]);

  const onFirstHandleClick = useCallback((e: FederatedPointerEvent) => {
    // Stop the event from propegating further - it it propegates, then it will start a brand new
    // polygon.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    polygonTool.completePolygonAtFirstHandle();
  }, [polygonTool]);

  const onFirstHandleEnter = useCallback(() => {
    polygonTool.setHoveringFirstHandle(true);
  }, [polygonTool]);

  const onFirstHandleLeave = useCallback(() => {
    polygonTool.setHoveringFirstHandle(false);
  }, [polygonTool]);

  return (
    <>
      <PolygonRenderer
        segments={workingPolygonSegments}
        showHandles
        showDimensions

        onFirstHandleClick={workingPolygon.points.length >= 2 ? onFirstHandleClick : undefined}
        onFirstHandleEnter={workingPolygon.points.length >= 2 ? onFirstHandleEnter : undefined}
        onFirstHandleLeave={workingPolygon.points.length >= 2 ? onFirstHandleLeave : undefined}
      />

      {/* Render any intersection points. */}
      <HandleSprites
        points={
          previewSegmentIntersections
            .filter((inters) => previewSegmentIntersectionsEnabled.has(inters.keyCombo))
            .map((inters) => inters.intersectionPoint)
        }
        handleTexture={getVertexHandleTexture()}
        viewportScale={viewportScale}
      />
      <HandleSprites
        points={
          previewSegmentIntersections
            .filter((inters) => !previewSegmentIntersectionsEnabled.has(inters.keyCombo))
            .map((inters) => inters.intersectionPoint)
        }
        handleTexture={getIntersectionVertexHandleTexture()}
        viewportScale={viewportScale}
      />
    </>
  );
};

type RectangleRendererProps = {
  rectangle: Rectangle;
  fill?: number | null;
  stroke?: number;
  selected?: boolean;
  onFillPointerDown?: (event: FederatedPointerEvent) => void;
  onCornerHandlePointerDown?: (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => void;
  onLinearResizerPointerDown?: (edge: 'top' | 'bottom' | 'left' | 'right') => void;
  isDragging?: boolean;
};

const RectangleRenderer: React.FunctionComponent<RectangleRendererProps> = ({
  rectangle,
  fill,
  stroke = 0x000000,
  selected,
  onFillPointerDown,
  onCornerHandlePointerDown,
  onLinearResizerPointerDown,
  isDragging,
}) => {
  const { viewportScale, activeTool, sheet } = useViewportContext();

  const isSelectMode = activeTool.type === 'select';

  const boundingBox = useMemo((): Rect<SheetPosition> => {
    return {
      position: rectangle.upperLeft,
      width: rectangle.lowerRight.x - rectangle.upperLeft.x,
      height: rectangle.lowerRight.y - rectangle.upperLeft.y,
    };
  }, [rectangle]);

  const rectangleBoundsCorners = useMemo(() => rectCorners(boundingBox), [boundingBox]);
  const rectangleBoundsPoints = useMemo(() => cornersToList(rectangleBoundsCorners), [rectangleBoundsCorners]);

  const drawRectangle = useCallback((graphics: Graphics) => {
    graphics.clear();

    const x = rectangle.upperLeft.x * SHEET_UNITS_TO_PIXELS;
    const y = rectangle.upperLeft.y * SHEET_UNITS_TO_PIXELS;
    const width = (rectangle.lowerRight.x - rectangle.upperLeft.x) * SHEET_UNITS_TO_PIXELS;
    const height = (rectangle.lowerRight.y - rectangle.upperLeft.y) * SHEET_UNITS_TO_PIXELS;

    if (fill !== null) {
      graphics.setFillStyle({ color: fill });
      graphics.rect(x, y, width, height);
      graphics.fill();
    }

    graphics.setStrokeStyle({ color: stroke, width: 1 / viewportScale });
    graphics.rect(x, y, width, height);
    graphics.stroke();
  }, [rectangle, fill, stroke, viewportScale]);

  const upperLeft = rectangle.upperLeft;
  const upperRight = new SheetPosition(rectangle.lowerRight.x, rectangle.upperLeft.y);
  const lowerLeft = new SheetPosition(rectangle.upperLeft.x, rectangle.lowerRight.y);

  return (
    <pixiContainer>
      <pixiGraphics
        draw={drawRectangle}
        eventMode={isDragging ? 'none' : (isSelectMode || selected ? 'static' : 'none')}
        onPointerDown={onFillPointerDown}
      />
      {selected ? (
        <SelectionBoundingBox
          boundingBox={boundingBox}
          viewportScale={viewportScale}
          onLinearResizerPointerDown={onLinearResizerPointerDown}
          onCornerHandlePointerDown={onCornerHandlePointerDown}
        />
      ) : null}

      {selected ? (
        <>
          <DimensionLineConstrait
            key="dim-width"
            pointA={upperLeft}
            pointB={upperRight}
            viewportScale={viewportScale}
            sheet={sheet}
            offsetPx={16}
          />
          <DimensionLineConstrait
            key="dim-height"
            pointA={upperLeft}
            pointB={lowerLeft}
            viewportScale={viewportScale}
            sheet={sheet}
            offsetPx={16}
          />
        </>
      ) : null}
    </pixiContainer>
  );
};

type WorkingRectangleRendererProps = {
  workingRectangle: WorkingRectangle;
  viewportScale: number;
};

const WorkingRectangleRenderer: React.FunctionComponent<WorkingRectangleRendererProps> = ({ workingRectangle, viewportScale }) => {
  const { sheet } = useViewportContext();

  const firstPoint = workingRectangle.firstPoint;
  const previewLowerRight = workingRectangle.previewLowerRight;
  const isReady = firstPoint !== null && previewLowerRight !== null;

  const upperLeft = isReady
    ? (workingRectangle.isCenterMode
      ? new SheetPosition(
          firstPoint.x - (previewLowerRight.x - firstPoint.x),
          firstPoint.y - (previewLowerRight.y - firstPoint.y),
        )
      : new SheetPosition(
          Math.min(firstPoint.x, previewLowerRight.x),
          Math.min(firstPoint.y, previewLowerRight.y),
        ))
    : new SheetPosition(0, 0);

  const lowerRight = isReady
    ? (workingRectangle.isCenterMode
      ? previewLowerRight
      : new SheetPosition(
          Math.max(firstPoint.x, previewLowerRight.x),
          Math.max(firstPoint.y, previewLowerRight.y),
        ))
    : new SheetPosition(0, 0);

  const x = upperLeft.x * SHEET_UNITS_TO_PIXELS;
  const y = upperLeft.y * SHEET_UNITS_TO_PIXELS;
  const width = (lowerRight.x - upperLeft.x) * SHEET_UNITS_TO_PIXELS;
  const height = (lowerRight.y - upperLeft.y) * SHEET_UNITS_TO_PIXELS;

  const drawWorkingRectangle = useCallback((graphics: Graphics) => {
    if (!isReady) return;
    graphics.clear();
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / viewportScale });
    graphics.rect(x, y, width, height);
    graphics.stroke();
  }, [viewportScale, isReady, x, y, width, height]);

  const upperRight = new SheetPosition(lowerRight.x, upperLeft.y);
  const lowerLeft = new SheetPosition(upperLeft.x, lowerRight.y);

  if (!isReady) {
    return null;
  }

  return (
    <pixiContainer>
      <pixiGraphics draw={drawWorkingRectangle} />
      <DimensionLineConstrait
        key="dim-width"
        pointA={upperLeft}
        pointB={upperRight}
        viewportScale={viewportScale}
        sheet={sheet}
        offsetPx={16}
      />
      <DimensionLineConstrait
        key="dim-height"
        pointA={upperLeft}
        pointB={lowerLeft}
        viewportScale={viewportScale}
        sheet={sheet}
        offsetPx={16}
      />
    </pixiContainer>
  );
};

type EllipseRendererProps = {
  ellipse: Ellipse;
  fill?: number | null;
  stroke?: number;
  selected?: boolean;
  onFillPointerDown?: (event: FederatedPointerEvent) => void;
  onCornerHandlePointerDown?: (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => void;
  onLinearResizerPointerDown?: (edge: 'top' | 'bottom' | 'left' | 'right') => void;
  isDragging?: boolean;
};

const EllipseRenderer: React.FunctionComponent<EllipseRendererProps> = ({
  ellipse,
  fill,
  stroke = 0x000000,
  selected,
  onFillPointerDown,
  onCornerHandlePointerDown,
  onLinearResizerPointerDown,
  isDragging,
}) => {
  const { viewportScale, activeTool, sheet } = useViewportContext();

  const isSelectMode = activeTool.type === 'select';

  const boundingBox = useMemo((): Rect<SheetPosition> => {
    return {
      position: new SheetPosition(ellipse.center.x - ellipse.radiusX, ellipse.center.y - ellipse.radiusY),
      width: ellipse.radiusX * 2,
      height: ellipse.radiusY * 2,
    };
  }, [ellipse]);

  const drawEllipse = useCallback((graphics: Graphics) => {
    graphics.clear();

    const centerX = ellipse.center.x * SHEET_UNITS_TO_PIXELS;
    const centerY = ellipse.center.y * SHEET_UNITS_TO_PIXELS;
    const radiusXPixels = ellipse.radiusX * SHEET_UNITS_TO_PIXELS;
    const radiusYPixels = ellipse.radiusY * SHEET_UNITS_TO_PIXELS;

    if (fill !== null) {
      graphics.setFillStyle({ color: fill });
      graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
      graphics.fill();
    }

    graphics.setStrokeStyle({ color: stroke, width: 1 / viewportScale });
    graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
    graphics.stroke();
  }, [ellipse, fill, stroke, viewportScale]);

  const radiusPointRight = new SheetPosition(ellipse.center.x + ellipse.radiusX, ellipse.center.y);
  const radiusPointTop = new SheetPosition(ellipse.center.x, ellipse.center.y - ellipse.radiusY);

  return (
    <pixiContainer>
      <pixiGraphics
        draw={drawEllipse}
        eventMode={isDragging ? 'none' : (isSelectMode || selected ? 'static' : 'none')}
        onPointerDown={onFillPointerDown}
      />
      {selected ? (
        <SelectionBoundingBox
          boundingBox={boundingBox}
          viewportScale={viewportScale}
          onLinearResizerPointerDown={onLinearResizerPointerDown}
          onCornerHandlePointerDown={onCornerHandlePointerDown}
        />
      ) : null}

      {selected ? (
        <>
          <DimensionLineConstrait
            key="dim-rx"
            pointA={ellipse.center}
            pointB={radiusPointRight}
            viewportScale={viewportScale}
            sheet={sheet}
            offsetPx={16}
          />
          <DimensionLineConstrait
            key="dim-ry"
            pointA={ellipse.center}
            pointB={radiusPointTop}
            viewportScale={viewportScale}
            sheet={sheet}
            offsetPx={16}
          />
        </>
      ) : null}
    </pixiContainer>
  );
};

type WorkingEllipseRendererProps = {
  workingEllipse: WorkingEllipse;
  viewportScale: number;
};

const WorkingEllipseRenderer: React.FunctionComponent<WorkingEllipseRendererProps> = ({ workingEllipse, viewportScale }) => {
  const { sheet } = useViewportContext();

  const firstPoint = workingEllipse.firstPoint;
  const previewPoint = workingEllipse.previewPoint;
  const isReady = firstPoint !== null && previewPoint !== null;

  const center = isReady
    ? (workingEllipse.isCenterMode
      ? firstPoint
      : new SheetPosition(
          (Math.min(firstPoint.x, previewPoint.x) + Math.max(firstPoint.x, previewPoint.x)) / 2,
          (Math.min(firstPoint.y, previewPoint.y) + Math.max(firstPoint.y, previewPoint.y)) / 2,
        ))
    : new SheetPosition(0, 0);

  const radiusX = isReady
    ? (workingEllipse.isCenterMode
      ? Math.abs(previewPoint.x - firstPoint.x)
      : (Math.max(firstPoint.x, previewPoint.x) - Math.min(firstPoint.x, previewPoint.x)) / 2)
    : 0;

  const radiusY = isReady
    ? (workingEllipse.isCenterMode
      ? Math.abs(previewPoint.y - firstPoint.y)
      : (Math.max(firstPoint.y, previewPoint.y) - Math.min(firstPoint.y, previewPoint.y)) / 2)
    : 0;

  const centerX = center.x * SHEET_UNITS_TO_PIXELS;
  const centerY = center.y * SHEET_UNITS_TO_PIXELS;
  const radiusXPixels = radiusX * SHEET_UNITS_TO_PIXELS;
  const radiusYPixels = radiusY * SHEET_UNITS_TO_PIXELS;

  const drawWorkingEllipse = useCallback((graphics: Graphics) => {
    graphics.clear();
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / viewportScale });
    graphics.ellipse(centerX, centerY, radiusXPixels, radiusYPixels);
    graphics.stroke();
  }, [viewportScale, centerX, centerY, radiusXPixels, radiusYPixels]);

  const radiusPointRight = new SheetPosition(center.x + radiusX, center.y);
  const radiusPointTop = new SheetPosition(center.x, center.y - radiusY);

  if (!isReady) {
    return null;
  }

  return (
    <pixiContainer>
      <pixiGraphics draw={drawWorkingEllipse} />
      <DimensionLineConstrait
        key="dim-rx"
        pointA={center}
        pointB={radiusPointRight}
        viewportScale={viewportScale}
        sheet={sheet}
        offsetPx={16}
      />
      <DimensionLineConstrait
        key="dim-ry"
        pointA={center}
        pointB={radiusPointTop}
        viewportScale={viewportScale}
        sheet={sheet}
        offsetPx={16}
      />
    </pixiContainer>
  );
};

const ADD_POLYGON_POINT_TOOLTIP_TIMEOUT_MS = 100;

/**
 * Renders the CAD viewport with the sheet rectangle, adaptive grid lines, and polygons.
 * Handles mouse, touch, and wheel events via ViewportControls.
 */
export default function ViewportRenderer2D({ sheet, toolManager, selectionManager }: ViewportRenderer2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportControlsRef = useRef<ViewportControls | null>(null);
  const [viewportControlsState, setViewportControlsState] = useState<ViewportControlsState | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState<{ width: number, height: number } | null>(null);
  const [polygons, setPolygons] = useState<Array<Polygon>>([]);
  const [workingPolygon, setWorkingPolygon] = useState<WorkingPolygon | null>(null);
  const [rectangles, setRectangles] = useState<Array<Rectangle>>([]);
  const [workingRectangle, setWorkingRectangle] = useState<WorkingRectangle | null>(null);
  const [ellipses, setEllipses] = useState<Array<Ellipse>>([]);
  const [workingEllipse, setWorkingEllipse] = useState<WorkingEllipse | null>(null);
  const [activeTool, setActiveTool] = useState(toolManager.getActiveTool());
  const [previewSheetPos, setPreviewSheetPos] = useState<SheetPosition | null>(null);
  const [arcDrawMode, setArcDrawMode] = useState<"quadratic" | "cubic">("quadratic");
  const [isHoveringFirstHandle, setIsHoveringFirstHandle] = useState(false);
  const [mouseScreenPos, setMouseScreenPos] = useState<ScreenPosition | null>(null);
  const [draggingShapeState, setDraggingShapeState] = useState<DraggingShapeState | null>(null);
  const [rectangleIsCenterMode, setRectangleIsCenterMode] = useState(false);
  const [ellipseIsCenterMode, setEllipseIsCenterMode] = useState(false);
  const [isHoveringPolygonEdge, setIsHoveringPolygonEdge] = useState(false);
  const [showAddPointTooltip, setShowAddPointTooltip] = useState(false);
  const [closestPointToSegment, setClosestPointToSegment] = useState<{ polygonId: string; segmentIndex: number; point: SheetPosition } | null>(null);
  const [previewSegmentIntersections, setPreviewSegmentIntersections] = useState<Array<PreviewSegmentIntersections>>([]);
  const [previewSegmentIntersectionsEnabled, setPreviewSegmentIntersectionsEnabled] = useState(new Set<KeyCombo>());

  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [superHeld, setSuperHeld] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);

  const [tooltipTimer, setTooltipTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isHoveringPolygonEdge) {
      const timer = setTimeout(() => {
        setShowAddPointTooltip(true);
      }, ADD_POLYGON_POINT_TOOLTIP_TIMEOUT_MS);
      setTooltipTimer(timer);
    } else {
      if (tooltipTimer) {
        clearTimeout(tooltipTimer);
        setTooltipTimer(null);
      }
      setShowAddPointTooltip(false);
    }

    return () => {
      if (tooltipTimer) {
        clearTimeout(tooltipTimer);
      }
    };
  }, [isHoveringPolygonEdge]);

  useEffect(() => {
    const geometryStore = toolManager.getGeometryStore();

    toolManager.on('toolChange', setActiveTool);
    geometryStore.on('polygonsChanged', setPolygons);
    geometryStore.on('workingPolygonChanged', setWorkingPolygon);
    geometryStore.on('rectanglesChanged', setRectangles);
    geometryStore.on('workingRectangleChanged', setWorkingRectangle);
    geometryStore.on('ellipsesChanged', setEllipses);
    geometryStore.on('workingEllipseChanged', setWorkingEllipse);

    toolManager.on('altChange', setAltHeld);
    toolManager.on('shiftChange', setShiftHeld);
    toolManager.on('superChange', setSuperHeld);
    toolManager.on('ctrlChange', setCtrlHeld);

    return () => {
      toolManager.off('toolChange', setActiveTool);
      geometryStore.off('polygonsChanged', setPolygons);
      geometryStore.off('workingPolygonChanged', setWorkingPolygon);
      geometryStore.off('rectanglesChanged', setRectangles);
      geometryStore.off('workingRectangleChanged', setWorkingRectangle);
      geometryStore.off('ellipsesChanged', setEllipses);
      geometryStore.off('workingEllipseChanged', setWorkingEllipse);

      toolManager.off('altChange', setAltHeld);
      toolManager.off('shiftChange', setShiftHeld);
      toolManager.off('superChange', setSuperHeld);
      toolManager.off('ctrlChange', setCtrlHeld);
    };
  }, [toolManager]);

  useEffect(() => {
    switch (activeTool.type) {
      case "polygon": {
        activeTool.on('arcDrawModeChange', setArcDrawMode);
        activeTool.on('hoveringFirstHandleChange', setIsHoveringFirstHandle);
        activeTool.on('previewSegmentIntersections', setPreviewSegmentIntersections);
        activeTool.on('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
        return () => {
          activeTool.off('arcDrawModeChange', setArcDrawMode);
          activeTool.off('hoveringFirstHandleChange', setIsHoveringFirstHandle);
          activeTool.off('previewSegmentIntersections', setPreviewSegmentIntersections);
          activeTool.off('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
        };
      }
      case "rectangle": {
        activeTool.on('isCenterModeChange', setRectangleIsCenterMode);
        return () => {
          activeTool.off('isCenterModeChange', setRectangleIsCenterMode);
        };
      }
      case "ellipse": {
        activeTool.on('isCenterModeChange', setEllipseIsCenterMode);
        return () => {
          activeTool.off('isCenterModeChange', setEllipseIsCenterMode);
        };
      }

      case "move": {
        // No events for this tool.
        return;
      }

      case "select": {
        activeTool.on('dragStateChange', setDraggingShapeState);
        activeTool.on('closestPointToSegmentChange', setClosestPointToSegment);
        return () => {
          activeTool.off('dragStateChange', setDraggingShapeState);
          activeTool.off('closestPointToSegmentChange', setClosestPointToSegment);
        };
      }
    }
  }, [activeTool]);

  const [selectedIds, setSelectedIds] = useState(selectionManager.getSelectedIds());
  useEffect(() => {
    selectionManager.on('selectionChange', setSelectedIds);
    return () => {
      selectionManager.off('selectionChange', setSelectedIds);
    };
  }, [selectionManager]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        if (viewportControlsRef.current) {
          viewportControlsRef.current.resizeCanvas(width, height);
        }
        setCanvasDimensions({ width, height });
        setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
      }
    });

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    viewportControlsRef.current = new ViewportControls({
      canvasWidth: width,
      canvasHeight: height,
      sheet,
    });
    toolManager.setViewportControls(viewportControlsRef.current);
    setCanvasDimensions({ width, height });
    setViewportControlsState(viewportControlsRef.current.getState());

    const initialViewportState = viewportControlsRef.current.getState().viewport;
    toolManager.syncSnappingOptions(initialViewportState.scale);

    const onScaleChange = (scale: number) => {
      toolManager.syncSnappingOptions(scale);
    };
    const onNudgeCanvas = () => {
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };
    const onFitToViewport = () => {
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
      toolManager.syncSnappingOptions(viewportControlsRef.current?.getState().viewport.scale ?? 1);
    };

    viewportControlsRef.current.on('scaleChange', onScaleChange);
    viewportControlsRef.current.on('nudgeCanvas', onNudgeCanvas);
    viewportControlsRef.current.on('fitToViewport', onFitToViewport);

    viewportControlsRef.current.fitToViewport();

    return () => {
      viewportControlsRef.current?.off('scaleChange', onScaleChange);
      viewportControlsRef.current?.off('nudgeCanvas', onNudgeCanvas);
      viewportControlsRef.current?.off('fitToViewport', onFitToViewport);
    };
  }, [toolManager, sheet]);

  // Update the cursor when dictated to do so by a tool.
  useEffect(() => {
    if (!viewportControlsRef.current) {
      return;
    }

    const onCursorChange = () => {
      const cursor = viewportControlsRef.current?.getCursor() ?? toolManager.getCursor();
      if (containerRef.current) {
        containerRef.current.style.cursor = cursor;
      }
    };

    const viewportControls = viewportControlsRef.current;
    viewportControls.on('cursorChange', onCursorChange);
    toolManager.on('cursorChange', onCursorChange);

    return () => {
      viewportControls.off('cursorChange', onCursorChange);
      toolManager.off('cursorChange', onCursorChange);
    };
  }, [toolManager, sheet]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      viewportControlsRef.current?.handleWheel(event);
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onMouseDown = (event: MouseEvent) => {
      viewportControlsRef.current?.handleMouseDown(event);
      if (viewportControlsRef.current) {
        const viewportState = viewportControlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseDown(screenPos, viewportState);
        if (activeTool.type === "polygon") {
          // FIXME: this should be a polygon tool event
          setPreviewSheetPos(activeTool.previewSheetPos);
        } else if (activeTool.type === "rectangle") {
          setPreviewSheetPos(activeTool.previewSheetPos);
        } else if (activeTool.type === "ellipse") {
          setPreviewSheetPos(activeTool.previewSheetPos);
        }
      }
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onMouseMove = (event: MouseEvent) => {
      viewportControlsRef.current?.handleMouseMove(event);
      if (viewportControlsRef.current) {
        const viewportState = viewportControlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseMove(screenPos, viewportState);
        if (activeTool.type === "polygon") {
          // FIXME: this should be a polygon tool event
          setPreviewSheetPos(activeTool.previewSheetPos);
        } else if (activeTool.type === "rectangle") {
          setPreviewSheetPos(activeTool.previewSheetPos);
        } else if (activeTool.type === "ellipse") {
          setPreviewSheetPos(activeTool.previewSheetPos);
        }

        setMouseScreenPos(new ScreenPosition(event.clientX, event.clientY));
      }
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onMouseUp = () => {
      viewportControlsRef.current?.handleMouseUp();
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onMouseLeave = () => {
      viewportControlsRef.current?.handleMouseLeave();
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onTouchStart = (event: TouchEvent) => {
      viewportControlsRef.current?.handleTouchStart(event);
    };

    const onTouchMove = (event: TouchEvent) => {
      viewportControlsRef.current?.handleTouchMove(event);
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onTouchEnd = () => {
      viewportControlsRef.current?.handleTouchEnd();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      toolManager.handleKeyDown(event);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      toolManager.handleKeyUp(event);
    };

    const container = containerRef.current;

    window.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mouseleave", onMouseLeave);
    container.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);
    container.addEventListener("touchend", onTouchEnd);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("wheel", onWheel);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mouseleave", onMouseLeave);
      container.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [toolManager, activeTool, sheet]);

  const drawRect = useCallback((graphics: Graphics) => {
    if (!viewportControlsState) {
      return;
    }

    const scale = viewportControlsState.viewport.scale;
    const vpX = viewportControlsState.viewport.position.x;
    const vpY = viewportControlsState.viewport.position.y;
    const sheetWidth = viewportControlsState.rect.width;
    const sheetHeight = viewportControlsState.rect.height;
    const grid = getGridAtScale(scale, Sheets.getDefaultUnitFamily(sheet));
    const primaryWorldUnits = grid.primarySheetUnits * SHEET_UNITS_TO_PIXELS;

    graphics.clear();

    // Draw fill of sheet
    graphics.setFillStyle({ color: 0xffffff });
    graphics.rect(0, 0, sheetWidth, sheetHeight);
    graphics.fill();

    // Calculate visible world area for grid culling
    // A point at screen (sx, sy) maps to world: ((sx - vpX) / scale, (sy - vpY) / scale)
    const leftVisible = Math.max(0, -vpX / scale);
    const topVisible = Math.max(0, -vpY / scale);
    const rightVisible = canvasDimensions ? Math.min(sheetWidth, (-vpX + canvasDimensions.width) / scale) : sheetWidth;
    const bottomVisible = canvasDimensions ? Math.min(sheetHeight, (-vpY + canvasDimensions.height) / scale) : sheetHeight;

    // Draw secondary grid lines (only visible ones)
    if (grid.secondarySheetUnits !== null && grid.secondaryPx !== null) {
      const secondaryWorldUnits = grid.secondarySheetUnits * SHEET_UNITS_TO_PIXELS;
      graphics.setStrokeStyle({ color: 0xdddddd, width: 1 / scale });

      const firstSecondaryX = Math.floor(leftVisible / secondaryWorldUnits) * secondaryWorldUnits;
      for (let x = firstSecondaryX; x <= rightVisible; x += secondaryWorldUnits) {
        if (x >= 0 && x <= sheetWidth) {
          graphics.moveTo(x, Math.max(0, topVisible));
          graphics.lineTo(x, Math.min(sheetHeight, bottomVisible));
        }
      }
      const firstSecondaryY = Math.floor(topVisible / secondaryWorldUnits) * secondaryWorldUnits;
      for (let y = firstSecondaryY; y <= bottomVisible; y += secondaryWorldUnits) {
        if (y >= 0 && y <= sheetHeight) {
          graphics.moveTo(Math.max(0, leftVisible), y);
          graphics.lineTo(Math.min(sheetWidth, rightVisible), y);
        }
      }
      graphics.stroke();
    }

    // Draw primary grid lines (only visible ones)
    graphics.setStrokeStyle({ color: 0xaaaaaa, width: 1 / scale });

    const firstPrimaryX = Math.floor(leftVisible / primaryWorldUnits) * primaryWorldUnits;
    for (let x = firstPrimaryX; x <= rightVisible; x += primaryWorldUnits) {
      if (x >= 0 && x <= sheetWidth) {
        graphics.moveTo(x, Math.max(0, topVisible));
        graphics.lineTo(x, Math.min(sheetHeight, bottomVisible));
      }
    }
    const firstPrimaryY = Math.floor(topVisible / primaryWorldUnits) * primaryWorldUnits;
    for (let y = firstPrimaryY; y <= bottomVisible; y += primaryWorldUnits) {
      if (y >= 0 && y <= sheetHeight) {
        graphics.moveTo(Math.max(0, leftVisible), y);
        graphics.lineTo(Math.min(sheetWidth, rightVisible), y);
      }
    }
    graphics.stroke();

    // Draw outline of sheet
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.rect(0, 0, sheetWidth, sheetHeight);
    graphics.stroke();
  }, [viewportControlsState, canvasDimensions, sheet]);

  const previewHandleSprites = useMemo(() => {
    if (previewSheetPos === null) {
      return [];
    }
    if (activeTool.type === 'polygon' && workingPolygon === null) {
      return [{ type: "point" as const, point: previewSheetPos }];
    }
    if (activeTool.type === 'rectangle' && workingRectangle === null) {
      return [{ type: "point" as const, point: previewSheetPos }];
    }
    if (activeTool.type === 'ellipse' && workingEllipse === null) {
      return [{ type: "point" as const, point: previewSheetPos }];
    }
    return [];
  }, [activeTool, workingPolygon, workingRectangle, workingEllipse, previewSheetPos]);

  const viewportContextState = useMemo(() => ({
    viewportScale: viewportControlsState?.viewport.scale ?? 1,
    sheet,
    toolManager,
    activeTool,
    selectionManager,
  } satisfies ViewportContextData), [sheet, toolManager, viewportControlsState?.viewport.scale, activeTool, selectionManager]);

  /** Bounding box for mouse proximity culling of edge detectors on non-selected, non-closed polygons.
   * Only computed in select mode when mouse position is available.
   * Uses Cohen-Sutherland algorithm to efficiently cull segments that don't intersect the mouse proximity area.
   */
  const mousePositionProximityAABB = useMemo((): Rect<SheetPosition> | null => {
    if (activeTool.type !== "select") {
      return null;
    }
    if (!viewportControlsState) {
      return null;
    }
    if (!mouseScreenPos) {
      return null;
    }
    const worldPos = mouseScreenPos.toWorld(viewportControlsState.viewport);
    const sheetPos = worldPos.toSheet();
    return proximityBoundingBox(
      sheetPos,
      PROXIMITY_EDGE_DETECTOR_RADIUS_PX / SHEET_UNITS_TO_PIXELS / viewportControlsState.viewport.scale,
    );
  }, [activeTool.type, viewportControlsState, mouseScreenPos]);

  return (
    <ViewportContextProvider value={viewportContextState}>
      <div ref={containerRef} className="h-full w-full overflow-hidden bg-[#eeeeee]">
        <Application resizeTo={containerRef} backgroundColor={0xeeeeee} antialias={true}>
          {viewportControlsState ? (
            <pixiContainer
              x={viewportControlsState.viewport.position.x}
              y={viewportControlsState.viewport.position.y}
              scale={viewportControlsState.viewport.scale}
            >
              <pixiGraphics
                draw={drawRect}
                eventMode="static"
                onPointerDown={() => {
                  if (activeTool.type === 'select') {
                    selectionManager.clearSelection();
                  }
                }}
              />

              {/* Completed polygons: */}
              {polygons.map((polygon) => {
                const isSelected = selectedIds.includes(polygon.id);
                return (
                  <PolygonRenderer
                    key={polygon.id}
                    segments={polygon.points}
                    closed={polygon.closed}
                    fillColor={polygon.fillColor ?? 0xffffff}
                    showDimensions
                    showHandles={activeTool.type !== 'polygon' ? isSelected : true}
                    selected={isSelected}
                    mousePositionProximityAABB={!polygon.closed && !isSelected ? mousePositionProximityAABB : null}
                    isDragging={draggingShapeState?.type === 'polygon' && draggingShapeState.polygonId === polygon.id}
                    onVertexPointerDown={(e, segmentIndex) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onVertexPointerDown(
                          new ScreenPosition(e.clientX, e.clientY),
                          viewportControlsRef.current,
                          polygon.id,
                          segmentIndex,
                        );
                      }
                    }}
                    onControlPointerDown={(e, segmentIndex, pointKey) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onControlPointerDown(
                          new ScreenPosition(e.clientX, e.clientY),
                          viewportControlsRef.current,
                          polygon.id,
                          segmentIndex,
                          pointKey,
                        );
                      }
                    }}
                    onFillPointerDown={(e) => {
                      if (activeTool.type === "select") {
                        activeTool.handlePolygonSelect(polygon.id, e.shiftKey);

                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onPolygonFillPointerDown(
                          new ScreenPosition(e.clientX, e.clientY),
                          viewportControlsRef.current,
                          polygon.id,
                        );
                      }
                    }}
                    onCornerHandlePointerDown={(corner) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onCornerHandlePointerDown(
                          viewportControlsRef.current,
                          polygon.id,
                          corner,
                        );
                      }
                    }}
                    onLinearResizerPointerDown={(edge) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onLinearResizerPointerDown(
                          viewportControlsRef.current,
                          polygon.id,
                          edge,
                        );
                      }
                    }}
                    onLineSegmentEdgeHitDetectorPointerDown={(_e: FederatedPointerEvent, segmentIndex: number) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        if (!closestPointToSegment) {
                          return;
                        }
                        if (shiftHeld) {
                          activeTool.addPointOnLineSegmentEdge(
                            polygon.id,
                            segmentIndex,
                            closestPointToSegment.point,
                          );
                        } else {
                          // TODO - select polygon edge here!
                        }
                      }
                    }}
                    onLineSegmentEdgeHitDetectorEnter={() => {
                      if (activeTool.type === "select") {
                        setIsHoveringPolygonEdge(true);
                      }
                    }}
                    onLineSegmentEdgeHitDetectorLeave={() => {
                      setIsHoveringPolygonEdge(false);
                    }}
                    onQuadraticEdgeHitDetectorPointerDown={(_e: FederatedPointerEvent, segmentIndex: number) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        if (!closestPointToSegment) {
                          return;
                        }
                        if (shiftHeld) {
                          activeTool.addPointOnQuadraticEdge(
                            polygon.id,
                            segmentIndex,
                            closestPointToSegment.point,
                          );
                        } else {
                          // TODO - select polygon edge here!
                        }
                      }
                    }}
                    onQuadraticEdgeHitDetectorEnter={() => {
                      if (activeTool.type === "select") {
                        setIsHoveringPolygonEdge(true);
                      }
                    }}
                    onQuadraticEdgeHitDetectorLeave={() => {
                      setIsHoveringPolygonEdge(false);
                    }}
                    onCubicEdgeHitDetectorPointerDown={(_e: FederatedPointerEvent, segmentIndex: number) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        if (!closestPointToSegment) {
                          return;
                        }
                        if (shiftHeld) {
                          activeTool.addPointOnCubicEdge(
                            polygon.id,
                            segmentIndex,
                            closestPointToSegment.point,
                          );
                        } else {
                          // TODO - select polygon edge here!
                        }
                      }
                    }}
                    onCubicEdgeHitDetectorEnter={() => {
                      if (activeTool.type === "select") {
                        setIsHoveringPolygonEdge(true);
                      }
                    }}
                    onCubicEdgeHitDetectorLeave={() => {
                      setIsHoveringPolygonEdge(false);
                    }}
                  />
                );
              })}

              {/* Completed rectangles: */}
              {rectangles.map((rectangle) => {
                const isSelected = selectedIds.includes(rectangle.id);
                return (
                  <RectangleRenderer
                    key={rectangle.id}
                    rectangle={rectangle}
                    fill={rectangle.fillColor ?? 0xffffff}
                    selected={isSelected}
                    isDragging={draggingShapeState?.type === 'rectangle' && draggingShapeState.rectangleId === rectangle.id}
                    onFillPointerDown={(e) => {
                      if (activeTool.type === "select") {
                        activeTool.handleRectangleSelect(rectangle.id, e.shiftKey);

                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onRectangleFillPointerDown?.(
                          new ScreenPosition(e.clientX, e.clientY),
                          viewportControlsRef.current,
                          rectangle.id,
                        );
                      }
                    }}
                    onCornerHandlePointerDown={(corner) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onRectangleCornerHandlePointerDown?.(
                          viewportControlsRef.current,
                          rectangle.id,
                          corner,
                        );
                      }
                    }}
                    onLinearResizerPointerDown={(edge) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onRectangleEdgePointerDown?.(
                          viewportControlsRef.current,
                          rectangle.id,
                          edge,
                        );
                      }
                    }}
                  />
                );
              })}

              {/* Completed ellipses: */}
              {ellipses.map((ellipse) => {
                const isSelected = selectedIds.includes(ellipse.id);
                return (
                  <EllipseRenderer
                    key={ellipse.id}
                    ellipse={ellipse}
                    fill={ellipse.fillColor ?? 0xffffff}
                    selected={isSelected}
                    isDragging={draggingShapeState?.type === 'ellipse' && draggingShapeState.ellipseId === ellipse.id}
                    onFillPointerDown={(e) => {
                      if (activeTool.type === "select") {
                        activeTool.handleEllipseSelect(ellipse.id, e.shiftKey);

                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onEllipseFillPointerDown?.(
                          new ScreenPosition(e.clientX, e.clientY),
                          viewportControlsRef.current,
                          ellipse.id,
                        );
                      }
                    }}
                    onCornerHandlePointerDown={(corner) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onEllipseCornerHandlePointerDown?.(
                          viewportControlsRef.current,
                          ellipse.id,
                          corner,
                        );
                      }
                    }}
                    onLinearResizerPointerDown={(edge) => {
                      if (activeTool.type === "select") {
                        if (!viewportControlsRef.current) {
                          return;
                        }
                        activeTool.onEllipseEdgePointerDown?.(
                          viewportControlsRef.current,
                          ellipse.id,
                          edge,
                        );
                      }
                    }}
                  />
                );
              })}

              {/* Currently work in progress polygon: */}
              {workingPolygon && activeTool.type === "polygon" ? (
                <WorkingPolygonRenderer
                  polygonTool={activeTool}
                  workingPolygon={workingPolygon}
                  viewportScale={viewportControlsState.viewport.scale}
                />
              ) : null}

              {/* Currently work in progress rectangle: */}
              {workingRectangle && activeTool.type === "rectangle" ? (
                <WorkingRectangleRenderer
                  workingRectangle={workingRectangle}
                  viewportScale={viewportControlsState.viewport.scale}
                />
              ) : null}

              {/* Currently work in progress ellipse: */}
              {workingEllipse && activeTool.type === "ellipse" ? (
                <WorkingEllipseRenderer
                  workingEllipse={workingEllipse}
                  viewportScale={viewportControlsState.viewport.scale}
                />
              ) : null}

              {/* Preview handle for rectangle/ellipse first point: */}
              {previewHandleSprites && previewHandleSprites.length > 0 && (
                <HandleSprites
                  points={previewHandleSprites.map(seg => seg.point)}
                  handleTexture={getVertexHandleTexture()}
                  viewportScale={viewportControlsState.viewport.scale}
                />
              )}

              {/* Render a fake handle when inserting a point on a polygon edge */}
              {activeTool.type === 'select' && isHoveringPolygonEdge && closestPointToSegment && shiftHeld ? (
                <pixiSprite
                  texture={getIntersectionVertexHandleTexture()}
                  x={closestPointToSegment.point.x * SHEET_UNITS_TO_PIXELS}
                  y={closestPointToSegment.point.y * SHEET_UNITS_TO_PIXELS}
                  anchor={{ x: 0.5, y: 0.5 }}
                  scale={{ x: 1 / viewportControlsState.viewport.scale, y: 1 / viewportControlsState.viewport.scale }}
                />
              ) : null}
            </pixiContainer>
          ) : null}
        </Application>

        {activeTool.type === 'polygon' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>{getStatusText(workingPolygon, isHoveringFirstHandle, altHeld, arcDrawMode)}</span>
              <div className="flex items-center gap-2">
                {workingPolygon?.pendingArcEndPoint !== null ? (
                  <KeyboardShortcut label={arcDrawMode === "cubic" ? "Quadratic" : "Cubic"}>
                    {arcDrawMode === "cubic" ? "m" : "b"}
                  </KeyboardShortcut>
                ) : (
                  <KeyboardShortcut label="Arc" disabled={altHeld}>alt</KeyboardShortcut>
                )}
                <KeyboardShortcut label="No snap" disabled={shiftHeld}>shift</KeyboardShortcut>
                <KeyboardShortcut label={<>Snap 45&deg;</>} disabled={superHeld}>super</KeyboardShortcut>
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {previewSegmentIntersections.length > 0 && viewportControlsState && mouseScreenPos ? (
          previewSegmentIntersections.map((inters, index) => {
            const position = inters.intersectionPoint.toWorld().toScreen(viewportControlsState.viewport);
            return (
              <HoverTooltip
                variant="secondary"
                position={position}
                key={index}
              >
                <KeyboardShortcut active={previewSegmentIntersectionsEnabled.has(inters.keyCombo)} label="Split here?">
                  {inters.keyCombo}
                </KeyboardShortcut>
              </HoverTooltip>
            );
          })
        ) : null}

        {activeTool.type === 'rectangle' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>{getRectangleStatusText(workingRectangle, rectangleIsCenterMode, shiftHeld)}</span>
              <div className="flex items-center gap-2">
                <KeyboardShortcut label="Center mode" disabled={rectangleIsCenterMode}>alt</KeyboardShortcut>
                <KeyboardShortcut label="Square" disabled={shiftHeld}>shift</KeyboardShortcut>
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'ellipse' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>{getEllipseStatusText(workingEllipse, ellipseIsCenterMode, shiftHeld)}</span>
              <div className="flex items-center gap-2">
                <KeyboardShortcut label="Center mode" disabled={ellipseIsCenterMode}>alt</KeyboardShortcut>
                <KeyboardShortcut label="Circle" disabled={shiftHeld}>shift</KeyboardShortcut>
              </div>
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'select' && mouseScreenPos && draggingShapeState !== null ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <KeyboardShortcut label="No snap" disabled={shiftHeld}>shift</KeyboardShortcut>
              {draggingShapeState.type === 'polygon-edge' || draggingShapeState.type === 'polygon-corner' || draggingShapeState.type === 'rectangle-edge' || draggingShapeState.type === 'rectangle-corner' || draggingShapeState.type === 'ellipse-edge' || draggingShapeState.type === 'ellipse-corner' ? (
                <KeyboardShortcut label="Around center" disabled={altHeld}>alt</KeyboardShortcut>
              ) : null}
              {draggingShapeState.type === 'polygon-corner' || draggingShapeState.type === 'rectangle-corner' || draggingShapeState.type === 'ellipse-corner' ? (
                <KeyboardShortcut label="Keep aspect ratio" disabled={superHeld}>super</KeyboardShortcut>
              ) : null}
            </div>
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'select' && showAddPointTooltip && isHoveringPolygonEdge && closestPointToSegment && viewportControlsState ? (
          <HoverTooltip position={closestPointToSegment.point.toWorld().toScreen(viewportControlsState.viewport)}>
            <div className="flex flex-col gap-1">
              <KeyboardShortcut label="Add point" disabled={shiftHeld}>shift</KeyboardShortcut>
            </div>
          </HoverTooltip>
        ) : null}

        <FitToScreenButton onClick={() => viewportControlsRef.current?.fitToViewport()} />
      </div>
    </ViewportContextProvider>
  );
}
