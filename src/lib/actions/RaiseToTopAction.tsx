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
      const polygon = this.getGeometryStore().polygons.find((p) => p.id === id);
      if (polygon) {
        this.getGeometryStore().setPolygonRenderOrder(id, 0);
        continue;
      }
      const rectangle = this.getGeometryStore().getRectangleById(id);
      if (rectangle) {
        this.getGeometryStore().setRectangleRenderOrder(id, 0);
        continue;
      }
      const ellipse = this.getGeometryStore().getEllipseById(id);
      if (ellipse) {
        this.getGeometryStore().setEllipseRenderOrder(id, 0);
        continue;
      }
    }
  }
}
