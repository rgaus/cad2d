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
