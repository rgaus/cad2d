"use client";

import { useCallback, useEffect, useRef, useState, useMemo, createContext, useContext } from "react";
import { Application, extend } from "@pixi/react";
import { Container, EventMode, FederatedPointerEvent, Graphics, Sprite, Texture } from "pixi.js";
import { ViewportControls } from "@/lib/viewport/ViewportControls";
import { Rect, ScreenPosition, SheetPosition, ViewportControlsState } from "@/lib/viewport/types";
import { getGridAtScale } from "@/lib/viewport/grid";
import { type Tool, ToolManager } from "@/lib/tools/ToolManager";
import { SelectionManager } from "@/lib/tools/SelectionManager";
import { SHEET_UNITS_TO_PIXELS, Sheets, type Sheet } from "@/lib/sheet/Sheet";
import { type Polygon, type WorkingPolygon, type PolygonSegment } from "@/lib/tools/types";
import { angleBetweenInDegrees, boundingBox, cornersToList, distance, midPoint, quadraticBezierControlFromMidpoint, rectCorners, rectInset } from "@/lib/math";
import DimensionLineConstrait from "./DimensionLineConstrait";
import { CURVE_CONTROL_POINT_HANDLE_TEXTURE, SELECTED_FILL_COLOR, SELECTION_CORNER_HANDLE_TEXTURE, VERTEX_HANDLE_TEXTURE } from "@/lib/textures";
import { HoverTooltip } from "./HoverTooltip";
import { PolygonTool } from "@/lib/tools/PolygonTool";
import { KeyboardShortcut } from "./KeyboardShortcut";
import FitToScreenButton from "./FitToScreenButton";
import { DraggingPolygonState, SELECTED_OUTSET_PX } from "@/lib/tools/SelectTool";

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

function HandleSprites({ points, handleTexture, scale, onFirstHandleClick, onFirstHandleEnter, onFirstHandleLeave, onVertexPointerDown, lastHandleEventMode, isDragging }: {
  points: Array<SheetPosition>;
  handleTexture: Texture;
  scale: number;
  onFirstHandleClick?: (event: FederatedPointerEvent) => void;
  onFirstHandleEnter?: () => void;
  onFirstHandleLeave?: () => void;
  onVertexPointerDown?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  lastHandleEventMode?: EventMode;
  isDragging?: boolean;
}) {
  const spriteScale = 1 / scale;
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
          texture={CURVE_CONTROL_POINT_HANDLE_TEXTURE}
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

const LINEAR_RESIZER_WIDTH_PX = 16;

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
  const [length, angleDegrees] = useMemo(() => {
    return [
      distance(startPosition, endPosition),
      angleBetweenInDegrees(startPosition, endPosition),
    ];
  }, [startPosition, endPosition]);

  const cursor = useMemo(() => {
    let normalizedAngleDegrees = angleDegrees;
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
  }, [angleDegrees]);

  return (
    <pixiSprite
      texture={Texture.WHITE}
      // tint={0xff0000}
      alpha={0}
      x={startPosition.x * SHEET_UNITS_TO_PIXELS}
      y={endPosition.y * SHEET_UNITS_TO_PIXELS}
      angle={angleDegrees <= 0 ? angleDegrees - 90 : angleDegrees + 90}
      anchor={{ x: 0.5, y: 0 }}
      scale={{
        x: LINEAR_RESIZER_WIDTH_PX / scale,
        y: length * SHEET_UNITS_TO_PIXELS,
      }}
      eventMode="static"
      cursor={cursor}
      onPointerDown={onPointerDown}
    />
  );
}

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

    graphics.setStrokeStyle({ color: SELECTED_FILL_COLOR, width: 1 / viewportScale });
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
        handleTexture={SELECTION_CORNER_HANDLE_TEXTURE}
        scale={viewportScale}
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
              const startX = seg.controlPointA.x * SHEET_UNITS_TO_PIXELS;
              const startY = seg.controlPointA.y * SHEET_UNITS_TO_PIXELS;
              const endX = seg.point.x * SHEET_UNITS_TO_PIXELS;
              const endY = seg.point.y * SHEET_UNITS_TO_PIXELS;
              graphics.moveTo(startX, startY);
              graphics.lineTo(startX, startY);
              graphics.stroke();
              graphics.moveTo(startX, startY);
              graphics.lineTo(endX, endY);
              graphics.stroke();
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

