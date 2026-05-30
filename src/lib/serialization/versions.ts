import type { UndoEntry } from '../history/types';
import type { ToolType } from '../tools/types';
import type { UnitType } from '../units/length';

/** The current file format version. Bump when making breaking schema changes. */
export const CURRENT_VERSION = 1;

/** Magic prefix for the state comment at the end of the SVG file. */
export const CAD2D_STATE_COMMENT_PREFIX = 'cad2d-state:';

/** Serialized form of a Length (unit + magnitude). */
export type SerializedLength = {
  type: UnitType;
  magnitude: number;
};

/** Serialized form of a SheetPosition. */
export type SerializedPosition = {
  x: number;
  y: number;
};

/** Serialized viewport state (pan offset and zoom). */
export type SerializedViewport = {
  position: SerializedPosition;
  scale: number;
};

/** Serialized history state (stacks and ID counter). */
export type SerializedHistory = {
  undoStack: Array<UndoEntry>;
  redoStack: Array<UndoEntry>;
  stableIdCounter: number;
};

/** The full serialized state stored in the magic SVG comment. */
export type SerializedState = {
  version: number;
  sheet: {
    width: SerializedLength;
    height: SerializedLength;
    defaultUnit: UnitType;
  };
  viewport: SerializedViewport;
  selection: Array<string>;
  history: SerializedHistory;
  activeTool: ToolType;
};

/** A migration function that takes a state and returns it upgraded to the next version. */
type MigrationLoader = (state: SerializedState) => SerializedState;

/**
 * Ordered list of migration loaders. Each loader is responsible for upgrading FROM its
 * version TO version + 1. For example, MIGRATION_LOADERS[0] migrates v1 → v2.
 *
 * The migration chain is applied repeatedly until state.version === CURRENT_VERSION.
 */
const MIGRATION_LOADERS: Array<{ version: number; migrate: MigrationLoader }> = [
  // Add migration loaders here when new versions are added
  // Example:
  // {
  //   version: 1,
  //   migrate: (state) => {
  //     // Add new fields with defaults
  //     state.newField = defaultValue;
  //     state.version = 2;
  //     return state;
  //   }
  // },
];

/**
 * Migrates a serialized state to the current version by applying all necessary
 * migration loaders in order.
 */
export function migrateState(state: SerializedState): SerializedState {
  let current = state;
  for (const loader of MIGRATION_LOADERS) {
    if (current.version < loader.version) {
      current = loader.migrate(current);
    }
  }
  return current;
}
