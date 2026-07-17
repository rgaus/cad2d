import { ArrowUp } from 'lucide-react';
import React from 'react';
import { Entity, RenderOrderComponent } from '@/lib/entity';
import { PLATFORM_CONTROL_KEY_STRING } from '../detection';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

export class RaiseAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = 'raise' as const;
  label = 'Raise';
  desc = 'Raise selected geometry one level';

  get icon(): React.ReactNode {
    return <ArrowUp size={20} />;
  }

  executeKeyCombo = [`${PLATFORM_CONTROL_KEY_STRING}+]`, 'PageUp'];

  async execute() {
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const geometry = this.getGeometryStore().getById(id);
      if (geometry && Entity.hasComponent(geometry, RenderOrderComponent)) {
        this.getGeometryStore().setRenderOrder(id, RenderOrderComponent.get(geometry) + 1);
        continue;
      }
    }
  }
}
