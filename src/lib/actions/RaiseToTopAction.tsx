import { ArrowUpFromLine } from 'lucide-react';
import React from 'react';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

export class RaiseToTopAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = 'raise-to-top' as const;
  label = 'Raise to Top';
  desc = 'Raise selected geometry to the top';

  get icon(): React.ReactNode {
    return <ArrowUpFromLine size={20} />;
  }

  executeKeyCombo = ['cmd+shift+]', 'ctrl+shift+]', 'Home'];

  async execute() {
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const geometry = this.getGeometryStore().getById(id);
      if (geometry) {
        this.getGeometryStore().setRenderOrder(id, 0);
        continue;
      }
    }
  }
}
