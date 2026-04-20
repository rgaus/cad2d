"use client";

import { useState, useCallback } from "react";
import ViewportRenderer2D from "./components/ViewportRenderer2D";
import SheetSettingsPanel from "./components/SheetSettingsPanel";
import { Sheet, SHEET_A4_WIDTH_CM, SHEET_A4_HEIGHT_CM } from "@/lib/sheet/Sheet";
import { Lengths } from "@/lib/units/length";

export default function Home() {
  const [sheet, setSheet] = useState(() => new Sheet({
    width: Lengths.centimeters(SHEET_A4_WIDTH_CM),
    height: Lengths.centimeters(SHEET_A4_HEIGHT_CM),
  }));

  const handleSheetChange = useCallback((newSheet: Sheet) => {
    setSheet(newSheet);
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <ViewportRenderer2D sheet={sheet} />
      <div className="absolute right-4 top-4">
        <SheetSettingsPanel sheet={sheet} onSheetChange={handleSheetChange} />
      </div>
    </div>
  );
}
