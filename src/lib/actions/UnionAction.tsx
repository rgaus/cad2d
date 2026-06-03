import { SquaresUnite } from 'lucide-react';
import React from 'react';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';
import { WorkerActionHost } from './WorkerActionHost';
import { computeBooleanOperation } from './boolean-compute';
import { applyBooleanResult, extractGeometry } from './boolean-utils';
import { type BooleanOperationRequest } from './types';

export class UnionAction extends BaseAction {
  type = 'union' as const;
  label = 'Union';
  desc =
    'Combines multiple selected geometries into a single polygon by merging their overlapping areas.';
  executeKeyCombo = null;

  readonly timeout = 30000;
  readonly supportsWorker = true;

  get icon(): React.ReactNode {
    return <SquaresUnite size={20} />;
  }

  constructor(actionsManager: ActionsManager) {
    super(actionsManager);
    this.updateDisabled = () => {
      this.disabled = this.getSelectionManager().getSelectedIds().length < 2;
    };
    this.getSelectionManager().on('selectionChange', this.updateDisabled);
    this.updateDisabled();
  }

  private updateDisabled: () => void;

  async execute() {
    const geometryStore = this.getGeometryStore();
    const selectionManager = this.getSelectionManager();
    const historyManager = this.getHistoryManager();
    const selectedIds = selectionManager.getSelectedIds();

    if (selectedIds.length < 2) {
      return;
    }

    const { polygons, firstFillColor } = extractGeometry(geometryStore, selectedIds);

    if (polygons.length < 2) {
      return;
    }

    let resultPoints: Array<[number, number]> | null = null;

    if (this.supportsWorker) {
      try {
        const host = new WorkerActionHost();
        const request: BooleanOperationRequest = {
          type: 'boolean-operation',
          operation: 'union',
          polygons,
        };
        const response = await host.run(request, this.timeout ?? 30000);
        resultPoints = response.result;
      } catch (error) {
        console.warn('[UnionAction] Worker execution failed, falling back to main thread:', error);
        resultPoints = computeBooleanOperation('union', polygons);
      }
    } else {
      resultPoints = computeBooleanOperation('union', polygons);
    }

    if (!resultPoints) {
      return;
    }

    applyBooleanResult(
      geometryStore,
      historyManager,
      selectionManager,
      selectedIds,
      resultPoints,
      firstFillColor,
      'boolean-union',
    );
  }
}
