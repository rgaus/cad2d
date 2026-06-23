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
import {
  SHEET_SIZE_PRESETS,
  Sheet,
  SheetSizePreset,
  type SheetSizePresetKey,
} from '@/lib/sheet/Sheet';
import { UNITS, type UnitType } from '@/lib/units/length';
import { cn } from '@/lib/utils';
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

  const [hoveredSheetSize, setHoveredSheetSize] = useState<SheetSizePresetKey | null>(null);

  useEffect(() => {
    sheet.on('widthChange', setSheetWidth);
    sheet.on('heightChange', setSheetHeight);
    sheet.on('defaultUnitChange', setSheetDefaultUnit);
    sheet.on('unitPlacesChanged', setSheetUnitPlaces);
    sheet.on('dcelDebugViewChange', setSheetDcelDebugView);
    return () => {
      sheet.off('widthChange', setSheetWidth);
      sheet.off('heightChange', setSheetHeight);
      sheet.off('defaultUnitChange', setSheetDefaultUnit);
      sheet.off('unitPlacesChanged', setSheetUnitPlaces);
      sheet.off('dcelDebugViewChange', setSheetDcelDebugView);
    };
  }, [sheet]);

  return (
    <FloatingPanel title="Sheet settings">
      <div className="flex flex-col gap-3">
        <div className="flex overflow-x-auto gap-2 max-w-[300px] pb-5 -mb-2.5 -mx-1 px-1">
          {Object.entries(SHEET_SIZE_PRESETS).map(([key, spec]) => {
            const orientation = SheetSizePreset.matches(spec, sheet);
            return (
              <button
                key={key}
                onClick={() => {
                  const newOrientation = orientation === 'portait' ? 'landscape' : 'portait';
                  sheet.updateSizePreset(key as SheetSizePresetKey, newOrientation);
                  setHoveredSheetSize(null);
                }}
                onMouseEnter={() => setHoveredSheetSize(key as SheetSizePresetKey)}
                onMouseLeave={() => setHoveredSheetSize(null)}
                className={cn(
                  'relative flex-shrink-0 w-16 h-[72px] rounded-md border flex flex-col items-center justify-center gap-1.5 cursor-pointer',
                  orientation !== null
                    ? 'border-[var(--accent-9)] bg-[var(--accent-3)]'
                    : 'border-[var(--slate-7)] hover:border-[var(--slate-8)]',
                )}
              >
                <div
                  className="bg-white rounded-[2px] mb-3"
                  style={{
                    width: orientation !== 'landscape' ? 20 : undefined,
                    height: orientation === 'landscape' ? 24 : undefined,
                    aspectRatio:
                      orientation === 'landscape'
                        ? `${spec.height} / ${spec.width}`
                        : `${spec.width} / ${spec.height}`,
                    transform:
                      orientation !== null && hoveredSheetSize === key
                        ? 'rotate(-10deg)'
                        : undefined,
                  }}
                />
                <span className="absolute bottom-1 text-[11px] text-[var(--slate-11)] font-medium select-none">
                  {spec.label}
                </span>
              </button>
            );
          })}
        </div>
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
      </div>
    </FloatingPanel>
  );
};

export default SheetSettingsPanel;
