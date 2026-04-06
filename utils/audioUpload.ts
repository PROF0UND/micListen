import { Buffer } from "buffer";

export function float32ToPcm16Base64(x: Float32Array): string {
  const i16 = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) {
    // clamp to [-1,1]
    let s = x[i];
    if (s > 1) s = 1;
    if (s < -1) s = -1;
    i16[i] = Math.round(s * 32767);
  }
  // IMPORTANT: use the underlying bytes
  return Buffer.from(i16.buffer).toString("base64");
}
