module.exports = function colorRgba(color) {
  if (color === 'none' || color === 'transparent') {
    return [];
  }
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 6) {
      return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
    }
  }
  const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return [parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3]), 1];
  }
  const hslMatch = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (hslMatch) {
    const h = parseInt(hslMatch[1]) / 360;
    const s = parseInt(hslMatch[2]) / 100;
    const l = parseInt(hslMatch[3]) / 100;
    const r = l <= 0.5 ? l * (1 + s) : l + s - l * s;
    const s2 = 2 * l - r;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    return [Math.round(hue2rgb(s2, r, h + 1/3) * 255), Math.round(hue2rgb(s2, r, h) * 255), Math.round(hue2rgb(s2, r, h - 1/3) * 255), 1];
  }
  return [];
};