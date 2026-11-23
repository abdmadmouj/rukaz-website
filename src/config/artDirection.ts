/**
 * Every number that shapes the sculpture lives here.
 *
 * Units: metres for sizes and positions, degrees for angles, seconds for time.
 * The 93 plates are created once (by the hero ribbon) and only move; every other form
 * adapts to the plate count.
 */
export type MaterialKey = 'forest' | 'teal' | 'jade' | 'mist' | 'ivory';

export interface MaterialSpec {
  color: string;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** strength of the frosted clouds and hairline crackle */
  marble: number;
  marbleScale: number;
  /** light from inside the plate (sub-surface glow) */
  glow: number;
  glowColor: string;
  translucency: number;
  transmission: number;
  thickness: number;
  attenuationColor: string;
  attenuationDistance: number;
}

export type Breakpoint = 'wide' | 'tablet' | 'mobile';
export interface CameraSpec {
  pos: [number, number, number];
  target: [number, number, number];
  fov: number;
  /** moves the image without changing perspective, as a fraction of the viewport */
  shift: [number, number];
}

export const artDirection = {
  plate: { cornerSegments: 8, bevelSegments: 4, faceRadius: 0.16, bevel: 0.045 },

  materials: {
    /** Obsidian: polished dark stone, the ground colour */
    forest: { color: '#0C1C18', roughness: 0.36, clearcoat: 0.55, clearcoatRoughness: 0.18, marble: 0.22, marbleScale: 2, glow: 0, glowColor: '#123a31', translucency: 0, transmission: 0, thickness: 0, attenuationColor: '#ffffff', attenuationDistance: 0 },
    /** Deep Emerald: dense green glass, the depth colour */
    teal: { color: '#0F5747', roughness: 0.22, clearcoat: 0.9, clearcoatRoughness: 0.08, marble: 0.45, marbleScale: 1.8, glow: 0.5, glowColor: '#1BA97D', translucency: 0.6, transmission: 0.5, thickness: 1.2, attenuationColor: '#0D4F42', attenuationDistance: 0.9 },
    /** Glass Emerald: the one bright accent, used sparingly */
    jade: { color: '#1BA97D', roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.06, marble: 0.4, marbleScale: 1.7, glow: 1.2, glowColor: '#62E8B8', translucency: 0.9, transmission: 0.55, thickness: 1, attenuationColor: '#15946C', attenuationDistance: 1 },
    /** Glass Mist: frosted grey-green glass */
    mist: { color: '#B8C8C5', roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.06, marble: 0.6, marbleScale: 1.6, glow: 0.6, glowColor: '#D4E6E0', translucency: 0.75, transmission: 0.66, thickness: 1, attenuationColor: '#8FA9A3', attenuationDistance: 1.4 },
    /** Ivory: the paper colour, as pale frosted glass */
    ivory: { color: '#ECEFEC', roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, marble: 0.5, marbleScale: 1.5, glow: 0.75, glowColor: '#F2FFF8', translucency: 0.9, transmission: 0.7, thickness: 1, attenuationColor: '#CFD8D2', attenuationDistance: 2 },
  } satisfies Record<MaterialKey, MaterialSpec>,

  /** relative weight per finish: dark stone is heavier and moves a little slower */
  mass: { forest: 1.6, teal: 1, jade: 0.9, mist: 1, ivory: 0.95 } satisfies Record<MaterialKey, number>,

  /** A dark room. Sharp edges, soft light: one cool key from above, and light from beneath. */
  lighting: {
    exposure: 1.05,
    environmentIntensity: 0.6,
    /** direction towards the key light (world): falls from the top right and behind */
    keyDirection: [0.75, 1, -0.55] as [number, number, number],
    keyColor: '#EEF6F2',
    keyIntensity: 2.4,
    fillColor: '#B8C8C5',
    fillIntensity: 0.18,
    hemiSky: '#15241F',
    hemiGround: '#0D4F42',
    hemiIntensity: 0.55,
    /** light from beneath: a low emerald source in front of the sculpture, rising */
    underColor: '#1BA97D',
    underIntensity: 0.9,
    /** studio environment baked into reflections */
    env: { top: '#1A2924', mid: '#0B1714', bottom: '#06100D', key: 2.6, strip: 1.4, bounce: '#1BA97D', bounceLevel: 0.55 },
  },

  floor: {
    backdropTop: '#071411',
    backdropHorizon: '#0A1C18',
    near: '#0C1E1A',
    far: '#091814',
    /** world distance over which the floor dissolves into the backdrop */
    fadeStart: 18,
    fadeEnd: 46,
    reflectionStrength: 0.62,
    reflectionBlur: 0.008,
    shadowStrength: 0.55,
    shadowSoftness: 0.55,
    aoStrength: 0.6,
    aoRadius: 0.38,
    /** light passing through the glass pools on the floor in Glass Emerald */
    glowColor: '#1BA97D',
    glowStrength: 0.34,
    /** world rectangle covered by the shadow and glow map [minX, minZ, maxX, maxZ] */
    region: [-32, -28, 32, 28] as [number, number, number, number],
    mapResolution: 640,
  },

  /** the ground and sky for each theme: dark is the brand's night studio, light a pale day studio */
  themes: {
    dark: { backdropTop: '#071411', backdropHorizon: '#0A1C18', near: '#0C1E1A', far: '#091814', glowStrength: 0.34, shadowStrength: 0.55, exposure: 1 },
    light: { backdropTop: '#F3F6F3', backdropHorizon: '#E6ECE8', near: '#E9EEEA', far: '#E3E9E5', glowStrength: 0.16, shadowStrength: 0.42, exposure: 1.12 },
  },

  /** The hero: every plate side by side in one centred row, facing you, curving gently away at the ends. */
  ribbon: {
    seed: 7,
    count: 93,
    thickness: [0.34, 0.24, 0.4, 0.28, 0.3, 0.22, 0.36, 0.26],
    gap: 0.2,
    /** height at the ends and at the middle, and how wide the middle swell is (m) */
    height: [1.2, 1.6] as [number, number],
    swell: 6,
    length: 3.2,
    /** how far the row bends away from you: z = -curve * x^2 */
    curve: 0.011,
    /** Deep Emerald most, then Obsidian, Mist, Ivory; Glass Emerald about 1 in 12 */
    mats: ['teal', 'mist', 'forest', 'teal', 'ivory', 'forest', 'teal', 'jade', 'forest', 'mist', 'teal', 'ivory', 'forest', 'teal', 'mist', 'forest', 'teal', 'ivory', 'jade', 'forest', 'teal', 'mist', 'forest', 'ivory'] as MaterialKey[],
  },

  /** Who we work with: a layered sphere parted along a channel into two halves. */
  /** the globe (who we work with) turns on its axis: `turn` degrees a second, about 26 s a turn */
  halves: { center: [0, 2.6, 0] as [number, number, number], radius: 2.2, bands: 8, fill: 0.84, thickness: 0.12, channel: 0.42, open: 7, spin: 3, turn: 14 },

  /**
   * Ways to work with us: the core sample. A column of glass slats in three layers,
   * loose at the top (Advise), woven in the middle (Operate), dense at the base (Commit).
   * Listed base first.
   */
  core: {
    center: [0, 0, 0] as [number, number, number],
    radius: 1.3,
    slat: 0.1,
    layerGap: 0.36,
    layers: [
      { name: 'commit', rings: 2, perRing: 22, height: 0.82, fill: 0.92, lift: 0 },
      { name: 'operate', rings: 2, perRing: 14, height: 0.74, fill: 0.62, lift: 0.08 },
      { name: 'advise', rings: 3, perRing: 7, height: 0.42, fill: 0.5, lift: 0.18 },
    ],
    /** how far the active layer rises, and the slow turn while held (degrees per second) */
    highlightLift: 0.22,
    spin: 4,
  },

  /** How it moves: four gates in a row; a stream of plates rises gate by gate. */
  gates: {
    xs: [-6.9, -2.3, 2.3, 6.9],
    width: 2.5,
    height: 3.1,
    post: { t: 0.2, l: 0.56, pieces: 3 },
    lintel: { t: 0.2, h: 0.5, pieces: 3 },
    stream: { from: -9.6, to: 9.6, t: 0.12, h: 0.78, l: 0.46 },
  },

  /** Proof: six rising bars of standing glass fins, each taller than the last. */
  column: { center: [0, 0, 0] as [number, number, number], counts: [12, 13, 15, 16, 18, 19], heights: [0.8, 3.8] as [number, number], barGap: 1.6, pitch: 0.26, fin: { t: 0.08, l: 1.1 }, spin: 0 },

  /** Terms: every plate laid out in an ordered grid. Nothing hidden. */
  ledger: { center: [0, 0, 0] as [number, number, number], cols: 8, tile: { t: 0.08, w: 0.66, d: 0.44 }, gap: 0.12 },

  /** Start here: the RUKAZ mark, built from horizontal glass bars split by its channel. */
  mark: { center: [0, 0, 0] as [number, number, number], height: 5.7, base: 0.32, depth: 0.32, fill: 0.74, minLength: 0.16 },

  /**
   * Framing. Hand-placed cameras for the hero and the closing view (the composed
   * reference shots); every other form is framed automatically into its area of the
   * screen, so nothing sits small in an empty frame and nothing is cropped.
   */
  cameras: {
    hero: {
      wide: { pos: [0, 2.7, 15], target: [0, 1.2, 0], fov: 32, shift: [0, 0.22] },
      tablet: { pos: [0, 2.6, 14], target: [0, 1.25, 0], fov: 36, shift: [0, 0.12] },
      mobile: { pos: [0, 2.8, 15], target: [0, 1.2, 0], fov: 40, shift: [0, 0.36] },
    },
    connect: {
      wide: { pos: [0, 6, 16.5], target: [0, 0.6, -2], fov: 30, shift: [0, 0.12] },
      tablet: { pos: [0, 6.5, 18], target: [0, 0.6, -2], fov: 34, shift: [0, 0.04] },
      mobile: { pos: [0, 7, 19], target: [0, 0.6, -2], fov: 40, shift: [0, 0.28] },
    },
  } satisfies Record<string, Record<Breakpoint, CameraSpec>>,

  framing: {
    fov: { wide: 30, tablet: 34, mobile: 40 } satisfies Record<Breakpoint, number>,
    /** where the form sits, as viewport fractions [x0, x1, y0, y1] (y from the top): centred in the
     *  upper half, so the words below never lie on the plates */
    area: {
      wide: [0.16, 0.84, 0.08, 0.53],
      tablet: [0.08, 0.92, 0.1, 0.46],
      mobile: [0.04, 0.96, 0.1, 0.44],
    } satisfies Record<Breakpoint, [number, number, number, number]>,
    /** share of the area the form fills */
    fill: 0.86,
    /** direction from the form to the camera, per form: [azimuth, elevation] in degrees */
    view: {
      who: [0, 10],
      ways: [8, 9],
      gate: [-34, 13],
      proof: [34, 12],
      terms: [0, 52],
      contact: [0, 4],
    } as Record<string, [number, number]>,
  },

  designAspect: { wide: 1.7768331562167907, tablet: 0.6949152542372882, mobile: 0.46208530805687204 } satisfies Record<Breakpoint, number>,

  /**
   * Transitions play three beats: release (plates lift off the old form along their faces),
   * travel (a wave in reading order, each on its own arc and lane), settle (physics).
   */
  choreography: {
    /** share of a transition over which departures are spread (small: the plates move as one) */
    stagger: 0.14,
    /** how far plates lift off the form before travelling (m) */
    release: 0,
    /** how high the whole flight rises at its middle (m) */
    arc: 0.5,
    /** sideways lanes (m): off, the matched paths already keep clear */
    lanes: 0,
    stageSmoothing: 0.42,
  },


  pointer: {
    radius: 0.11,
    lift: 0.16,
    push: 0.16,
    tilt: 7,
    stiffness: 9,
    /** how close the pointer must be (0..1 of the crest) for a plate to ring, and the most
     *  plates one quick sweep may ring in turn */
    touchThreshold: 0.5,
    strumMax: 8,
    fan: { radius: 0.15, lift: 0.45, lean: 30, roll: 0, yaw: 0, grow: 0.08 },
  },

  /** physics (see src/scene/physics/plateWorld.ts for what each value does) */
  physics: { stiffness: 46, angularStiffness: 64, dampingRatio: 0.92, restitution: 0.08, friction: 0.35, shrinkAfter: 0.6 },
  /** the physics runs this much faster than the clock, so each form is built within about two
   *  seconds of stopping on a section (same contacts and checks, just quicker) */
  physicsSpeed: 1.8,
};

export type ArtDirection = typeof artDirection;
