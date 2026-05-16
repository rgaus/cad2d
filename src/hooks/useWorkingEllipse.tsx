import { useEffect, useState } from "react";
import { useViewportContext } from "@/contexts/viewport-context";
import { WorkingEllipse } from "@/lib/tools/types";

export const useWorkingEllipse = () => {
  const { geometryStore } = useViewportContext();

  const [workingEllipse, setWorkingEllipse] = useState<WorkingEllipse | null>(geometryStore.workingEllipse);

  useEffect(() => {
    geometryStore.on('workingEllipseChanged', setWorkingEllipse);
    return () => {
      geometryStore.off('workingEllipseChanged', setWorkingEllipse);
    };
  }, [geometryStore]);

  return workingEllipse;
};
