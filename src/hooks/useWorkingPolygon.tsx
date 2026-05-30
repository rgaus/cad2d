import { useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { WorkingPolygon } from '@/lib/tools/types';

export const useWorkingPolygon = () => {
  const { geometryStore } = useViewportContext();

  const [workingPolygon, setWorkingPolygon] = useState<WorkingPolygon | null>(
    geometryStore.workingPolygon,
  );

  useEffect(() => {
    geometryStore.on('workingPolygonChanged', setWorkingPolygon);
    return () => {
      geometryStore.off('workingPolygonChanged', setWorkingPolygon);
    };
  }, [geometryStore]);

  return workingPolygon;
};
