import { type Sheet } from '@/lib/sheet/Sheet';
import { type SelectionManager } from '@/lib/tools/SelectionManager';
import { type Tool, type ToolManager } from '@/lib/tools/ToolManager';
import { createContext, useContext } from 'react';

export type ViewportContextData = {
  viewportScale: number;
  sheet: Sheet;
  toolManager: ToolManager;
  activeTool: Tool;
  selectionManager: SelectionManager;
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
