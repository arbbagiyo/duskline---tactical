# duskline-tactical

[![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/c/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/arbbagiyo/duskline---tactical/rank.svg)](https://make.fun/c/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/arbbagiyo/duskline---tactical/reward.svg)](https://make.fun/c/threejs-fps-02)

DUSKLINE is a round-based tactical first-person shooter built on three.js, set in Duskline Yard — a dusk-lit freight yard with three lanes (Canal, Stacks, and the Overpass), two bomb sites (Depot and Crane), and a low amber sun over violet fog.

You play a Vanguard attacker with one bot teammate against three Sentinel defenders. Plant the charge at a site and defend it until it detonates, or eliminate the other team. Every round earns money for the buy menu: the VK-7 rifle, the K-9 SMG, frag and smoke grenades. Gunplay rewards stopping to aim — recoil and spread grow when you fire on the move or spray, headshots pay a damage bonus, and bots patrol waypoints, hold sites, and react to what they see and hear.

Everything is procedural: geometry from three.js primitives, sound from WebAudio oscillators, no external assets and no network requests.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome.

Controls: WASD move, mouse look, click fire, R reload, Ctrl crouch, Space jump, hold E to plant the charge, B for the buy menu, 1/2/3/4 to switch weapons and grenades.

## Layout

- `game/` — the game: `index.html` plus ES modules under `game/src/` (state, world, player, weapons, bots, grenades, rounds, HUD, audio, input, palette, shots), with three.js 0.187.0 vendored under `game/vendor/three/`.
- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to the output directory and writes `dossier.json`.
- `serve.ts` — a tiny static server for local play.
- `shots.json` — the four deterministic screenshot URLs (`?shot=start|play|site|end&seed=1`).

Built for the [make.fun](https://make.fun/?ref=&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) bounty "Make the best three.js tactical FPS".
