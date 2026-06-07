import { UnplugIcon } from 'lucide-react';
import React from 'react';
import { PolygonComponent } from '@/lib/geometry';
import { UndoEntry } from '@/lib/history/types';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

/** Toggles a single selected polygon between open and closed state. */
export class OpenClosePolygonAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.updateDisabledState();
    this.getSelectionManager().on('selectionChange', this.updateDisabledState);
  }

  private updateDisabledState = () => {
    const selectedIds = this.getSelectionManager().getSelectedIds();
    const geometryStore = this.getGeometryStore();
    const polygonIds = selectedIds.filter(
      (id) => geometryStore.getByIdWithComponent(id, PolygonComponent) !== null,
    );
    const nonPolygonCount = selectedIds.length - polygonIds.length;
    this.disabled = !(polygonIds.length === 1 && nonPolygonCount === 0);
  };

  type = 'open-close-polygon' as const;
  label = 'Open/Close Polygon';

  get icon(): React.ReactNode {
    return <UnplugIcon size={20} />;
  }

  async execute() {
    const selectedIds = this.getSelectionManager().getSelectedIds();
    const geometryStore = this.getGeometryStore();
    const historyManager = this.getHistoryManager();

    if (selectedIds.length === 0) {
      return;
    }

    historyManager.applyTransaction('open-close-polygon', () => {
      for (const id of selectedIds) {
        const polygon = geometryStore.getByIdWithComponent(id, PolygonComponent);
        if (!polygon) {
          continue;
        }
        const data = PolygonComponent.get(polygon);
        if (data.points.length < 3) return;
        if (data.closed) {
          historyManager.apply(UndoEntry.polygonClose(id, true, false));
        } else {
          historyManager.apply(UndoEntry.polygonClose(id, false, true));
        }
        return;
      }
    });
  }
}
