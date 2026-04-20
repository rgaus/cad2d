"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Application, extend } from "@pixi/react";
import { Container, FederatedPointerEvent, Graphics, Sprite, Texture } from "pixi.js";
import { ViewportControls } from "@/lib/viewport/ViewportControls";
import { ScreenPosition, SheetPosition } from "@/lib/viewport/types";
import { getGridAtScale } from "@/lib/viewport/grid";
import { ToolManager } from "@/lib/tools/ToolManager";
import { CM_TO_PIXELS, type Sheet } from "@/lib/sheet/Sheet";
import type { Polygon, WorkingPolygon } from "@/lib/tools/types";
import DimensionLineConstrait from "./DimensionLineConstrait";

extend({
  Container,
  Graphics,
  Sprite,
});

type ViewportRenderer2DProps = {
  sheet: Sheet;
  toolManager: ToolManager;
};

const HANDLE_SIZE_PX = 10;

function createHandleTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = HANDLE_SIZE_PX;
  canvas.height = HANDLE_SIZE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.fillRect(0, 0, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
  ctx.strokeRect(0, 0, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
  return Texture.from(canvas);
}

function HandleSprites({ points, handleTexture, scale, onFirstClick }: { points: Array<SheetPosition>, handleTexture: Texture, scale: number, onFirstClick?: (event: FederatedPointerEvent) => void }) {
  const spriteScale = 1 / scale;
  if (points.length === 0) return null;

  return (
    <>
      {points.map((point, index) => (
        <pixiSprite
          key={index}
          texture={handleTexture}
          x={point.x * CM_TO_PIXELS}
          y={point.y * CM_TO_PIXELS}
          anchor={0.5}
          scale={spriteScale}
          eventMode={onFirstClick ? "static" : "none"}
          cursor="pointer"
          {...(index === 0 && onFirstClick ? { onPointerDown: onFirstClick } : {})}
        />
      ))}
    </>
  );
}

/**
 * Renders the CAD viewport with the sheet rectangle, adaptive grid lines, and polygons.
 * Handles mouse, touch, and wheel events via ViewportControls.
 */
export default function ViewportRenderer2D({ sheet, toolManager }: ViewportRenderer2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<ViewportControls | null>(null);
  const [state, setState] = useState<Awaited<ReturnType<ViewportControls['getState']>> | undefined>(undefined);
  const [polygons, setPolygons] = useState<Array<Polygon>>([]);
  const [workingPolygon, setWorkingPolygon] = useState<WorkingPolygon | null>(null);
  const [currentTool, setCurrentTool] = useState(toolManager.getTool());
  const [previewSheetPos, setPreviewSheetPos] = useState<SheetPosition | null>(null);

  const handleTexture = useMemo(() => createHandleTexture(), []);

  useEffect(() => {
    toolManager.on('toolChange', setCurrentTool);
    toolManager.on('cursorChange', (cursor: string) => {
      if (containerRef.current) {
        containerRef.current.style.cursor = cursor;
      }
    });
    toolManager.getPolygonStore().on('polygonsChanged', setPolygons);
    toolManager.getPolygonStore().on('workingPolygonChanged', setWorkingPolygon);
  }, [toolManager]);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        if (controlsRef.current) {
          controlsRef.current.resizeCanvas(width, height);
        }
        setState(controlsRef.current?.getState());
      }
    });

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

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
      setState(controlsRef.current?.getState());
    };

    const onMouseDown = (event: MouseEvent) => {
      controlsRef.current?.handleMouseDown(event);
      if (controlsRef.current) {
        const viewportState = controlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseDown(screenPos, viewportState);
        setPreviewSheetPos(toolManager.previewSheetPos);
      }
      setState(controlsRef.current?.getState());
    };

    const onMouseMove = (event: MouseEvent) => {
      controlsRef.current?.handleMouseMove(event);
      if (controlsRef.current) {
        const viewportState = controlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseMove(screenPos, viewportState);
        setPreviewSheetPos(toolManager.previewSheetPos);
      }
      setState(controlsRef.current?.getState());
    };

    const onMouseUp = () => {
      controlsRef.current?.handleMouseUp();
      setState(controlsRef.current?.getState());
    };

    const onMouseLeave = () => {
      controlsRef.current?.handleMouseLeave();
      setState(controlsRef.current?.getState());
    };

    const onTouchStart = (event: TouchEvent) => {
      controlsRef.current?.handleTouchStart(event);
    };

    const onTouchMove = (event: TouchEvent) => {
      controlsRef.current?.handleTouchMove(event);
      setState(controlsRef.current?.getState());
    };

    const onTouchEnd = () => {
      controlsRef.current?.handleTouchEnd();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      toolManager.handleKeyDown(event);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      toolManager.handleKeyUp(event);
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

  const drawPolygon = useCallback((graphics: Graphics, points: Array<SheetPosition>, closed: boolean, scale: number) => {
    if (points.length < 2) return;

    const viewportPoints = points.map(p => ({
      x: p.x * CM_TO_PIXELS,
      y: p.y * CM_TO_PIXELS,
    }));

    if (closed) {
      graphics.setFillStyle({ color: 0xcccccc });
      graphics.poly(viewportPoints.flatMap(p => [p.x, p.y]));
      graphics.fill();
    }

    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.moveTo(viewportPoints[0].x, viewportPoints[0].y);
    for (const point of viewportPoints) {
      graphics.lineTo(point.x, point.y);
    }
    if (closed) {
      graphics.lineTo(viewportPoints[0].x, viewportPoints[0].y);
    }
    graphics.stroke();
  }, []);

  const drawWorkingPolygon = useCallback((graphics: Graphics, wp: WorkingPolygon, scale: number) => {
    if (wp.points.length === 0) return;

    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });

    const firstPoint = wp.points[0];
    if (firstPoint) {
      const firstViewportX = firstPoint.x * CM_TO_PIXELS;
      const firstViewportY = firstPoint.y * CM_TO_PIXELS;
      graphics.moveTo(firstViewportX, firstViewportY);
      for (const point of wp.points.slice(1)) {
        graphics.lineTo(point.x * CM_TO_PIXELS, point.y * CM_TO_PIXELS);
      }
      if (wp.previewPoint) {
        graphics.lineTo(wp.previewPoint.x * CM_TO_PIXELS, wp.previewPoint.y * CM_TO_PIXELS);
      }
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

    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.rect(0, 0, state.rect.width, state.rect.height);
    graphics.stroke();
  }, [state, polygons, workingPolygon, drawPolygon, drawWorkingPolygon]);

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
    return [previewSheetPos];
  }, [currentTool, workingPolygon, previewSheetPos]);

  const handleFirstClick = useCallback((e: FederatedPointerEvent) => {
    // Stop the event from propegating further - it it propegates, then it will start a brand new
    // polygon.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    toolManager.completePolygonAtFirstHandle();
  }, [toolManager]);

  return (
    <div ref={containerRef} className="h-screen w-screen overflow-hidden">
      {state ? (
        <Application resizeTo={containerRef} backgroundColor={0xeeeeee} antialias={true}>
          <pixiContainer
            x={state.viewport.position.x}
            y={state.viewport.position.y}
            scale={state.viewport.scale}
          >
            <pixiGraphics draw={drawRect} />
            {workingPolygon && workingPolygon.points.length >= 2 && (
              <>
                {workingPolygon.points.slice(0, -1).map((point, i) => (
                  <DimensionLineConstrait
                    key={`dim-${i}`}
                    pointA={point}
                    pointB={workingPolygon.points[i + 1]}
                    viewportScale={state.viewport.scale}
                    offsetPx={16}
                  />
                ))}
                {workingPolygon.previewPoint && (
                  <DimensionLineConstrait
                    key="dim-preview"
                    pointA={workingPolygon.points[workingPolygon.points.length - 1]}
                    pointB={workingPolygon.previewPoint}
                    viewportScale={state.viewport.scale}
                    offsetPx={16}
                  />
                )}
              </>
            )}
            {previewHandleSprites && previewHandleSprites.length > 0 && (
              <HandleSprites
                points={previewHandleSprites}
                handleTexture={handleTexture}
                scale={state.viewport.scale}
              />
            )}
            {workingHandleSprites && workingHandleSprites.length > 0 && (
              <HandleSprites
                points={workingHandleSprites}
                handleTexture={handleTexture}
                scale={state.viewport.scale}
                onFirstClick={workingHandleSprites.length >= 2 ? handleFirstClick : undefined}
              />
            )}
            {polygonHandleSprites.length > 0 && (
              <HandleSprites points={polygonHandleSprites} handleTexture={handleTexture} scale={state.viewport.scale} />
            )}
          </pixiContainer>
        </Application>
      ) : null}
    </div>
  );
}
