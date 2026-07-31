import { KeyPoints, Rect, SheetPosition } from '@/lib/viewport/types';
import { ResizeParams, type Entity, type EntityComponent } from '../types';
import { BoundingBox } from '@/lib/math';

export type FrameData = { upperLeft: SheetPosition; lowerRight: SheetPosition };

/**
 * A frame is a axis aligned region of space which is user translateable or resizable.
 */
export type FrameComponent = EntityComponent<'frame', FrameData>;

export namespace FrameComponent {
  export const key: keyof FrameComponent = 'frame';

  export function create(upperLeft: SheetPosition, lowerRight: SheetPosition): FrameComponent {
    return { frame: { upperLeft, lowerRight } };
  }

  export function get(geometry: Entity<FrameComponent>): FrameData {
    return geometry.components.frame;
  }

  export function update<F extends Entity<FrameComponent>>(
    geometry: F,
    partial: Partial<FrameData>,
  ): F {
    return {
      ...geometry,
      components: {
        ...geometry.components,
        frame: { ...geometry.components.frame, ...partial },
      },
    };
  }

  /** Takes a filter and translates all points according to {@link transform}. */
  export function translate<F extends Entity<FrameComponent>>(
    frame: F,
    transform: (point: SheetPosition) => SheetPosition,
  ): F {
    const frameData = FrameComponent.get(frame);
    return FrameComponent.update(frame, {
      upperLeft: transform(frameData.upperLeft),
      lowerRight: transform(frameData.lowerRight),
    })
  }

  export function equals(a: Entity<FrameComponent>, b: Entity<FrameComponent>): boolean {
    const aData = FrameComponent.get(a);
    const bData = FrameComponent.get(b);
    return (
      aData.upperLeft.x === bData.upperLeft.x && aData.upperLeft.y === bData.upperLeft.y &&
      aData.lowerRight.x === bData.lowerRight.x && aData.lowerRight.y === bData.lowerRight.y
    );
  }

  export function getOrigin(entity: Entity<FrameComponent>): SheetPosition {
    return FrameComponent.get(entity).upperLeft;
  }

  export function boundingBox(entity: Entity<FrameComponent>): Rect<SheetPosition> {
    const frameData = FrameComponent.get(entity);
    return BoundingBox.fromPoints([frameData.upperLeft, frameData.lowerRight]);
  }

  export function keyPoints(
    _entity: Entity<FrameComponent>,
  ): KeyPoints<SheetPosition> {
    // TODO: Consider adding frame corner snap points back? I'm unclear if this is a good idea.
    // Pros: constraints can be attached to frames
    // Cons: frame corner points may conflict with other geometry corner points
    //
    // const rectangle = FrameComponent.get(entity);
    // const rect: Rect<SheetPosition> = {
    //   position: rectangle.upperLeft,
    //   width: rectangle.lowerRight.x - rectangle.upperLeft.x,
    //   height: rectangle.lowerRight.y - rectangle.upperLeft.y,
    // };
    // return {
    //   // NOTE: it is very important that perimeter winds counter clockwise, as that is what the DCEL
    //   // expects.
    //   perimeter: BoundingBox.cornersToArray(BoundingBox.corners(rect)),
    //   perimeterLabels: ['upperLeft', 'upperRight', 'lowerRight', 'lowerLeft'] as const,
    //   extras: {},
    // };
    // const rectangle = FrameComponent.get(entity);
    // const rect: Rect<SheetPosition> = {
    //   position: rectangle.upperLeft,
    //   width: rectangle.lowerRight.x - rectangle.upperLeft.x,
    //   height: rectangle.lowerRight.y - rectangle.upperLeft.y,
    // };
    return {
      perimeter: [],
      perimeterLabels: [],
      extras: {},
    };
  }

  export function resize<F extends Entity<FrameComponent>>(
    entity: F,
    params: ResizeParams,
    originalBBox?: Rect<SheetPosition>,
  ): F | null {
    const state = FrameComponent.get(entity);
    if (!originalBBox) {
      originalBBox = {
        position: state.upperLeft,
        width: state.lowerRight.x - state.upperLeft.x,
        height: state.lowerRight.y - state.upperLeft.y,
      };
    }

    const newBBox = FrameComponent.resizeBBox(originalBBox, params);
    if (!newBBox) {
      return null;
    }

    const pctLeft = (state.upperLeft.x - originalBBox.position.x) / originalBBox.width;
    const pctTop = (state.upperLeft.y - originalBBox.position.y) / originalBBox.height;
    const pctRight = (state.lowerRight.x - originalBBox.position.x) / originalBBox.width;
    const pctBottom = (state.lowerRight.y - originalBBox.position.y) / originalBBox.height;

    const newUpperLeft = new SheetPosition(
      newBBox.position.x + pctLeft * newBBox.width,
      newBBox.position.y + pctTop * newBBox.height,
    );
    const newLowerRight = new SheetPosition(
      newBBox.position.x + pctRight * newBBox.width,
      newBBox.position.y + pctBottom * newBBox.height,
    );

    const ul = new SheetPosition(
      Math.min(newUpperLeft.x, newLowerRight.x),
      Math.min(newUpperLeft.y, newLowerRight.y),
    );
    const lr = new SheetPosition(
      Math.max(newUpperLeft.x, newLowerRight.x),
      Math.max(newUpperLeft.y, newLowerRight.y),
    );

    if (ul.x !== lr.x && ul.y !== lr.y) {
      return FrameComponent.update(entity, { upperLeft: ul, lowerRight: lr });
    } else {
      return null;
    }
  }

