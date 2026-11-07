import { type Id } from '@/lib/entity';
import { type UndoEntry } from '@/lib/history/types';
import { Angle, DegreesType } from '@/lib/units/angle';
import { Length, UnitType } from '@/lib/units/length';
import { GeometryRelativeSheetPosition, SheetPosition } from '@/lib/viewport/types';

/**
 * JSON-safe history codec.
 *
 * Undo entries contain class-backed values (Length/Angle/SheetPosition/GeometryRelativeSheetPosition)
 * which JSON.stringify silently flattens to plain objects. That loses unit conversion and position
 * helper methods, so replaying a restored history entry breaks. This codec tags those values while
 * encoding and rehydrates them while decoding.
 */

const CODEC_TAG = '__cad2dType';

type EncodedValue = unknown;

function encodeValue(value: unknown): EncodedValue {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeValue(item));
  }
  if (value instanceof Length) {
    const serialized = value.serialize();
    return {
      [CODEC_TAG]: 'length',
      type: serialized.type,
      magnitude: serialized.magnitude,
    };
  }
  if (value instanceof Angle) {
    return {
      [CODEC_TAG]: 'angle',
      type: value.type === DegreesType ? 'degrees' : 'radians',
      magnitude: value.magnitude,
    };
  }
  if (value instanceof GeometryRelativeSheetPosition) {
    return { [CODEC_TAG]: 'geometry-relative-position', x: value.x, y: value.y };
  }
  if (value instanceof SheetPosition) {
    return { [CODEC_TAG]: 'sheet-position', x: value.x, y: value.y };
  }

  const encoded: Record<string, EncodedValue> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    encoded[key] = encodeValue(entryValue);
  }
  return encoded;
}

function decodeValue(value: EncodedValue): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => decodeValue(item));
  }

  const record = value as Record<string, unknown>;
  const tag = record[CODEC_TAG];
  if (typeof tag === 'string') {
    switch (tag) {
      case 'length': {
        const magnitude = record.magnitude as number;
        const type = record.type;
        if (!UnitType.is(type)) {
          throw new Error(`history-codec: invalid length unit type ${String(type)}`);
        }
        return Length.fromSheetUnits(type, magnitude);
      }
      case 'angle': {
        const magnitude = record.magnitude as number;
        return record.type === 'radians' ? Angle.radians(magnitude) : Angle.degrees(magnitude);
      }
      case 'geometry-relative-position':
        return new GeometryRelativeSheetPosition(record.x as number, record.y as number);
      case 'sheet-position':
        return new SheetPosition(record.x as number, record.y as number);
      default:
        break;
    }
  }

  const decoded: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(record)) {
    decoded[key] = decodeValue(entryValue);
  }
  return decoded;
}

/** Encodes a single undo/redo entry into a JSON-safe value. */
export function encodeUndoEntry(entry: UndoEntry): EncodedValue {
  return encodeValue(entry);
}

/** Decodes a single undo/redo entry from its JSON-safe representation. */
export function decodeUndoEntry(value: EncodedValue): UndoEntry {
  return decodeValue(value) as UndoEntry;
}

/** Encodes an undo/redo stack into JSON-safe values. External entries hold callbacks for
 * transient UI state and are omitted from persisted history. */
export function encodeUndoStack(stack: Array<UndoEntry>): Array<EncodedValue> {
  return stack.filter((entry) => entry.type !== 'external').map((entry) => encodeUndoEntry(entry));
}

/** Decodes an undo/redo stack from its JSON-safe representation. */
export function decodeUndoStack(stack: Array<EncodedValue>): Array<UndoEntry> {
  return stack.map((entry) => decodeUndoEntry(entry));
}

/** Keys whose string values are entity/geometry ids inside undo entries. */
const ID_KEYS = new Set(['id', 'geometryId', 'beforeGeometryId', 'afterGeometryId']);

function remapValue(value: unknown, idMap: Map<Id, Id>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => remapValue(item, idMap));
  }
  // Preserve class-backed values (Length/Angle/Position...) which the codec just rehydrated.
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const remapped: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(record)) {
    if (ID_KEYS.has(key) && typeof entryValue === 'string') {
      remapped[key] = idMap.get(entryValue as Id) ?? entryValue;
    } else {
      remapped[key] = remapValue(entryValue, idMap);
    }
  }
  return remapped;
}

/** Rewrites every entity/geometry id referenced by an undo entry using the passed map. */
export function remapUndoEntryIds(entry: UndoEntry, idMap: Map<Id, Id>): UndoEntry {
  return remapValue(entry, idMap) as UndoEntry;
}
