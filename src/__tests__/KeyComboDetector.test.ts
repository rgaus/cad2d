import { KeyComboDetector } from '../lib/index-mapper';

type MockKeyboardEvent = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

function makeKeyEvent(
  key: string,
  modifiers: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {},
): MockKeyboardEvent {
  return {
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    altKey: modifiers.altKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  };
}

describe('KeyComboDetector', () => {
  let detector: KeyComboDetector;

  beforeEach(() => {
    detector = new KeyComboDetector(5000);
  });

  afterEach(() => {
    detector.destroy();
  });

  describe('single keys', () => {
    it('detects a single letter key', () => {
      detector.registerKeyCombo('a');
      expect(detector.push(makeKeyEvent('a'))).toBe('a');
    });

    it('detects a single special key', () => {
      detector.registerKeyCombo('Enter');
      expect(detector.push(makeKeyEvent('Enter'))).toBe('Enter');
    });

    it('does not trigger on different key', () => {
      detector.registerKeyCombo('a');
      expect(detector.push(makeKeyEvent('b'))).toBe(null);
    });

    it('detects Escape', () => {
      detector.registerKeyCombo('Escape');
      expect(detector.push(makeKeyEvent('Escape'))).toBe('Escape');
    });
  });

  describe('sequences', () => {
    it('detects a two-key sequence', () => {
      detector.registerKeyCombo('a b');
      expect(detector.push(makeKeyEvent('a'))).toBe(null);
      expect(detector.push(makeKeyEvent('b'))).toBe('a b');
    });

    it('detects a three-key sequence', () => {
      detector.registerKeyCombo('a b c');
      detector.push(makeKeyEvent('a'));
      expect(detector.push(makeKeyEvent('b'))).toBe(null);
      expect(detector.push(makeKeyEvent('c'))).toBe('a b c');
    });

    it('does not match incomplete sequence', () => {
      detector.registerKeyCombo('a b');
      expect(detector.push(makeKeyEvent('a'))).toBe(null);
    });

    it('does not match wrong second key', () => {
      detector.registerKeyCombo('a b');
      detector.push(makeKeyEvent('a'));
      expect(detector.push(makeKeyEvent('c'))).toBe(null);
    });
  });

  describe('modifier keys', () => {
    it('detects ctrl+key', () => {
      detector.registerKeyCombo('ctrl+a');
      expect(detector.push(makeKeyEvent('a', { ctrlKey: true }))).toBe('ctrl+a');
    });

    it('detects control+key (alias)', () => {
      detector.registerKeyCombo('control+a');
      expect(detector.push(makeKeyEvent('a', { ctrlKey: true }))).toBe('control+a');
    });

    it('detects alt+key', () => {
      detector.registerKeyCombo('alt+b');
      expect(detector.push(makeKeyEvent('b', { altKey: true }))).toBe('alt+b');
    });

    it('detects shift+key', () => {
      detector.registerKeyCombo('shift+c');
      expect(detector.push(makeKeyEvent('c', { shiftKey: true }))).toBe('shift+c');
    });

    it('detects cmd+key', () => {
      detector.registerKeyCombo('cmd+d');
      expect(detector.push(makeKeyEvent('d', { metaKey: true }))).toBe('cmd+d');
    });

    it('detects super+key (alias for cmd)', () => {
      detector.registerKeyCombo('super+e');
      expect(detector.push(makeKeyEvent('e', { metaKey: true }))).toBe('super+e');
    });

    it('does not match modifier without key', () => {
      detector.registerKeyCombo('ctrl+a');
      expect(detector.push(makeKeyEvent('a', { ctrlKey: false }))).toBe(null);
    });
  });

  describe('special keys', () => {
    it('detects Enter', () => {
      detector.registerKeyCombo('Enter');
      expect(detector.push(makeKeyEvent('Enter'))).toBe('Enter');
    });

    it('detects Tab', () => {
      detector.registerKeyCombo('Tab');
      expect(detector.push(makeKeyEvent('Tab'))).toBe('Tab');
    });

    it('detects Escape', () => {
      detector.registerKeyCombo('Escape');
      expect(detector.push(makeKeyEvent('Escape'))).toBe('Escape');
    });

    it('detects ArrowUp', () => {
      detector.registerKeyCombo('ArrowUp');
      expect(detector.push(makeKeyEvent('ArrowUp'))).toBe('ArrowUp');
    });

    it('detects Backspace', () => {
      detector.registerKeyCombo('Backspace');
      expect(detector.push(makeKeyEvent('Backspace'))).toBe('Backspace');
    });

    it('detects Delete', () => {
      detector.registerKeyCombo('Delete');
      expect(detector.push(makeKeyEvent('Delete'))).toBe('Delete');
    });
  });

  describe('combinations (modifier + sequence)', () => {
    it('detects ctrl+a then b', () => {
      detector.registerKeyCombo('ctrl+a b');
      expect(detector.push(makeKeyEvent('a', { ctrlKey: true }))).toBe(null);
      expect(detector.push(makeKeyEvent('b'))).toBe('ctrl+a b');
    });

    it('detects a then ctrl+b', () => {
      detector.registerKeyCombo('a ctrl+b');
      expect(detector.push(makeKeyEvent('a'))).toBe(null);
      expect(detector.push(makeKeyEvent('b', { ctrlKey: true }))).toBe('a ctrl+b');
    });

    it('detects shift+a then b then c', () => {
      detector.registerKeyCombo('shift+a b c');
      expect(detector.push(makeKeyEvent('a', { shiftKey: true }))).toBe(null);
      expect(detector.push(makeKeyEvent('b'))).toBe(null);
      expect(detector.push(makeKeyEvent('c'))).toBe('shift+a b c');
    });
  });

  describe('setKeyCombos', () => {
    it('registers multiple combos at once', () => {
      detector.setKeyCombos(['a', 'b', 'c']);
      expect(detector.push(makeKeyEvent('a'))).toBe('a');
      expect(detector.push(makeKeyEvent('b'))).toBe('b');
      expect(detector.push(makeKeyEvent('c'))).toBe('c');
    });
  });

  describe('isPotentialyInProgress', () => {
    it('returns true when sequence is in progress', () => {
      detector.registerKeyCombo('a b c');
      detector.push(makeKeyEvent('a'));
      expect(detector.isPotentiallyInProgress('a b c')).toBe(true);
    });

    it('returns false when no keys pressed', () => {
      detector.registerKeyCombo('a b');
      expect(detector.isPotentiallyInProgress('a b')).toBe(false);
    });

    it('returns false when partial does not match', () => {
      detector.registerKeyCombo('a b');
      detector.push(makeKeyEvent('x'));
      expect(detector.isPotentiallyInProgress('a b')).toBe(false);
    });
  });

  describe('clear', () => {
    it('clears the state', () => {
      detector.registerKeyCombo('a b');
      detector.push(makeKeyEvent('a'));
      detector.clear();
      expect(detector.push(makeKeyEvent('a'))).toBe(null);
      expect(detector.push(makeKeyEvent('b'))).toBe(null);
    });
  });

  describe('unregisterKeyCombo', () => {
    it('removes a combo', () => {
      detector.registerKeyCombo('a');
      detector.unregisterKeyCombo('a');
      expect(detector.push(makeKeyEvent('a'))).toBe(null);
    });
  });

  describe('expiry', () => {
    it('does not match after timeout', () => {
      jest.useFakeTimers();
      const shortDetector = new KeyComboDetector(100);
      shortDetector.registerKeyCombo('a b');

      shortDetector.push(makeKeyEvent('a'));
      jest.advanceTimersByTime(150);
      expect(shortDetector.push(makeKeyEvent('b'))).toBe(null);

      shortDetector.destroy();
      jest.useRealTimers();
    });
  });

  describe('modifier-only keys do not trigger', () => {
    it('Meta does not trigger', () => {
      detector.registerKeyCombo('a');
      expect(detector.push(makeKeyEvent('Meta'))).toBe(null);
    });

    it('Control does not trigger', () => {
      detector.registerKeyCombo('a');
      expect(detector.push(makeKeyEvent('Control'))).toBe(null);
    });

    it('Shift does not trigger', () => {
      detector.registerKeyCombo('a');
      expect(detector.push(makeKeyEvent('Shift'))).toBe(null);
    });

    it('Alt does not trigger', () => {
      detector.registerKeyCombo('a');
      expect(detector.push(makeKeyEvent('Alt'))).toBe(null);
    });
  });

  describe('uppercase keys with shift', () => {
    it('matches uppercase key combo against keyboard events with shift held', () => {
      detector.registerKeyCombo('c P');

      // Step 1: press 'c' (no shift) — partial match, not yet matched
      expect(detector.push(makeKeyEvent('c'))).toBeNull();

      // Step 2: press 'P' with shiftKey: true (browser naturally sends this for uppercase P)
      expect(detector.push(makeKeyEvent('P', { shiftKey: true }))).toBe('c P');
    });
  });
});
