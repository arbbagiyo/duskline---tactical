// Duskline Yard: an original dusk-lit freight yard, built only from three.js
// primitives. Three lanes run south (Vanguard) to north (Sentinels): Canal
// along the water on the west, Stacks through the containers on the east, and
// the Overpass catwalk down the middle. Site A "Depot" sits west, site B
// "Crane" sits east. Every solid is both a bullet stop and a collider; decor
// that must not block movement is marked visual-only. The waypoint graph at
// the end is what the bots pathfind over; bots never see the mesh list.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 5;

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'steel' ? 0.55 : 0.9,
      metalness: name === 'steel' || name === 'rust' ? 0.35 : 0.04,
    });
  }
  mats.water.roughness = 0.25;
  mats.water.metalness = 0.6;

  const colliders = [];
  const shootables = [];
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  function solid(w, h, d, x, y, z, mat, collide = true, shoot = true, rotY = 0) {
    const mesh = new THREE.Mesh(boxGeo, mats[mat]);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    mesh.updateMatrixWorld(true);
    if (collide) colliders.push(new THREE.Box3().setFromObject(mesh));
    if (shoot) shootables.push(mesh);
    return mesh;
  }
  function cyl(r, h, x, y, z, mat, seg = 12) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    mesh.updateMatrixWorld(true);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter. The yard floor is one slab; the canal strip is a
  // shallow water plane along the west wall with plank bridges over it.
  solid(66, 0.4, 50, 0, -0.2, 0, 'ground');
  solid(0.6, WALL_H, 50, -32.3, WALL_H / 2, 0, 'steel');
  solid(0.6, WALL_H, 50, 32.3, WALL_H / 2, 0, 'steel');
  solid(66, WALL_H, 0.6, 0, WALL_H / 2, -24.3, 'steel');
  solid(66, WALL_H, 0.6, 0, WALL_H / 2, 24.3, 'steel');
  solid(4.5, 0.06, 44, -29.4, 0.03, 0, 'water', false, false);
  solid(5.4, 0.18, 2.2, -29.2, 0.09, 10, 'crate', false, false);
  solid(5.4, 0.18, 2.2, -29.2, 0.09, -8, 'crate', false, false);

  // Distant yard silhouettes outside the walls, for depth through the fog.
  const skyline = [[-40, -30, 10, 14], [-18, -34, 14, 10], [8, -36, 12, 18], [30, -32, 10, 12], [42, -8, 12, 16], [42, 14, 10, 10], [-42, 8, 12, 14]];
  for (const [x, z, w, h] of skyline) solid(w, h, w, x, h / 2 - 0.5, z, 'sky', false, false);

  // --- Site A "Depot": a three-walled shed, open to the east, ringed ground.
  solid(0.5, 3.6, 9, -28.5, 1.8, -16, 'rust');
  solid(9, 3.6, 0.5, -24, 1.8, -20.5, 'rust');
  solid(9, 0.3, 9.5, -24, 3.7, -16, 'steel', false, true);
  solid(2.2, 1.1, 1.2, -22.5, 0.55, -13.5, 'crate');
  solid(1.2, 1.1, 1.2, -26, 0.55, -14, 'crate');
  solid(1.2, 2.2, 1.2, -26, 1.65, -14, 'crate');
  cyl(0.55, 1.25, -21.5, 0.62, -18.5, 'rust');
  cyl(0.55, 1.25, -27.5, 0.62, -18.8, 'teal');

  // --- Site B "Crane": a tower crane over an open pad with container cover.
  solid(1.4, 11, 1.4, 28, 5.5, -19, 'steel');
  solid(13, 0.8, 1.1, 24, 10.6, -19, 'accent', false, true);
  solid(0.12, 4.5, 0.12, 20.5, 8.2, -19, 'steel', false, false);
  solid(0.7, 0.7, 0.7, 20.5, 5.7, -19, 'rust', false, false);
  solid(6, 2.6, 2.4, 26.5, 1.3, -13.5, 'teal', true, true, 0.12);
  solid(1.2, 1.1, 1.2, 21.5, 0.55, -15, 'crate');
  solid(2.4, 1.1, 1.2, 23, 0.55, -18.5, 'sand');
  cyl(0.55, 1.25, 27.5, 0.62, -17.5, 'rust');

  // --- Canal lane (west): low walls, crates and a pipe run to break sightlines.
  solid(0.5, 1.15, 7, -20, 0.57, 8, 'sand');
  solid(1.2, 1.1, 1.2, -24, 0.55, 2, 'crate');
  solid(1.2, 1.1, 1.2, -24, 0.55, 3.4, 'crate');
  solid(2.6, 1.1, 1.2, -18.5, 0.55, -4, 'crate');
  solid(0.7, 0.7, 12, -16.5, 2.9, -2, 'steel', false, true);
  solid(0.5, 1.15, 6, -21, 0.57, -9, 'sand');
  cyl(0.55, 1.25, -17.5, 0.62, 13, 'teal');

  // --- Stacks lane (east): stacked containers with gaps to slip through.
  solid(6, 2.6, 2.4, 20, 1.3, 8, 'rust', true, true, -0.06);
  solid(6, 2.6, 2.4, 20, 3.9, 8, 'teal', true, true, -0.06);
  solid(2.4, 2.6, 6, 15, 1.3, 0, 'teal');
  solid(1.2, 1.1, 1.2, 24, 0.55, 1, 'crate');
  solid(1.2, 1.1, 1.2, 24, 0.55, -0.4, 'crate');
  solid(2.6, 1.1, 1.2, 18, 0.55, -7, 'crate');
  solid(0.5, 1.15, 6, 21, 0.57, -10, 'sand');
  cyl(0.55, 1.25, 16.5, 0.62, 13.5, 'rust');

  // --- Middle / Overpass: a catwalk bridge over the centre, pillars as cover,
  // and a container cross that splits mid into two short sightlines.
  solid(19, 0.35, 3, 0, 3.35, 0, 'steel', true, true);
  solid(0.25, 1.0, 3, -9.4, 4.0, 0, 'steel', false, true);
  solid(0.25, 1.0, 3, 9.4, 4.0, 0, 'steel', false, true);
  solid(0.6, 3.2, 0.6, -8.5, 1.6, -1.2, 'steel');
  solid(0.6, 3.2, 0.6, -8.5, 1.6, 1.2, 'steel');
  solid(0.6, 3.2, 0.6, 8.5, 1.6, -1.2, 'steel');
  solid(0.6, 3.2, 0.6, 8.5, 1.6, 1.2, 'steel');
  solid(6, 2.6, 2.4, -3, 1.3, 5.5, 'teal', true, true, 0.05);
  solid(2.4, 2.6, 5, 4, 1.3, -5.5, 'rust');
  solid(1.2, 1.1, 1.2, -6, 0.55, -6, 'crate');
  solid(2.4, 1.1, 1.2, 6.5, 0.55, 6, 'sand');
  solid(0.5, 1.15, 5, 0, 0.57, -11, 'sand');
  cyl(0.55, 1.25, -11, 0.62, 9, 'teal');
  cyl(0.55, 1.25, 11.5, 0.62, -9.5, 'rust');

  // Spawn cover: low crates each team starts behind.
  solid(2.4, 1.1, 1.2, -4, 0.55, 19, 'crate');
  solid(2.4, 1.1, 1.2, 4, 0.55, 19, 'crate');
  solid(2.4, 1.1, 1.2, -4, 0.55, -19, 'crate');
  solid(2.4, 1.1, 1.2, 4, 0.55, -19, 'crate');

  // Site markers: glowing ground rings and a letter beacon each.
  const rings = {};
  for (const [key, cx, cz] of [['A', -24, -16], ['B', 24, -16]]) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 3.9, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(cx, 0.06, cz);
    group.add(ring);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.9, 7, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    );
    beacon.position.set(cx, 3.5, cz);
    group.add(beacon);
    rings[key] = ring;
  }

  // Lighting: violet hemisphere, one low amber sun with shadows, three lamps.
  scene.add(new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.ground), 1.15));
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.horizon), 2.4);
  sun.position.set(-26, 18, 26);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.sky), 0.5);
  fill.position.set(20, 14, -18);
  scene.add(fill);
  for (const [x, z] of [[-24, -13], [24, -13], [0, 3]]) {
    solid(0.18, 4.6, 0.18, x, 2.3, z, 'steel');
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.ink) }));
    head.position.set(x, 4.7, z);
    group.add(head);
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 22, 15, 1.8);
    lamp.position.set(x, 4.5, z);
    scene.add(lamp);
  }

  return {
    colliders,
    shootables,
    group,
    rings,
    sites: {
      A: { key: 'A', name: 'Depot', cx: -24, cz: -16, hw: 5.5, hd: 4.5 },
      B: { key: 'B', name: 'Crane', cx: 24, cz: -16, hw: 5.5, hd: 4.5 },
    },
    spawns: {
      van: [[-2, 21], [2, 21], [0, 19]],
      sent: [[-3, -21], [3, -21], [0, -19.5]],
    },
    // Waypoint graph: [x, z, links]. Bots BFS over this, never through walls.
    waypoints: [
      [0, 20, [1, 6, 11]], [0, 12, [0, 2, 6, 11]], [0, 4, [1, 3, 4, 5]],
      [0, -6, [2, 10, 15, 19]], [-8, 0, [2, 7, 6]], [8, 0, [2, 12, 11]],
      [-20, 14, [0, 1, 4, 7]], [-22, 4, [6, 4, 8]], [-22, -8, [7, 9, 10]],
      [-24, -16, [8, 17]], [-14, -12, [3, 8, 17]], [20, 14, [0, 1, 5, 12]],
      [22, 4, [11, 5, 13]], [22, -8, [12, 14, 15]], [24, -16, [13, 18]],
      [14, -12, [3, 13, 18]], [0, -20, [19, 17, 18]], [-18, -18, [9, 10, 16]],
      [18, -18, [14, 15, 16]], [0, -10, [3, 16]],
    ],
  };
}
