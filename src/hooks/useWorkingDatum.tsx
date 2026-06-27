import { useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { WorkingDatum } from '@/lib/tools/types';

export const useWorkingDatum = () => {
  const { geometryStore } = useViewportContext();

  const [workingDatum, setWorkingDatum] = useState<WorkingDatum | null>(
    geometryStore.workingDatum,
  );

  useEffect(() => {
    geometryStore.on('workingDatumChanged', setWorkingDatum);
    return () => {
      geometryStore.off('workingDatumChanged', setWorkingDatum);
    };
  }, [geometryStore]);

  return workingDatum;
};
