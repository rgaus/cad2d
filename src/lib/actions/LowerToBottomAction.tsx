import { ArrowDownToLine } from 'lucide-react';
import React from 'react';
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
      const polygon = this.getGeometryStore().polygons.find((p) => p.id === id);
      if (polygon) {
        this.getGeometryStore().setPolygonRenderOrder(id, maxOrder);
        continue;
      }
      const rectangle = this.getGeometryStore().getRectangleById(id);
      if (rectangle) {
        this.getGeometryStore().setRectangleRenderOrder(id, maxOrder);
        continue;
      }
      const ellipse = this.getGeometryStore().getEllipseById(id);
      if (ellipse) {
        this.getGeometryStore().setEllipseRenderOrder(id, maxOrder);
        continue;
      }
    }
  }
}
