import { EventEmitter } from 'eventemitter3';
import { GeometryStore } from '@/lib/geometry/GeometryStore';
import { HistoryManager } from '@/lib/history/HistoryManager';
import { KeyComboDetector } from '@/lib/index-mapper';
import { type SerializationManager } from '@/lib/serialization/SerializationManager';
import { type Sheet } from '@/lib/sheet/Sheet';
import { SelectionManager } from '@/lib/tools/SelectionManager';
import { ToolManager } from '@/lib/tools/ToolManager';
import { ConvertToPolygonAction } from './ConvertToPolygonAction';
import { CopyAction } from './CopyAction';
import { DeleteSelectedAction } from './DeleteSelectedAction';
import { DifferenceAction } from './DifferenceAction';
import { IntersectionAction } from './IntersectionAction';
import { LoadAction } from './LoadAction';
import { LowerAction } from './LowerAction';
import { LowerToBottomAction } from './LowerToBottomAction';
import { OpenClosePolygonAction } from './OpenClosePolygonAction';
import { PasteAction } from './PasteAction';
import { RaiseAction } from './RaiseAction';
import { RaiseToTopAction } from './RaiseToTopAction';
import { ReconstrainAction } from './ReconstrainAction';
import { RedoAction } from './RedoAction';
import { SaveAction } from './SaveAction';
import { SaveAsAction } from './SaveAsAction';
import { SelectAllAction } from './SelectAllAction';
import { ToggleLinkDimensionsAction } from './ToggleLinkDimensionsAction';
import { UndoAction } from './UndoAction';
import { UnionAction } from './UnionAction';

const ACTIONS = [
  UndoAction,
  RedoAction,
  UnionAction,
  DifferenceAction,
  IntersectionAction,
  SaveAction,
  SaveAsAction,
  LoadAction,
  SelectAllAction,
  CopyAction,
  PasteAction,
  DeleteSelectedAction,
  RaiseAction,
  LowerAction,
  RaiseToTopAction,
  LowerToBottomAction,
  ReconstrainAction,
  OpenClosePolygonAction,
  ToggleLinkDimensionsAction,
  ConvertToPolygonAction,
];
const ACTIONS_BY_TYPE = {
  undo: UndoAction,
  redo: RedoAction,
  union: UnionAction,
  difference: DifferenceAction,
  intersection: IntersectionAction,
  save: SaveAction,
  'save-as': SaveAsAction,
  load: LoadAction,
  'select-all': SelectAllAction,
  copy: CopyAction,
  paste: PasteAction,
  'delete-selected': DeleteSelectedAction,
  raise: RaiseAction,
  lower: LowerAction,
  'raise-to-top': RaiseToTopAction,
  'lower-to-bottom': LowerToBottomAction,
  reconstrain: ReconstrainAction,
  'open-close-polygon': OpenClosePolygonAction,
  'toggle-link-dimensions': ToggleLinkDimensionsAction,
  'convert-to-polygon': ConvertToPolygonAction,
};
export type ActionType = keyof typeof ACTIONS_BY_TYPE;
export type Action = InstanceType<(typeof ACTIONS_BY_TYPE)[ActionType]>;

export type ActionManagerEvents = {
  actionDisabledChange: (actionType: ActionType, disabled: boolean) => void;
  actionMenuOpenChange: (open: boolean) => void;
  actionExecuted: (actionType: ActionType) => void;
};

/** Manages the list of actions, their metadata (like disabled state, etc), and executing them. */
export class ActionsManager extends EventEmitter<ActionManagerEvents> {
  private actions: Array<Action>;

  private sheet: Sheet;
  private geometryStore: GeometryStore;
  private selectionManager: SelectionManager;
  private historyManager: HistoryManager;
  private toolManager: ToolManager | null = null;

  private keyCombos = new KeyComboDetector();

