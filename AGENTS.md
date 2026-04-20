@~/.config/opencode/AGENTS.md

## Overview
Cad2d (working name) is a 2d cad application which makes casual mechanical drawing easy. Important
design principals:
- Cad2d is a progressive web application. It should work just as well offline as online.
- Cad2d should be optimized equally well for working on a laptop (target a 14" macbook with full
  screen chrome) or an ipad. So, when thinking through interfaces, both mouse and touch based
  gestures should be considered equally.
- Cad2d is built to be highly decoupled, which makes it highly testable. Wherever possible, build
  complex pieces as classes which take events coming in and events going out, and write extensive
  unit tests verifying that each piece works as expected.

## Architecture
Cad2d is a next.js application which renders cad elements using pixi.js via @pixi/react. All source
code lives under `src/`.

### Directory Structure
```
src/
  app/                    # Next.js App Router pages and components
    components/           # React UI components
    page.tsx              # Root page
  lib/
    viewport/             # Viewport rendering and interaction logic
      types.ts            # Position classes and types
      viewportMath.ts     # Coordinate conversion utilities
      ViewportControls.ts # Core class (event-driven, testable)
  __tests__/               # Unit tests
```

### Core Principles

**Decoupled Core**: Complex logic lives in pure TypeScript classes under `lib/`. These classes:
- Take no React dependencies
- Use EventEmitter for output events (e.g., `cursorChange`)
- Accept input via explicit handler methods (e.g., `handleWheel`, `handleMouseDown`)
- Are fully unit-testable by instantiating them directly and calling methods

**React as a Thin Wrapper**: React components (e.g., `ViewportRenderer2D`) serve as integration
layers that:
- Instantiate core classes
- Attach DOM event listeners and forward them to core handlers
- Subscribe to core events and apply side effects (cursor changes, re-renders)
- Render Pixi elements using state read from core

### Coordinate System

The application uses three distinct position types, each modelled as a class with `toWorld` /
`toViewport` / `toScreen` methods:

- **ScreenPosition**: Represents a position in screen pixels. Origin is top-left of the viewport.
- **ViewportPosition**: Represents a position in the PixiJS viewport coordinate space. Includes
  pan offset and scale - transforms to/from WorldPosition via the current ViewportState.
- **WorldPosition**: Represents a position in world (document) coordinates. This is the canonical
  space for modelling geometry.

All position conversions require a `ViewportState` containing the current viewport `position`
(ViewportPosition) and `scale` (number).

### Testing

Unit tests live in `src/__tests__/` and test core classes in isolation by:
1. Instantiating the class with test config
2. Calling input methods (handler methods)
3. Asserting output state via `getState()` or event emissions

This approach allows testing complex viewport interaction logic without needing a DOM
environment or React rendering. Tests are run via `npm test` (Jest).
