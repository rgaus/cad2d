"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Application, extend } from "@pixi/react";
import { Container, Graphics } from "pixi.js";
import { ViewportControls } from "@/lib/viewport/ViewportControls";
import type { Sheet } from "@/lib/sheet/Sheet";

extend({
  Container,
  Graphics,
});

type ViewportRenderer2DProps = {
  sheet: Sheet;
};

export default function ViewportRenderer2D({ sheet }: ViewportRenderer2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<ViewportControls | null>(null);
  const [state, setState] = useState<Awaited<ReturnType<ViewportControls['getState']>> | undefined>(undefined);
  const sheetRef = useRef<Sheet>(sheet);

  const handleCursorChange = useCallback((cursor: "grab" | "grabbing" | "default") => {
    if (containerRef.current) {
      containerRef.current.style.cursor = cursor;
    }
  }, []);

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
      sheet: sheetRef.current,
    });

    controlsRef.current.on('cursorChange', handleCursorChange);

    setState(controlsRef.current.getState());

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      controlsRef.current?.handleWheel(event);
      setState(controlsRef.current?.getState());
    };

    const onMouseDown = (event: MouseEvent) => {
      controlsRef.current?.handleMouseDown(event);
      setState(controlsRef.current?.getState());
    };

    const onMouseMove = (event: MouseEvent) => {
      controlsRef.current?.handleMouseMove(event);
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

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mouseleave", onMouseLeave);
    window.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      controlsRef.current?.off('cursorChange', handleCursorChange);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mouseleave", onMouseLeave);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [handleCursorChange]);

  useEffect(() => {
    if (sheet !== sheetRef.current) {
      sheetRef.current = sheet;
      if (controlsRef.current) {
        controlsRef.current.updateSheet(sheet);
        setState(controlsRef.current.getState());
      }
    }
  }, [sheet]);

  const drawRect = useCallback((graphics: Graphics) => {
    if (!state) return;
    graphics.clear();
    graphics.setFillStyle({ color: 0xffffff });
    graphics.rect(state.rect.position.x, state.rect.position.y, state.rect.width, state.rect.height);
    graphics.fill();
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / state.viewport.scale });
    graphics.rect(state.rect.position.x, state.rect.position.y, state.rect.width, state.rect.height);
    graphics.stroke();
  }, [state]);

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
