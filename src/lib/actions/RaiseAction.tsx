import { ArrowUp } from 'lucide-react';
import React from 'react';
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
      const polygon = this.getGeometryStore().polygons.find((p) => p.id === id);
      if (polygon) {
        this.getGeometryStore().setPolygonRenderOrder(id, polygon.renderOrder + 1);
        continue;
      }
      const rectangle = this.getGeometryStore().getRectangleById(id);
      if (rectangle) {
        this.getGeometryStore().setRectangleRenderOrder(id, rectangle.renderOrder + 1);
        continue;
      }
      const ellipse = this.getGeometryStore().getEllipseById(id);
      if (ellipse) {
        this.getGeometryStore().setEllipseRenderOrder(id, ellipse.renderOrder + 1);
        continue;
      }
    }
  }
}
