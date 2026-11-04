// SPDX-License-Identifier: GPL-3.0-or-later
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { BUILD } from "@/lib/backend";
import { audioSources, audioStart, audioStatus, audioStop, EMPTY_AUDIO, type AudioConfig, type AudioSource, type AudioStatus } from "@/lib/audio-backend";
import { AUDIO_STORAGE, assignAudioDefaults, parseAudioPreferences } from "@/lib/audio-preferences";
interface AudioContextValue {
  config: AudioConfig; status: AudioStatus; sources: AudioSource[]; busy: boolean; sourceError: string | null;
  change: (next: AudioConfig, commit?: boolean) => void; setMode: (enabled: boolean) => Promise<void>; refresh: () => Promise<void>;
}
const Context = createContext<AudioContextValue | null>(null);
export function useAudio() { const value = useContext(Context); if (!value) throw new Error("Audio context missing"); return value; }
function load() { try { return parseAudioPreferences(localStorage.getItem(AUDIO_STORAGE)); } catch { return parseAudioPreferences(null); } }
export default function AudioProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AudioConfig>(load), [status, setStatus] = useState<AudioStatus>(EMPTY_AUDIO);
  const [sources, setSources] = useState<AudioSource[]>([]), [busy, setBusy] = useState(false), [sourceError, setSourceError] = useState<string | null>(null);
  const configRef = useRef(config), statusRef = useRef(status), busyRef = useRef(false), initialized = useRef(false), alive = useRef(false), refreshing = useRef(false), lastError = useRef<string | null>(null);
  function remember(next: AudioConfig) { configRef.current = next; setConfig(next); try { localStorage.setItem(AUDIO_STORAGE, JSON.stringify({ version: 2, config: next })); } catch { /* Private sessions can refuse storage. */ } }
  function accept(next: AudioStatus) { statusRef.current = next; setStatus(next); }
  async function refresh() {
    if (refreshing.current || busyRef.current) return;
    refreshing.current = true;
    try { const list = await audioSources(); if (!alive.current) return; setSources(list); setSourceError(null); if (!statusRef.current.running) remember(assignAudioDefaults(configRef.current, list)); }
    catch (e) { if (alive.current) setSourceError(String(e)); }
    finally { refreshing.current = false; }
  }
  async function apply(next: AudioConfig, enabled: boolean) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); lastError.current = null;
    try {
      if (enabled && (next.output.enabled || next.microphone.enabled)) { await audioStart(next); accept(await audioStatus()); }
      else { const s = await audioStop(); accept(s); if (s.error) toast.error(s.error); }
    } catch (e) {
      toast.error(String(e));
      try { const actual = await audioStatus(); accept(actual); if (actual.running && actual.config) remember(actual.config); } catch { /* The command failure is already shown. */ }
    } finally { busyRef.current = false; if (alive.current) setBusy(false); }
  }
  function change(next: AudioConfig, commit = false) { if (busyRef.current) return; remember(next); if (commit && statusRef.current.running) void apply(next, true); }
  async function setMode(enabled: boolean) {
    if (enabled && !configRef.current.output.enabled && !configRef.current.microphone.enabled) { toast.error("Activez au moins la sortie audio ou le microphone."); return; }
    await apply(configRef.current, enabled);
  }
  useEffect(() => {
    alive.current = true;
    if (BUILD !== "app") return () => { alive.current = false; };
    let pending = false;
    const refreshSources = () => { void refresh(); };
    window.addEventListener("focus", refreshSources);
    const sourceTimer = setInterval(refreshSources, 15000);
    const poll = async () => {
      if (pending || busyRef.current) return; pending = true;
      try {
        const next = await audioStatus(); if (!alive.current || busyRef.current) return;
        accept(next);
        if (!initialized.current) { initialized.current = true; if (next.running && next.config) remember(next.config); }
        const error = next.error || next.output.error || next.microphone.error;
        if (error && error !== lastError.current) { toast.error(error); lastError.current = error; }
      } catch (e) { if (alive.current) setSourceError(String(e)); }
      finally { pending = false; }
    };
    const timer = setInterval(() => void poll(), 80);
    Promise.resolve().then(() => { void refresh(); void poll(); });
    return () => { alive.current = false; clearInterval(timer); clearInterval(sourceTimer); window.removeEventListener("focus", refreshSources); };
  }, []);
  return <Context.Provider value={{ config, status, sources, busy, sourceError, change, setMode, refresh }}>{children}</Context.Provider>;
}
