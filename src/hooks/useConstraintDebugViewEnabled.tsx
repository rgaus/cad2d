import { useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';

export const useConstraintDebugViewEnabled = () => {
  const { sheet } = useViewportContext();

  const [enabled, setEnabled] = useState(sheet.constraintDebugView);

  useEffect(() => {
    sheet.on('constraintDebugViewChange', setEnabled);
    return () => {
      sheet.off('constraintDebugViewChange', setEnabled);
    };
  }, [sheet]);

  return enabled;
};