  export function resizeBBox(
    bbox: Rect<SheetPosition>,
    params: ResizeParams,
  ): Rect<SheetPosition> | null {
    const upperLeft = bbox.position;
    const lowerRight = new SheetPosition(
      bbox.position.x + bbox.width,
      bbox.position.y + bbox.height,
    );

    let newUpperLeft = upperLeft;
    let newLowerRight = lowerRight;

    if (params.mode.type === 'corner') {
      const corner = params.mode.corner;
      const centerX = (upperLeft.x + lowerRight.x) / 2;
      const centerY = (upperLeft.y + lowerRight.y) / 2;

      if (params.altHeld) {
        let dx: number;
        let dy: number;
        switch (corner) {
          case 'top-left':
            dx = centerX - params.to.x;
            dy = centerY - params.to.y;
            break;
          case 'top-right':
            dx = params.to.x - centerX;
            dy = centerY - params.to.y;
            break;
          case 'bottom-left':
            dx = centerX - params.to.x;
            dy = params.to.y - centerY;
            break;
          case 'bottom-right':
            dx = params.to.x - centerX;
            dy = params.to.y - centerY;
            break;
        }
        newUpperLeft = new SheetPosition(centerX - dx, centerY - dy);
        newLowerRight = new SheetPosition(centerX + dx, centerY + dy);
      } else {
        switch (corner) {
          case 'top-left':
            newUpperLeft = params.to;
            break;
          case 'top-right':
            newUpperLeft = new SheetPosition(upperLeft.x, params.to.y);
            newLowerRight = new SheetPosition(params.to.x, lowerRight.y);
            break;
          case 'bottom-left':
            newUpperLeft = new SheetPosition(params.to.x, upperLeft.y);
            newLowerRight = new SheetPosition(lowerRight.x, params.to.y);
            break;
          case 'bottom-right':
            newLowerRight = params.to;
            break;
        }
      }

      if (params.shiftHeld || params.linkDimensions) {
        if (bbox.width === 0 || bbox.height === 0) {
          return null;
        }
        if (params.altHeld) {
          const dx = Math.abs(params.to.x - centerX);
          const dy = Math.abs(params.to.y - centerY);
          const scale = Math.max(dx / (bbox.width / 2), dy / (bbox.height / 2));
          const newW = bbox.width * scale;
          const newH = bbox.height * scale;
          newUpperLeft = new SheetPosition(centerX - newW / 2, centerY - newH / 2);
          newLowerRight = new SheetPosition(centerX + newW / 2, centerY + newH / 2);
        } else {
          let pivotX: number;
          let pivotY: number;
          switch (corner) {
            case 'top-left':
              pivotX = lowerRight.x;
              pivotY = lowerRight.y;
              break;
            case 'top-right':
              pivotX = upperLeft.x;
              pivotY = lowerRight.y;
              break;
            case 'bottom-left':
              pivotX = lowerRight.x;
              pivotY = upperLeft.y;
              break;
            case 'bottom-right':
              pivotX = upperLeft.x;
              pivotY = upperLeft.y;
              break;
          }
          const dx = Math.abs(params.to.x - pivotX);
          const dy = Math.abs(params.to.y - pivotY);
          const scale = Math.max(dx / bbox.width, dy / bbox.height);
          const newW = bbox.width * scale;
          const newH = bbox.height * scale;
          switch (corner) {
            case 'top-left':
              newUpperLeft = new SheetPosition(pivotX - newW, pivotY - newH);
              newLowerRight = new SheetPosition(pivotX, pivotY);
              break;
            case 'top-right':
              newUpperLeft = new SheetPosition(pivotX, pivotY - newH);
              newLowerRight = new SheetPosition(pivotX + newW, pivotY);
              break;
            case 'bottom-left':
              newUpperLeft = new SheetPosition(pivotX - newW, pivotY);
              newLowerRight = new SheetPosition(pivotX, pivotY + newH);
              break;
            case 'bottom-right':
              newUpperLeft = new SheetPosition(pivotX, pivotY);
              newLowerRight = new SheetPosition(pivotX + newW, pivotY + newH);
              break;
          }
        }
      }
    } else {
      const edge = params.mode.edge;
      const originalWidth = lowerRight.x - upperLeft.x;
      const originalHeight = lowerRight.y - upperLeft.y;

      if (params.altHeld) {
        const centerX = (upperLeft.x + lowerRight.x) / 2;
        const centerY = (upperLeft.y + lowerRight.y) / 2;
        const halfWidth = originalWidth / 2;
        const halfHeight = originalHeight / 2;

        switch (edge) {
          case 'top':
            newUpperLeft = new SheetPosition(centerX - halfWidth, params.to.y);
            newLowerRight = new SheetPosition(
              centerX + halfWidth,
              centerY + halfHeight + (upperLeft.y - params.to.y),
            );
            if (params.shiftHeld || params.linkDimensions) {
              const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
              const newWidth = originalWidth * (newHeight / originalHeight);
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
            }
            break;
          case 'bottom':
            newUpperLeft = new SheetPosition(
              centerX - halfWidth,
              centerY - halfHeight - (params.to.y - lowerRight.y),
            );
            newLowerRight = new SheetPosition(centerX + halfWidth, params.to.y);
            if (params.shiftHeld || params.linkDimensions) {
              const newHeight = Math.abs(newLowerRight.y - newUpperLeft.y);
              const newWidth = originalWidth * (newHeight / originalHeight);
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, newUpperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, newLowerRight.y);
            }
            break;
          case 'left':
            newUpperLeft = new SheetPosition(params.to.x, centerY - halfHeight);
            newLowerRight = new SheetPosition(
              centerX + halfWidth + (upperLeft.x - params.to.x),
              centerY + halfHeight,
            );
            if (params.shiftHeld || params.linkDimensions) {
              const newWidth = Math.abs(newLowerRight.x - newUpperLeft.x);
              const newHeight = originalHeight * (newWidth / originalWidth);
              newUpperLeft = new SheetPosition(newUpperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(newLowerRight.x, centerY + newHeight / 2);
            }
            break;
          case 'right':
            newUpperLeft = new SheetPosition(
              centerX - halfWidth - (params.to.x - lowerRight.x),
              centerY - halfHeight,
            );
            newLowerRight = new SheetPosition(params.to.x, centerY + halfHeight);
            if (params.shiftHeld || params.linkDimensions) {
              const newWidth = Math.abs(newLowerRight.x - newUpperLeft.x);
              const newHeight = originalHeight * (newWidth / originalWidth);
              newUpperLeft = new SheetPosition(newUpperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(newLowerRight.x, centerY + newHeight / 2);
            }
            break;
        }
      } else {
        switch (edge) {
          case 'top':
            newUpperLeft = new SheetPosition(upperLeft.x, params.to.y);
            if (params.shiftHeld || params.linkDimensions) {
              const delta = upperLeft.y - params.to.y;
              const newHeight = originalHeight + delta;
              const newWidth = originalWidth * (newHeight / originalHeight);
              const centerX = (upperLeft.x + lowerRight.x) / 2;
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, params.to.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, lowerRight.y);
            }
            break;
          case 'bottom':
            newLowerRight = new SheetPosition(lowerRight.x, params.to.y);
            if (params.shiftHeld || params.linkDimensions) {
              const delta = params.to.y - lowerRight.y;
              const newHeight = originalHeight + delta;
              const newWidth = originalWidth * (newHeight / originalHeight);
              const centerX = (upperLeft.x + lowerRight.x) / 2;
              newUpperLeft = new SheetPosition(centerX - newWidth / 2, upperLeft.y);
              newLowerRight = new SheetPosition(centerX + newWidth / 2, params.to.y);
            }
            break;
          case 'left':
            newUpperLeft = new SheetPosition(params.to.x, upperLeft.y);
            if (params.shiftHeld || params.linkDimensions) {
              const delta = upperLeft.x - params.to.x;
              const newWidth = originalWidth + delta;
              const newHeight = originalHeight * (newWidth / originalWidth);
              const centerY = (upperLeft.y + lowerRight.y) / 2;
              newUpperLeft = new SheetPosition(params.to.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(lowerRight.x, centerY + newHeight / 2);
            }
            break;
          case 'right':
            newLowerRight = new SheetPosition(params.to.x, lowerRight.y);
            if (params.shiftHeld || params.linkDimensions) {
              const delta = params.to.x - lowerRight.x;
              const newWidth = originalWidth + delta;
              const newHeight = originalHeight * (newWidth / originalWidth);
              const centerY = (upperLeft.y + lowerRight.y) / 2;
              newUpperLeft = new SheetPosition(upperLeft.x, centerY - newHeight / 2);
              newLowerRight = new SheetPosition(params.to.x, centerY + newHeight / 2);
            }
            break;
        }
      }
    }

    const ul = new SheetPosition(
      Math.min(newUpperLeft.x, newLowerRight.x),
      Math.min(newUpperLeft.y, newLowerRight.y),
    );
    const lr = new SheetPosition(
      Math.max(newUpperLeft.x, newLowerRight.x),
      Math.max(newUpperLeft.y, newLowerRight.y),
    );
    if (ul.x !== lr.x && ul.y !== lr.y) {
      return { position: ul, width: lr.x - ul.x, height: lr.y - ul.y };
    }
    return null;
  }
}
