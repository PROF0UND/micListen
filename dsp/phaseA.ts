// phaseA.ts
export type DetectionParams = {
  windowMs?: number; // 25
  strideMs?: number; // 10
  heartbeatMinDistMs?: number; // 500
  heartbeatThresholdPct?: number; // 75
  systolicMinMs?: number; // 80
  systolicMaxMs?: number; // 350
  s2ThresholdPct?: number; // 40
};

export type PhaseAResult = {
  frameRate: number;
  envelope: Float32Array;
  s1Frames: number[];
  s2Frames: number[];
  hrBpm: number | null;
};

const DEFAULT_PARAMS: Required<DetectionParams> = {
  windowMs: 25,
  strideMs: 10,
  heartbeatMinDistMs: 500,
  heartbeatThresholdPct: 75,
  systolicMinMs: 80,
  systolicMaxMs: 350,
  s2ThresholdPct: 40,
};

/** Phase A preprocess: mean remove + 99th percentile clip + normalize (no bandpass yet) */
export function preprocessPhaseA(x: Float32Array): Float32Array {
  const y = new Float32Array(x.length);

  // mean remove
  let mean = 0;
  for (let i = 0; i < x.length; i++) mean += x[i];
  mean /= x.length;

  for (let i = 0; i < x.length; i++) y[i] = x[i] - mean;

  // clip at 99th percentile of abs
  const abs = new Float32Array(y.length);
  for (let i = 0; i < y.length; i++) abs[i] = Math.abs(y[i]);
  const thr = percentile(abs, 99);
  const clip = Math.max(thr, 1e-9);

  for (let i = 0; i < y.length; i++) {
    if (y[i] > clip) y[i] = clip;
    else if (y[i] < -clip) y[i] = -clip;
  }

  // normalize by max abs
  let maxAbs = 0;
  for (let i = 0; i < y.length; i++) maxAbs = Math.max(maxAbs, Math.abs(y[i]));
  const scale = maxAbs > 1e-9 ? 1 / maxAbs : 1;
  for (let i = 0; i < y.length; i++) y[i] *= scale;

  return y;
}

/** Shannon energy envelope (ported from Python) */
export function computeShannonEnvelope(
  signal: Float32Array,
  fs: number,
  windowMs: number,
  strideMs: number,
): { envelope: Float32Array; frameRate: number } {
  const windowSize = Math.max(1, Math.floor((windowMs * fs) / 1000));
  const stride = Math.max(1, Math.floor((strideMs * fs) / 1000));
  const frameRate = fs / stride;

  // normalize by max abs
  let maxAbs = 0;
  for (let i = 0; i < signal.length; i++)
    maxAbs = Math.max(maxAbs, Math.abs(signal[i]));
  const normDen = maxAbs + 1e-10;

  // compute Shannon energy per sample: -x^2 * log(x^2 + eps)
  const eps = 1e-10;
  const se = new Float32Array(signal.length);
  for (let i = 0; i < signal.length; i++) {
    const xn = signal[i] / normDen;
    const x2 = xn * xn;
    se[i] = -x2 * Math.log(x2 + eps);
  }

  const nWindows = Math.floor((se.length - windowSize) / stride) + 1;
  if (nWindows <= 0) {
    return { envelope: new Float32Array(0), frameRate };
  }

  const envelope = new Float32Array(nWindows);

  // sliding mean (simple loop; fast enough for Phase A)
  for (let w = 0; w < nWindows; w++) {
    const start = w * stride;
    let sum = 0;
    for (let j = 0; j < windowSize; j++) sum += se[start + j];
    envelope[w] = sum / windowSize;
  }

  return { envelope, frameRate };
}

/** Basic peak finder (similar to scipy.signal.find_peaks for our needs) */
function findPeaks1D(
  y: Float32Array,
  minHeight: number,
  minDistance: number,
): number[] {
  const peaks: number[] = [];
  let lastAccepted = -Infinity;

  for (let i = 1; i < y.length - 1; i++) {
    if (y[i] < minHeight) continue;

    // local maxima
    if (y[i] >= y[i - 1] && y[i] > y[i + 1]) {
      if (i - lastAccepted >= minDistance) {
        peaks.push(i);
        lastAccepted = i;
      } else {
        // if too close, keep the higher one (simple merge)
        const prevIdx = peaks.length - 1;
        if (prevIdx >= 0 && y[i] > y[peaks[prevIdx]]) {
          peaks[prevIdx] = i;
          lastAccepted = i;
        }
      }
    }
  }
  return peaks;
}

