'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Sheet } from '@/lib/sheet/Sheet';
import { UNITS, type UnitType } from '@/lib/units/length';
import FloatingPanel from './FloatingPanel';
import LabeledRow from './LabeledRow';
import LengthInput from './LengthInput';

type SheetSettingsPanelProps = {
  sheet: Sheet;
};

const SheetSettingsPanel: React.FunctionComponent<SheetSettingsPanelProps> = ({ sheet }) => {
  const [sheetWidth, setSheetWidth] = useState(sheet.width);
  const [sheetHeight, setSheetHeight] = useState(sheet.height);
  const [sheetDefaultUnit, setSheetDefaultUnit] = useState(sheet.defaultUnit);
  const [sheetUnitPlaces, setSheetUnitPlaces] = useState(sheet.unitPlaces);
  const [sheetDcelDebugView, setSheetDcelDebugView] = useState(sheet.dcelDebugView);
  const [sheetConstraintDebugView, setSheetConstraintDebugView] = useState(
    sheet.constraintDebugView,
  );

  useEffect(() => {
    sheet.on('widthChange', setSheetWidth);
    sheet.on('heightChange', setSheetHeight);
    sheet.on('defaultUnitChange', setSheetDefaultUnit);
    sheet.on('unitPlacesChanged', setSheetUnitPlaces);
    sheet.on('dcelDebugViewChange', setSheetDcelDebugView);
    sheet.on('constraintDebugViewChange', setSheetConstraintDebugView);
    return () => {
      sheet.off('widthChange', setSheetWidth);
      sheet.off('heightChange', setSheetHeight);
      sheet.off('defaultUnitChange', setSheetDefaultUnit);
      sheet.off('unitPlacesChanged', setSheetUnitPlaces);
      sheet.off('dcelDebugViewChange', setSheetDcelDebugView);
      sheet.off('constraintDebugViewChange', setSheetConstraintDebugView);
    };
  }, [sheet]);

  return (
    <FloatingPanel title="Sheet settings">
      <div className="flex flex-col gap-3">
        <LabeledRow label="Default unit:">
          <Select
            value={sheetDefaultUnit}
            onValueChange={(value) => sheet.updateDefaultUnit(value as UnitType)}
          >
            <SelectTrigger>
              <SelectValue placeholder="ie: cm" />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </LabeledRow>
        <LabeledRow label="Width:">
          <LengthInput
            value={sheetWidth}
            onChange={(width) => sheet.updateWidth(width)}
            roundPlaces={sheet.unitPlaces}
          />
        </LabeledRow>
        <LabeledRow label="Height:">
          <LengthInput
            value={sheetHeight}
            onChange={(height) => sheet.updateHeight(height)}
            roundPlaces={sheet.unitPlaces}
          />
        </LabeledRow>
        <LabeledRow label="Unit places:">
          {/* FIXME: replace this with a domain specific control which also handles number input better (validation on blur, etc) */}
          <Input
            type="number"
            value={sheetUnitPlaces}
            onChange={(e) => sheet.updateUnitPlaces(parseFloat(e.currentTarget.value))}
          />
        </LabeledRow>

        <div className="w-full h-[1px] bg-[var(--slate-6)] mt-3" />

        <LabeledRow label="DCEL debug:" fullWidth={false}>
          <Switch
            checked={sheetDcelDebugView}
            onCheckedChange={(checked) => sheet.updateDcelDebugView(checked)}
          />
        </LabeledRow>
        <LabeledRow label="Constraint debug:" fullWidth={false}>
          <Switch
            checked={sheetConstraintDebugView}
            onCheckedChange={(checked) => sheet.updateConstraintDebugView(checked)}
          />
        </LabeledRow>
      </div>
    </FloatingPanel>
  );
};

export default SheetSettingsPanel;
