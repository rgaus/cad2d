import { useEffect, useState } from 'react';
import type { GeometryStore } from '@/lib/entity/GeometryStore';
import type { WorkingInvoluteGear } from '@/lib/entity/involute-gear';

/** Subscribes to the store's working involute gear preview. */
export const useWorkingInvoluteGear = (
  geometryStore: GeometryStore,
): WorkingInvoluteGear | null => {
  const [working, setWorking] = useState<WorkingInvoluteGear | null>(
    geometryStore.workingInvoluteGear,
  );

  useEffect(() => {
    const handler = (next: WorkingInvoluteGear | null) => setWorking(next);
    geometryStore.on('workingInvoluteGearChanged', handler);
    return () => {
      geometryStore.off('workingInvoluteGearChanged', handler);
    };
  }, [geometryStore]);

  return working;
};
