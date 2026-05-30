import { Copy } from 'lucide-react';
import React from 'react';
import { PLATFORM_CONTROL_KEY_STRING } from '../detection';
import { ActionsManager } from './ActionsManager';
import { BaseAction } from './BaseAction';

export class CopyAction extends BaseAction {
  constructor(actionManager: ActionsManager) {
    super(actionManager);

    this.disabled = this.getSelectionManager().isEmpty();

    this.getSelectionManager().on('selectionChange', () => {
      this.disabled = this.getSelectionManager().isEmpty();
    });
  }

  type = 'copy' as const;
  label = 'Copy';
  desc = 'Copy selected geometry to clipboard';

  get icon(): React.ReactNode {
    return <Copy size={20} />;
  }

  executeKeyCombo = `${PLATFORM_CONTROL_KEY_STRING}+c`;

  async execute() {
    const selectedText = this.getSerializationManager()?.formatSelectedAsFragment();
    if (typeof selectedText === 'string') {
      await navigator.clipboard.writeText(selectedText);
    }
  }
}
