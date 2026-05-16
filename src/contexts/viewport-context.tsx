import { type Sheet } from '@/lib/sheet/Sheet';
import { GeometryStore } from '@/lib/tools/GeometryStore';
import { type SelectionManager } from '@/lib/tools/SelectionManager';
import { type Tool, type ToolManager } from '@/lib/tools/ToolManager';
import { DraggingShapeState, ScreenPosition, SheetPosition, WorkingEllipse, WorkingPolygon, WorkingRectangle } from '@/lib/tools/types';
import { ViewportControls } from '@/lib/viewport/ViewportControls';
import { createContext, useContext, useEffect, useState } from 'react';

export type ViewportContextData = {
  viewportScale: number;
  viewportControls: ViewportControls | null;

  sheet: Sheet;
  toolManager: ToolManager;
  activeTool: Tool;
  selectionManager: SelectionManager;
  geometryStore: GeometryStore;
  mouseScreenPos: ScreenPosition | null;
};
const ViewportContext = createContext<ViewportContextData | null>(null);

/** A context provider which contains data required to render the viewport. */
export const useViewportContext = () => {
  const data = useContext(ViewportContext);
  if (!data) {
    throw new Error('useViewportContext: Not used from within a ViewportContext.');
  }
  return data;
};

export const ViewportContextProvider = ViewportContext.Provider;
