import { useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { WorkingRectangle } from '@/lib/tools/types';

export const useWorkingRectangle = () => {
  const { geometryStore } = useViewportContext();

  const [workingRectangle, setWorkingRectangle] = useState<WorkingRectangle | null>(
    geometryStore.workingRectangle,
  );

  useEffect(() => {
    geometryStore.on('workingRectangleChanged', setWorkingRectangle);
    return () => {
      geometryStore.off('workingRectangleChanged', setWorkingRectangle);
    };
  }, [geometryStore]);

  return workingRectangle;
};
