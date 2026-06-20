export type KeyCombo = string;

/**
 * Maps an index into a unique key combo that can be used for selection of a large number of items.
 * FIXME: there is a big where non unique key combos can be generated, like "aa" and "aaz". These
 * should be eliminated. */
export function mapIndexToKeyCombo(index: number): KeyCombo {
  return index
    .toString(26)
    .split('')
    .map((char) => {
      switch (char) {
        case '0':
          return 'a';
        case '1':
          return 'b';
        case '2':
          return 'c';
        case '3':
          return 'd';
        case '4':
          return 'e';
        case '5':
          return 'f';
        case '6':
          return 'g';
        case '7':
          return 'h';
        case '8':
          return 'i';
        case '9':
          return 'j';
        case 'a':
          return 'k';
        case 'b':
          return 'l';
        case 'c':
          return 'm';
        case 'd':
          return 'n';
        case 'e':
          return 'o';
        case 'f':
          return 'p';
        case 'g':
          return 'q';
        case 'h':
          return 'r';
        case 'i':
          return 's';
        case 'j':
          return 't';
        case 'k':
          return 'u';
        case 'l':
          return 'v';
        case 'm':
          return 'w';
        case 'n':
          return 'x';
        case 'o':
          return 'y';
        case 'p':
          return 'z';
      }
    })
    .join('');
}

type ResolvedKeyCombo = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
};

const PATTERNS: { [key in Exclude<keyof ResolvedKeyCombo, 'key'>]: Array<string> } = {
  ctrlKey: ['ctrl', 'control'],
  altKey: ['alt', 'opt', 'option'],
  shiftKey: ['shift'],
  metaKey: ['super', 'cmd'],
};

