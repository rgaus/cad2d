import { useEffect, useState } from "react";
import { useViewportContext } from "@/contexts/viewport-context";
import { SheetPosition } from "@/lib/viewport/types";

export const useClosestPointToSegment = () => {
  const { activeTool } = useViewportContext();

  const [closestPointToSegment, setClosestPointToSegment] = useState<{ polygonId: string; segmentIndex: number; point: SheetPosition } | null>(null);

  useEffect(() => {
    if (activeTool.type !== 'select') {
      return;
    }
    activeTool.on('closestPointToSegmentChange', setClosestPointToSegment);
    return () => {
      activeTool.off('closestPointToSegmentChange', setClosestPointToSegment);
    };
  }, [activeTool]);

  return closestPointToSegment;
};