  constructor(
    sheet: Sheet,
    geometryStore: GeometryStore,
    selectionManager: SelectionManager,
    historyManager: HistoryManager,
  ) {
    super();
    this.sheet = sheet;
    this.geometryStore = geometryStore;
    this.selectionManager = selectionManager;
    this.historyManager = historyManager;

    this.actions = ACTIONS.map((ActionClass) => {
      const action = new ActionClass(this);
      action.on('disabledChange', (disabled) =>
        this.emit('actionDisabledChange', action.type, disabled),
      );
      return action;
    });

    this.keyCombos.registerKeyCombo('/');
    for (const action of this.actions) {
      if (typeof action.executeKeyCombo === 'string') {
        this.keyCombos.registerKeyCombo(action.executeKeyCombo);
      } else if (Array.isArray(action.executeKeyCombo)) {
        for (const combo of action.executeKeyCombo) {
          this.keyCombos.registerKeyCombo(combo);
        }
      }
    }
  }

  /** Sets the ToolManager. Call this before executing actions that depend on the active tool. */
  setToolManager(toolManager: ToolManager): void {
    this.toolManager = toolManager;
    const selectAllAction = this.getAction('select-all') as SelectAllAction;
    if (selectAllAction) {
      selectAllAction.setToolManager(toolManager);
    }
  }

  /** Returns the ToolManager, or null if not set. */
  getToolManager(): ToolManager | null {
    return this.toolManager;
  }

  listActionsJSON() {
    return this.actions.map((action) => action.toJSON());
  }

  getAction<Type extends keyof typeof ACTIONS_BY_TYPE>(type: Type) {
    return this.actions.find((action) => action.type === type)! as InstanceType<
      (typeof ACTIONS_BY_TYPE)[Type]
    >;
  }

  #actionMenuOpen = false;
  getActionMenuOpen() {
    return this.#actionMenuOpen;
  }
  closeActionMenu() {
    this.#actionMenuOpen = false;
    this.emit('actionMenuOpenChange', false);
  }
  openActionMenu() {
    this.#actionMenuOpen = true;
    this.emit('actionMenuOpenChange', true);
  }

  /** Returns the GeometryStore. */
  getSheet(): Sheet {
    return this.sheet;
  }

  /** Returns the GeometryStore. */
  getGeometryStore(): GeometryStore {
    return this.geometryStore;
  }

  /** Returns the SelectionManager. */
  getSelectionManager(): SelectionManager {
    return this.selectionManager;
  }

  /** Returns the HistoryManager. */
  getHistoryManager(): HistoryManager {
    return this.historyManager;
  }

  private serializationManager: SerializationManager | null = null;

  /** Sets the SerializationManager. Optional - if not set, save/load actions will no-op. */
  setSerializationManager(manager: SerializationManager | null): void {
    this.serializationManager = manager;
  }

  /** Returns the SerializationManager, or null if not set. */
  getSerializationManager(): SerializationManager | null {
    return this.serializationManager;
  }

  #executingAction: Action | null = null;
  async execute(actionType: ActionType) {
    const action = this.getAction(actionType);
    this.#executingAction = action;

    const timeoutMs = action.timeout ?? 30000;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Action "${actionType}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      await Promise.race([action.execute(), timeoutPromise]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        console.error(`[ActionsManager] Action "${actionType}" timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
      this.#executingAction = null;
      this.emit('actionExecuted', actionType);
    }
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    // If a user presses a key combo to switch the active tool, then switch tools
    const matchingCombo = this.keyCombos.push(event);
    if (matchingCombo) {
      event.preventDefault();

      if (matchingCombo === '/') {
        // Open the more actions menu
        this.openActionMenu();
        return true;
      }

      const matchingAction = this.actions.find((a) => {
        if (typeof a.executeKeyCombo === 'string') {
          return a.executeKeyCombo === matchingCombo;
        } else if (Array.isArray(a.executeKeyCombo)) {
          return a.executeKeyCombo.includes(matchingCombo);
        } else {
          return false;
        }
      });
      if (matchingAction) {
        event.preventDefault();
        this.execute(matchingAction.type as ActionType);
        return true;
      }
    }

    if (this.#executingAction) {
      this.#executingAction.handleKeyDown(event);
      return true;
    } else {
      return false;
    }
  }
  handleKeyUp(event: KeyboardEvent) {
    if (this.#executingAction) {
      this.#executingAction.handleKeyUp(event);
      return true;
    } else {
      return false;
    }
  }
}
