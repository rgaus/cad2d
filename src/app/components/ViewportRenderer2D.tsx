"use client";

import { useEffect, useRef, useState, useMemo, Fragment } from "react";
import { Application, extend } from "@pixi/react";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { ViewportControls } from "@/lib/viewport/ViewportControls";
import { ScreenPosition, SheetPosition, ViewportControlsState } from "@/lib/viewport/types";
import { ToolManager } from "@/lib/tools/ToolManager";
import { SelectionManager } from "@/lib/tools/SelectionManager";
import { SHEET_UNITS_TO_PIXELS, type Sheet } from "@/lib/sheet/Sheet";
import { type Polygon, type WorkingPolygon, type Rectangle, type WorkingRectangle, type Ellipse, type WorkingEllipse } from "@/lib/tools/types";
import { getVertexHandleTexture, getIntersectionVertexHandleTexture } from "@/lib/textures";
import { HoverTooltip } from "./HoverTooltip";
import { PolygonToolStatusTooltip, PreviewSegmentIntersections } from "@/lib/tools/PolygonTool";
import { TrimSegment, type SplitPoint } from "@/lib/tools/TrimSplitTool";
import { KeyboardShortcut } from "./KeyboardShortcut";
import FitToScreenButton from "./FitToScreenButton";
import { type DraggingShapeState } from "@/lib/tools/types";
import { KeyCombo } from "@/lib/index-mapper";
import { ActionsManager } from "@/lib/actions/ActionsManager";
import { ViewportContextData, ViewportContextProvider } from "@/contexts/viewport-context";
import { SheetRenderer } from "@/components/SheetRenderer";
import { HandleSprites } from "@/components/HandleSprites";
import { RendererLayers } from "@/lib/renderer";
import { EllipseLayers, WorkingEllipseRenderer } from "@/components/EllipseRenderer";
import { RectangleLayers, WorkingRectangleRenderer } from "@/components/RectangleRenderer";
import { PolygonLayers, WorkingPolygonRenderer } from "@/components/PolygonRenderer";
import { useDevicePixelRatio } from "@/hooks";

extend({
  Container,
  Graphics,
  Sprite,
});

type ViewportRenderer2DProps = {
  sheet: Sheet;
  toolManager: ToolManager;
  actionsManager: ActionsManager;
  selectionManager: SelectionManager;
};

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


const ADD_POLYGON_POINT_TOOLTIP_TIMEOUT_MS = 100;

/**
 * Renders the CAD viewport with the sheet rectangle, adaptive grid lines, and polygons.
 * Handles mouse, touch, and wheel events via ViewportControls.
 */
