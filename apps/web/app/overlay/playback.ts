import type { Frame, OverlaySettings } from "./runtime";

export function playMedia(media: HTMLMediaElement, frame: Frame, settings: OverlaySettings) {
  let stopped = false;
  const finish = () => { if (!stopped) frame.done(); };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    media.removeEventListener("ended", finish);
    media.removeEventListener("error", finish);
    frame.signal.removeEventListener("abort", cleanup);
    media.pause();
    media.removeAttribute("src");
    media.load();
  };
  if (frame.signal.aborted) return cleanup;
  // Restore source after React Strict Mode's setup/cleanup/setup cycle.
  if (frame.action.url) media.setAttribute("src", frame.action.url);
  media.volume = settings.volume * (frame.action.volume ?? 1);
  media.addEventListener("ended", finish);
  media.addEventListener("error", finish);
  frame.signal.addEventListener("abort", cleanup, { once: true });
  try { void media.play()?.catch(finish); } catch { finish(); }
  return cleanup;
}

export function speak(frame: Frame, settings: OverlaySettings, synthesis?: SpeechSynthesis, Utterance?: typeof SpeechSynthesisUtterance) {
  if (frame.signal.aborted) return () => {};
  if (!settings.ttsEnabled || !synthesis || !Utterance) { frame.done(); return () => {}; }
  let stopped = false;
  const utterance = new Utterance((frame.action.text ?? "").slice(0, settings.ttsMaxLength));
  const finish = () => { if (!stopped) frame.done(); };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    utterance.onend = null; utterance.onerror = null;
    frame.signal.removeEventListener("abort", cleanup);
    synthesis.cancel();
  };
  frame.signal.addEventListener("abort", cleanup, { once: true });
  utterance.onend = finish; utterance.onerror = finish;
  utterance.volume = settings.volume;
  utterance.rate = frame.action.rate ?? settings.ttsRate;
  try {
    utterance.voice = synthesis.getVoices().find(voice => voice.voiceURI === settings.ttsVoice || voice.name === settings.ttsVoice) ?? null;
    synthesis.speak(utterance);
  } catch { finish(); }
  return cleanup;
}