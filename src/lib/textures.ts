"use client";
import { Texture } from "pixi.js";

const HANDLE_SIZE_PX = 10;

export const SELECTED_FILL_COLOR = 0x3498db;

let vertexHandleTexture: Texture | null = null;
let curveControlPointHandleTexture: Texture | null = null;
let selectionCornerHandleTexture: Texture | null = null;
let intersectionVertexHandleTexture: Texture | null = null;

function ensureClientSide() {
  if (typeof document === 'undefined') {
    throw new Error(' textures.ts must only be used on the client side');
  }
}

function createSquareHandleTexture(): Texture {
  ensureClientSide();
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

/** A square handle used for vertices of a polygon. */
export function getVertexHandleTexture(): Texture {
  if (!vertexHandleTexture) {
    vertexHandleTexture = createSquareHandleTexture();
  }
  return vertexHandleTexture;
}

function createCircleHandleTexture(): Texture {
  ensureClientSide();
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
export function getCurveControlPointHandleTexture(): Texture {
  if (!curveControlPointHandleTexture) {
    curveControlPointHandleTexture = createCircleHandleTexture();
  }
  return curveControlPointHandleTexture;
}

function createSelectionCornerHandleTexture(): Texture {
  ensureClientSide();
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
export function getSelectionCornerHandleTexture(): Texture {
  if (!selectionCornerHandleTexture) {
    selectionCornerHandleTexture = createSelectionCornerHandleTexture();
  }
  return selectionCornerHandleTexture;
}

function createIntersectionVertexHandleTexture(): Texture {
  ensureClientSide();
  const canvas = document.createElement('canvas');
  const size = HANDLE_SIZE_PX + 4;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) - 2;

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
}

/** A circular handle with a + icon, indicating a potential vertex at an intersection point. */
export function getIntersectionVertexHandleTexture(): Texture {
  if (!intersectionVertexHandleTexture) {
    intersectionVertexHandleTexture = createIntersectionVertexHandleTexture();
  }
  return intersectionVertexHandleTexture;
}