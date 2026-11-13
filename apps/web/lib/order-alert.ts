const melody = [
  { note: 72, at: 0, duration: 0.37 },
  { note: 76, at: 0.33, duration: 0.37 },
  { note: 79, at: 0.66, duration: 0.5 },
  { note: 76, at: 1.16, duration: 0.37 },
  { note: 74, at: 1.49, duration: 0.37 },
  { note: 77, at: 1.82, duration: 0.37 },
  { note: 72, at: 2.15, duration: 0.72 },
];

export function createOrderAlert(context: AudioContext) {
  const { sampleRate } = context;
  const buffer = context.createBuffer(1, Math.ceil(3.2 * sampleRate), sampleRate);
  const samples = buffer.getChannelData(0);

  for (const { note, at, duration } of melody) {
    const frequency = 440 * 2 ** ((note - 69) / 12);
    const start = Math.round(at * sampleRate);
    const length = Math.round(duration * sampleRate);

    for (let offset = 0; offset < length; offset++) {
      const time = offset / sampleRate;
      const envelope = Math.min(1, time / 0.024, (duration - time) / 0.09) * Math.exp(-3 * time);
      const phase = 2 * Math.PI * frequency * time;
      samples[start + offset] += envelope * (0.24 * Math.sin(phase) + 0.06 * Math.sin(2 * phase));
    }
  }

  return buffer;
}