/** S1/S2 detection on envelope frames (ported from detect_s1_s2) */
export function detectS1S2Frames(
  envelope: Float32Array,
  frameRate: number,
  params: Required<DetectionParams>,
): { s1Frames: number[]; s2Frames: number[] } {
  if (envelope.length < 10) return { s1Frames: [], s2Frames: [] };

  const heartbeatMinDist = Math.floor(
    (params.heartbeatMinDistMs * frameRate) / 1000,
  );
  const systolicMin = Math.floor((params.systolicMinMs * frameRate) / 1000);
  const systolicMax = Math.floor((params.systolicMaxMs * frameRate) / 1000);

  const heartbeatThreshold = percentile(envelope, params.heartbeatThresholdPct);
  const heartbeats = findPeaks1D(
    envelope,
    heartbeatThreshold,
    heartbeatMinDist,
  );

  if (heartbeats.length < 2) return { s1Frames: [], s2Frames: [] };

  const s2Threshold = percentile(envelope, params.s2ThresholdPct);

  const s1List: number[] = [];
  const s2List: number[] = [];

  for (let i = 0; i < heartbeats.length; i++) {
    const hb = heartbeats[i];
    const windowEnd =
      i < heartbeats.length - 1
        ? heartbeats[i + 1]
        : Math.min(
            hb + Math.floor((1200 * frameRate) / 1000),
            envelope.length - 1,
          );

    // search S1 near hb
    const s1SearchStart = Math.max(0, hb - Math.floor(systolicMin / 2));
    const s1SearchEnd = Math.min(
      hb + Math.floor(systolicMin / 2),
      envelope.length - 1,
    );

    let s1Idx = hb;
    if (s1SearchEnd > s1SearchStart) {
      // pick highest local peak above s2Threshold
      let bestIdx = -1;
      let bestVal = -Infinity;
      for (let k = s1SearchStart + 1; k < s1SearchEnd - 1; k++) {
        if (envelope[k] < s2Threshold) continue;
        if (envelope[k] >= envelope[k - 1] && envelope[k] > envelope[k + 1]) {
          if (envelope[k] > bestVal) {
            bestVal = envelope[k];
            bestIdx = k;
          }
        }
      }
      if (bestIdx !== -1) s1Idx = bestIdx;
    }

    // search S2 after S1 in [systolicMin, systolicMax]
    const s2SearchStart = s1Idx + systolicMin;
    const s2SearchEnd = Math.min(s1Idx + systolicMax, windowEnd);

    if (s2SearchStart >= s2SearchEnd) continue;

    let s2Idx = -1;
    let s2Val = -Infinity;

    for (let k = s2SearchStart + 1; k < s2SearchEnd - 1; k++) {
      if (envelope[k] < s2Threshold) continue;
      if (envelope[k] >= envelope[k - 1] && envelope[k] > envelope[k + 1]) {
        if (envelope[k] > s2Val) {
          s2Val = envelope[k];
          s2Idx = k;
        }
      }
    }

    if (s2Idx !== -1) {
      const interval = s2Idx - s1Idx;
      if (interval >= systolicMin && interval <= systolicMax) {
        const ratio = envelope[s2Idx] / (envelope[s1Idx] + 1e-10);
        if (ratio >= 0.1 && ratio <= 3.0) {
          s1List.push(s1Idx);
          s2List.push(s2Idx);
        }
      }
    }
  }

  return { s1Frames: s1List, s2Frames: s2List };
}

/** HR estimate from S1 frames (ported from estimate_heart_rate) */
export function estimateHeartRateBpm(
  s1Frames: number[],
  frameRate: number,
): number | null {
  if (s1Frames.length < 2) return null;

  const intervals: number[] = [];
  for (let i = 1; i < s1Frames.length; i++) {
    intervals.push((s1Frames[i] - s1Frames[i - 1]) / frameRate);
  }

  const medianInterval = median(intervals);
  const valid = intervals.filter(
    (x) => x > medianInterval * 0.5 && x < medianInterval * 1.5,
  );
  const meanInterval = valid.length >= 1 ? mean(valid) : medianInterval;
  if (!isFinite(meanInterval) || meanInterval <= 1e-6) return null;

  return 60.0 / meanInterval;
}

/** Full Phase A analysis: window -> envelope -> s1/s2 -> HR */
export function analyzePhaseA(
  window: Float32Array,
  fs: number,
  params?: DetectionParams,
): PhaseAResult {
  const p = { ...DEFAULT_PARAMS, ...(params ?? {}) };

  const signal = preprocessPhaseA(window);
  const { envelope, frameRate } = computeShannonEnvelope(
    signal,
    fs,
    p.windowMs,
    p.strideMs,
  );
  const { s1Frames, s2Frames } = detectS1S2Frames(envelope, frameRate, p);
  const hrBpm = estimateHeartRateBpm(s1Frames, frameRate);

  return { envelope, frameRate, s1Frames, s2Frames, hrBpm };
}

/* ---------- small helpers ---------- */

function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function median(xs: number[]): number {
  const a = xs.slice().sort((u, v) => u - v);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : 0.5 * (a[mid - 1] + a[mid]);
}

function percentile(arr: Float32Array, p: number): number {
  const a = Array.from(arr);
  a.sort((u, v) => u - v);
  const idx = Math.min(
    a.length - 1,
    Math.max(0, Math.floor((p / 100) * (a.length - 1))),
  );
  return a[idx];
}
