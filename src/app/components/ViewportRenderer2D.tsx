"use client";

import { useCallback, useEffect, useRef, useState, useMemo, createContext, useContext } from "react";
import { Application, extend } from "@pixi/react";
import { Container, FederatedPointerEvent, Graphics, Sprite, Texture } from "pixi.js";
import { ViewportControls } from "@/lib/viewport/ViewportControls";
import { ScreenPosition, SheetPosition, ViewportControlsState } from "@/lib/viewport/types";
import { getGridAtScale } from "@/lib/viewport/grid";
import { ToolManager } from "@/lib/tools/ToolManager";
import { CM_TO_PIXELS, type Sheet } from "@/lib/sheet/Sheet";
import type { Polygon, WorkingPolygon, PolygonSegment } from "@/lib/tools/types";
import { midPoint, quadraticBezierControlFromMidpoint } from "@/lib/math";
import DimensionLineConstrait from "./DimensionLineConstrait";
import { CIRCLE_HANDLE_TEXTURE, SQUARE_HANDLE_TEXTURE } from "@/lib/textures";
import { HoverTooltip } from "./HoverTooltip";

extend({
  Container,
  Graphics,
  Sprite,
});

type ViewportRenderer2DProps = {
  sheet: Sheet;
  toolManager: ToolManager;
};

function HandleSprites({ segments, handleTexture, scale, onFirstClick, onFirstPointerEnter, onFirstPointerLeave }: {
  segments: Array<PolygonSegment>;
  handleTexture: Texture;
  scale: number;
  onFirstClick?: (event: FederatedPointerEvent) => void;
  onFirstPointerEnter?: () => void;
  onFirstPointerLeave?: () => void;
}) {
  const spriteScale = 1 / scale;
  if (segments.length === 0) return null;

  return (
    <>
      {segments.map((seg, index) => (
        <pixiSprite
          key={index}
          texture={handleTexture}
          x={seg.point.x * CM_TO_PIXELS}
          y={seg.point.y * CM_TO_PIXELS}
          anchor={0.5}
          scale={spriteScale}
          eventMode={onFirstClick ? "static" : "none"}
          cursor="pointer"
          {...(index === 0 ? {
            ...(onFirstClick ? { onPointerDown: onFirstClick } : {}),
            ...(onFirstPointerEnter ? { onPointerEnter: onFirstPointerEnter } : {}),
            ...(onFirstPointerLeave ? { onPointerLeave: onFirstPointerLeave } : {}),
          } : {})}
        />
      ))}
    </>
  );
}