export default function ViewportRenderer2D({ sheet, toolManager, actionsManager, selectionManager }: ViewportRenderer2DProps) {
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
  const [polygonToolStatusTooltip, setPolygonToolStatusTooltip] = useState<PolygonToolStatusTooltip | null>(null);
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
  const [splitPointOrTrimSegment, setSplitPointOrTrimSegment] = useState<SplitPoint | TrimSegment | null>(null);

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
        activeTool.on('statusTooltipChange', setPolygonToolStatusTooltip);
        activeTool.on('previewSheetPositionChange', setPreviewSheetPos);
        activeTool.on('previewSegmentIntersections', setPreviewSegmentIntersections);
        activeTool.on('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
        return () => {
          activeTool.off('statusTooltipChange', setPolygonToolStatusTooltip);
          activeTool.off('previewSheetPositionChange', setPreviewSheetPos);
          activeTool.off('previewSegmentIntersections', setPreviewSegmentIntersections);
          activeTool.off('previewSegmentIntersectionsEnabled', setPreviewSegmentIntersectionsEnabled);
        };
      }
      case "rectangle": {
        activeTool.on('isCenterModeChange', setRectangleIsCenterMode);
        activeTool.on('previewSheetPositionChange', setPreviewSheetPos);
        return () => {
          activeTool.off('isCenterModeChange', setRectangleIsCenterMode);
          activeTool.off('previewSheetPositionChange', setPreviewSheetPos);
        };
      }
      case "ellipse": {
        activeTool.on('isCenterModeChange', setEllipseIsCenterMode);
        activeTool.on('previewSheetPositionChange', setPreviewSheetPos);
        return () => {
          activeTool.off('isCenterModeChange', setEllipseIsCenterMode);
          activeTool.off('previewSheetPositionChange', setPreviewSheetPos);
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

      case "trim-split": {
        activeTool.on('splitPointOrTrimSegmentChange', setSplitPointOrTrimSegment);
        return () => {
          activeTool.off('splitPointOrTrimSegmentChange', setSplitPointOrTrimSegment);
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
      }
      setViewportControlsState(viewportControlsRef.current?.getState() ?? null);
    };

    const onMouseMove = (event: MouseEvent) => {
      viewportControlsRef.current?.handleMouseMove(event);
      if (viewportControlsRef.current) {
        const viewportState = viewportControlsRef.current.getState().viewport;
        const screenPos = new ScreenPosition(event.clientX, event.clientY);
        toolManager.handleMouseMove(screenPos, viewportState);
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
      for (const handleKeyDown of [
        actionsManager.handleKeyDown.bind(actionsManager),
        toolManager.handleKeyDown.bind(toolManager),
      ]) {
        if (handleKeyDown(event)) {
          break;
        }
      }
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
    viewportControls: viewportControlsRef.current,
    sheet,
    toolManager,
    activeTool,
    selectionManager,
    geometryStore: toolManager.getGeometryStore(),
    mouseScreenPos, // FIXME: break this out into another context, it will change often
  } satisfies ViewportContextData), [sheet, toolManager, viewportControlsState?.viewport.scale, activeTool, selectionManager, mouseScreenPos]);

  const pixelRatio = useDevicePixelRatio();

  return (
    <ViewportContextProvider value={viewportContextState}>
      <div ref={containerRef} className="h-full w-full overflow-hidden bg-[#eeeeee]">
        <Application resizeTo={containerRef} backgroundColor={0xeeeeee} antialias={true} resolution={pixelRatio} autoDensity={true}>
          {/* Render a backdrop to capture clicks that weren't caught by something else. */}
          {canvasDimensions ? (
            <pixiSprite
              texture={Texture.WHITE}
              alpha={0}
              x={0}
              y={0}
              scale={{ x: canvasDimensions.width, y: canvasDimensions.height }}
              eventMode="static"
              onPointerDown={() => {
                if (activeTool.type === 'select') {
                  selectionManager.clearSelection();
                }
              }}
            />
          ) : null}

          {viewportControlsState ? (
            <pixiContainer
              x={viewportControlsState.viewport.position.x}
              y={viewportControlsState.viewport.position.y}
              scale={viewportControlsState.viewport.scale}
            >
              {canvasDimensions !== null ? (
                <SheetRenderer
                  sheet={sheet}
                  viewportControlsState={viewportControlsState}
                  canvasDimensions={canvasDimensions}
                />
              ) : null}

              {/* Completed polygons: */}
              {typeof PolygonLayers[RendererLayers.Solids] === 'function' ? (
                polygons.map((polygon) => {
                  const layer = PolygonLayers[RendererLayers.Solids];
                  if (typeof layer !== 'function') {
                    return null;
                  }
                  return (
                    <Fragment key={polygon.id}>
                      {layer(polygon)}
                    </Fragment>
                  );
                })
              ) : PolygonLayers[RendererLayers.Solids]}
              {typeof PolygonLayers[RendererLayers.Overlays] === 'function' ? (
                polygons.map((polygon) => {
                  const layer = PolygonLayers[RendererLayers.Overlays];
                  if (typeof layer !== 'function') {
                    return null;
                  }
                  return (
                    <Fragment key={polygon.id}>
                      {layer(polygon)}
                    </Fragment>
                  );
                })
              ) : PolygonLayers[RendererLayers.Overlays]}

              {/* Completed rectangles: */}
              {typeof RectangleLayers[RendererLayers.Solids] === 'function' ? (
                rectangles.map((rectangle) => {
                  const layer = RectangleLayers[RendererLayers.Solids];
                  if (typeof layer !== 'function') {
                    return null;
                  }
                  return (
                    <Fragment key={rectangle.id}>
                      {layer(rectangle)}
                    </Fragment>
                  );
                })
              ) : RectangleLayers[RendererLayers.Solids]}
              {typeof RectangleLayers[RendererLayers.Overlays] === 'function' ? (
                rectangles.map((rectangle) => {
                  const layer = RectangleLayers[RendererLayers.Overlays];
                  if (typeof layer !== 'function') {
                    return null;
                  }
                  return (
                    <Fragment key={rectangle.id}>
                      {layer(rectangle)}
                    </Fragment>
                  );
                })
              ) : RectangleLayers[RendererLayers.Overlays]}

              {/* Completed ellipses: */}
              {typeof EllipseLayers[RendererLayers.Solids] === 'function' ? (
                ellipses.map((ellipse) => {
                  const layer = EllipseLayers[RendererLayers.Solids];
                  if (typeof layer !== 'function') {
                    return null;
                  }
                  return (
                    <Fragment key={ellipse.id}>
                      {layer(ellipse)}
                    </Fragment>
                  );
                })
              ) : EllipseLayers[RendererLayers.Solids]}
              {typeof EllipseLayers[RendererLayers.Overlays] === 'function' ? (
                ellipses.map((ellipse) => {
                  const layer = EllipseLayers[RendererLayers.Overlays];
                  if (typeof layer !== 'function') {
                    return null;
                  }
                  return (
                    <Fragment key={ellipse.id}>
                      {layer(ellipse)}
                    </Fragment>
                  );
                })
              ) : EllipseLayers[RendererLayers.Overlays]}

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
              {activeTool.type === 'select' && isHoveringPolygonEdge && closestPointToSegment ? (
                <pixiSprite
                  texture={getIntersectionVertexHandleTexture()}
                  x={closestPointToSegment.point.x * SHEET_UNITS_TO_PIXELS}
                  y={closestPointToSegment.point.y * SHEET_UNITS_TO_PIXELS}
                  anchor={{ x: 0.5, y: 0.5 }}
                  scale={{ x: 1 / viewportControlsState.viewport.scale, y: 1 / viewportControlsState.viewport.scale }}
                />
              ) : null}

              {/* Render a fake handle when a possible split point has been found */}
              {activeTool.type === 'trim-split' && splitPointOrTrimSegment?.type === 'split-point' ? (
                <pixiSprite
                  texture={getIntersectionVertexHandleTexture()}
                  x={splitPointOrTrimSegment.point.x * SHEET_UNITS_TO_PIXELS}
                  y={splitPointOrTrimSegment.point.y * SHEET_UNITS_TO_PIXELS}
                  anchor={{ x: 0.5, y: 0.5 }}
                  scale={{ x: 1 / viewportControlsState.viewport.scale, y: 1 / viewportControlsState.viewport.scale }}
                />
              ) : null}

              {/* Render a highlight over the segment to be trimmed */}
              {activeTool.type === 'trim-split' && splitPointOrTrimSegment?.type === 'trim-segment' ? (
                <pixiSprite
                  texture={Texture.WHITE}
                  tint={0xe5484d /* var(--red-9) */}
                  x={computeLineSpriteTransform(splitPointOrTrimSegment.trimmedSegment.start, splitPointOrTrimSegment.trimmedSegment.end).centerX}
                  y={computeLineSpriteTransform(splitPointOrTrimSegment.trimmedSegment.start, splitPointOrTrimSegment.trimmedSegment.end).centerY}
                  angle={computeLineSpriteTransform(splitPointOrTrimSegment.trimmedSegment.start, splitPointOrTrimSegment.trimmedSegment.end).angleDegrees + 90}
                  anchor={{ x: 0.5, y: 0.5 }}
                  scale={{
                    x: 5 / viewportControlsState.viewport.scale,
                    y: computeLineSpriteTransform(splitPointOrTrimSegment.trimmedSegment.start, splitPointOrTrimSegment.trimmedSegment.end).length,
                  }}
                />
              ) : null}
            </pixiContainer>
          ) : null}
        </Application>

        {activeTool.type === 'polygon' && mouseScreenPos ? (
          <HoverTooltip position={mouseScreenPos}>
            <div className="flex flex-col gap-1">
              <span>
                {{
                  'place-first-point': 'Place first point',
                  'continue-polygon': 'Continue polygon',
                  'place-next-point': 'Place next point',
                  'place-arc-endpoint': 'Place arc endpoint',
                  'place-closing-arc-endpoint': 'Arc: close with...',
                  'arc-quadratic': 'Place quadratic arc control point',
                  'arc-cubic': 'Place cubic arc control point',
                  'close-polygon': 'Close polygon',
                  'close-arc-quadratic': 'Place quadratic arc control point',
                  'close-arc-cubic': 'Place cubic arc control point',
                }[polygonToolStatusTooltip ?? 'place-first-point']}
              </span>
              <div className="flex items-center gap-2">
                {['arc-quadratic', 'close-arc-quadratic', 'arc-cubic', 'close-arc-cubic'].includes(polygonToolStatusTooltip!) ? (
                  <KeyboardShortcut label={polygonToolStatusTooltip === 'arc-cubic' || polygonToolStatusTooltip === 'close-arc-cubic' ? "Quadratic" : "Cubic"}>
                    {polygonToolStatusTooltip === 'arc-cubic' || polygonToolStatusTooltip === 'close-arc-cubic' ? 'M' : 'B'}
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

        {/* TODO: show this only when the cursor is in the bounds of the selected geometry, maybe? */}
        {/* {activeTool.type === 'select' && mouseScreenPos && selectedIds.length > 0 ? ( */}
        {/*   <HoverTooltip position={mouseScreenPos}> */}
        {/*     <div className="flex flex-col gap-1"> */}
        {/*       <KeyboardShortcut label="Duplicate" disabled={altHeld}>alt</KeyboardShortcut> */}
        {/*     </div> */}
        {/*   </HoverTooltip> */}
        {/* ) : null} */}

        {activeTool.type === 'select' && showAddPointTooltip && isHoveringPolygonEdge && closestPointToSegment && viewportControlsState ? (
          <HoverTooltip position={closestPointToSegment.point.toWorld().toScreen(viewportControlsState.viewport)}>
            Add point
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'trim-split' && splitPointOrTrimSegment?.type === 'split-point' && viewportControlsState ? (
          <HoverTooltip position={splitPointOrTrimSegment.point.toWorld().toScreen(viewportControlsState.viewport)}>
            Add intersection point
          </HoverTooltip>
        ) : null}

        {activeTool.type === 'trim-split' && splitPointOrTrimSegment?.type === 'trim-segment' && viewportControlsState ? (
          <HoverTooltip position={splitPointOrTrimSegment.nearestCursorPoint.toWorld().toScreen(viewportControlsState.viewport)}>
            Trim segment
          </HoverTooltip>
        ) : null}

        <FitToScreenButton onClick={() => viewportControlsRef.current?.fitToViewport()} />
      </div>
    </ViewportContextProvider>
  );
}
