import { SquaresUnite } from 'lucide-react';
import React from 'react';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';
import { executeBooleanOperation } from './boolean-operation';

export class UnionAction extends BaseAction {
  type = 'union' as const;
  label = 'Union';
  desc =
    'Combines multiple selected geometries into a single polygon by merging their overlapping areas.';
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
      operation: 'union',
      geometryStore: this.getGeometryStore(),
      selectionManager: this.getSelectionManager(),
      historyManager: this.getHistoryManager(),
      sheetDefaultUnit: this.getSheet().defaultUnit,
    });
  }
}