const SPECIAL_KEYS = [
  // All special KeyboardEvent.key values from:
  // https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values
  // Grouped by section for readability.

  // --- Special values ---
  'Unidentified',

  // --- Modifier keys ---
  'Alt',
  'AltGraph',
  'CapsLock',
  'Control',
  'Fn',
  'FnLock',
  'Hyper',
  'Meta',
  'NumLock',
  'ScrollLock',
  'Shift',
  'Super',
  'Symbol',
  'SymbolLock',

  // --- Whitespace keys ---
  'Enter',
  'Tab',
  // No " " here, omitted on purpose

  // --- Navigation keys ---
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',

  // --- Editing keys ---
  'Backspace',
  'Clear',
  'Copy',
  'CrSel',
  'Cut',
  'Delete',
  'EraseEof',
  'ExSel',
  'Insert',
  'Paste',
  'Redo',
  'Undo',

  // --- UI keys ---
  'Accept',
  'Again',
  'Attn',
  'Cancel',
  'ContextMenu',
  'Escape',
  'Execute',
  'Find',
  'Finish',
  'Help',
  'Pause',
  'Play',
  'Props',
  'Select',
  'ZoomIn',
  'ZoomOut',

  // --- Device keys ---
  'BrightnessDown',
  'BrightnessUp',
  'Eject',
  'Hibernate',
  'LogOff',
  'Power',
  'PowerOff',
  'PrintScreen',
  'Standby',
  'WakeUp',

  // --- IME and composition keys (common) ---
  'AllCandidates',
  'Alphanumeric',
  'CodeInput',
  'Compose',
  'Convert',
  'Dead',
  'FinalMode',
  'GroupFirst',
  'GroupLast',
  'GroupNext',
  'GroupPrevious',
  'ModeChange',
  'NextCandidate',
  'NonConvert',
  'PreviousCandidate',
  'Process',
  'SingleCandidate',

  // --- IME keys: Korean keyboards only ---
  'HangulMode',
  'HanjaMode',
  'JunjaMode',

  // --- IME keys: Japanese keyboards only ---
  'Eisu',
  'Hankaku',
  'Hiragana',
  'HiraganaKatakana',
  'KanaMode',
  'KanjiMode',
  'Katakana',
  'Romaji',
  'Zenkaku',
  'ZenkakuHankaku',

  // --- Function keys ---
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',
  'F13',
  'F14',
  'F15',
  'F16',
  'F17',
  'F18',
  'F19',
  'F20',
  'Soft1',
  'Soft2',
  'Soft3',
  'Soft4',

  // --- Phone keys ---
  'AppSwitch',
  'Call',
  'Camera',
  'CameraFocus',
  'EndCall',
  'GoBack',
  'GoHome',
  'HeadsetHook',
  'LastNumberRedial',
  'MannerMode',
  'Notification',
  'VoiceDial',

  // --- Multimedia keys ---
  'ChannelDown',
  'ChannelUp',
  'MediaFastForward',
  'MediaPause',
  'MediaPlay',
  'MediaPlayPause',
  'MediaRecord',
  'MediaRewind',
  'MediaStop',
  'MediaTrackNext',
  'MediaTrackPrevious',

  // --- Audio control keys ---
  'AudioBalanceLeft',
  'AudioBalanceRight',
  'AudioBassBoostDown',
  'AudioBassBoostToggle',
  'AudioBassBoostUp',
  'AudioBassDown',
  'AudioBassUp',
  'AudioFaderFront',
  'AudioFaderRear',
  'AudioSurroundModeNext',
  'AudioTrebleDown',
  'AudioTrebleUp',
  'AudioVolumeDown',
  'AudioVolumeMute',
  'AudioVolumeUp',
  'MicrophoneToggle',
  'MicrophoneVolumeDown',
  'MicrophoneVolumeMute',
  'MicrophoneVolumeUp',

  // --- TV control keys ---
  'TV',
  'TV3DMode',
  'TVAntennaCable',
  'TVAudioDescription',
  'TVAudioDescriptionMixDown',
  'TVAudioDescriptionMixUp',
  'TVContentsMenu',
  'TVDataService',
  'TVInput',
  'TVInputComponent1',
  'TVInputComponent2',
  'TVInputComposite1',
  'TVInputComposite2',
  'TVInputHDMI1',
  'TVInputHDMI2',
  'TVInputHDMI3',
  'TVInputHDMI4',
  'TVInputVGA1',
  'TVMediaContext',
  'TVNetwork',
  'TVNumberEntry',
  'TVPower',
  'TVRadioService',
  'TVSatellite',
  'TVSatelliteBS',
  'TVSatelliteCS',
  'TVSatelliteToggle',
  'TVTerrestrialAnalog',
  'TVTerrestrialDigital',
  'TVTimer',

  // --- Media controller keys ---
  'AVRInput',
  'AVRPower',
  'ColorF0Red',
  'ColorF1Green',
  'ColorF2Yellow',
  'ColorF3Blue',
  'ColorF4Grey',
  'ColorF5Brown',
  'ClosedCaptionToggle',
  'Dimmer',
  'DisplaySwap',
  'DVR',
  'Exit',
  'FavoriteClear0',
  'FavoriteClear1',
  'FavoriteClear2',
  'FavoriteClear3',
  'FavoriteRecall0',
  'FavoriteRecall1',
  'FavoriteRecall2',
  'FavoriteRecall3',
  'FavoriteStore0',
  'FavoriteStore1',
  'FavoriteStore2',
  'FavoriteStore3',
  'Guide',
  'GuideNextDay',
  'GuidePreviousDay',
  'Info',
  'InstantReplay',
  'Link',
  'ListProgram',
  'LiveContent',
  'Lock',
  'MediaApps',
  'MediaAudioTrack',
  'MediaLast',
  'MediaSkipBackward',
  'MediaSkipForward',
  'MediaStepBackward',
  'MediaStepForward',
  'MediaTopMenu',
  'NavigateIn',
  'NavigateNext',
  'NavigateOut',
  'NavigatePrevious',
  'NextFavoriteChannel',
  'NextUserProfile',
  'OnDemand',
  'Pairing',
  'PinPDown',
  'PinPMove',
  'PinPToggle',
  'PinPUp',
  'PlaySpeedDown',
  'PlaySpeedReset',
  'PlaySpeedUp',
  'RandomToggle',
  'RcLowBattery',
  'RecordSpeedNext',
  'RfBypass',
  'ScanChannelsToggle',
  'ScreenModeNext',
  'Settings',
  'SplitScreenToggle',
  'STBInput',
  'STBPower',
  'Subtitle',
  'Teletext',
  'VideoModeNext',
  'Wink',
  'ZoomToggle',

  // --- Speech recognition keys ---
  'SpeechCorrectionList',
  'SpeechInputToggle',

  // --- Document keys ---
  'Close',
  'MailForward',
  'MailReply',
  'MailSend',
  'New',
  'Open',
  'Print',
  'Save',
  'SpellCheck',

  // --- Application selector keys ---
  'LaunchCalculator',
  'LaunchCalendar',
  'LaunchContacts',
  'LaunchMail',
  'LaunchMediaPlayer',
  'LaunchMusicPlayer',
  'LaunchMyComputer',
  'LaunchPhone',
  'LaunchScreenSaver',
  'LaunchSpreadsheet',
  'LaunchWebBrowser',
  'LaunchWebCam',
  'LaunchWordProcessor',

  // --- Browser control keys ---
  'BrowserBack',
  'BrowserFavorites',
  'BrowserForward',
  'BrowserHome',
  'BrowserRefresh',
  'BrowserSearch',
  'BrowserStop',

  // --- Numeric keypad keys ---
  'Add',
  'Decimal',
  'Divide',
  'Key11',
  'Key12',
  'Multiply',
  'Separator',
  'Subtract',
];

