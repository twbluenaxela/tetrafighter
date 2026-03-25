# TetraFighter

A 3D browser game where tetromino-shaped fighters battle. Defeat enemies to collect their shapes and build art sculptures.

## How to Play

### Controls
- **WASD** - Move
- **Shift** - Sprint
- **Mouse** - Look around (click to capture mouse)
- **Q/E** - Rotate your tetromino body (this is your main attack!)

### Gameplay
- You control a blue team fighter. Your tetromino "head" shape is your weapon.
- **Rotate into enemies** (Q/E) to physically push and spin them with your blocks.
- When your blocks connect with an enemy's blocks (3+ adjacent faces), one fighter captures the other.
- The winner is determined by surface contact area, with momentum as a tiebreaker.
- Captured shapes get added to your team's art sculpture on the sideline.
- After 2 minutes, the team with the most collected shapes wins.
- Reinforcements spawn every 10 seconds (up to 8 per team).

### Tips
- Use rotation sweeps to push enemies into bad positions before connecting.
- If two fighters swing into each other, the forces partially cancel — timing matters.
- The player fighter has 4x mass, so you're harder to push around.
- You can counter-rotate within 150ms of a connection to break free.

## Installation

No build step required. This is a static site using ES modules.

### Option 1: Any static file server
```bash
# Python
python3 -m http.server 8000

# Node.js (npx)
npx serve .

# PHP
php -S localhost:8000
```

Then open `http://localhost:8000` in your browser.

### Option 2: Open directly
Some browsers allow opening `index.html` directly, but module imports may be blocked by CORS. A local server is recommended.

### Requirements
- Modern browser with ES module and WebAssembly support (Chrome, Firefox, Edge, Safari)
- No dependencies to install — Three.js and Rapier physics are loaded from CDN

## Tech Stack
- **Three.js** — 3D rendering
- **Rapier3D** — WASM physics engine (collision, forces, angular momentum)
- **Web Audio API** — Sound effects
- Vanilla JavaScript, no build tools
