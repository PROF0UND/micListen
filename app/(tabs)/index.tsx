import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
} from "react-native";

import { useHeartbeatMic } from "../../hooks/useHeartbeatMic";
import { analyzePhaseA } from "../../dsp/phaseA";
import { loadBpModels } from "../../ml/loadModels";
import { float32ToPcm16Base64 } from "../../utils/audioUpload";
import { Waveform } from "../../components/Waveform";

import { Audio } from "expo-av";
import { saveWindowAsWav } from "../../utils/wav";

import * as Sharing from "expo-sharing";

import { lowpass1p } from "../../utils/filters";

const WAVE_PADDING = 10;

export default function HomeScreen() {
  const { start, stop, level, isReady, getLatestWindow, sampleRate, resetBuffer, getPreviewWindow } =
    useHeartbeatMic({ windowSeconds: 8 });

  const [hr, setHr] = useState<number | null>(null);

  const [sbp, setSbp] = useState<number | null>(null);
  const [dbp, setDbp] = useState<number | null>(null);

  // waveform
  const [wave, setWave] = useState<Float32Array | null>(null);

  // low pass filter
  const [cutoffHz, setCutoffHz] = useState<string>("150"); // default
  const [filteredWindow, setFilteredWindow] = useState<Float32Array | null>(null);
  const [waveWidth, setWaveWidth] = useState<number>(0);

  // for waveform
  useEffect(() => {
    const id = setInterval(() => {
      const w = getPreviewWindow();
      if (!w || w.length === 0) return;

      // Optionally show last 1-2 seconds for clarity while recording:
      const secondsToShow = 8;
      const n = Math.min(w.length, Math.floor(sampleRate * secondsToShow));
      const slice = w.subarray(w.length - n);

      setWave(new Float32Array(slice));
    }, 80);

    return () => clearInterval(id);
  }, [getPreviewWindow, sampleRate]);

  // for playback
  async function playLast8Seconds() {
    const w = filteredWindow ?? getLatestWindow();
    if (!w) {
      console.log("Not ready yet (need full 8s).");
      return;
    }

    const uri = await saveWindowAsWav(w, sampleRate);

    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });

    const { sound } = await Audio.Sound.createAsync({ uri });
    await sound.playAsync();

    // optional: unload after playback finishes
    sound.setOnPlaybackStatusUpdate((status) => {
      if ((status as any)?.didJustFinish) sound.unloadAsync();
    });
  }

  // file sharing
  async function shareLast8Seconds() {
    const w = filteredWindow ?? getLatestWindow();
    if (!w) {
      console.log("Not ready yet (need full 8s).");
      return;
    }

    const uri = await saveWindowAsWav(w, sampleRate);

    const available = await Sharing.isAvailableAsync();
    if (!available) {
      console.log("Sharing not available on this device.");
      return;
    }

    await Sharing.shareAsync(uri, {
      mimeType: "audio/wav",
      dialogTitle: "Share heartbeat recording",
      UTI: "public.wav", // iOS hint (safe to include)
    });
  }

  // low pass filter
  function filterLast8Seconds() {
    const w = getLatestWindow();
    if (!w) {
      console.log("Not ready yet (need full 8s).");
      return;
    }

    const fc = Number(cutoffHz);
    if (!Number.isFinite(fc) || fc <= 0) {
      console.log("Invalid cutoffHz");
      return;
    }

    const { y } = lowpass1p(w, sampleRate, fc);
    setFilteredWindow(y);

    console.log(`Filtered last 8s with low-pass fc=${fc}Hz`);
  }

  useEffect(() => {
    (async () => {
      try {
        await loadBpModels();
      } catch (e) {
        console.error("Model load failed:", e);
      }
    })();
  }, []);

  useEffect(() => {
    if (!isReady) return;

    const id = setInterval(() => {
      const w = filteredWindow ?? getLatestWindow();
      if (!w) return;

      const res = analyzePhaseA(w, sampleRate);
      setHr(res.hrBpm);
    }, 1000);

    return () => clearInterval(id);
  }, [isReady, getLatestWindow, sampleRate]);

  async function uploadWindow() {
    const w = getLatestWindow();
    if (!w) {
      console.log("Not ready yet (need full window).");
      return;
    }

    const pcm16Base64 = float32ToPcm16Base64(w);

    // Replace with your computer's LAN IP (same Wi-Fi as phone)
    const SERVER_URL = "http://10.200.2.187:8000/analyze_pcm";

    console.log("uploading...");

    const res = await fetch(SERVER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sampleRate,
        pcm16Base64,
      }),
    });

    console.log("upload successful");

    const json = await res.json();
    console.log("Server analysis:", JSON.stringify(json, null, " "));

    if (json.sbp != null && json.dbp != null) {
      setSbp(json.sbp);
      setDbp(json.dbp);
    }
  }

  function reset() {
    setHr(null);
    setSbp(null);
    setDbp(null);
    resetBuffer();
    console.log("reset");
  }

  const isFiltered = Boolean(filteredWindow && filteredWindow.length > 0);

  return (
    <View style={styles.screen}>

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.pulseDot} />
          <Text style={styles.title}>MicListen</Text>
        </View>
        <Text style={styles.subtitle}>Heartbeat capture and analysis</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Capture</Text>
          <View style={styles.row}>
            <ActionButton label="Start" onPress={start} />
            <ActionButton label="Stop" onPress={stop} variant="ghost" />
          </View>
          <View style={styles.row}>
            <ActionButton label="Upload 8s" onPress={uploadWindow} disabled={!isReady} />
            <ActionButton label="Reset" onPress={reset} variant="ghost" />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Waveform</Text>
          <View
            style={styles.waveWrap}
            onLayout={(event) => {
              const measured = Math.floor(event.nativeEvent.layout.width);
              const next = Math.max(0, measured - WAVE_PADDING * 2);
              if (next !== waveWidth) setWaveWidth(next);
            }}
          >
            <Waveform samples={wave} width={waveWidth || 320} height={140} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Playback and Share</Text>
          <View style={styles.row}>
            <ActionButton label="Play 8s" onPress={playLast8Seconds} disabled={!isReady} />
            <ActionButton
              label="Share 8s"
              onPress={shareLast8Seconds}
              disabled={!isReady}
              variant="ghost"
            />
          </View>
          <View style={[styles.pill, isFiltered ? styles.pillActive : styles.pillMuted]}>
            <Text style={styles.pillText}>
              {isFiltered ? "Sharing filtered audio" : "Sharing raw audio"}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Filter</Text>
          <Text style={styles.label}>Low-pass cutoff (Hz)</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.inputMono]}
              value={cutoffHz}
              onChangeText={setCutoffHz}
              keyboardType="numeric"
              placeholder="150"
              placeholderTextColor="#6B7280"
            />
            <ActionButton label="Filter 8s" onPress={filterLast8Seconds} disabled={!isReady} />
          </View>
          <Text style={styles.helper}>Tip: 80-200 Hz is a good starting point.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Vitals</Text>
          <View style={styles.metricRow}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Signal</Text>
              <Text style={styles.metricValue}>{level.toFixed(4)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>HR</Text>
              <Text style={styles.metricValue}>{hr ? `${hr.toFixed(0)} bpm` : "-"}</Text>
            </View>
          </View>
          <View style={styles.metricRow}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>SBP</Text>
              <Text style={styles.metricValue}>{sbp ? `${sbp.toFixed(0)} mmHg` : "-"}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>DBP</Text>
              <Text style={styles.metricValue}>{dbp ? `${dbp.toFixed(0)} mmHg` : "-"}</Text>
            </View>
          </View>
        </View>

        
      </ScrollView>
    </View>
  );
}

