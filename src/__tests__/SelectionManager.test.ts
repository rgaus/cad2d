import { SelectionManager } from '../lib/tools/SelectionManager';

describe('SelectionManager', () => {
  let selectionManager: SelectionManager;

  beforeEach(() => {
    selectionManager = new SelectionManager();
  });

  describe('select / deselect / isSelected', () => {
    it('starts with empty selection', () => {
      expect(selectionManager.isEmpty()).toBe(true);
      expect(selectionManager.getSelectedIds()).toHaveLength(0);
    });

    it('selects a polygon by id', () => {
      selectionManager.select('polygon-1' as any);
      expect(selectionManager.isSelected('polygon-1' as any)).toBe(true);
      expect(selectionManager.isEmpty()).toBe(false);
    });

    it('deselects a polygon by id', () => {
      selectionManager.select('polygon-1' as any);
      selectionManager.deselect('polygon-1' as any);
      expect(selectionManager.isSelected('polygon-1' as any)).toBe(false);
      expect(selectionManager.isEmpty()).toBe(true);
    });

    it('isSelected returns false for unselected id', () => {
      expect(selectionManager.isSelected('polygon-1' as any)).toBe(false);
    });
  });

  describe('toggle', () => {
    it('toggles selection on when not selected', () => {
      selectionManager.toggle('polygon-1' as any);
      expect(selectionManager.isSelected('polygon-1' as any)).toBe(true);
    });

    it('toggles selection off when already selected', () => {
      selectionManager.select('polygon-1' as any);
      selectionManager.toggle('polygon-1' as any);
      expect(selectionManager.isSelected('polygon-1' as any)).toBe(false);
    });
  });

  describe('multi-select', () => {
    it('can select multiple polygons', () => {
      selectionManager.select('polygon-1' as any);
      selectionManager.select('polygon-2' as any);
      expect(selectionManager.isSelected('polygon-1' as any)).toBe(true);
      expect(selectionManager.isSelected('polygon-2' as any)).toBe(true);
      expect(selectionManager.getSelectedIds()).toHaveLength(2);
    });

    it('can deselect one polygon while others remain selected', () => {
      selectionManager.select('polygon-1' as any);
      selectionManager.select('polygon-2' as any);
      selectionManager.deselect('polygon-1' as any);
      expect(selectionManager.isSelected('polygon-1' as any)).toBe(false);
      expect(selectionManager.isSelected('polygon-2' as any)).toBe(true);
      expect(selectionManager.getSelectedIds()).toHaveLength(1);
    });
  });

  describe('clearSelection', () => {
    it('clears all selections', () => {
      selectionManager.select('polygon-1' as any);
      selectionManager.select('polygon-2' as any);
      selectionManager.clearSelection();
      expect(selectionManager.isEmpty()).toBe(true);
      expect(selectionManager.getSelectedIds()).toHaveLength(0);
    });
  });

  describe('events', () => {
    it('emits selectionChange on select', () => {
      const handler = jest.fn();
      selectionManager.on('selectionChange', handler);
      selectionManager.select('polygon-1' as any);
      expect(handler).toHaveBeenCalledWith(['polygon-1']);
    });

    it('emits selectionChange on deselect', () => {
      selectionManager.select('polygon-1' as any);
      const handler = jest.fn();
      selectionManager.on('selectionChange', handler);
      selectionManager.deselect('polygon-1' as any);
      expect(handler).toHaveBeenCalledWith([]);
    });

    it('emits selectionChange on toggle', () => {
      const handler = jest.fn();
      selectionManager.on('selectionChange', handler);
      selectionManager.toggle('polygon-1' as any);
      expect(handler).toHaveBeenCalledWith(['polygon-1']);
    });

    it('emits selectionChange on clearSelection', () => {
      selectionManager.select('polygon-1' as any);
      selectionManager.select('polygon-2' as any);
      const handler = jest.fn();
      selectionManager.on('selectionChange', handler);
      selectionManager.clearSelection();
      expect(handler).toHaveBeenCalledWith([]);
    });
  });
});
