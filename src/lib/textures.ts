import { Texture } from "pixi.js";

const HANDLE_SIZE_PX = 10;

function createSquareHandleTexture(): Texture {
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
}
/** A square handle used for verticies of a polygon. */
export const VERTEX_HANDLE_TEXTURE = createSquareHandleTexture();

function createCircleHandleTexture(): Texture {
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
}
/** A circular handle used for control points in a curve. */
export const CURVE_CONTROL_POINT_HANDLE_TEXTURE = createCircleHandleTexture();

export const SELECTED_FILL_COLOR = 0x3498db;

function createSelectionCornerHandleTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = HANDLE_SIZE_PX;
  canvas.height = HANDLE_SIZE_PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = `#${SELECTED_FILL_COLOR.toString(16)}`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX / 2, HANDLE_SIZE_PX / 2 - 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  return Texture.from(canvas);
}
/** A circular handle used for adjusting the corners of a selection. */
export const SELECTION_CORNER_HANDLE_TEXTURE = createSelectionCornerHandleTexture();

function createIntersectionVertexHandleTexture(): Texture {
  const canvas = document.createElement('canvas');
  // A little larger than the square handle so it's easy to click
  const size = HANDLE_SIZE_PX + 4;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) - 2;

  // Hollow circle in accent color
  ctx.strokeStyle = '#4a90e2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // "+" crosshair in the center to suggest "add vertex here"
  const armLength = 3;
  ctx.beginPath();
  ctx.moveTo(cx - armLength, cy);
  ctx.lineTo(cx + armLength, cy);
  ctx.moveTo(cx, cy - armLength);
  ctx.lineTo(cx, cy + armLength);
  ctx.stroke();

  return Texture.from(canvas);
}
/** A circular handle with a + icon, indicating a potential vertex at an intersection point. */
export const INTERSECTION_VERTEX_HANDLE_TEXTURE = createIntersectionVertexHandleTexture();
