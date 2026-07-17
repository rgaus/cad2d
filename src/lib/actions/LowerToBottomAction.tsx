import { ArrowDownToLine } from 'lucide-react';
import React from 'react';
import { Entity, RenderOrderComponent } from '../geometry';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

export class LowerToBottomAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = 'lower-to-bottom' as const;
  label = 'Lower to Bottom';
  desc = 'Lower selected geometry to the bottom';

  get icon(): React.ReactNode {
    return <ArrowDownToLine size={20} />;
  }

  executeKeyCombo = ['cmd+shift+[', 'ctrl+shift+[', 'End'];

  async execute() {
    const [maxOrder] = this.getGeometryStore().getMaxRenderOrder();
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const geometry = this.getGeometryStore().getById(id);
      if (geometry && Entity.hasComponent(geometry, RenderOrderComponent)) {
        this.getGeometryStore().setRenderOrder(id, maxOrder);
        continue;
      }
    }
  }
}
