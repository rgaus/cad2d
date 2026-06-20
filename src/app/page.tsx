'use client';

import { useEffect, useState } from 'react';
import { ActionsManager } from '@/lib/actions/ActionsManager';
import { SerializationManager } from '@/lib/serialization/SerializationManager';
import { Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { ActionPanel } from './components/ActionPanel';
import SelectionInspector from './components/SelectionInspector';
import SheetSettingsPanel from './components/SheetSettingsPanel';
import ToolPalette from './components/ToolPalette';
import ViewportRenderer2D from './components/ViewportRenderer2D';

export default function Home() {
  const [sheet] = useState<Sheet>(() => Sheet.a4());

  const [selectionManager] = useState(() => new SelectionManager());

  const [toolManager] = useState(
    () => new ToolManager(sheet.geometryStore, selectionManager, sheet.historyManager),
  );

  const [actionManager] = useState(
    () => new ActionsManager(sheet, sheet.geometryStore, selectionManager, sheet.historyManager),
  );

  // Wire up ToolManager with ActionsManager (for select-all action)
  useEffect(() => {
    actionManager.setToolManager(toolManager);
  }, [actionManager, toolManager]);

  // Wire up SerializationManager
  useState(() => {
    const serializationManager = new SerializationManager(actionManager, toolManager, sheet);
    actionManager.setSerializationManager(serializationManager);
    toolManager.setSerializationManager(serializationManager);
  });

  const [activeTool, setActiveTool] = useState(toolManager.getActiveTool());
  useEffect(() => {
    toolManager.on('toolChange', setActiveTool);
    toolManager.on('subToolChange', setActiveTool);
    return () => {
      toolManager.off('toolChange', setActiveTool);
      toolManager.off('subToolChange', setActiveTool);
    };
  }, [toolManager]);

  return (
    <div className="fixed h-screen w-screen overflow-hidden">
      <ViewportRenderer2D
        sheet={sheet}
        toolManager={toolManager}
        selectionManager={selectionManager}
        actionsManager={actionManager}
      />
      <div className="absolute left-4 top-4">
        <ActionPanel actionsManager={actionManager} />
      </div>
      <div className="absolute right-4 top-4">
        <SheetSettingsPanel sheet={sheet} />
      </div>
      <ToolPalette toolManager={toolManager} />
      <SelectionInspector
        sheet={sheet}
        geometryStore={sheet.geometryStore}
        selectionManager={selectionManager}
        historyManager={sheet.historyManager}
        actionsManager={actionManager}
      />
    </div>
  );
}
