"use client";

import { Application, extend } from "@pixi/react";
import { Container, Graphics } from "pixi.js";
import { useCallback, useRef } from "react";

extend({
  Container,
  Graphics,
});

export default function Home() {
  const containerRef = useRef<HTMLDivElement>(null);

  const drawRect = useCallback((graphics: Graphics) => {
    graphics.clear();
    graphics.setFillStyle({ color: 0xff0000 });
    graphics.rect(0, 0, 20, 20);
    graphics.fill();
  }, []);

  return (
    <div ref={containerRef} className="h-screen w-screen overflow-hidden">
      <Application resizeTo={containerRef}>
        <pixiGraphics draw={drawRect} />
      </Application>
    </div>
  );
}
