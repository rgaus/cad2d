'use client';

import colorRgba from 'color-rgba';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PRESET_COLORS_BY_LABEL } from '@/lib/geometry/colors';
import { cn } from '@/lib/utils';

export const PRESET_COLOR_GRID: Array<Array<null | 'none' | keyof typeof PRESET_COLORS_BY_LABEL>> =
  [
    [null, 'none', 'black', 'white'],
    ['red-light', 'red-mid', 'red-dark', 'slate-lightest'],
    ['purple-light', 'purple-mid', 'purple-dark', 'slate-light'],
    ['blue-light', 'blue-mid', 'blue-dark', 'slate-midlight'],
    ['green-light', 'green-mid', 'green-dark', 'slate-mid'],
    ['orange-light', 'orange-mid', 'orange-dark', 'slate-middark'],
    ['yellow-light', 'yellow-mid', 'yellow-dark', 'slate-dark'],
  ];

type ColorInputProps = {
  value: number | null | 'non-homogeneous';
  openDirection?: 'up' | 'down';
  onChange: (color: number | null) => void;
};

function hexToDisplay(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

const ColorInput: React.FunctionComponent<ColorInputProps> = ({
  value,
  openDirection = 'down',
  onChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(() =>
    value === null || value === 'non-homogeneous' ? '' : '#' + value.toString(16).padStart(6, '0'),
  );
  const [isInvalid, setIsInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(
      value === null || value === 'non-homogeneous'
        ? ''
        : '#' + value.toString(16).padStart(6, '0'),
    );
  }, [value]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
  }, [isOpen]);

  const isNonHomogeneous = value === 'non-homogeneous';
  const commitValue = useCallback(
    (raw: string) => {
      if (isNonHomogeneous && raw.trim() === '') {
        return;
      }

      if (
        raw.trim() === '' ||
        raw.trim() === 'none' ||
        raw.trim() === 'null' ||
        raw.trim() === 'transparent'
      ) {
        setInputValue('');
        setIsInvalid(false);
        onChange(null);
        return;
      }

      let resultRgba = colorRgba(raw.replace(/^0x/, ''));
      if (resultRgba.length === 0) {
        resultRgba = colorRgba(`#${raw}`);
      }

      if (resultRgba.length !== 0) {
        const parsed = ((resultRgba[0] << 16) | (resultRgba[1] << 8) | resultRgba[2]) >>> 0;
        const hex = '#' + parsed.toString(16).padStart(6, '0');
        setInputValue(hex);
        setIsInvalid(false);
        onChange(parsed);
        return;
      }

      setIsInvalid(true);
    },
    [onChange, isNonHomogeneous],
  );

  const handleTriggerClick = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleInputBlur = useCallback(() => {
    commitValue(inputValue);
  }, [inputValue, commitValue]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'Enter':
          commitValue(inputValue);
          setIsOpen(false);
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          break;
      }
    },
    [inputValue, commitValue],
  );

  const handlePresetClick = useCallback(
    (color: number) => {
      setInputValue(`#${color.toString(16)}`);
      setIsInvalid(false);
      onChange(color);
      setIsOpen(false);
    },
    [onChange],
  );

  const handleNoneClick = useCallback(() => {
    setInputValue('');
    setIsInvalid(false);
    console.log('FOO');
    onChange(null);
    setIsOpen(false);
  }, [onChange]);

  const bgColor = value === null ? '#ffffff' : '#' + value.toString(16).padStart(6, '0');
  const textColor = value === null ? '#666666' : hexToDisplay(bgColor);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <Button
        type="button"
        asChild
        onClick={handleTriggerClick}
        className={cn(
          'w-full h-8 px-2 rounded-[4px] bg-[var(--slate-3)] hover:bg-[var(--slate-4)] border border-[var(--slate-5)] cursor-text transition-colors justify-start gap-2',
          {
            'border-[var(--slate-8)] hover:bg-[var(--slate-3)]': isOpen,
            'border-[#e74c3c]': isInvalid,
            'cursor-pointer': value === 'non-homogeneous',
          },
        )}
        style={{ color: value === null ? 'var(--slate-7)' : textColor }}
      >
        <PopoverTrigger>
          {value === null ? (
            <span
              className="text-sm font-bold"
              style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
            >
              None
            </span>
          ) : null}
          {value === 'non-homogeneous' ? (
            <span
              className="text-sm text-[var(--slate-11)]"
              style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
            >
              Many values
            </span>
          ) : null}
          {typeof value === 'number' ? (
            <span
              className="text-sm font-mono font-bold px-1 py-0.5 rounded-md"
              style={{
                fontFamily: 'var(--font-roboto-mono), monospace',
                color: textColor,
                backgroundColor: value === null ? '#ffffff' : bgColor,
              }}
            >
              {inputValue}
            </span>
          ) : null}
        </PopoverTrigger>
      </Button>
      <PopoverContent
        className="p-1"
        align="end"
        side={openDirection === 'up' ? 'bottom' : 'top'}
        // Keep these events from propagating and effecting the viewport state at all
        onKeyDown={(e) => e.stopPropagation()} // (For color hex input box)
      >
        <div className="flex gap-0.5 mb-3">
          {PRESET_COLOR_GRID.map((row, colIndex) => {
            const common = 'w-8 h-8 rounded border border-2';
            return (
              <div key={colIndex} className="flex flex-col gap-1.5">
                {row.map((label, rowIndex) => {
                  switch (label) {
                    case null:
                      return (
                        <div
                          key={label}
                          className={cn(common, 'bg-transparent border-transparent')}
                        />
                      );
                    case 'none':
                      return (
                        <button
                          key={label}
                          type="button"
                          onClick={handleNoneClick}
                          className={cn(
                            common,
                            'rounded border border-[var(--slate-5)] hover:border-[var(--slate-8)] transition-colors flex items-center justify-center relative overflow-hidden',
                          )}
                          style={{ backgroundColor: '#ffffff' }}
                        >
                          <div
                            className="absolute inset-0"
                            style={{
                              background:
                                'repeating-linear-gradient(45deg, #ccc 0, #ccc 1px, transparent 0, transparent 50%)',
                              backgroundSize: '8px 8px',
                            }}
                          />
                        </button>
                      );
                    default:
                      const hex = PRESET_COLORS_BY_LABEL[label];
                      return (
                        <button
                          key={label}
                          type="button"
                          title={`#${hex.toString(16)}`}
                          onClick={() => handlePresetClick(hex)}
                          className={cn(
                            common,
                            'border-[var(--slate-5)] hover:border-[var(--slate-11)] transition-colors',
                          )}
                          style={{
                            backgroundColor: `#${hex.toString(16)}`,
                            gridColumnStart: colIndex + 1,
                            gridRowStart: rowIndex + 1,
                          }}
                        />
                      );
                  }
                })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          <span
            className="text-[var(--slate-12)] text-sm"
            style={{ fontFamily: 'var(--font-roboto-mono), monospace' }}
          >
            #
          </span>
          <Input
            ref={inputRef}
            type="text"
            value={inputValue.replace(/^#/, '')}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={handleInputBlur}
            onKeyDown={handleInputKeyDown}
            placeholder="hex, rgb, name..."
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ColorInput;
