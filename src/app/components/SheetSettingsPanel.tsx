"use client";

import { Sheet } from "@/lib/sheet/Sheet";
import type { Length } from "@/lib/units/length";
import FloatingPanel from "./FloatingPanel";
import LabeledRow from "./LabeledRow";
import LengthInput from "./LengthInput";

type SheetSettingsPanelProps = {
  sheet: Sheet;
  onWidthChange: (width: Length) => void;
  onHeightChange: (height: Length) => void;
};

export default function SheetSettingsPanel({ sheet, onWidthChange, onHeightChange }: SheetSettingsPanelProps) {
  return (
    <FloatingPanel title="Sheet settings">
      <div className="flex flex-col gap-3">
        <LabeledRow label="Width:">
          <LengthInput value={sheet.width} onChange={onWidthChange} />
        </LabeledRow>
        <LabeledRow label="Height:">
          <LengthInput value={sheet.height} onChange={onHeightChange} />
        </LabeledRow>
      </div>
    </FloatingPanel>
  );
}
