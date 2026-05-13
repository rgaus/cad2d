export type KeyCombo = string;

/**
  * Maps an index into a unique key combo that can be used for selection of a large number of items.
  * FIXME: there is a big where non unique key combos can be generated, like "aa" and "aaz". These
  * should be eliminated. */
export function mapIndexToKeyCombo(index: number): KeyCombo {
  return index.toString(26).split('').map((char) => {
    switch (char) {
      case '0': return 'a';
      case '1': return 'b';
      case '2': return 'c';
      case '3': return 'd';
      case '4': return 'e';
      case '5': return 'f';
      case '6': return 'g';
      case '7': return 'h';
      case '8': return 'i';
      case '9': return 'j';
      case 'a': return 'k';
      case 'b': return 'l';
      case 'c': return 'm';
      case 'd': return 'n';
      case 'e': return 'o';
      case 'f': return 'p';
      case 'g': return 'q';
      case 'h': return 'r';
      case 'i': return 's';
      case 'j': return 't';
      case 'k': return 'u';
      case 'l': return 'v';
      case 'm': return 'w';
      case 'n': return 'x';
      case 'o': return 'y';
      case 'p': return 'z';
    }
  }).join('');
}

/** A class which can be fed keys pressed by a user and used to detect multi key combinations. */
export class KeyComboDetector {
  private state: KeyCombo = "";
  private options = new Set<KeyCombo>();

  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private delayBeforeExpiryMs: number;

  constructor(delayBeforeExpiryMs = 2000) {
    this.delayBeforeExpiryMs = delayBeforeExpiryMs;
    this.touchClearTimeout();
  }

  private touchClearTimeout() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.timeoutId = setTimeout(() => {
      this.state = "";
    }, this.delayBeforeExpiryMs);
  }

  registerKeyCombo(keyCombo: KeyCombo) {
    this.options.add(keyCombo);
    return this;
  }
  unregisterKeyCombo(keyCombo: KeyCombo) {
    this.options.delete(keyCombo);
    return this;
  }
  setKeyCombos(keyCombos: Array<KeyCombo>) {
    this.options = new Set(keyCombos);
    return this;
  }

  /** Is this given key combination potentially halfway through being entered right now? */
  isPotentialyInProgress(combo: KeyCombo) {
    return this.state.length > 0 && combo.startsWith(this.state);
  }

  /** The main method - feed in keys, returns any matching key combos found. */
  push(key: string): KeyCombo | null {
    this.touchClearTimeout();
    this.state += key;

    for (const option of this.options) {
      if (option === this.state) {
        this.state = "";
        return option;
      }
    }

    return null;
  }

  clear() {
    this.state = "";
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    return this;
  }

  /** Cleanup the timeout before discarding this class. */
  destroy() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
  }
}
