"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Application, extend } from "@pixi/react";
import { Container, Graphics } from "pixi.js";
import { ViewportControls } from "@/lib/viewport/ViewportControls";

extend({
  Container,
  Graphics,
});

const RECT_WIDTH = 100;
const RECT_HEIGHT = 100;

export default function ViewportRenderer2D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<ViewportControls | null>(null);
  const [state, setState] = useState(controlsRef.current?.getState());

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

    controlsRef.current = new ViewportControls(
      {
        canvasWidth: width,
        canvasHeight: height,
        rectWidth: RECT_WIDTH,
        rectHeight: RECT_HEIGHT,
      },
      { onCursorChange: handleCursorChange }
    );

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

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("mouseleave", onMouseLeave);

    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [handleCursorChange]);

  const drawRect = useCallback((graphics: Graphics) => {
    if (!state) return;
    graphics.clear();
    graphics.setFillStyle({ color: 0xffffff });
    graphics.rect(state.rect.position.x, state.rect.position.y, state.rect.width, state.rect.height);
    graphics.fill();
  }, [state]);

  if (!state) {
    return <div ref={containerRef} className="h-screen w-screen overflow-hidden" />;
  }

  return (
    <div ref={containerRef} className="h-screen w-screen overflow-hidden">
      <Application resizeTo={containerRef}>
        <pixiContainer
          x={state.viewport.position.x}
          y={state.viewport.position.y}
          scale={state.viewport.scale}
        >
          <pixiGraphics draw={drawRect} />
        </pixiContainer>
      </Application>
    </div>
  );
}
