import { ClipboardPaste } from 'lucide-react';
import React from 'react';
import { PLATFORM_CONTROL_KEY_STRING } from '../detection';
import { BaseAction } from './BaseAction';

export class PasteAction extends BaseAction {
  type = 'paste' as const;
  label = 'Paste';
  desc = 'Paste geometry from clipboard';

  get icon(): React.ReactNode {
    return <ClipboardPaste size={20} />;
  }

  executeKeyCombo = `${PLATFORM_CONTROL_KEY_STRING}+v`;

  async execute() {
    const geometryStore = this.getGeometryStore();
    const selectionManager = this.getSelectionManager();

    const text = await navigator.clipboard.readText();

    // Snapshot existing IDs so we can identify the newly pasted items
    const beforeIds = geometryStore.getAllGeometryIds();

    const result = this.getHistoryManager().applyTransaction('paste', () => {
      return this.getSerializationManager()?.loadFragment(text);
    });
    if (typeof result !== 'undefined' && !result.success) {
      return;
    }

    // Find the IDs that were added by the paste and select them
    const afterIds = geometryStore.getAllGeometryIds();
    const newIds = new Set<string>();
    for (const id of afterIds) {
      if (!beforeIds.has(id)) {
        newIds.add(id);
      }
    }

    selectionManager.clearSelection().selectAll(newIds);
  }
}
