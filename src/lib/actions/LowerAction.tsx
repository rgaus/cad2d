import { ArrowDown } from 'lucide-react';
import React from 'react';
import { PLATFORM_CONTROL_KEY_STRING } from '../detection';
import { RenderOrderComponent } from '../geometry';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

export class LowerAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = 'lower' as const;
  label = 'Lower';
  desc = 'Lower selected geometry one level';

  get icon(): React.ReactNode {
    return <ArrowDown size={20} />;
  }

  executeKeyCombo = [`${PLATFORM_CONTROL_KEY_STRING}+[`, 'PageDown'];

  async execute() {
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const geometry = this.getGeometryStore().getById(id);
      if (geometry) {
        this.getGeometryStore().setRenderOrder(id, RenderOrderComponent.get(geometry) - 1);
        continue;
      }
    }
  }
}
