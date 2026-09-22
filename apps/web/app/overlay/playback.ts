import type { Frame, OverlaySettings } from "./runtime";

export function playMedia(media: HTMLMediaElement, frame: Frame, settings: OverlaySettings) {
  let stopped = false;
  const finish = () => { if (!stopped) frame.done(); };
  const onReady = () => { media.removeEventListener("canplay", onReady); start(); };
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    media.removeEventListener("ended", finish);
    media.removeEventListener("error", finish);
    media.removeEventListener("canplay", onReady);
    frame.signal.removeEventListener("abort", cleanup);
    media.pause();
    media.removeAttribute("src");
    media.load();
  };
  if (frame.signal.aborted) return cleanup;
  // Restore source after React Strict Mode's setup/cleanup/setup cycle.
  if (frame.action.url) {
    media.setAttribute("src", frame.action.url);
    // Low-end machines: hint the browser to buffer eagerly and decode off the main thread.
    media.preload = "auto";
    if ("playsInline" in media) media.playsInline = true;
  }
  media.volume = settings.volume * (frame.action.volume ?? 1);
  media.addEventListener("ended", finish);
  media.addEventListener("error", finish);
  frame.signal.addEventListener("abort", cleanup, { once: true });
  const start = () => { try { void media.play()?.catch(finish); } catch { finish(); } };
  // Wait until enough media is buffered so playback never starts on a blank/stuttering frame.
  // Missing readyState (older engines/tests) falls back to immediate playback.
  if (!media.readyState || media.readyState >= 3) start();
  else {
    media.addEventListener("canplay", onReady);
    // Safety net: if canplay never fires (bad URL), the error/timeout path still finishes the frame.
    setTimeout(() => media.removeEventListener("canplay", onReady), 8000);
  }
  return cleanup;
}