import type { UndoEntry } from '../history/types';
import type { ToolType } from '../tools/types';
import { type SerializedLength, type UnitType } from '../units/length';

/** The current file format version. Bump when making breaking schema changes. */
export const CURRENT_VERSION = 1;

/** Magic prefix for the state comment at the end of the SVG file. */
export const CAD2D_STATE_COMMENT_PREFIX = 'cad2d-state:';

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
export type MigrationLoader = (state: SerializedState) => SerializedState;

/** A migration loader paired with the version it upgrades FROM. */
export type MigrationLoaderEntry = { version: number; migrate: MigrationLoader };

/**
 * Ordered list of migration loaders. Each loader is responsible for upgrading FROM its
 * version TO version + 1. For example, MIGRATION_LOADERS[0] migrates v1 → v2.
 *
 * The migration chain is applied repeatedly until state.version === CURRENT_VERSION.
 */
const MIGRATION_LOADERS: Array<MigrationLoaderEntry> = [
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
 *
 * Each loader upgrades FROM its `version` TO `version + 1`, so a loader only runs when the current
 * state version exactly matches the loader's `version`. States written by a newer cad2d release are
 * rejected rather than silently mis-read.
 */
export function migrateState(
  state: SerializedState,
  loaders: Array<MigrationLoaderEntry> = MIGRATION_LOADERS,
): SerializedState {
  if (state.version > CURRENT_VERSION) {
    throw new Error(
      `migrateState: file version ${state.version} is newer than supported version ${CURRENT_VERSION}`,
    );
  }

  let current = state;
  for (const loader of loaders) {
    if (current.version === loader.version) {
      current = loader.migrate(current);
    }
  }

  if (current.version !== CURRENT_VERSION) {
    throw new Error(
      `migrateState: no migration path from version ${state.version} to ${CURRENT_VERSION}`,
    );
  }

  return current;
}
