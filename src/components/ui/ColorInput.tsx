'use client';

/* eslint-disable react-hooks/exhaustive-deps, react-hooks/set-state-in-effect */


import colorRgba from 'color-rgba';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { PRESET_COLORS_BY_LABEL } from '@/lib/entity/colors';
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
  size?: 'xs' | 'sm' | 'default' | 'lg';
  onChange: (color: number | null) => void;
  onFocus?: () => void;
  onBlur?: () => void;
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
  size = 'default',
  onChange,
  onFocus,
  onBlur,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(() =>
    value === null || value === 'non-homogeneous' ? '' : '#' + value.toString(16).padStart(6, '0'),
  );
  const [isInvalid, setIsInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      onFocus?.();
    } else {
      onBlur?.();
    }
  }, [isOpen]);

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
    onChange(null);
    setIsOpen(false);
  }, [onChange]);

  const bgColor = value === null ? '#ffffff' : '#' + value.toString(16).padStart(6, '0');
  const textColor = value === null ? '#666666' : hexToDisplay(bgColor);

  const pillClass = {
    xs: 'text-[9px] px-1',
    sm: 'text-[10px] px-1',
    default: 'text-xs py-0.5 px-1.5',
    lg: 'text-sm py-1 px-2',
  }[size];
  const labelClass = {
    xs: 'text-xs',
    sm: 'text-xs',
    default: 'text-sm',
    lg: 'text-sm',
  }[size];

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size={size}
          className={cn(
            'w-full justify-start bg-[var(--slate-1)] border border-[var(--slate-6)] hover:bg-[var(--slate-1)] hover:border-[var(--slate-6)] text-[var(--slate-12)] cursor-text',
            'ring-offset-[var(--slate-1)]',
            {
              'h-5 px-1': size === 'xs',
              'h-6 px-2': size === 'sm',
              'h-8 px-3': size === 'default',
              'h-10 px-3': size === 'lg',
              'outline-none': isOpen,
              'border-[var(--red-9)] hover:border-[var(--red-9)]': isInvalid,
              'cursor-pointer': value === 'non-homogeneous',
            },
          )}
          style={{ color: value === null ? 'var(--slate-7)' : textColor }}
        >
          {value === null ? (
            <span className={cn('font-bold', labelClass)}>None</span>
          ) : null}
          {value === 'non-homogeneous' ? (
            <span className={cn('text-[var(--slate-11)]', labelClass)}>Many values</span>
          ) : null}
          {typeof value === 'number' ? (
            <span
              className={cn(
                'inline-flex items-center justify-center rounded-sm font-mono font-bold',
                pillClass,
              )}
              style={{ color: textColor, backgroundColor: bgColor }}
            >
              {inputValue}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-auto", {
          "p-3": size === "default" || size === "lg",
          "p-2": size === "xs" || size === "sm",
        })}
        align="start"
        side={openDirection === 'up' ? 'bottom' : 'top'}
        // Keep these events from propagating and effecting the viewport state at all
        onKeyDown={(e) => e.stopPropagation()} // (For color hex input box)
      >
        <div className="flex gap-0.5 mb-2">
          {PRESET_COLOR_GRID.map((row, colIndex) => {
            const common = cn('rounded border border-2', {
              'w-6 h-6': size === 'xs' || size === 'sm',
              'w-8 h-8': size === 'default' || size === 'lg',
            });
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
          <Input
            ref={inputRef}
            type="text"
            size={size === 'default' || size === 'lg' ? 'default' : 'sm'}
            value={inputValue.replace(/^#/, '')}
            leading="#"
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
