import { useEffect, useState } from "react";
import { useViewportContext } from "@/contexts/viewport-context";
import { DraggingShapeState } from "@/lib/tools/types";

export const useDraggingShapeState = () => {
  const { activeTool } = useViewportContext();

  const [draggingShapeState, setDraggingShapeState] = useState<DraggingShapeState | null>(null);

  useEffect(() => {
    if (activeTool.type !== 'select') {
      return;
    }
    activeTool.on('dragStateChange', setDraggingShapeState);
    return () => {
      activeTool.off('dragStateChange', setDraggingShapeState);
    };
  }, [activeTool]);

  return draggingShapeState;
};
