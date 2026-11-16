// The single state module. Every mutable fact about the match lives on G and
// nowhere else, so rounds, bots, HUD and shots all read the same truth. Other
// modules own meshes and behaviour; they never keep a second copy of a score,
// a timer or the bomb. All randomness flows through G.rng, seeded from ?seed=,
// which is what makes screenshot frames deterministic.
export const ROUND_TIME = 100;
export const BUY_TIME = 10;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5;
export const BOMB_FUSE = 35;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 1400;
export const LOSS_REWARD = 800;
export const MAX_MONEY = 8000;
export const MATCH_WINS = 5;

export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const G = {
  seed: 1,
  rng: mulberry32(1),
  // phase: 'menu' | 'buy' | 'live' | 'ended' | 'match'
  phase: 'menu',
  time: 0,
  round: 1,
  scoreV: 0,
  scoreS: 0,
  money: START_MONEY,
  timer: ROUND_TIME,
  buyLeft: BUY_TIME,
  endLeft: 0,
  endText: '',
  winner: null,
  bomb: {
    state: 'carried', // 'carried' | 'dropped' | 'planted' | 'gone'
    site: null, // 'A' | 'B'
    carrier: 'player', // 'player' | 'mate' | null
    pos: { x: 0, y: 0, z: 0 },
    fuse: BOMB_FUSE,
    plant: 0,
    defuse: 0,
  },
  heard: { x: 0, z: 0, t: -99, loud: 0 },
  feed: [], // {text, t, good} newest last, HUD trims
  smokes: [], // live smoke clouds {x, z, radius, left}
  shot: null,
  frozen: false,
  started: false,
  kills: 0,
  deaths: 0,
};

export function resetMatch() {
  G.round = 1;
  G.scoreV = 0;
  G.scoreS = 0;
  G.money = START_MONEY;
  G.kills = 0;
  G.deaths = 0;
  G.feed.length = 0;
  G.winner = null;
}

export function resetBomb() {
  G.bomb.state = 'carried';
  G.bomb.site = null;
  G.bomb.carrier = 'player';
  G.bomb.fuse = BOMB_FUSE;
  G.bomb.plant = 0;
  G.bomb.defuse = 0;
}

export function announce(text, good) {
  G.feed.push({ text, t: G.time, good: !!good });
  if (G.feed.length > 6) G.feed.shift();
}

export function hear(x, z, loud) {
  G.heard.x = x;
  G.heard.z = z;
  G.heard.t = G.time;
  G.heard.loud = loud;
}
