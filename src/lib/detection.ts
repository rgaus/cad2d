export function isApplePlatform() {
  // navigator.userAgentData is the modern way to check platform info,
  // but it's not available in all browsers (notably Firefox/Safari)
  if (typeof (navigator as any).userAgentData !== 'undefined') {
    const platform = (navigator as any).userAgentData.platform.toLowerCase();
    return platform.includes('mac') || platform.includes('iphone') || platform.includes('ipad');
  }

  // Fall back to the legacy navigator.platform for broader compatibility.
  // Covers: MacIntel, MacPPC, Mac68K, iPhone, iPad (older iOS)
  return /mac|iphone|ipad/i.test(navigator.platform);
}

/** Set to "cmd" on macs, "ctrl" everywhere else. */
export const PLATFORM_CONTROL_KEY_STRING = isApplePlatform() ? "cmd" : "ctrl";

/** Set to "option" on macs, "alt" everywhere else. */
export const PLATFORM_ALT_KEY_STRING = isApplePlatform() ? "option" : "alt";

/** Set to "cmd" on macs, "super" everywhere else. */
export const PLATFORM_SUPER_KEY_STRING = isApplePlatform() ? "cmd" : "super";

/** Checks to see if the platform specific "control" key was pressed (command on macs, ctrl
  * everywhere else) */
export function isPlatformControlKey<E extends { ctrlKey: boolean, metaKey: boolean }>(event: E): boolean {
  if (isApplePlatform()) {
    return event.metaKey;
  } else {
    return event.ctrlKey;
  }
}