function CircleHandleSprites({ controlPoints, handleTexture, scale }: {
  controlPoints: Array<SheetPosition>;
  handleTexture: Texture;
  scale: number;
}) {
  const spriteScale = 1 / scale;
  if (controlPoints.length === 0) return null;

  return (
    <>
      {controlPoints.map((point, index) => (
        <pixiSprite
          key={index}
          texture={handleTexture}
          x={point.x * CM_TO_PIXELS}
          y={point.y * CM_TO_PIXELS}
          anchor={0.5}
          scale={spriteScale}
          eventMode="none"
          cursor="default"
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

type ViewportContextData = { sheet: Sheet, toolManager: ToolManager };
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
 * Renders the CAD viewport with the sheet rectangle, adaptive grid lines, and polygons.
 * Handles mouse, touch, and wheel events via ViewportControls.
 */
export default function ViewportRenderer2D({ sheet, toolManager }: ViewportRenderer2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<ViewportControls | null>(null);
  const [state, setState] = useState<ViewportControlsState | null>(null);
  const [polygons, setPolygons] = useState<Array<Polygon>>([]);
  const [workingPolygon, setWorkingPolygon] = useState<WorkingPolygon | null>(null);
  const [currentTool, setCurrentTool] = useState(toolManager.getTool());
  const [previewSheetPos, setPreviewSheetPos] = useState<SheetPosition | null>(null);
  const [arcDrawMode, setArcDrawMode] = useState<"quadratic" | "cubic">("quadratic");
  const [isHoveringFirstHandle, setIsHoveringFirstHandle] = useState(false);
  const [mouseScreenPos, setMouseScreenPos] = useState<ScreenPosition | null>(null);
  const [altHeld, setAltHeld] = useState(false);

  useEffect(() => {
    toolManager.on('toolChange', setCurrentTool);
    toolManager.on('cursorChange', (cursor: string) => {
      if (containerRef.current) {
        containerRef.current.style.cursor = cursor;
      }
    });
    toolManager.getPolygonStore().on('polygonsChanged', setPolygons);
    toolManager.getPolygonStore().on('workingPolygonChanged', setWorkingPolygon);
    toolManager.on('arcDrawModeChange', setArcDrawMode);
    toolManager.on('hoveringFirstHandleChange', setIsHoveringFirstHandle);
  }, [toolManager]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        if (controlsRef.current) {
          controlsRef.current.resizeCanvas(width, height);
        }
        setState(controlsRef.current?.getState() ?? null);
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

    controlsRef.current = new ViewportControls({
      canvasWidth: width,
      canvasHeight: height,
      sheet,
    });

    setState(controlsRef.current.getState());

    const initialViewportState = controlsRef.current.getState().viewport;
    toolManager.syncSnappingOptions(initialViewportState.scale);

    controlsRef.current.on('scaleChange', (scale: number) => {
      toolManager.syncSnappingOptions(scale);
    });

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      controlsRef.current?.handleWheel(event);
      setState(controlsRef.current?.getState() ?? null);
    };

    const onMouseDown = (event: MouseEvent) => {
      controlsRef.current?.handleMouseDown(event);
      if (controlsRef.current) {
        const viewportState = controlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseDown(screenPos, viewportState);
        setPreviewSheetPos(toolManager.previewSheetPos);
      }
      setState(controlsRef.current?.getState() ?? null);
    };

    const onMouseMove = (event: MouseEvent) => {
      controlsRef.current?.handleMouseMove(event);
      if (controlsRef.current) {
        const viewportState = controlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseMove(screenPos, viewportState);
        setPreviewSheetPos(toolManager.previewSheetPos);
        setMouseScreenPos(new ScreenPosition(event.clientX, event.clientY));
      }
      setState(controlsRef.current?.getState() ?? null);
    };

    const onMouseUp = () => {
      controlsRef.current?.handleMouseUp();
      setState(controlsRef.current?.getState() ?? null);
    };

    const onMouseLeave = () => {
      controlsRef.current?.handleMouseLeave();
      setState(controlsRef.current?.getState() ?? null);
    };

    const onTouchStart = (event: TouchEvent) => {
      controlsRef.current?.handleTouchStart(event);
    };

    const onTouchMove = (event: TouchEvent) => {
      controlsRef.current?.handleTouchMove(event);
      setState(controlsRef.current?.getState() ?? null);
    };

    const onTouchEnd = () => {
      controlsRef.current?.handleTouchEnd();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      toolManager.handleKeyDown(event);
      switch (event.key) {
        case 'Alt':
          setAltHeld(true);
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      toolManager.handleKeyUp(event);
      switch (event.key) {
        case 'Alt':
          setAltHeld(false);
          break;
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [toolManager, sheet]);

  useEffect(() => {
    controlsRef.current?.setPanEnabled(currentTool === 'move');
  }, [currentTool]);

  const drawPolygon = useCallback((graphics: Graphics, segments: Array<PolygonSegment>, closed: boolean, scale: number) => {
    if (segments.length < 2) return;

    const viewportPoints = segments.map(s => ({
      x: s.point.x * CM_TO_PIXELS,
      y: s.point.y * CM_TO_PIXELS,
    }));

    if (closed) {
      graphics.setFillStyle({ color: 0xcccccc });
      graphics.poly(viewportPoints.flatMap(p => [p.x, p.y]));
      graphics.fill();
    }

    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.moveTo(viewportPoints[0].x, viewportPoints[0].y);
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      const prev = segments[i - 1];
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
  }, []);

  const drawWorkingPolygon = useCallback((graphics: Graphics, wp: WorkingPolygon, scale: number) => {
    if (wp.points.length === 0) return;

    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });

    const firstPoint = wp.points[0].point;
    const firstViewportX = firstPoint.x * CM_TO_PIXELS;
    const firstViewportY = firstPoint.y * CM_TO_PIXELS;
    graphics.moveTo(firstViewportX, firstViewportY);

    for (let i = 1; i < wp.points.length; i++) {
      const seg = wp.points[i];
      const prev = wp.points[i - 1];
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

    if (wp.previewPoint) {
      const lastSeg = wp.points[wp.points.length - 1];
      if (wp.pendingArcEndPoint && lastSeg.type === "arc-cubic") {
        graphics.bezierCurveTo(
          lastSeg.controlPointB.x * CM_TO_PIXELS,
          lastSeg.controlPointB.y * CM_TO_PIXELS,
          wp.previewPoint.x * CM_TO_PIXELS,
          wp.previewPoint.y * CM_TO_PIXELS,
          wp.previewPoint.x * CM_TO_PIXELS,
          wp.previewPoint.y * CM_TO_PIXELS,
        );
      } else if (wp.pendingArcEndPoint && lastSeg.type === "arc-quadratic") {
        graphics.quadraticCurveTo(
          lastSeg.controlPoint.x * CM_TO_PIXELS,
          lastSeg.controlPoint.y * CM_TO_PIXELS,
          wp.previewPoint.x * CM_TO_PIXELS,
          wp.previewPoint.y * CM_TO_PIXELS,
        );
      } else {
        graphics.lineTo(wp.previewPoint.x * CM_TO_PIXELS, wp.previewPoint.y * CM_TO_PIXELS);
      }
    }

    graphics.stroke();
  }, []);

  const drawWIPArcPreview = useCallback((graphics: Graphics, wp: WorkingPolygon, arcDrawMode: "quadratic" | "cubic", scale: number) => {
    if (wp.pendingArcEndPoint === null || wp.points.length === 0 || wp.previewPoint === null) return;

    const lastSeg = wp.points[wp.points.length - 1];
    const startX = lastSeg.point.x * CM_TO_PIXELS;
    const startY = lastSeg.point.y * CM_TO_PIXELS;
    const endX = wp.pendingArcEndPoint.x * CM_TO_PIXELS;
    const endY = wp.pendingArcEndPoint.y * CM_TO_PIXELS;
    const cpX = wp.previewPoint.x * CM_TO_PIXELS;
    const cpY = wp.previewPoint.y * CM_TO_PIXELS;

    if (arcDrawMode === 'quadratic') {
      graphics.setStrokeStyle({ color: 0xaaaaaa, width: 1 / scale });
      graphics.moveTo(startX, startY);
      graphics.lineTo(cpX, cpY);
      graphics.lineTo(endX, endY);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
      graphics.moveTo(startX, startY);
      graphics.quadraticCurveTo(cpX, cpY, endX, endY);
      graphics.stroke();
    } else {
      const cpB = quadraticBezierControlFromMidpoint(lastSeg.point, wp.pendingArcEndPoint, midPoint(lastSeg.point, wp.pendingArcEndPoint));
      const cpBX = cpB.x * CM_TO_PIXELS;
      const cpBY = cpB.y * CM_TO_PIXELS;

      graphics.setStrokeStyle({ color: 0xaaaaaa, width: 1 / scale });
      graphics.moveTo(startX, startY);
      graphics.lineTo(cpX, cpY);
      graphics.moveTo(endX, endY);
      graphics.lineTo(cpX, cpY);
      graphics.stroke();

      graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
      graphics.moveTo(startX, startY);
      graphics.bezierCurveTo(cpX, cpY, cpBX, cpBY, endX, endY);
      graphics.stroke();
    }
  }, []);

  const drawRect = useCallback((graphics: Graphics) => {
    if (!state) return;

    const scale = state.viewport.scale;
    const grid = getGridAtScale(scale);
    const primaryWorldUnits = grid.primaryCm * CM_TO_PIXELS;

    graphics.clear();

    graphics.setFillStyle({ color: 0xffffff });
    graphics.rect(0, 0, state.rect.width, state.rect.height);
    graphics.fill();

    if (grid.secondaryCm !== null && grid.secondaryPx !== null) {
      const secondaryWorldUnits = grid.secondaryCm * CM_TO_PIXELS;
      graphics.setStrokeStyle({ color: 0xdddddd, width: 1 / scale });
      for (let x = 0; x <= state.rect.width; x += secondaryWorldUnits) {
        graphics.moveTo(x, 0);
        graphics.lineTo(x, state.rect.height);
      }
      for (let y = 0; y <= state.rect.height; y += secondaryWorldUnits) {
        graphics.moveTo(0, y);
        graphics.lineTo(state.rect.width, y);
      }
      graphics.stroke();
    }

    graphics.setStrokeStyle({ color: 0xaaaaaa, width: 1 / scale });
    for (let x = 0; x <= state.rect.width; x += primaryWorldUnits) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, state.rect.height);
    }
    for (let y = 0; y <= state.rect.height; y += primaryWorldUnits) {
      graphics.moveTo(0, y);
      graphics.lineTo(state.rect.width, y);
    }
    graphics.stroke();

    for (const polygon of polygons) {
      drawPolygon(graphics, polygon.points, polygon.closed, scale);
    }

    if (workingPolygon && workingPolygon.points.length > 0) {
      drawWorkingPolygon(graphics, workingPolygon, scale);
    }

    if (workingPolygon && workingPolygon.pendingArcEndPoint !== null) {
      drawWIPArcPreview(graphics, workingPolygon, arcDrawMode, scale);
    }

    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.rect(0, 0, state.rect.width, state.rect.height);
    graphics.stroke();
  }, [state, polygons, workingPolygon, arcDrawMode, drawPolygon, drawWorkingPolygon, drawWIPArcPreview]);

  const workingHandleSprites = useMemo(() => {
    if (!workingPolygon || workingPolygon.points.length === 0) return null;
    return workingPolygon.points;
  }, [workingPolygon]);

  const polygonHandleSprites = useMemo(() => {
    if (currentTool !== 'select') return [];
    return polygons.flatMap((polygon) =>
      polygon.points
    );
  }, [polygons, currentTool]);

  const previewHandleSprites = useMemo(() => {
    if (currentTool !== 'polygon' || previewSheetPos === null) return null;
    return [{ type: "point" as const, point: previewSheetPos }];
  }, [currentTool, workingPolygon, previewSheetPos]);

  const handleFirstClick = useCallback((e: FederatedPointerEvent) => {
    // Stop the event from propegating further - it it propegates, then it will start a brand new
    // polygon.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    toolManager.completePolygonAtFirstHandle();
  }, [toolManager]);

  const handleFirstPointerEnter = useCallback(() => {
    toolManager.setHoveringFirstHandle(true);
  }, [toolManager]);

  const handleFirstPointerLeave = useCallback(() => {
    toolManager.setHoveringFirstHandle(false);
  }, [toolManager]);

  const viewportContextState = useMemo(() => ({
    sheet,
    toolManager,
  }), [sheet, toolManager]);

  return (
    <ViewportContextProvider value={viewportContextState}>
      <div ref={containerRef} className="h-full w-full overflow-hidden bg-[#eeeeee]">
        <Application resizeTo={containerRef} backgroundColor={0xeeeeee} antialias={true}>
          {state ? (
            <pixiContainer
              x={state.viewport.position.x}
              y={state.viewport.position.y}
              scale={state.viewport.scale}
            >
              <pixiGraphics draw={drawRect} />

              {workingPolygon && workingPolygon.points.length >= 1 && (
                <>
                  {workingPolygon.points.slice(0, -1).map((seg, i) => (
                    <DimensionLineConstrait
                      key={`dim-${i}`}
                      pointA={seg.point}
                      pointB={workingPolygon.points[i + 1].point}
                      viewportScale={state.viewport.scale}
                      offsetPx={16}
                    />
                  ))}
                  {workingPolygon.previewPoint && (
                    <DimensionLineConstrait
                      key="dim-preview"
                      pointA={workingPolygon.points[workingPolygon.points.length - 1].point}
                      pointB={workingPolygon.previewPoint}
                      viewportScale={state.viewport.scale}
                      offsetPx={16}
                    />
                  )}
                </>
              )}
              {workingPolygon && workingPolygon.points.length > 0 && (
                <CircleHandleSprites
                  controlPoints={workingPolygon.points.flatMap((seg) => {
                    switch (seg.type) {
                      case 'arc-quadratic':
                        return [seg.controlPoint];
                      case 'arc-cubic':
                        return [seg.controlPointA, seg.controlPointB];
                      case 'point':
                      default:
                        return [];
                    }
                  })}
                  handleTexture={CIRCLE_HANDLE_TEXTURE}
                  scale={state.viewport.scale}
                />
              )}

              {previewHandleSprites && previewHandleSprites.length > 0 && (
                <HandleSprites
                  segments={previewHandleSprites}
                  handleTexture={SQUARE_HANDLE_TEXTURE}
                  scale={state.viewport.scale}
                />
              )}
              {workingHandleSprites && workingHandleSprites.length > 0 && (
                <HandleSprites
                  segments={workingHandleSprites}
                  handleTexture={SQUARE_HANDLE_TEXTURE}
                  scale={state.viewport.scale}
                  onFirstClick={workingHandleSprites.length >= 2 ? handleFirstClick : undefined}
                  onFirstPointerEnter={workingHandleSprites.length >= 2 ? handleFirstPointerEnter : undefined}
                  onFirstPointerLeave={workingHandleSprites.length >= 2 ? handleFirstPointerLeave : undefined}
                />
              )}
              {workingPolygon && workingPolygon.points.length > 0 && (
                <BezierLines segments={workingPolygon.points} scale={state.viewport.scale} />
              )}
              {workingPolygon && workingPolygon.pendingArcEndPoint !== null && (
                <HandleSprites
                  segments={[{ type: "point", point: workingPolygon.pendingArcEndPoint }]}
                  handleTexture={SQUARE_HANDLE_TEXTURE}
                  scale={state.viewport.scale}
                />
              )}

              {polygonHandleSprites.length > 0 && (
                <HandleSprites
                  segments={polygonHandleSprites}
                  handleTexture={SQUARE_HANDLE_TEXTURE}
                  scale={state.viewport.scale}
                />
              )}
              {workingPolygon && workingPolygon.points.length > 0 && (
                <BezierLines segments={workingPolygon.points} scale={state.viewport.scale} />
              )}
            </pixiContainer>
          ) : null}
        </Application>

        {currentTool === 'polygon' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            {getStatusText(workingPolygon, isHoveringFirstHandle, altHeld, arcDrawMode)}
          </HoverTooltip>
        ) : null}
      </div>
    </ViewportContextProvider>
  );
}
