import { useEffect } from 'react';
import { useConstraintDebugViewEnabled } from '@/hooks/useConstraintDebugViewEnabled';
import { useConstraints } from '@/hooks/useConstraints';
import { SingleLayers } from '@/lib/renderer';

const ConstraintDebugRendererOverlays: React.FunctionComponent = () => {
  const constraints = useConstraints();
  const enabled = useConstraintDebugViewEnabled();

  useEffect(() => {
    if (enabled) {
      console.log('Constraint debug constraints:', constraints);
    }
  }, [constraints, enabled]);

  if (!enabled) {
    return null;
  }

  return <pixiContainer />;
};

export const ConstraintDebugRenderer: SingleLayers<React.ReactNode> = {
  Overlays: <ConstraintDebugRendererOverlays />,
};
