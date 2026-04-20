"use client";

import { useCallback } from "react";
import { Sheet } from "@/lib/sheet/Sheet";
import type { Length } from "@/lib/units/length";
import FloatingPanel from "./FloatingPanel";
import LabeledRow from "./LabeledRow";
import LengthInput from "./LengthInput";

type SheetSettingsPanelProps = {
  sheet: Sheet;
  onSheetChange: (sheet: Sheet) => void;
};

export default function SheetSettingsPanel({ sheet, onSheetChange }: SheetSettingsPanelProps) {
  const handleWidthChange = useCallback((newWidth: Length) => {
    onSheetChange(new Sheet({ width: newWidth, height: sheet.height }));
  }, [sheet.height, onSheetChange]);

  const handleHeightChange = useCallback((newHeight: Length) => {
    onSheetChange(new Sheet({ width: sheet.width, height: newHeight }));
  }, [sheet.width, onSheetChange]);

  return (
    <FloatingPanel title="Sheet settings">
      <div className="flex flex-col gap-3">
        <LabeledRow label="Width:">
          <LengthInput value={sheet.width} onChange={handleWidthChange} />
        </LabeledRow>
        <LabeledRow label="Height:">
          <LengthInput value={sheet.height} onChange={handleHeightChange} />
        </LabeledRow>
      </div>
    </FloatingPanel>
  );
}
