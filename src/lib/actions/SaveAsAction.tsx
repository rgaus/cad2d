import { Save } from 'lucide-react';
import React from 'react';
import { pickFileToSave, saveToHandle, triggerDownload } from '../file-system-helpers';
import { BaseAction } from './BaseAction';

export class SaveAsAction extends BaseAction {
  type = 'save-as' as const;
  label = 'Save As...';
  desc = 'Save drawing to a new file';

  get icon(): React.ReactNode {
    return <Save size={20} />;
  }

  executeKeyCombo = 'cmd+shift+s';

  async execute() {
    const serializationManager = this.getSerializationManager();
    if (serializationManager === null) {
      console.warn('[cad2d] SerializationManager not registered - save-as skipped');
      return;
    }

    const svgResult = serializationManager.save();
    if (!svgResult.success || svgResult.svg === null) {
      console.error('[cad2d] Save-as failed - could not generate SVG');
      return;
    }

    const svg = svgResult.svg;

    // Always show picker (SaveAs behavior)
    const result = await pickFileToSave();
    if (result.handle === null && !result.usedFallback) {
      // User cancelled
      return;
    }

    if (result.handle !== null) {
      // File System Access API was used
      const success = await saveToHandle(result.handle, svg);
      if (!success) {
        console.error('[cad2d] Save-as failed - could not write to file');
        return;
      }
      serializationManager.setLastSaveFileHandle(result.handle);
    } else {
      // Fallback was used (a[download])
      triggerDownload(svg, 'drawing.svg');
      serializationManager.setLastSaveFileHandle(null);
    }
  }
}
