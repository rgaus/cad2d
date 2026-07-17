import { Shapes } from 'lucide-react';
import React from 'react';
import { EllipseComponent, PolygonComponent, RectangleComponent } from '@/lib/entity';
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
    const rectangleIds = selectedIds.filter(
      (id) => geometryStore.getByIdWithComponent(id, RectangleComponent) !== null,
    );
    const ellipseIds = selectedIds.filter(
      (id) => geometryStore.getByIdWithComponent(id, EllipseComponent) !== null,
    );
    const polygonIds = selectedIds.filter(
      (id) => geometryStore.getByIdWithComponent(id, PolygonComponent) !== null,
    );
    const singleRectangle =
      rectangleIds.length === 1 && ellipseIds.length === 0 && polygonIds.length === 0;
    const singleEllipse =
      ellipseIds.length === 1 && rectangleIds.length === 0 && polygonIds.length === 0;
    this.disabled = !(singleRectangle || singleEllipse);
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
        const rectangle = geometryStore.getByIdWithComponent(id, RectangleComponent);
        if (rectangle) {
          const polygon = geometryStore.convertRectangleToPolygon(rectangle.id);
          selectionManager.deselect(rectangle.id);
          selectionManager.select(polygon.id);
          return;
        }
        const ellipse = geometryStore.getByIdWithComponent(id, EllipseComponent);
        if (ellipse) {
          const polygon = geometryStore.convertEllipseToPolygon(ellipse.id);
          selectionManager.deselect(ellipse.id);
          selectionManager.select(polygon.id);
          return;
        }
      }
    });
  }
}
