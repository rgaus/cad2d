# Cad2d (working name)

A web based, 2d CAD application for mechanical drawing. It aims to fully replicate the set of
functionality available in autodesk fusion 360's sketch mode / the sketch mode within solidworks.

**Drawing Tools**

- Polygon tool with freehand vertex placement, arc drawing (quadratic and cubic bezier), and live dimension lines during creation
- Rectangle and ellipse tools with working constraints shown during placement
- Shift and alt modifier support for square/circle modes and center-origin placement

**Selection & Manipulation**

- Click-to-select with a bounding box overlay around selected geometry
- Drag-to-select with a rubber-band marquee
- Corner and edge resize handles on selected geometry, with group resize preserving aspect ratio
- Alt-drag to duplicate selected shapes; hold ctrl to disable snapping while dragging

**Editing Tools**

- Trim/split: click a segment to split it, splitting overlapping polygons into separate offcuts
- Fillet: click a corner to round it with a configurable arc radius
- Chamfer: click a corner to bevel it by a fixed distance
- All three editing tools are combined into a single geometry-edit multitool

**Constraints**

- Linear constraints with editable length inputs, supporting both absolute and driven dimensions
- Perpendicular, parallel, horizontal, vertical, and colinear constraints
- Angle constraints with ray-based constraint tracks
- Constraint endpoints can lock to key points or other constraint endpoints; datum points auto-create when needed
- Gradient-descent constraint solver that re-solves after edits, with conflict detection and rendering
- Constrained track movement limits geometry to valid positions when constraints are attached

**Serialization**

- Save and load documents in an SVG-superset format that preserves all geometry, constraints, and metadata
- Copy and paste geometry with automatic ID remapping and constraint re-binding

**Actions**

- Undo/redo with full transaction support, grouping multi-step operations into single undo entries
- Boolean operations: union, difference, and intersection of selected shapes
- Flip horizontal and vertical, delete selected, select all
- Render order controls with bring-forward/send-backward actions

**Snapping**

- Grid snapping aligned to the sheet coordinate system, with a minimum grid size floor at high zoom
- Angular snap at 15-degree increments for constraint tracks and polygon edges
- Key point snapping to vertices, edge midpoints, and shape centers

**Units & Display**

- Length units: millimeters, centimeters, meters, inches, and feet with fractional-inch formatting (e.g. 5' 1")
- Angle units: degrees and radians
- Configurable significant figures for displayed measurements

**Navigation & Viewport**

- Pan, zoom, and pinch-to-zoom with bounded zoom limits
- Customizable sheet with width, height, and unit presets; fit-to-viewport action
- Cartesian grid with adaptive line density and configurable snap intervals


## Development

This is currently a next.js app. To get started, run `npm install` and then `npm run dev`.

Open [http://localhost:3000](http://localhost:3000) with your browser to see the app and make
changes for it to live reload.
