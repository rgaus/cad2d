import { Texture } from 'pixi.js';
import { SPRITE_SCALE_FACTOR } from '../textures';

const TEXTURE_CACHE = new Map<string, Texture>();

const TEXT_PADDING = 4;
const TEXT_FONT_FAMILY = "'Roboto Mono', 'Courier New', monospace";
const TEXT_FONT_SIZE = 12;
const TEXT_COLOR = '#000000';
const BG_COLOR = '#ffffff';

export function getDimensionTextTexture(
  text: string,
  bgColor: string = BG_COLOR,
  textColor: string = TEXT_COLOR,
): Texture {
  const cacheKey = `${text},${bgColor}`;

  if (TEXTURE_CACHE.has(cacheKey)) {
    return TEXTURE_CACHE.get(cacheKey)!;
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  ctx.font = `${TEXT_FONT_SIZE}px ${TEXT_FONT_FAMILY}`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = TEXT_FONT_SIZE;

  const textureWidth = textWidth + TEXT_PADDING * 2;
  const textureHeight = textHeight + TEXT_PADDING * 2;

  canvas.width = Math.ceil(textureWidth * SPRITE_SCALE_FACTOR);
  canvas.height = Math.ceil(textureHeight * SPRITE_SCALE_FACTOR);

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = `${TEXT_FONT_SIZE * SPRITE_SCALE_FACTOR}px ${TEXT_FONT_FAMILY}`;
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = Texture.from(canvas);
  TEXTURE_CACHE.set(cacheKey, texture);

  return texture;
}

export function clearDimensionTextCache(): void {
  for (const texture of TEXTURE_CACHE.values()) {
    texture.destroy(true);
  }
  TEXTURE_CACHE.clear();
}
