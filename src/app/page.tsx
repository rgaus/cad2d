"use client";

import { useState, useCallback, useEffect } from "react";
import ViewportRenderer2D from "./components/ViewportRenderer2D";
import SheetSettingsPanel from "./components/SheetSettingsPanel";
import ToolPalette from "./components/ToolPalette";
import UndoRedoPanel from "./components/UndoRedoPanel";
import { Sheets, type Sheet } from "@/lib/sheet/Sheet";
import { Length, type UnitType } from "@/lib/units/length";
import { ToolManager } from "@/lib/tools/ToolManager";
import { SelectionManager } from "@/lib/tools/SelectionManager";
import SelectionInspector from "./components/SelectionInspector";

export default function Home() {
  const [sheet, setSheet] = useState<Sheet>(() => Sheets.a4());

  const handleWidthChange = useCallback((width: Length) => {
    setSheet(old => Sheets.updateWidth(old, width));
  }, []);

  const handleHeightChange = useCallback((height: Length) => {
    setSheet(old => Sheets.updateHeight(old, height));
  }, []);

  const handleDefaultUnitChange = useCallback((unit: UnitType) => {
    setSheet(old => Sheets.updateDefaultUnit(old, unit));
  }, []);

  const [selectionManager] = useState(() => new SelectionManager());

  const [toolManager] = useState(() => new ToolManager(
    sheet.geometryStore,
    selectionManager,
    sheet.historyManager,
  ));

  const [activeTool, setActiveTool] = useState(toolManager.getActiveTool());
  useEffect(() => {
    toolManager.on("toolChange", setActiveTool);
    return () => {
      toolManager.off("toolChange", setActiveTool);
    };
  }, [toolManager]);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <ViewportRenderer2D 
        sheet={sheet} 
        toolManager={toolManager} 
        selectionManager={selectionManager}
      />
      <div className="absolute left-4 top-4">
        <UndoRedoPanel historyManager={sheet.historyManager} />
      </div>
      <div className="absolute right-4 top-4">
        <SheetSettingsPanel
          sheet={sheet}
          onWidthChange={handleWidthChange}
          onHeightChange={handleHeightChange}
          onDefaultUnitChange={handleDefaultUnitChange}
        />
      </div>
      <ToolPalette
        activeToolType={activeTool.type}
        onToolChange={(tool) => toolManager.setActiveTool(tool)}
      />
      <SelectionInspector
        geometryStore={sheet.geometryStore}
        selectionManager={selectionManager}
        defaultUnit={sheet.defaultUnit}
      />
    </div>
  );
}
