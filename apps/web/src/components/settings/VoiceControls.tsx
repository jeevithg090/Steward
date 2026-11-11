import { Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type SpeechRate, useAccessibility } from "@/app/accessibility.tsx";
import { Button } from "@/components/ui/Button.tsx";
import { ChoiceGroup, Field, Select } from "@/components/ui/Field.tsx";
import { useSpeak } from "@/features/voice";

const SPEECH_RATES: { value: SpeechRate; label: string }[] = [
  { value: 0.8, label: "Slower" },
  { value: 1, label: "Normal" },
  { value: 1.25, label: "Faster" },
];

export const VOICE_SAMPLE = "This is how Steward sounds when it reads a reply to you.";

function engine(): SpeechSynthesis | undefined {
  return typeof globalThis.speechSynthesis === "object" ? globalThis.speechSynthesis : undefined;
}

/** This device's voices. Browsers load them late, so the list follows `voiceschanged`. */
function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => engine()?.getVoices() ?? []);
  useEffect(() => {
    const synth = engine();
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener?.("voiceschanged", update);
    return () => synth.removeEventListener?.("voiceschanged", update);
  }, []);
  return voices;
}

/** The page's language first ("en" matches "en-GB"), then the rest, each in the browser's order. */
function groupVoices(voices: SpeechSynthesisVoice[]) {
  const page = (document.documentElement.lang || "en").split("-")[0]!.toLowerCase();
  const mine = voices.filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === page);
  const others = voices.filter((v) => !mine.includes(v));
  return { mine, others };
}

function VoiceOption({ voice }: { voice: SpeechSynthesisVoice }) {
  return (
    <option value={voice.voiceURI}>
      {voice.name} ({voice.lang})
    </option>
  );
}

/**
 * Which voice reads replies aloud, how fast, and a sample to hear them. Everything stays on this
 * device: the browser's own voices do the speaking.
 */
export function VoiceControls() {
  const a11y = useAccessibility();
  const speaker = useSpeak();
  const voices = useVoices();
  if (!speaker.supported) {
    return (
      <p className="text-ink-2 text-sub">This browser can't read aloud, so there is no voice to choose.</p>
    );
  }
  const { mine, others } = groupVoices(voices);
  // The chosen voice shows as chosen while the browser is still loading its voices, and when this
  // browser doesn't have it (it reads with its usual voice then).
  const missing = a11y.speechVoice !== "" && !voices.some((v) => v.voiceURI === a11y.speechVoice);
  return (
    <div className="flex flex-col gap-4">
      <Field label="Voice" description="Voices on this device. Nothing is sent anywhere to read aloud.">
        <Select value={a11y.speechVoice} onChange={(e) => a11y.set({ speechVoice: e.target.value })}>
          <option value="">This device's usual voice</option>
          {missing ? (
            <option value={a11y.speechVoice}>
              {voices.length === 0 ? "The voice you chose" : "A voice this browser doesn't have"}
            </option>
          ) : null}
          {others.length > 0 && mine.length > 0 ? (
            <>
              <optgroup label="In this page's language">
                {mine.map((v) => (
                  <VoiceOption key={v.voiceURI} voice={v} />
                ))}
              </optgroup>
              <optgroup label="Other languages">
                {others.map((v) => (
                  <VoiceOption key={v.voiceURI} voice={v} />
                ))}
              </optgroup>
            </>
          ) : (
            voices.map((v) => <VoiceOption key={v.voiceURI} voice={v} />)
          )}
        </Select>
      </Field>
      <ChoiceGroup<`${SpeechRate}`>
        legend="Reading speed"
        value={`${a11y.speechRate}`}
        onValueChange={(v) => a11y.set({ speechRate: Number(v) as SpeechRate })}
        choices={SPEECH_RATES.map((r) => ({ value: `${r.value}`, label: r.label }))}
      />
      <div>
        <Button
          size="sm"
          icon={speaker.speaking ? <Square /> : <Volume2 />}
          onClick={() => (speaker.speaking ? speaker.stop() : speaker.speak(VOICE_SAMPLE))}
        >
          {speaker.speaking ? "Stop the sample" : "Hear a sample"}
        </Button>
      </div>
    </div>
  );
}
