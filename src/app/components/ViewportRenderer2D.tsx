"use client";

import { useCallback, useEffect, useRef, useState, useMemo, createContext, useContext } from "react";
import { Application, extend } from "@pixi/react";
import { Container, EventMode, FederatedPointerEvent, Graphics, Sprite, Texture } from "pixi.js";
import { ViewportControls } from "@/lib/viewport/ViewportControls";
import { ScreenPosition, SheetPosition, ViewportControlsState } from "@/lib/viewport/types";
import { getGridAtScale } from "@/lib/viewport/grid";
import { type Tool, ToolManager } from "@/lib/tools/ToolManager";
import { SelectionManager } from "@/lib/tools/SelectionManager";
import { CM_TO_PIXELS, type Sheet } from "@/lib/sheet/Sheet";
import { type Id } from "@/lib/tools/types";
import { type Polygon, type WorkingPolygon, type PolygonSegment } from "@/lib/tools/types";
import { midPoint, quadraticBezierControlFromMidpoint } from "@/lib/math";
import DimensionLineConstrait from "./DimensionLineConstrait";
import { CIRCLE_HANDLE_TEXTURE, SQUARE_HANDLE_TEXTURE } from "@/lib/textures";
import { HoverTooltip } from "./HoverTooltip";
import { PolygonTool } from "@/lib/tools/PolygonTool";

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

