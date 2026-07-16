'use client';
import { cyan } from '@radix-ui/colors';
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
  canvas.width = HANDLE_SIZE_PX * 2;
  canvas.height = HANDLE_SIZE_PX * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4;
  ctx.fillRect(0, 0, HANDLE_SIZE_PX * 2, HANDLE_SIZE_PX * 2);
  ctx.strokeRect(0, 0, HANDLE_SIZE_PX * 2, HANDLE_SIZE_PX * 2);
  return Texture.from(canvas);
});

/** A circular handle used for control points in a curve. */
export const CurveControlPointHandleTexture = new CachedIconTexture(() => {
  const canvas = document.createElement('canvas');
  canvas.width = HANDLE_SIZE_PX * 2;
  canvas.height = HANDLE_SIZE_PX * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(HANDLE_SIZE_PX, HANDLE_SIZE_PX, HANDLE_SIZE_PX - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return Texture.from(canvas);
});

/** A circular handle with a + icon, indicating a potential vertex at an intersection point. */
export const IntersectionVertexHandleTexture = new CachedIconTexture(() => {
  const canvas = document.createElement('canvas');
  const baseSize = HANDLE_SIZE_PX + 4;
  const size = baseSize * 2;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 4;

  ctx.strokeStyle = '#4a90e2';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  const armLength = 6;
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
  canvas.width = HANDLE_SIZE_PX * 2;
  canvas.height = HANDLE_SIZE_PX * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = `#${SELECTION_COLOR.toString(16)}`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(HANDLE_SIZE_PX, HANDLE_SIZE_PX, HANDLE_SIZE_PX - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return Texture.from(canvas);
});

export const ConflictIconTexture = new CachedIconTexture(() => {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;
  const iconColor = '#e5484d';

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = iconColor;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const inner = 8;
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
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const inner = 8;
  ctx.lineWidth = 2;
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
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e5484d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const inner = 8;
  ctx.lineWidth = 2;
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
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Two short vertical parallel lines
  const gap = 4;
  const barHeight = 14;
  ctx.lineWidth = 2.4;
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
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e5484d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Two short vertical parallel lines
  const gap = 6;
  const barHeight = 14;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - gap, cy - barHeight / 2);
  ctx.lineTo(cx - gap, cy + barHeight / 2);
  ctx.moveTo(cx + gap, cy - barHeight / 2);
  ctx.lineTo(cx + gap, cy + barHeight / 2);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular indicator labelling horizontal constraints. */
export const HorizontalConstraintIconTexture = new CachedIconTexture(() => {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Horizontal line
  ctx.beginPath();
  ctx.moveTo(cx - 8, cy);
  ctx.lineTo(cx + 8, cy);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular indicator labelling horizontal constraints in conflict. */
export const HorizontalConstraintIconConflictTexture = new CachedIconTexture(() => {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e5484d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 8, cy);
  ctx.lineTo(cx + 8, cy);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular indicator labelling vertical constraints. */
export const VerticalConstraintIconTexture = new CachedIconTexture(() => {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Vertical line
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx, cy + 8);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular indicator labelling vertical constraints in conflict. */
export const VerticalConstraintIconConflictTexture = new CachedIconTexture(() => {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e5484d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx, cy + 8);
  ctx.stroke();

  return Texture.from(canvas);
});

/** A circular indicator labelling colinear constraints. */
export const ColinearConstraintIconTexture = new CachedIconTexture(() => {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Three dots in a diagonal line representing collinearity
  const gap = 6;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(cx - gap, cy - gap, 2.4, 0, Math.PI * 2);
  ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
  ctx.arc(cx + gap, cy + gap, 2.4, 0, Math.PI * 2);
  ctx.fill();

  return Texture.from(canvas);
});

/** A circular indicator labelling colinear constraints in conflict. */
export const ColinearConstraintIconConflictTexture = new CachedIconTexture(() => {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 16;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#e5484d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const gap = 6;
  ctx.fillStyle = '#e5484d';
  ctx.beginPath();
  ctx.arc(cx - gap, cy - gap, 2.4, 0, Math.PI * 2);
  ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
  ctx.arc(cx + gap, cy + gap, 2.4, 0, Math.PI * 2);
  ctx.fill();

  return Texture.from(canvas);
});

/** A circular indicator labelling a fillet filter. */
export const FilletFilterIconTexture = new CachedIconTexture(() => {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = 18;

  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Square corner with a rounded top-right fillet corner
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.fillStyle = '#cccccc';
  ctx.moveTo(cx - 9, cy - 6);
  ctx.lineTo(cx, cy - 6);
  ctx.arc(cx, cy, 6, (3 * Math.PI) / 2, 0);
  ctx.lineTo(cx + 6, cy + 9);
  ctx.stroke();
  ctx.fill();

  return Texture.from(canvas);
});

/** A crosshair icon for datum markers. */
export const DatumCrosshairTexture = new CachedIconTexture(() => {
  const radius = DATUM_CIRCLE_RADIUS_PX * 2;
  const size = radius * 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - radius, cy);
  ctx.lineTo(cx + radius, cy);
  ctx.moveTo(cx, cy - radius);
  ctx.lineTo(cx, cy + radius);
  ctx.stroke();
  return Texture.from(canvas);
});

const DIAMOND_SIZE_PX = 16;

/** A small cyan-500 diamond used for snap hint markers on geometry key points. */
export const SnapHintDiamondTexture = new CachedIconTexture(() => {
  const canvas = document.createElement('canvas');
  canvas.width = DIAMOND_SIZE_PX;
  canvas.height = DIAMOND_SIZE_PX;
  const ctx = canvas.getContext('2d')!;
  const half = DIAMOND_SIZE_PX / 2;
  ctx.fillStyle = cyan.cyan10;
  ctx.strokeStyle = cyan.cyan10;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(half, 0);
  ctx.lineTo(DIAMOND_SIZE_PX, half);
  ctx.lineTo(half, DIAMOND_SIZE_PX);
  ctx.lineTo(0, half);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  return Texture.from(canvas);
});
