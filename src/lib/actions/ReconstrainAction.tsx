import { WandSparklesIcon } from 'lucide-react';
import React from 'react';
import { round } from '@/lib/math';
import { BaseAction } from './BaseAction';

export class ReconstrainAction extends BaseAction {
  type = 'reconstrain' as const;
  stability = 'beta' as const;
  label = 'Recompute constraints';
  get icon(): React.ReactNode {
    return <WandSparklesIcon size={20} />;
  }

  executeKeyCombo = 'R';

  async execute() {
    const start = performance.now();
    this.getGeometryStore().reconstrain(this.getSheet().defaultUnit, []);
    const end = performance.now();
    console.log('Reconstrain time:', round(end - start, 2), 'ms');
  }
}