type PolygonRendererProps = { 
  segments: Array<PolygonSegment>;
  closed?: boolean;

  fill?: number;
  stroke?: number;

  showHandles?: boolean;
  showDimensions?: boolean;

  selected?: boolean;
  onVertexPointerDown?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  onControlPointerDown?: (event: FederatedPointerEvent, segmentIndex: number, pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB') => void;

  onFirstHandleClick?: (event: FederatedPointerEvent) => void;
  onFirstHandleEnter?: () => void;
  onFirstHandleLeave?: () => void;
  onFillPointerDown?: (event: FederatedPointerEvent) => void;
  onCornerHandlePointerDown?: (corner: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => void;
  onLinearResizerPointerDown?: (edge: 'top' | 'bottom' | 'left' | 'right') => void;
  isDragging?: boolean;
};

const PolygonRenderer: React.FunctionComponent<PolygonRendererProps> = ({
  segments,
  closed = false,
  fill = 0xcccccc,
  stroke = 0x000000,
  showHandles,
  showDimensions,
  selected,
  onVertexPointerDown,
  onControlPointerDown,
  onFirstHandleClick,
  onFirstHandleEnter,
  onFirstHandleLeave,
  onFillPointerDown,
  onCornerHandlePointerDown,
  onLinearResizerPointerDown,
  isDragging,
}) => {
  const { viewportScale, activeTool, sheet } = useViewportContext();

  const isSelectMode = activeTool.type === 'select';
  const effectiveFill = selected ? SELECTED_FILL_COLOR : fill;

  const polygonBounds = useMemo(() => {
    return boundingBox(segments.map(s => s.point));
  }, [segments]);

  const drawPolygon = useCallback((graphics: Graphics) => {
    if (segments.length < 2) {
      return;
    }

    graphics.clear();

    const viewportPoints = segments.map(s => ({
      x: s.point.x * SHEET_UNITS_TO_PIXELS,
      y: s.point.y * SHEET_UNITS_TO_PIXELS,
    }));

    if (closed) {
      graphics.setFillStyle({ color: effectiveFill });
      graphics.poly(viewportPoints.flatMap(p => [p.x, p.y]));
      graphics.fill();
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
  }, [viewportScale, segments, closed, effectiveFill, stroke]);

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
            handleTexture={VERTEX_HANDLE_TEXTURE}
            scale={viewportScale}
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
};

const WorkingPolygonRenderer: React.FunctionComponent<WorkingPolygonRendererProps> = ({ polygonTool, workingPolygon }) => {
  const [arcDrawMode, setArcDrawMode] = useState<"quadratic" | "cubic">(polygonTool.arcDrawMode);
  useEffect(() => {
    polygonTool.on('arcDrawModeChange', setArcDrawMode);
    return () => {
      polygonTool.off('arcDrawModeChange', setArcDrawMode);
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
    <PolygonRenderer
      segments={workingPolygonSegments}
      showHandles
      showDimensions

      onFirstHandleClick={workingPolygon.points.length >= 2 ? onFirstHandleClick : undefined}
      onFirstHandleEnter={workingPolygon.points.length >= 2 ? onFirstHandleEnter : undefined}
      onFirstHandleLeave={workingPolygon.points.length >= 2 ? onFirstHandleLeave : undefined}
    />
  );
};

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
  const [activeTool, setActiveTool] = useState(toolManager.getActiveTool());
  const [previewSheetPos, setPreviewSheetPos] = useState<SheetPosition | null>(null);
  const [arcDrawMode, setArcDrawMode] = useState<"quadratic" | "cubic">("quadratic");
  const [isHoveringFirstHandle, setIsHoveringFirstHandle] = useState(false);
  const [mouseScreenPos, setMouseScreenPos] = useState<ScreenPosition | null>(null);
  const [draggingPolygonState, setDraggingPolygonState] = useState<DraggingPolygonState | null>(null);

  const [altHeld, setAltHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [superHeld, setSuperHeld] = useState(false);
  const [ctrlHeld, setCtrlHeld] = useState(false);

  useEffect(() => {
    toolManager.on('toolChange', setActiveTool);
    toolManager.getPolygonStore().on('polygonsChanged', setPolygons);
    toolManager.getPolygonStore().on('workingPolygonChanged', setWorkingPolygon);

    toolManager.on('altChange', setAltHeld);
    toolManager.on('shiftChange', setShiftHeld);
    toolManager.on('superChange', setSuperHeld);
    toolManager.on('ctrlChange', setCtrlHeld);
  }, [toolManager]);

  useEffect(() => {
    switch (activeTool.type) {
      case "polygon": {
        activeTool.on('arcDrawModeChange', setArcDrawMode);
        activeTool.on('hoveringFirstHandleChange', setIsHoveringFirstHandle);
        return () => {
          activeTool.off('arcDrawModeChange', setArcDrawMode);
          activeTool.off('hoveringFirstHandleChange', setIsHoveringFirstHandle);
        };
      }

      case "move": {
        // No events for this tool.
        return;
      }

      case "select": {
        activeTool.on('dragStateChange', setDraggingPolygonState);
        return () => {
          activeTool.off('dragStateChange', setDraggingPolygonState);
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

    viewportControlsRef.current.on('scaleChange', (scale: number) => {
      toolManager.syncSnappingOptions(scale);
    });
    viewportControlsRef.current.on('nudgeCanvas', () => {
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    });
    viewportControlsRef.current.on('fitToViewport', () => {
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
      toolManager.syncSnappingOptions(viewportControlsRef.current?.getState().viewport.scale ?? 1);
    });

    viewportControlsRef.current.fitToViewport();
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
  }, [toolManager]);

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
    if (activeTool.type !== 'polygon' || workingPolygon !== null || previewSheetPos === null) {
      return [];
    }
    return [{ type: "point" as const, point: previewSheetPos }];
  }, [activeTool, workingPolygon, previewSheetPos]);

  const viewportContextState = useMemo(() => ({
    viewportScale: viewportControlsState?.viewport.scale ?? 1,
    sheet,
    toolManager,
    activeTool,
    selectionManager,
  } satisfies ViewportContextData), [sheet, toolManager, viewportControlsState?.viewport.scale, activeTool, selectionManager]);

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
                    showDimensions
                    showHandles={activeTool.type !== 'polygon' ? isSelected : true}
                    selected={isSelected}
                    isDragging={draggingPolygonState?.polygonId === polygon.id}
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
                  />
                );
              })}

              {/* Currently work in progress polygon: */}
              {workingPolygon && activeTool.type === "polygon" ? (
                <WorkingPolygonRenderer
                  polygonTool={activeTool}
                  workingPolygon={workingPolygon}
                />
              ) : null}

              {previewHandleSprites && previewHandleSprites.length > 0 && (
                <HandleSprites
                  points={previewHandleSprites.map(seg => seg.point)}
                  handleTexture={VERTEX_HANDLE_TEXTURE}
                  scale={viewportControlsState.viewport.scale}
                />
              )}
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

        {activeTool.type === 'select' && mouseScreenPos && draggingPolygonState !== null ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <KeyboardShortcut label="No snap" disabled={shiftHeld}>shift</KeyboardShortcut>
              {draggingPolygonState.type === 'bounding-box-corner' ? (
                <KeyboardShortcut label="Keep aspect ratio" disabled={superHeld}>super</KeyboardShortcut>
              ) : null}
            </div>
          </HoverTooltip>
        ) : null}

        <FitToScreenButton onClick={() => viewportControlsRef.current?.fitToViewport()} />
      </div>
    </ViewportContextProvider>
  );
}
