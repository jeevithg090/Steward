// src/features/chat/AudioMessage.tsx

export interface AudioMessageProps {
  audio: {
    url: string;
    durationMs?: number;
    duration?: number;
    waveform?: number[];
    mimeType?: string;
  };
}

export function AudioMessage({ audio }: AudioMessageProps) {
  // Use durationMs or duration, defaulting to 0 if undefined
  const rawMs = audio.durationMs ?? (audio.duration ? audio.duration * 1000 : 0);
  const seconds = Math.round(rawMs / 1000);

  return (
    <div className="flex items-center gap-3">
      <audio controls src={audio.url} className="h-8 max-w-full" />
      {seconds > 0 && (
        <span className="text-xs text-accent-200">
          {seconds}s
        </span>
      )}
    </div>
  );
}