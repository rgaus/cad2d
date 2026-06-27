'use client';
import { Texture } from 'pixi.js';
import { DATUM_CIRCLE_RADIUS_PX } from '@/lib/geometry/datum';

const HANDLE_SIZE_PX = 10;

export const SELECTION_COLOR = 0x3498db;
export const SELECTION_HINT_WIDTH_PX = 3;

class CachedIconTexture {
  private cache: Texture | null = null;

  private compute: () => Texture;
  constructor(compute: () => Texture) {
    this.compute = compute;
  }

  /** Get the texture, computing fresh if this is the first call. */
  get(): Texture {
    if (typeof document === 'undefined') {
      throw new Error('textures.ts must only be used on the client side');
    }

    if (this.cache) {
      return this.cache;
    }
    this.cache = this.compute();
    return this.cache;
  }
}
export type { CachedIconTexture };

/** A square handle used for vertices of a polygon. */
export const VertexHandleTexture = new CachedIconTexture(() => {
  const canvas = document.createElement('canvas');
  canvas.width = HANDLE_SIZE_PX;
  canvas.height = HANDLE_SIZE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.fillRect(0, 0, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
  ctx.strokeRect(0, 0, HANDLE_SIZE_PX, HANDLE_SIZE_PX);
  return Texture.from(canvas);
});

/** A circular handle used for control points in a curve. */
export const CurveControlPointHandleTexture = new CachedIconTexture(() => {
  const canvas = document.createElement('canvas');
  canvas.width = HANDLE_SIZE_PX;
  canvas.height = HANDLE_SIZE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return Texture.from(canvas);
});

/** A circular handle with a + icon, indicating a potential vertex at an intersection point. */
export const IntersectionVertexHandleTexture = new CachedIconTexture(() => {
  const canvas = document.createElement('canvas');
  const size = HANDLE_SIZE_PX + 4;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 2;

  ctx.strokeStyle = '#4a90e2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  const armLength = 3;
  ctx.beginPath();
  ctx.moveTo(cx - armLength, cy);
  ctx.lineTo(cx + armLength, cy);
  ctx.moveTo(cx, cy - armLength);
  ctx.lineTo(cx, cy + armLength);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular handle used for adjusting the corners of a selection. */
export const SelectionCornerHandleTexture = new CachedIconTexture(() => {
  const canvas = document.createElement('canvas');
  canvas.width = HANDLE_SIZE_PX;
  canvas.height = HANDLE_SIZE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = `#${SELECTION_COLOR.toString(16)}`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return Texture.from(canvas);
});

export const ConflictIconTexture = new CachedIconTexture(() => {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 8;
  const iconColor = '#e5484d';

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = iconColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const inner = 4;
  ctx.beginPath();
  ctx.moveTo(cx - inner, cy - inner);
  ctx.lineTo(cx + inner, cy + inner);
  ctx.moveTo(cx + inner, cy - inner);
  ctx.lineTo(cx - inner, cy + inner);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular indicator labelling perpendicular constraints. */
export const PerpendicularConstraintIconTexture = new CachedIconTexture(() => {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 8;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const inner = 4;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - inner);
  ctx.lineTo(cx, cy + inner);
  ctx.moveTo(cx + inner, cy + inner);
  ctx.lineTo(cx - inner, cy + inner);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular indicator labelling perpendicular constraints. */
export const PerpendicularConstraintIconConflictTexture = new CachedIconTexture(() => {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 8;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e5484d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const inner = 4;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - inner);
  ctx.lineTo(cx, cy + inner);
  ctx.moveTo(cx + inner, cy + inner);
  ctx.lineTo(cx - inner, cy + inner);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular indicator labelling parallel constraints. */
export const ParallelConstraintIconTexture = new CachedIconTexture(() => {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 8;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Two short vertical parallel lines
  const gap = 2;
  const barHeight = 7;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - barHeight / 2, cy - gap);
  ctx.lineTo(cx + barHeight / 2, cy - gap);
  ctx.moveTo(cx - barHeight / 2, cy + gap);
  ctx.lineTo(cx + barHeight / 2, cy + gap);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular indicator labelling parallel constraints in conflict. */
export const ParallelConstraintIconConflictTexture = new CachedIconTexture(() => {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 8;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e5484d';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Two short vertical parallel lines
  const gap = 3;
  const barHeight = 7;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - gap, cy - barHeight / 2);
  ctx.lineTo(cx - gap, cy + barHeight / 2);
  ctx.moveTo(cx + gap, cy - barHeight / 2);
  ctx.lineTo(cx + gap, cy + barHeight / 2);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A crosshair icon for datum markers. */
export const DatumCrosshairTexture = new CachedIconTexture(() => {
  const radius = DATUM_CIRCLE_RADIUS_PX;
  const size = radius * 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();
  return Texture.from(canvas);
});
