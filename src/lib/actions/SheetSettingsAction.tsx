import { Settings } from 'lucide-react';
import React from 'react';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

/** Toggles the visibility of the Sheet Settings panel. */
export class SheetSettingsAction extends BaseAction {
  type = 'sheet-settings' as const;
  label = 'Sheet Settings';

  get icon(): React.ReactNode {
    return <Settings size={20} />;
  }

  async execute() {
    this.getSheet().toggleSheetSettingsPanel();
  }
}
