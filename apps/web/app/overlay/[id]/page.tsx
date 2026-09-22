"use client";
import { use, useEffect, useRef, useState } from "react";
import { defaultSettings, OverlayRuntime, parseMessage, type Frame, type OverlaySettings } from "../runtime";
import { playMedia, speak } from "../playback";
const wsUrl = () => `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;

function Playback({ frame, settings }: { frame: Frame; settings: OverlaySettings }) {
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const latest = useRef(settings); latest.current = settings;
  useEffect(() => {
    if (frame.action.type === "tts") return speak(frame, latest.current,
      typeof window.speechSynthesis === "undefined" ? undefined : window.speechSynthesis,
      typeof window.SpeechSynthesisUtterance === "undefined" ? undefined : window.SpeechSynthesisUtterance);
    if (media.current) return playMedia(media.current, frame, latest.current);
  }, [frame]);
  useEffect(() => {
    if (media.current) media.current.volume = settings.volume * (frame.action.volume ?? 1);
    if (frame.action.type === "tts" && !settings.ttsEnabled) frame.done();
  }, [frame, settings]);
  const action = frame.action;
  return <>{action.type === "image" && <img src={action.url} alt="" onError={frame.done} />}{action.type === "video" && <video ref={media} src={action.url} playsInline />}{action.type === "audio" && <audio ref={media} src={action.url} />}{action.type === "tts" && <div className="caption">{action.text?.slice(0, settings.ttsMaxLength)}</div>}{action.type === "confetti" && <div className="confetti">{Array.from({ length: 80 }, (_, i) => <i key={i} style={{ left: `${(i * 47) % 100}%`, animationDelay: `${(i % 20) * -.1}s`, background: `hsl(${i * 41} 90% 60%)` }} />)}</div>}</>;
}
export default function Overlay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [settings, setSettings] = useState<OverlaySettings>(defaultSettings);
  useEffect(() => {
    let closed = false;
    let ws: WebSocket | null = null;
    let retry = 500;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const runtime = new OverlayRuntime(value => { if (!closed) setFrame(value); });
    setFrame(null); setSettings({ ...defaultSettings });
    const htmlBackground = document.documentElement.style.background;
    const bodyBackground = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    const schedule = () => {
      if (closed) return;
      clearTimeout(reconnect);
      reconnect = setTimeout(connect, retry);
      retry = Math.min(retry * 2, 10000);
    };
    const connect = () => {
      if (closed) return;
      let socket: WebSocket;
      try { socket = new WebSocket(wsUrl()); } catch { schedule(); return; }
      ws = socket;
      const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => socket.close(), 45000); };
      arm();
      socket.onopen = () => {
        if (closed || ws !== socket) return;
        retry = 500; arm();
        socket.send(JSON.stringify({ kind: "subscribe", projectId: id, client: "overlay" }));
      };
      socket.onmessage = event => {
        if (closed || ws !== socket) return;
        const message = parseMessage(event.data, id);
        if (!message) return;
        arm();
        if (message.kind === "ping") { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ kind: "pong", at: message.at })); }
        else if (message.kind === "settings") { runtime.update(message.settings); setSettings(runtime.settings); }
        else if (message.kind === "control") runtime.control(message.command);
        else runtime.enqueue(message, message.mode);
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (ws !== socket) return;
        clearTimeout(watchdog); schedule();
      };
    };
    connect();
    return () => {
      closed = true; clearTimeout(reconnect); clearTimeout(watchdog);
      if (ws) { ws.onopen = null; ws.onmessage = null; ws.onerror = null; ws.onclose = null; ws.close(); }
      runtime.dispose();
      document.documentElement.style.background = htmlBackground;
      document.body.style.background = bodyBackground;
    };
  }, [id]);
  return <main className="overlay" style={{ pointerEvents: "none", background: "transparent", color: "white" }}>{frame && <Playback key={frame.key} frame={frame} settings={settings} />}</main>;
}