function resolveKeyCombo(
  input: KeyCombo,
): Array<{ key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> {
  let combos = [];
  let working = input;
  while (working.length > 0) {
    let lastCombo: ResolvedKeyCombo | undefined = combos.at(-1);
    if (!lastCombo) {
      lastCombo = {
        key: '',
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
      } satisfies ResolvedKeyCombo;
      combos.push(lastCombo);
    }

    // Look for prefixes like `ctrl+`, in `ctrl+a`, etc
    let patternFound = false;
    for (const [key, patterns] of Object.entries(PATTERNS)) {
      for (const pattern of patterns) {
        if (working.startsWith(`${pattern}+`)) {
          lastCombo[key as keyof typeof PATTERNS] = true;
          working = working.slice(pattern.length + 1 /* plus sign */);
          patternFound = true;
        }
      }
    }
    if (patternFound) {
      continue;
    }

    // Look for key combos specified
    // ie, "Escape" or "Enter"
    for (const key of SPECIAL_KEYS) {
      if (working.startsWith(key)) {
        lastCombo.key = key;
        working = working.slice(key.length);
        patternFound = true;
      }
    }
    if (patternFound) {
      continue;
    }

    // If a pattern was NOT found, then pop off entries as keys
    const char = working[0];
    working = working.slice(1);
    if (/^\s$/.test(char)) {
      // Ignore whitespace
      continue;
    }
    lastCombo.key = char;
    combos.push({
      key: '',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
  }

  const firstEmptyIndex = combos.findIndex((c) => c.key.length === 0);
  if (firstEmptyIndex >= 0) {
    return combos.slice(0, firstEmptyIndex);
  } else {
    return combos;
  }
}

function resolvedKeyComboEqual(a: ResolvedKeyCombo, b: ResolvedKeyCombo): boolean {
  return (
    a.key === b.key &&
    a.altKey == b.altKey &&
    a.ctrlKey === b.ctrlKey &&
    a.metaKey == b.metaKey &&
    a.shiftKey === b.shiftKey
  );
}

function resolvedKeyComboListEqual(
  aArr: Array<ResolvedKeyCombo>,
  bArr: Array<ResolvedKeyCombo>,
): boolean {
  return (
    aArr.length === bArr.length &&
    aArr.every((a, i) => {
      const b = bArr[i];
      return resolvedKeyComboEqual(a, b);
    })
  );
}

/** A class which can be fed keys pressed by a user and used to detect multi key combinations. */
export class KeyComboDetector {
  private state: Array<ResolvedKeyCombo> = [];
  private options = new Map<KeyCombo, Array<ResolvedKeyCombo>>();

  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private delayBeforeExpiryMs: number;

  /** Returns the number of accumulated key presses currently in the detector state.
   *  Non-zero means a multi-key combo is potentially in progress. */
  get stateLength(): number {
    return this.state.length;
  }

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
      this.state = [];
    }, this.delayBeforeExpiryMs);
  }

  registerKeyCombo(keyCombo: KeyCombo) {
    this.options.set(keyCombo, resolveKeyCombo(keyCombo));
    return this;
  }
  unregisterKeyCombo(keyCombo: KeyCombo) {
    this.options.delete(keyCombo);
    return this;
  }
  setKeyCombos(keyCombos: Array<KeyCombo>) {
    this.options = new Map(keyCombos.map((kc) => [kc, resolveKeyCombo(kc)]));
    return this;
  }

  /** Is this given key combination potentially halfway through being entered right now? */
  isPotentiallyInProgress(combo: KeyCombo) {
    const resolved = resolveKeyCombo(combo);
    if (this.state.length === 0) {
      return false;
    }
    return (
      this.state.length <= resolved.length &&
      this.state.every((s, i) => resolvedKeyComboEqual(resolved[i], s))
    );
  }

  /** The main method - feed in keys, returns any matching key combos found. */
  push<E extends ResolvedKeyCombo>(event: E): KeyCombo | null {
    this.touchClearTimeout();

    // These are only modifiers, they can't trigger things directly
    if (['Meta', 'Control', 'Shift', 'Alt'].includes(event.key)) {
      return null;
    }
    this.state.push(event);

    for (const [key, option] of this.options) {
      if (resolvedKeyComboListEqual(option, this.state)) {
        this.state = [];
        return key;
      }
    }

    return null;
  }

  /** Seeds the detector state as if the given key combo had already been pressed.
   *  Useful for multi-tool prefix priming where the parent tool's prefix key
   *  was consumed by a higher-level detector. */
  primeState(keyCombo: KeyCombo): void {
    this.state = resolveKeyCombo(keyCombo);
    this.touchClearTimeout();
  }

  /** Resets only the accumulated key state, preserving all registered combos.
   *  Used to dismiss a multi-key prefix that was primed but should be cancelled. */
  resetState(): void {
    this.state = [];
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  clear() {
    this.state = [];
    this.options = new Map();
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
