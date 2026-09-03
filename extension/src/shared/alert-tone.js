import { ALERT_SOUND } from "./constants.js";

export function playAlertTone(audioContext, sound = ALERT_SOUND) {
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 12;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.2;
  compressor.connect(audioContext.destination);

  const master = audioContext.createGain();
  master.gain.value = sound.volume;
  master.connect(compressor);
  const start = audioContext.currentTime + 0.02;

  sound.strikes.forEach((strike) => {
    sound.partials.forEach((partial) => {
      const oscillator = audioContext.createOscillator();
      const envelope = audioContext.createGain();
      const at = start + strike.delaySeconds;
      const peak = Math.max(0.0001, partial.gain);
      oscillator.type = partial.type;
      oscillator.frequency.setValueAtTime(strike.frequency * partial.ratio, at);
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(peak, at + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + sound.durationSeconds);
      oscillator.connect(envelope).connect(master);
      oscillator.start(at);
      oscillator.stop(at + sound.durationSeconds + 0.02);
    });
  });
}