function SquareHandleSprites({ segments, handleTexture, scale, onFirstHandleClick, onFirstHandleEnter, onFirstHandleLeave, onVertexPointerDown, lastHandleEventMode, isDragging }: {
  segments: Array<PolygonSegment>;
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
  if (segments.length === 0) {
    return null;
  }

  return (
    <>
      {segments.map((seg, index) => {
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
          if (index === segments.length - 1 && lastHandleEventMode) {
            eventMode = lastHandleEventMode;
          }
        }

        return (
          <pixiSprite
            key={index}
            texture={handleTexture}
            x={seg.point.x * CM_TO_PIXELS}
            y={seg.point.y * CM_TO_PIXELS}
            anchor={0.5}
            scale={spriteScale}
            eventMode={eventMode}
            cursor={cursor}
            {...(onVertexPointerDown ? {
              onPointerDown: (e: FederatedPointerEvent) => {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
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

function CircleHandleSprites({ segments, handleTexture, scale, onControlPointerDown, isDragging }: {
  segments: Array<PolygonSegment>;
  handleTexture: Texture;
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
          texture={handleTexture}
          x={info.point.x * CM_TO_PIXELS}
          y={info.point.y * CM_TO_PIXELS}
          anchor={0.5}
          scale={spriteScale}
          eventMode={effectiveEventMode}
          cursor={effectiveCursor}
          {...(onControlPointerDown && !isDragging ? {
            onPointerDown: (e: FederatedPointerEvent) => {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              onControlPointerDown(e, info.segmentIndex, info.pointKey);
            }
          } : {})}
        />
      ))}
    </>
  );
}

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
              const startX = seg.controlPointA.x * CM_TO_PIXELS;
              const startY = seg.controlPointA.y * CM_TO_PIXELS;
              const endX = seg.point.x * CM_TO_PIXELS;
              const endY = seg.point.y * CM_TO_PIXELS;
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
              const startX = prevSeg.point.x * CM_TO_PIXELS;
              const startY = prevSeg.point.y * CM_TO_PIXELS;
              const controlX = seg.controlPoint.x * CM_TO_PIXELS;
              const controlY = seg.controlPoint.y * CM_TO_PIXELS;
              const endX = seg.point.x * CM_TO_PIXELS;
              const endY = seg.point.y * CM_TO_PIXELS;
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
    return 'place first point';
  }
  if (workingPolygon.pendingArcEndPoint !== null) {
    const isClosingArc = workingPolygon.points.length > 0 &&
      workingPolygon.pendingArcEndPoint.x === workingPolygon.points[0].point.x &&
      workingPolygon.pendingArcEndPoint.y === workingPolygon.points[0].point.y;
    if (isClosingArc) {
      return arcDrawMode === 'quadratic'
        ? 'arc: close with quadratic [b=cubic]'
        : 'arc: close with cubic [m=quadratic]';
    }
    return arcDrawMode === 'quadratic'
      ? 'arc: quadratic [b=cubic]'
      : 'arc: cubic [m=quadratic]';
  }
  if (isHoveringFirstHandle) {
    return altHeld ? 'arc: close with...' : 'close polygon';
  }
  if (altHeld) {
    return 'place arc endpoint';
  }
  return 'place next point';
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
  onPolygonClick?: (event: FederatedPointerEvent) => void;
  onVertexPointerDown?: (event: FederatedPointerEvent, segmentIndex: number) => void;
  onControlPointerDown?: (event: FederatedPointerEvent, segmentIndex: number, pointKey: 'controlPoint' | 'controlPointA' | 'controlPointB') => void;

  onFirstHandleClick?: (event: FederatedPointerEvent) => void;
  onFirstHandleEnter?: () => void;
  onFirstHandleLeave?: () => void;
  onFillPointerDown?: (event: FederatedPointerEvent) => void;
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
  onPolygonClick,
  onVertexPointerDown,
  onControlPointerDown,
  onFirstHandleClick,
  onFirstHandleEnter,
  onFirstHandleLeave,
  onFillPointerDown,
  isDragging,
}) => {
  const { viewportScale, activeTool } = useViewportContext();

  const isSelectMode = activeTool.type === 'select';
  const effectiveFill = selected ? 0x3498db : fill;

  const drawPolygon = useCallback((graphics: Graphics) => {
    if (segments.length < 2) {
      return;
    }

    graphics.clear();

    const viewportPoints = segments.map(s => ({
      x: s.point.x * CM_TO_PIXELS,
      y: s.point.y * CM_TO_PIXELS,
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
        graphics.lineTo(seg.point.x * CM_TO_PIXELS, seg.point.y * CM_TO_PIXELS);
      } else if (seg.type === "arc-quadratic") {
        graphics.quadraticCurveTo(
          seg.controlPoint.x * CM_TO_PIXELS,
          seg.controlPoint.y * CM_TO_PIXELS,
          seg.point.x * CM_TO_PIXELS,
          seg.point.y * CM_TO_PIXELS,
        );
      } else if (seg.type === "arc-cubic") {
        graphics.bezierCurveTo(
          seg.controlPointA.x * CM_TO_PIXELS,
          seg.controlPointA.y * CM_TO_PIXELS,
          seg.controlPointB.x * CM_TO_PIXELS,
          seg.controlPointB.y * CM_TO_PIXELS,
          seg.point.x * CM_TO_PIXELS,
          seg.point.y * CM_TO_PIXELS,
        );
      }
    }
    if (closed && segments.length >= 1) {
      const lastSeg = segments[segments.length - 1];
      if (lastSeg.type === "arc-cubic") {
        const first = segments[0];
        graphics.bezierCurveTo(
          lastSeg.controlPointB.x * CM_TO_PIXELS,
          lastSeg.controlPointB.y * CM_TO_PIXELS,
          first.point.x * CM_TO_PIXELS,
          first.point.y * CM_TO_PIXELS,
          first.point.x * CM_TO_PIXELS,
          first.point.y * CM_TO_PIXELS,
        );
      } else if (lastSeg.type === "arc-quadratic") {
        const first = segments[0];
        graphics.quadraticCurveTo(
          lastSeg.controlPoint.x * CM_TO_PIXELS,
          lastSeg.controlPoint.y * CM_TO_PIXELS,
          first.point.x * CM_TO_PIXELS,
          first.point.y * CM_TO_PIXELS,
        );
      } else {
        graphics.lineTo(viewportPoints[0].x, viewportPoints[0].y);
      }
    }
    graphics.stroke();
  }, [viewportScale, segments, closed, effectiveFill, stroke]);

  const handlePolygonClick = useCallback((e: FederatedPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (isSelectMode && selected && !e.shiftKey && onFillPointerDown) {
      onFillPointerDown(e);
    } else if (isSelectMode && selected) {
      // Clicking an already-selected polygon in select mode should not deselect it.
    } else if (onPolygonClick) {
      onPolygonClick(e);
    }
  }, [isSelectMode, selected, onPolygonClick, onFillPointerDown]);

  return (
    <pixiContainer>
      <pixiGraphics
        draw={drawPolygon}
        eventMode={isDragging ? 'none' : (isSelectMode || selected ? 'static' : 'none')}
        onPointerDown={handlePolygonClick}
      />

      {showDimensions && segments.length >= 2 ? (
        <>
          {segments.slice(0, -1).map((seg, i) => (
            <DimensionLineConstrait
              key={`dim-${i}`}
              pointA={seg.point}
              pointB={segments[i + 1].point}
              viewportScale={viewportScale}
              offsetPx={16}
            />
          ))}
        </>
      ) : null}

      {showHandles ? (
        <>
          <CircleHandleSprites
            segments={segments}
            handleTexture={CIRCLE_HANDLE_TEXTURE}
            scale={viewportScale}
            onControlPointerDown={onControlPointerDown}
            isDragging={isDragging}
          />
          <SquareHandleSprites
            segments={closed ? (
              // NOTE: don't render the last handle because it's the same as the first handle
              segments.slice(0, -1)
            ) : segments}
            handleTexture={SQUARE_HANDLE_TEXTURE}
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
  const [polygons, setPolygons] = useState<Array<Polygon>>([]);
  const [workingPolygon, setWorkingPolygon] = useState<WorkingPolygon | null>(null);
  const [activeTool, setActiveTool] = useState(toolManager.getActiveTool());
  const [previewSheetPos, setPreviewSheetPos] = useState<SheetPosition | null>(null);
  const [arcDrawMode, setArcDrawMode] = useState<"quadratic" | "cubic">("quadratic");
  const [isHoveringFirstHandle, setIsHoveringFirstHandle] = useState(false);
  const [mouseScreenPos, setMouseScreenPos] = useState<ScreenPosition | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const [draggingPolygonId, setDraggingPolygonId] = useState<Id | null>(null);

  useEffect(() => {
    toolManager.on('toolChange', setActiveTool);
    toolManager.getPolygonStore().on('polygonsChanged', setPolygons);
    toolManager.getPolygonStore().on('workingPolygonChanged', setWorkingPolygon);

    toolManager.on('arcDrawModeChange', setArcDrawMode);
    toolManager.on('hoveringFirstHandleChange', setIsHoveringFirstHandle);
    toolManager.on('dragStateChange', setDraggingPolygonId);
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
        activeTool.on('dragStateChange', setDraggingPolygonId);
        return () => {
          activeTool.off('dragStateChange', setDraggingPolygonId);
        };
      }
    }
  }, [activeTool]);

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

    setViewportControlsState(viewportControlsRef.current.getState());

    const initialViewportState = viewportControlsRef.current.getState().viewport;
    toolManager.syncSnappingOptions(initialViewportState.scale);

    viewportControlsRef.current.on('scaleChange', (scale: number) => {
      toolManager.syncSnappingOptions(scale);
    });
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
        activeTool.handleMouseDown(screenPos, viewportState);
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
        activeTool.handleMouseMove(screenPos, viewportState);
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
      activeTool.handleKeyDown(event);
      switch (event.key) {
        case 'Alt':
          setAltHeld(true);
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      activeTool.handleKeyUp(event);
      switch (event.key) {
        case 'Alt':
          setAltHeld(false);
          break;
      }
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
    const grid = getGridAtScale(scale);
    const primaryWorldUnits = grid.primaryCm * CM_TO_PIXELS;

    graphics.clear();

    // Draw fill of sheet
    graphics.setFillStyle({ color: 0xffffff });
    graphics.rect(0, 0, viewportControlsState.rect.width, viewportControlsState.rect.height);
    graphics.fill();

    // Draw sheet grid
    if (grid.secondaryCm !== null && grid.secondaryPx !== null) {
      const secondaryWorldUnits = grid.secondaryCm * CM_TO_PIXELS;
      graphics.setStrokeStyle({ color: 0xdddddd, width: 1 / scale });
      for (let x = 0; x <= viewportControlsState.rect.width; x += secondaryWorldUnits) {
        graphics.moveTo(x, 0);
        graphics.lineTo(x, viewportControlsState.rect.height);
      }
      for (let y = 0; y <= viewportControlsState.rect.height; y += secondaryWorldUnits) {
        graphics.moveTo(0, y);
        graphics.lineTo(viewportControlsState.rect.width, y);
      }
      graphics.stroke();
    }

    graphics.setStrokeStyle({ color: 0xaaaaaa, width: 1 / scale });
    for (let x = 0; x <= viewportControlsState.rect.width; x += primaryWorldUnits) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, viewportControlsState.rect.height);
    }
    for (let y = 0; y <= viewportControlsState.rect.height; y += primaryWorldUnits) {
      graphics.moveTo(0, y);
      graphics.lineTo(viewportControlsState.rect.width, y);
    }
    graphics.stroke();

    // Draw outline of sheet
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.rect(0, 0, viewportControlsState.rect.width, viewportControlsState.rect.height);
    graphics.stroke();
  }, [viewportControlsState]);

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
                const isSelected = selectionManager.isSelected(polygon.id);
                return (
                  <PolygonRenderer
                    key={polygon.id}
                    segments={polygon.points}
                    closed={polygon.closed}
                    showDimensions
                    showHandles={activeTool.type !== 'polygon' ? isSelected : true}
                    selected={isSelected}
                    isDragging={draggingPolygonId === polygon.id}
                    onPolygonClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.stopImmediatePropagation();

                      if (activeTool.type === "select") {
                        activeTool.handlePolygonSelect(polygon.id, e.shiftKey);
                      }
                    }}
                    onVertexPointerDown={(e, segmentIndex) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.stopImmediatePropagation();

                      if (activeTool.type === "select") {
                        activeTool.onVertexPointerDown(
                          new ScreenPosition(e.clientX, e.clientY),
                          { position: viewportControlsState.viewport.position, scale: viewportControlsState.viewport.scale },
                          polygon.id,
                          segmentIndex,
                        );
                      }
                    }}
                    onControlPointerDown={(e, segmentIndex, pointKey) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.stopImmediatePropagation();

                      if (activeTool.type === "select") {
                        activeTool.onControlPointerDown(
                          new ScreenPosition(e.clientX, e.clientY),
                          { position: viewportControlsState.viewport.position, scale: viewportControlsState.viewport.scale },
                          polygon.id,
                          segmentIndex,
                          pointKey,
                        );
                      }
                    }}
                    onFillPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.stopImmediatePropagation();

                      if (activeTool.type === "select") {
                        activeTool.onFillPointerDown(
                          new ScreenPosition(e.clientX, e.clientY),
                          { position: viewportControlsState.viewport.position, scale: viewportControlsState.viewport.scale },
                          polygon.id,
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
                <SquareHandleSprites
                  segments={previewHandleSprites}
                  handleTexture={SQUARE_HANDLE_TEXTURE}
                  scale={viewportControlsState.viewport.scale}
                />
              )}
            </pixiContainer>
          ) : null}
        </Application>

        {activeTool.type === 'polygon' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            {getStatusText(workingPolygon, isHoveringFirstHandle, altHeld, arcDrawMode)}
          </HoverTooltip>
        ) : null}
      </div>
    </ViewportContextProvider>
  );
}
