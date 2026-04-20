"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Application, extend } from "@pixi/react";
import { Container, Graphics } from "pixi.js";
import { ViewportControls } from "@/lib/viewport/ViewportControls";
import { ScreenPosition } from "@/lib/viewport/types";
import { getGridAtScale, CM_TO_PX } from "@/lib/viewport/grid";
import { ToolManager } from "@/lib/tools/ToolManager";
import type { Sheet } from "@/lib/sheet/Sheet";
import type { Polygon, WorkingPolygon } from "@/lib/tools/types";

extend({
  Container,
  Graphics,
});

type ViewportRenderer2DProps = {
  sheet: Sheet;
  toolManager: ToolManager;
};

const HANDLE_SIZE_PX = 8;

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
      }
      setState(controlsRef.current?.getState());
    };

    const onMouseMove = (event: MouseEvent) => {
      controlsRef.current?.handleMouseMove(event);
      if (controlsRef.current) {
        const viewportState = controlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseMove(screenPos, viewportState);
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

  const drawPolygon = useCallback((graphics: Graphics, points: Array<{ x: number; y: number }>, closed: boolean, scale: number) => {
    if (points.length < 2) return;

    if (closed) {
      graphics.setFillStyle({ color: 0xcccccc });
      graphics.poly(points.flatMap(p => [p.x, p.y]));
      graphics.fill();
    }

    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.poly(points.flatMap(p => [p.x, p.y]));
    graphics.stroke();
  }, []);

  const drawHandles = useCallback((graphics: Graphics, points: Array<{ x: number; y: number }>, scale: number) => {
    const handleSize = HANDLE_SIZE_PX / scale;
    graphics.setFillStyle({ color: 0xffffff });
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });

    for (const point of points) {
      graphics.rect(point.x - handleSize / 2, point.y - handleSize / 2, handleSize, handleSize);
      graphics.fill();
      graphics.stroke();
    }
  }, []);

  const drawWorkingPolygon = useCallback((graphics: Graphics, wp: WorkingPolygon, scale: number) => {
    if (wp.points.length === 0) return;

    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });

    const firstPoint = wp.points[0];
    if (firstPoint) {
      graphics.moveTo(firstPoint.x, firstPoint.y);
      for (const point of wp.points.slice(1)) {
        graphics.lineTo(point.x, point.y);
      }
      if (wp.previewPoint) {
        graphics.lineTo(wp.previewPoint.x, wp.previewPoint.y);
      }
      graphics.stroke();
    }

    drawHandles(graphics, wp.points, scale);
  }, [drawHandles]);

  const drawRect = useCallback((graphics: Graphics) => {
    if (!state) return;

    const scale = state.viewport.scale;
    const grid = getGridAtScale(scale);
    const primaryWorldUnits = grid.primaryCm * CM_TO_PX;

    graphics.clear();

    graphics.setFillStyle({ color: 0xffffff });
    graphics.rect(0, 0, state.rect.width, state.rect.height);
    graphics.fill();

    if (grid.secondaryCm !== null && grid.secondaryPx !== null) {
      const secondaryWorldUnits = grid.secondaryCm * CM_TO_PX;
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

    for (const polygon of polygons.filter(p => p.closed)) {
      drawPolygon(graphics, polygon.points, true, scale);
    }

    for (const polygon of polygons.filter(p => !p.closed)) {
      drawPolygon(graphics, polygon.points, false, scale);
    }

    if (workingPolygon && workingPolygon.points.length > 0) {
      drawWorkingPolygon(graphics, workingPolygon, scale);
    }

    if (currentTool === 'select') {
      for (const polygon of polygons) {
        drawHandles(graphics, polygon.points, scale);
      }
    }

    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.rect(0, 0, state.rect.width, state.rect.height);
    graphics.stroke();
  }, [state, polygons, workingPolygon, currentTool, drawPolygon, drawWorkingPolygon, drawHandles]);

  return (
    <div ref={containerRef} className="h-screen w-screen overflow-hidden">
      {state ? (
        <Application resizeTo={containerRef} backgroundColor={0xeeeeee}>
          <pixiContainer
            x={state.viewport.position.x}
            y={state.viewport.position.y}
            scale={state.viewport.scale}
          >
            <pixiGraphics draw={drawRect} />
          </pixiContainer>
        </Application>
      ) : null}
    </div>
  );
}
