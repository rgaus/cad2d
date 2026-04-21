"use client";

import { useCallback, useEffect, useRef, useState, useMemo, createContext, useContext } from "react";
import { Application, extend } from "@pixi/react";
import { Container, EventMode, FederatedPointerEvent, Graphics, Sprite, Texture } from "pixi.js";
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

function SquareHandleSprites({ segments, handleTexture, scale, onFirstHandleClick, onFirstHandleEnter, onFirstHandleLeave, lastHandleEventMode }: {
  segments: Array<PolygonSegment>;
  handleTexture: Texture;
  scale: number;
  onFirstHandleClick?: (event: FederatedPointerEvent) => void;
  onFirstHandleEnter?: () => void;
  onFirstHandleLeave?: () => void;
  lastHandleEventMode?: EventMode;
}) {
  const spriteScale = 1 / scale;
  if (segments.length === 0) {
    return null;
  }

  return (
    <>
      {segments.map((seg, index) => {
        let eventMode: EventMode = "none";
        if (index === 0 && (onFirstHandleClick || onFirstHandleEnter || onFirstHandleLeave)) {
          eventMode = "static";
        }
        if (index === segments.length - 1 && lastHandleEventMode) {
          eventMode = lastHandleEventMode;
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
            cursor="pointer"
            {...(index === 0 ? {
              ...(onFirstHandleClick ? { onPointerDown: onFirstHandleClick } : {}),
              ...(onFirstHandleEnter ? { onPointerEnter: onFirstHandleEnter } : {}),
              ...(onFirstHandleLeave ? { onPointerLeave: onFirstHandleLeave } : {}),
            } : {})}
          />
        );
      })}
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

type ViewportContextData = {
  viewportScale: number;
  sheet: Sheet;
  toolManager: ToolManager;
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

  onFirstHandleClick?: (event: FederatedPointerEvent) => void;
  onFirstHandleEnter?: () => void;
  onFirstHandleLeave?: () => void;
};

const PolygonRenderer: React.FunctionComponent<PolygonRendererProps> = ({
  segments,
  closed = false,
  fill = 0xcccccc,
  stroke = 0x000000,
  showHandles,
  showDimensions,
  onFirstHandleClick,
  onFirstHandleEnter,
  onFirstHandleLeave,
}) => {
  const { viewportScale } = useViewportContext();

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
      graphics.setFillStyle({ color: fill });
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
  }, [viewportScale, segments, closed, fill, stroke]);

  return (
    <pixiContainer>
      <pixiGraphics draw={drawPolygon} />

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

          {/* If closed, then connect back to the start point */}
          {closed ? (
            <DimensionLineConstrait
              pointA={segments[0].point}
              pointB={segments.at(-1)!.point}
              viewportScale={viewportScale}
              offsetPx={16}
            />
          ) : null}
        </>
      ) : null}

      {showHandles ? (
        <>
          <CircleHandleSprites
            controlPoints={segments.flatMap((seg) => {
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
            scale={viewportScale}
          />
          <SquareHandleSprites
            segments={segments}
            handleTexture={SQUARE_HANDLE_TEXTURE}
            scale={viewportScale}
            onFirstHandleClick={onFirstHandleClick}
            onFirstHandleEnter={onFirstHandleEnter}
            onFirstHandleLeave={onFirstHandleLeave}
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
  workingPolygon: WorkingPolygon;
};

const WorkingPolygonRenderer: React.FunctionComponent<WorkingPolygonRendererProps> = ({ workingPolygon }) => {
  const { toolManager } = useViewportContext();

  const [arcDrawMode, setArcDrawMode] = useState<"quadratic" | "cubic">(toolManager.arcDrawMode);
  useEffect(() => {
    toolManager.on('arcDrawModeChange', setArcDrawMode);
    return () => {
      toolManager.off('arcDrawModeChange', setArcDrawMode);
    };
  }, [toolManager]);

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

    toolManager.completePolygonAtFirstHandle();
  }, [toolManager]);

  const onFirstHandleEnter = useCallback(() => {
    toolManager.setHoveringFirstHandle(true);
  }, [toolManager]);

  const onFirstHandleLeave = useCallback(() => {
    toolManager.setHoveringFirstHandle(false);
  }, [toolManager]);

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

  const drawRect = useCallback((graphics: Graphics) => {
    if (!state) {
      return;
    }

    const scale = state.viewport.scale;
    const grid = getGridAtScale(scale);
    const primaryWorldUnits = grid.primaryCm * CM_TO_PIXELS;

    graphics.clear();

    // Draw fill of sheet
    graphics.setFillStyle({ color: 0xffffff });
    graphics.rect(0, 0, state.rect.width, state.rect.height);
    graphics.fill();

    // Draw sheet grid
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

    // Draw outline of sheet
    graphics.setStrokeStyle({ color: 0x000000, width: 1 / scale });
    graphics.rect(0, 0, state.rect.width, state.rect.height);
    graphics.stroke();
  }, [state]);

  const previewHandleSprites = useMemo(() => {
    if (currentTool !== 'polygon' || workingPolygon !== null || previewSheetPos === null) {
      return [];
    }
    return [{ type: "point" as const, point: previewSheetPos }];
  }, [currentTool, workingPolygon, previewSheetPos]);

  const viewportContextState = useMemo(() => ({
    viewportScale: state?.viewport.scale ?? 1,
    sheet,
    toolManager,
  } satisfies ViewportContextData), [sheet, toolManager, state?.viewport.scale]);

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

              {/* Completed polygons: */}
              {polygons.map((polygon) => {
                return (
                  <PolygonRenderer
                    key={polygon.id}
                    segments={polygon.points}
                    closed={polygon.closed}
                    showDimensions
                    showHandles
                  />
                );
              })}

              {/* Currently work in progress polygon: */}
              {workingPolygon ? (
                <WorkingPolygonRenderer
                  workingPolygon={workingPolygon}
                />
              ) : null}

              {previewHandleSprites && previewHandleSprites.length > 0 && (
                <SquareHandleSprites
                  segments={previewHandleSprites}
                  handleTexture={SQUARE_HANDLE_TEXTURE}
                  scale={state.viewport.scale}
                />
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
