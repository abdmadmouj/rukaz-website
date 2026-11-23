/**
 * Sound design. Off by default; everything is synthesised (no files, nothing streamed).
 *
 * The voice is glass stones: a plate the pointer reaches makes a short clink, like polished
 * glass pebbles knocking; the dark obsidian plates answer with a drier stone tap. A quick
 * sweep along the row rings each plate passed over, in turn. Scrolling is silent.
 * Under it, a very quiet pad follows the chapter in view.
 */
export type ChapterKey = 'hero' | 'who' | 'ways' | 'process' | 'proof' | 'terms' | 'contact' | 'connect';

export const soundDesign = {
  levels: { master: 0.9, ambient: 0.035, fx: 0.5 },
  /** pad chord per chapter, MIDI notes low to high, in A minor */
  chords: {
    hero: [45, 52, 57, 60],
    who: [41, 48, 57, 64],
    ways: [50, 53, 57, 64],
    process: [40, 52, 57, 59],
    proof: [41, 48, 53, 60],
    terms: [43, 50, 55, 62],
    contact: [43, 48, 55, 64],
    connect: [45, 52, 57, 60],
  } satisfies Record<ChapterKey, number[]>,
  pad: { cutoff: 820, breathHz: 0.05, breathDepth: 260, glide: 0.9, spread: [-0.5, -0.16, 0.16, 0.5], sub: 0.14 },
  air: { centre: 1800, level: 0.04 },
  tones: {
    /** seed for the variant generator, so the set of sounds is the same on every visit */
    seed: 23,
    glass: {
      variants: 14,
      pitch: [1500, 3900] as [number, number],
      /** mode ratios of a small glass body (inharmonic, so it rings like glass, not a bell) */
      ratios: [1, 2.32, 4.25, 6.63],
      levels: [1, 0.5, 0.26, 0.12],
      jitter: 0.04,
      decay: [0.35, 0.9] as [number, number],
      click: 0.35,
      double: 0.35,
    },
    stone: {
      variants: 6,
      pitch: [700, 1500] as [number, number],
      ratios: [1, 1.72, 2.93, 4.41],
      levels: [1, 0.6, 0.35, 0.18],
      jitter: 0.08,
      decay: [0.06, 0.16] as [number, number],
      click: 0.7,
      double: 0.25,
    },
    /** random re-pitch per touch, as a fraction (0.06 = ±6%) */
    detune: 0.06,
    gain: 0.25,
    /**
     * keeps busy moments clean: a plate can't re-trigger within `cooldown`; sounds closer
     * than `minGap` or beyond `perSecond` are dropped (never queued); dense passages get
     * softer; past `voices` the oldest sound is faded out and stopped
     */
    limit: { cooldown: 0.25, minGap: 0.03, perSecond: 18, densitySoftening: 0.1, voices: 8 },
  },
  swell: { level: 0.02 },
  reverb: { seconds: 2.2, decay: 0.6, wet: 0.3, ambientSend: 0.5, fxSend: 0.32 },
};
