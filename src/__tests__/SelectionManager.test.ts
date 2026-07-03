import { subscribeToEvents } from '../lib/subscribe-to-events';
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
    it('emits selectionChange on select', async () => {
      const events = subscribeToEvents(selectionManager, ['selectionChange']);
      selectionManager.select('polygon-1' as any);
      const payload = await events.waitFor('selectionChange');
      expect(payload).toEqual(['polygon-1']);
    });

    it('emits selectionChange on deselect', async () => {
      selectionManager.select('polygon-1' as any);
      const events = subscribeToEvents(selectionManager, ['selectionChange']);
      selectionManager.deselect('polygon-1' as any);
      const payload = await events.waitFor('selectionChange');
      expect(payload).toEqual([]);
    });

    it('emits selectionChange on toggle', async () => {
      const events = subscribeToEvents(selectionManager, ['selectionChange']);
      selectionManager.toggle('polygon-1' as any);
      const payload = await events.waitFor('selectionChange');
      expect(payload).toEqual(['polygon-1']);
    });

    it('emits selectionChange on clearSelection', async () => {
      selectionManager.select('polygon-1' as any);
      selectionManager.select('polygon-2' as any);
      const events = subscribeToEvents(selectionManager, ['selectionChange']);
      selectionManager.clearSelection();
      const payload = await events.waitFor('selectionChange');
      expect(payload).toEqual([]);
    });
  });
});
