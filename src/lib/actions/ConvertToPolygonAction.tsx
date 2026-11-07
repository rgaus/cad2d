import { Shapes } from 'lucide-react';
import React from 'react';
import { GeometryComponent } from '@/lib/entity';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

/** Converts a single selected rectangle or ellipse to a polygon and updates the selection. */
export class ConvertToPolygonAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.updateDisabledState();
    this.getSelectionManager().on('selectionChange', this.updateDisabledState);
  }

  private updateDisabledState = () => {
    const selectedIds = this.getSelectionManager().getSelectedIds();
    const geometryStore = this.getGeometryStore();
    const rectangleIds = selectedIds.filter((id) => {
      const g = geometryStore.getByIdWithComponent(id, GeometryComponent);
      return g !== null && GeometryComponent.get(g).type === 'rectangle';
    });
    const ellipseIds = selectedIds.filter((id) => {
      const g = geometryStore.getByIdWithComponent(id, GeometryComponent);
      return g !== null && GeometryComponent.get(g).type === 'ellipse';
    });
    this.disabled = rectangleIds.length + ellipseIds.length === 0;
  };

  type = 'convert-to-polygon' as const;
  label = 'Convert to Polygon';

  get icon(): React.ReactNode {
    return <Shapes size={20} />;
  }

  async execute() {
    const selectionManager = this.getSelectionManager();
    const selectedIds = selectionManager.getSelectedIds();
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();

    if (selectedIds.length === 0) {
      return;
    }

    historyManager.applyTransaction('convert-to-polygon', () => {
      for (const id of selectedIds) {
        const geom = geometryStore.getByIdWithComponent(id, GeometryComponent);
        if (!geom) {
          continue;
        }
        const geomData = GeometryComponent.get(geom);
        if (geomData.type === 'rectangle') {
          const polygon = geometryStore.convertRectangleToPolygon(geom.id);
          selectionManager.deselect(geom.id);
          selectionManager.select(polygon.id);
          continue;
        }
        if (geomData.type === 'ellipse') {
          const polygon = geometryStore.convertEllipseToPolygon(geom.id);
          selectionManager.deselect(geom.id);
          selectionManager.select(polygon.id);
          continue;
        }
      }
    });
  }
}
