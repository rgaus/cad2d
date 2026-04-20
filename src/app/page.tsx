"use client";

import { useState, useCallback } from "react";
import ViewportRenderer2D from "./components/ViewportRenderer2D";
import SheetSettingsPanel from "./components/SheetSettingsPanel";
import { Sheets, type Sheet } from "@/lib/sheet/Sheet";
import { Length } from "@/lib/units/length";

export default function Home() {
  const [sheet, setSheet] = useState<Sheet>(() => Sheets.a4());

  const handleWidthChange = useCallback((width: Length) => {
    setSheet(old => Sheets.updateWidth(old, width));
  }, []);

  const handleHeightChange = useCallback((height: Length) => {
    setSheet(old => Sheets.updateHeight(old, height));
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <ViewportRenderer2D sheet={sheet} />
      <div className="absolute right-4 top-4">
        <SheetSettingsPanel
          sheet={sheet}
          onWidthChange={handleWidthChange}
          onHeightChange={handleHeightChange}
        />
      </div>
    </div>
  );
}
