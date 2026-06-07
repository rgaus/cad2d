import { Graphics } from 'pixi.js';
import { useCallback, useEffect } from 'react';
import { useConstraintDebugViewEnabled } from '@/hooks/useConstraintDebugViewEnabled';
import { useConstraints } from '@/hooks/useConstraints';
import { SingleLayers } from '@/lib/renderer';
import { useViewportContext } from '@/contexts/viewport-context';

const ConstraintDebugRendererOverlays: React.FunctionComponent = () => {
  const { viewportScale } = useViewportContext();
  const constraints = useConstraints();
  const enabled = useConstraintDebugViewEnabled();

  useEffect(() => {
    if (enabled) {
      console.log('Constraint debug constraints:', constraints);
    }
  }, [constraints, enabled]);

  const draw = useCallback(
    (graphics: Graphics) => {
      graphics.clear();
      // TODO: render each type of constraint
    },
    [constraints, viewportScale]
  );

  if (!enabled) {
    return null;
  }

  return (<pixiContainer>
    <pixiGraphics draw={draw} />
  </pixiContainer>);
};

export const ConstraintDebugRenderer: SingleLayers<React.ReactNode> = {
  Overlays: <ConstraintDebugRendererOverlays />,
};
