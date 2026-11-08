import { Cog } from 'lucide-react';
import React from 'react';
import { ID_PREFIXES } from '@/lib/entity/GeometryStore';
import { InvoluteGear } from '@/lib/entity/involute-gear';
import { applySnapping } from '@/lib/snapping';
import { ScreenPosition, type ViewportState } from '@/lib/viewport/types';
import { BaseTool } from './BaseTool';

/** A tool for stamping involute gear entities with a single click. */
export class InvoluteGearTool extends BaseTool {
  type = 'involute-gear' as const;
  label = 'Involute Gear';
  focusKeyCombo = 'g' as const;

  get icon(): React.ReactNode {
    return <Cog size={24} color="white" />;
  }

  private snappedPosition(screenPos: ScreenPosition, viewport: ViewportState) {
    return applySnapping(screenPos.toWorld(viewport).toSheet(), {
      primaryGridSize: this.toolManager.snappingOptions.primaryGridSize,
      secondaryGridSize: this.toolManager.snappingOptions.secondaryGridSize,
      ctrlHeld: this.toolManager.getCtrlHeld(),
      superHeld: this.toolManager.getSuperHeld(),
      viewportScale: viewport.scale,
    });
  }

  handleToolBlur(): void {
    this.getGeometryStore().clearWorkingInvoluteGear();
  }

  handleMouseMove(screenPos: ScreenPosition, viewport: ViewportState): void {
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }
    const position = this.snappedPosition(screenPos, viewport);
    this.getGeometryStore().setWorkingInvoluteGear({
      position,
      params: InvoluteGear.create(position, sheet.defaultUnit).components.involuteGear.params,
      moduleSheetUnits: InvoluteGear.create(position, sheet.defaultUnit).components.involuteGear
        .moduleSheetUnits,
    });
  }

  handleMouseDown(screenPos: ScreenPosition, viewport: ViewportState): void {
    const sheet = this.getSheet();
    if (!sheet) {
      return;
    }
    const position = this.snappedPosition(screenPos, viewport);
    this.getGeometryStore().addOrdered(
      ID_PREFIXES.involuteGear,
      InvoluteGear.create(position, sheet.defaultUnit),
    );
  }
}
