// 4th‑order Butterworth low‑pass (two biquads).
// Robust roll‑off for isolating low‑frequency content like heart sounds.
type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };
type BiquadState = { x1: number; x2: number; y1: number; y2: number };

export type LowpassOptions = {
  order?: 2 | 4;
  state?: BiquadState[];
};

function designLowpassBiquad(sampleRate: number, cutoffHz: number, q: number): Biquad {
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = sinw0 / (2 * q);

  const b0 = (1 - cosw0) / 2;
  const b1 = 1 - cosw0;
  const b2 = (1 - cosw0) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw0;
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function processBiquad(
  input: Float32Array,
  coeffs: Biquad,
  state: BiquadState
): Float32Array {
  const y = new Float32Array(input.length);

  let x1 = state.x1;
  let x2 = state.x2;
  let y1 = state.y1;
  let y2 = state.y2;

  const { b0, b1, b2, a1, a2 } = coeffs;

  for (let i = 0; i < input.length; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    y[i] = y0;

    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  state.x1 = x1;
  state.x2 = x2;
  state.y1 = y1;
  state.y2 = y2;

  return y;
}

export function lowpass1p(
  x: Float32Array,
  sampleRate: number,
  cutoffHz: number,
  prevY: number | LowpassOptions = 0
): { y: Float32Array; lastY: number; state: BiquadState[] } {
  const y = new Float32Array(x.length);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || x.length === 0) {
    return { y, lastY: 0, state: [] };
  }

  const opts: LowpassOptions = typeof prevY === "number" ? {} : prevY ?? {};
  const order = opts.order ?? 4;

  // clamp cutoff to safe range
  const nyquist = sampleRate / 2;
  const fc = Math.max(1, Math.min(cutoffHz, nyquist * 0.99));

  // Butterworth Q values per biquad section
  const qs = order === 2 ? [0.70710678] : [0.5411961, 1.306563];
  const sections = qs.map((q) => designLowpassBiquad(sampleRate, fc, q));

  const seed =
    typeof prevY === "number" && Number.isFinite(prevY) ? prevY : 0;
  const state =
    opts.state && opts.state.length === sections.length
      ? opts.state
      : sections.map(() => ({ x1: seed, x2: seed, y1: seed, y2: seed }));

  let temp = x;
  for (let i = 0; i < sections.length; i++) {
    temp = processBiquad(temp, sections[i], state[i]);
  }

  y.set(temp);

  return { y, lastY: y.length > 0 ? y[y.length - 1] : seed, state };
}
