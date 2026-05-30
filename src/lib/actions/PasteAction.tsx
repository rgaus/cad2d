import { ClipboardPaste } from 'lucide-react';
import React from 'react';
import { PLATFORM_CONTROL_KEY_STRING } from '../detection';
import { ActionsManager } from './ActionsManager';
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
    const text = await navigator.clipboard.readText();
    this.getSerializationManager()?.loadFragment(text);
    // FIXME: select the newly added geometries
  }
}
