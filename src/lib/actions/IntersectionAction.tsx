import { SquaresUnite } from 'lucide-react';
import React from 'react';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';
import { executeBooleanOperation } from './boolean-operation';

export class IntersectionAction extends BaseAction {
  type = 'intersection' as const;
  label = 'Intersection';
  desc = 'Creates a new polygon from the overlapping area common to all selected geometries.';
  executeKeyCombo = null;

  get icon(): React.ReactNode {
    return <SquaresUnite size={20} />;
  }

  constructor(actionsManager: ActionsManager) {
    super(actionsManager);
    this.updateDisabled = () => {
      this.disabled = this.getSelectionManager().getSelectedIds().length < 2;
    };
    this.getSelectionManager().on('selectionChange', this.updateDisabled);
    this.updateDisabled();
  }

  private updateDisabled: () => void;

  async execute() {
    executeBooleanOperation({
      operation: 'intersection',
      geometryStore: this.getGeometryStore(),
      selectionManager: this.getSelectionManager(),
      historyManager: this.getHistoryManager(),
      sheetDefaultUnit: this.getSheet().defaultUnit,
    });
  }
}
