import EventEmitter from 'eventemitter3';
import type { Id } from './types';

export type SelectionManagerEvents = {
  selectionChange: (ids: Array<Id>) => void;
};

export class SelectionManager extends EventEmitter<SelectionManagerEvents> {
  private selectedIds: Set<Id> = new Set();

  isSelected(id: Id): boolean {
    return this.selectedIds.has(id);
  }

  getSelectedIds(): Array<Id> {
    return Array.from(this.selectedIds);
  }

  select(id: Id) {
    this.selectedIds.add(id);
    this.emit('selectionChange', this.getSelectedIds());
    return this;
  }

  deselect(id: Id) {
    this.selectedIds.delete(id);
    this.emit('selectionChange', this.getSelectedIds());
    return this;
  }

  selectAll(ids: Set<Id>) {
    for (const selectedId of ids) {
      this.selectedIds.add(selectedId);
    }
    this.emit('selectionChange', this.getSelectedIds());
  }

  toggle(id: Id) {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.emit('selectionChange', this.getSelectedIds());
    return this;
  }

  clearSelection(): void {
    this.selectedIds.clear();
    this.emit('selectionChange', this.getSelectedIds());
  }

  isEmpty(): boolean {
    return this.selectedIds.size === 0;
  }
}
