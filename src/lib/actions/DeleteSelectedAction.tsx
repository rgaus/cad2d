import { Trash2 } from 'lucide-react';
import React from 'react';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

export class DeleteSelectedAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = 'delete-selected' as const;
  label = 'Delete Selected';
  desc = 'Delete selected geometry';

  get icon(): React.ReactNode {
    return <Trash2 size={20} />;
  }

  executeKeyCombo = ['Delete', 'Backspace'];

  async execute() {
    for (const id of this.getSelectionManager().getSelectedIds()) {
      const polygon = this.getGeometryStore().polygons.find((p) => p.id === id);
      if (polygon) {
        this.getGeometryStore().deletePolygon(id);
        continue;
      }
      const rectangle = this.getGeometryStore().getRectangleById(id);
      if (rectangle) {
        this.getGeometryStore().deleteRectangle(id);
        continue;
      }
      const ellipse = this.getGeometryStore().getEllipseById(id);
      if (ellipse) {
        this.getGeometryStore().deleteEllipse(id);
        continue;
      }
    }
    this.getSelectionManager().clearSelection();
  }
}
