import { SquaresSubtract } from 'lucide-react';
import React from 'react';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';
import { executeBooleanOperation } from './boolean-operation';

export class DifferenceAction extends BaseAction {
  type = 'difference' as const;
  label = 'Difference';
  desc = 'Subtracts subsequent selected geometries from the first selected geometry.';
  executeKeyCombo = null;

  get icon(): React.ReactNode {
    return <SquaresSubtract size={20} />;
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
      operation: 'difference',
      geometryStore: this.getGeometryStore(),
      selectionManager: this.getSelectionManager(),
      historyManager: this.getHistoryManager(),
      sheetDefaultUnit: this.getSheet().defaultUnit,
    });
  }
}
