import { useEffect, useState } from 'react';
import { HoverTooltip } from '@/components/ui/HoverTooltip';
import { KeyboardShortcut } from '@/components/ui/KeyboardShortcut';
import { useViewportContext } from '@/contexts/viewport-context';
import { GearGeneratorAction, GearGeneratorState } from '@/lib/actions/GearGeneratorAction';

type GearPreviewTooltipProps = {
  action: GearGeneratorAction;
};

/** Hover/drag hint for the gear preview. */
export const GearPreviewTooltip: React.FunctionComponent<GearPreviewTooltipProps> = ({
  action,
}) => {
  const { mouseScreenPos, toolManager } = useViewportContext();
  const [state, setState] = useState<GearGeneratorState>(() => action.getState());

  useEffect(() => {
    const handleStateChange = (nextState: GearGeneratorState) => {
      setState(nextState);
    };
    action.on('stateChange', handleStateChange);
    return () => {
      action.off('stateChange', handleStateChange);
    };
  }, [action]);

  if (
    !state.panelVisible ||
    !mouseScreenPos ||
    (!state.previewInteraction.hovered && !state.previewInteraction.dragging)
  ) {
    return null;
  }

  return (
    <HoverTooltip position={mouseScreenPos}>
      <div className="flex items-center gap-2">
        <KeyboardShortcut label="No snap" disabled={toolManager.getCtrlHeld()}>
          ctrl
        </KeyboardShortcut>
        <KeyboardShortcut label="Cancel">esc</KeyboardShortcut>
      </div>
    </HoverTooltip>
  );
};
