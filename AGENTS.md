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
Cad2d ix a next.js application which renders cad elements using pixi.js via @pixi/react.
