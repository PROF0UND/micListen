import React, { useMemo } from "react";
import { View } from "react-native";
import Svg, { Polyline, Line, Defs, LinearGradient, Stop } from "react-native-svg";

type Props = {
  samples: Float32Array | null; // expects [-1..1]
  width?: number;
  height?: number;
};

export function Waveform({ samples, width = 320, height = 120 }: Props) {
  const points = useMemo(() => {
    if (!samples || samples.length === 0 || width <= 0 || height <= 0) return "";

    // Downsample to ~width points (one per x pixel)
    const n = width;
    const step = Math.max(1, Math.floor(samples.length / n));

    let maxAbs = 0;
    const stride = Math.max(1, Math.floor(samples.length / 1000));
    for (let i = 0; i < samples.length; i += stride) {
      const v = Math.abs(samples[i] ?? 0);
      if (v > maxAbs) maxAbs = v;
    }

    const target = 0.9;
    const scale = maxAbs > 0 ? Math.min(20, target / maxAbs) : 1;
    const half = height / 2;

    let out = "";
    for (let i = 0; i < n; i++) {
      const idx = i * step;
      const sRaw = samples[idx] ?? 0;

      let s = sRaw * scale;
      if (s > 1) s = 1;
      if (s < -1) s = -1;

      const y = half - s * half;

      out += `${i},${y} `;
    }

    return out.trim();
  }, [samples, width, height]);

  return (
    <View
      style={{
        width,
        height,
        overflow: "hidden",
        borderRadius: 12,
        backgroundColor: "rgba(2, 0, 0, 0.6)",
        borderWidth: 1,
        borderColor: "rgba(253, 180, 20, 0.18)",
      }}
    >
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="waveGradient" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.5" />
            <Stop offset="0.5" stopColor="#FDB414" stopOpacity="1" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0.5" />
          </LinearGradient>
        </Defs>
        <Line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="rgba(255, 255, 255, 0.08)"
          strokeWidth={1}
        />
        <Polyline
          points={points}
          fill="none"
          stroke="rgba(253, 180, 20, 0.25)"
          strokeWidth={6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Polyline
          points={points}
          fill="none"
          stroke="url(#waveGradient)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
