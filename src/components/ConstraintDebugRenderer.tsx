import { useEffect, useState } from 'react';
import { useViewportContext } from '@/contexts/viewport-context';
import { SingleLayers } from '@/lib/renderer';

const ConstraintDebugRendererOverlays: React.FunctionComponent = () => {
  const { sheet } = useViewportContext();

  const [enabled, setEnabled] = useState(sheet.constraintDebugView);
  useEffect(() => {
    sheet.on('constraintDebugViewChange', setEnabled);
    return () => {
      sheet.off('constraintDebugViewChange', setEnabled);
    };
  }, [sheet]);

  if (!enabled) {
    return null;
  }

  return <pixiContainer />;
};

export const ConstraintDebugRenderer: SingleLayers<React.ReactNode> = {
  Overlays: <ConstraintDebugRendererOverlays />,
};
