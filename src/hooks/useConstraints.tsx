import { useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { type Constraint } from '@/lib/geometry';

export const useConstraints = () => {
  const { geometryStore } = useViewportContext();

  const [constraints, setConstraints] = useState<Array<Constraint>>(geometryStore.constraints);

  useEffect(() => {
    geometryStore.on('constraintsChanged', setConstraints);
    return () => {
      geometryStore.off('constraintsChanged', setConstraints);
    };
  }, [geometryStore]);

  return constraints;
};