type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
};

function ActionButton({
  label,
  onPress,
  disabled = false,
  variant = "primary",
}: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        variant === "ghost" ? styles.buttonGhost : styles.buttonPrimary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === "ghost" ? styles.buttonTextGhost : styles.buttonTextPrimary,
          disabled && styles.buttonTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#020000",
  },
  container: {
    padding: 22,
    paddingTop: 56,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 28,
    letterSpacing: 0.5,
    fontFamily: Platform.select({
      ios: "AvenirNext-DemiBold",
      android: "sans-serif-condensed",
      default: "AvenirNext-DemiBold",
    }),
  },
  subtitle: {
    color: "rgba(255, 255, 255, 0.72)",
    marginTop: 6,
    fontSize: 14,
    fontFamily: Platform.select({
      ios: "AvenirNext-Regular",
      android: "sans-serif",
      default: "AvenirNext-Regular",
    }),
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#FDB414",
    shadowColor: "#FDB414",
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 4,
  },
  card: {
    marginTop: 18,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.14)",
  },
  cardTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    marginBottom: 12,
    fontFamily: Platform.select({
      ios: "AvenirNext-DemiBold",
      android: "sans-serif-medium",
      default: "AvenirNext-DemiBold",
    }),
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  label: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 13,
    marginBottom: 8,
    fontFamily: Platform.select({
      ios: "AvenirNext-Regular",
      android: "sans-serif",
      default: "AvenirNext-Regular",
    }),
  },
  input: {
    backgroundColor: "rgba(2, 0, 0, 0.9)",
    color: "#FFFFFF",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(253, 180, 20, 0.35)",
    minWidth: 120,
  },
  inputMono: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "Menlo",
    }),
    letterSpacing: 0.5,
  },
  helper: {
    color: "rgba(255, 255, 255, 0.6)",
    fontSize: 12,
    marginTop: 4,
  },
  pill: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginTop: 2,
  },
  pillText: {
    fontSize: 12,
    color: "#FFFFFF",
    fontFamily: Platform.select({
      ios: "AvenirNext-Medium",
      android: "sans-serif-medium",
      default: "AvenirNext-Medium",
    }),
  },
  pillActive: {
    backgroundColor: "rgba(253, 180, 20, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(253, 180, 20, 0.5)",
  },
  pillMuted: {
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    minWidth: 120,
    alignItems: "center",
  },
  buttonPrimary: {
    backgroundColor: "#FDB414",
  },
  buttonGhost: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(253, 180, 20, 0.45)",
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 13,
    letterSpacing: 0.4,
    fontFamily: Platform.select({
      ios: "AvenirNext-DemiBold",
      android: "sans-serif-medium",
      default: "AvenirNext-DemiBold",
    }),
  },
  buttonTextPrimary: {
    color: "#020000",
  },
  buttonTextGhost: {
    color: "#FFFFFF",
  },
  buttonTextDisabled: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  metricRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  metric: {
    flex: 1,
    minWidth: 140,
    backgroundColor: "rgba(2, 0, 0, 0.7)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(253, 180, 20, 0.2)",
  },
  metricLabel: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 12,
    marginBottom: 6,
    fontFamily: Platform.select({
      ios: "AvenirNext-Regular",
      android: "sans-serif",
      default: "AvenirNext-Regular",
    }),
  },
  metricValue: {
    color: "#FFFFFF",
    fontSize: 18,
    letterSpacing: 0.4,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "Menlo",
    }),
  },
  waveWrap: {
    padding: WAVE_PADDING,
    borderRadius: 16,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.08)",
  },
  blobOne: {
    position: "absolute",
    top: -80,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(253, 180, 20, 0.18)",
  },
  blobTwo: {
    position: "absolute",
    bottom: -120,
    left: -60,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
});
