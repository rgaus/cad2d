"use client";

import { useState, useCallback, useMemo } from "react";
import ViewportRenderer2D from "./components/ViewportRenderer2D";
import SheetSettingsPanel from "./components/SheetSettingsPanel";
import ToolPalette from "./components/ToolPalette";
import { Sheets, type Sheet } from "@/lib/sheet/Sheet";
import { Length } from "@/lib/units/length";
import { ToolManager } from "@/lib/tools/ToolManager";

export default function Home() {
  const [sheet, setSheet] = useState<Sheet>(() => Sheets.a4());
  const toolManager = useMemo(() => new ToolManager(sheet.polygonStore), []);

  const handleWidthChange = useCallback((width: Length) => {
    setSheet(old => Sheets.updateWidth(old, width));
  }, []);

  const handleHeightChange = useCallback((height: Length) => {
    setSheet(old => Sheets.updateHeight(old, height));
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <ViewportRenderer2D sheet={sheet} toolManager={toolManager} />
      <div className="absolute right-4 top-4">
        <SheetSettingsPanel
          sheet={sheet}
          onWidthChange={handleWidthChange}
          onHeightChange={handleHeightChange}
        />
      </div>
      <ToolPalette
        currentTool={toolManager.getTool()}
        onToolChange={(tool) => toolManager.setTool(tool)}
      />
    </div>
  );
}
