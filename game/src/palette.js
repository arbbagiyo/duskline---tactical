// DUSKLINE palette: one dusk look, defined once. Every 3D material and every
// CSS colour in index.html comes from these names, so the freight yard reads
// as one place: cold violet sky, low amber sun, rust and teal steel.
export const PALETTE = {
  sky: '#2b1d38', // violet dusk sky and fog
  horizon: '#c96a2e', // low sun glow on the horizon
  ground: '#3a3230', // packed yard dirt and asphalt
  steel: '#4a4f57', // girders, crane, catwalk
  rust: '#7a4a28', // weathered metal and barrels
  teal: '#2e6b62', // painted containers
  crate: '#8a6b3d', // wooden crates
  sand: '#9a8a68', // sandbags and dry grass tufts
  ink: '#ece5d8', // HUD text and lamp glass
  muted: '#a89e8e', // secondary HUD text
  accent: '#f2a93b', // amber: prompts, tracers, muzzle light
  ally: '#57c7d4', // Vanguard teammate markings
  enemy: '#e2543e', // Sentinel markings and danger
  water: '#274b5a', // canal strip
};

export const CSS_VARS = Object.entries(PALETTE)
  .map(([name, value]) => `--c-${name}: ${value};`)
  .join('\n');
