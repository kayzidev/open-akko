// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from "react";
import { AudioLines, Minus, Square, Copy, X } from "lucide-react";
import OpenAkkoLogo from "@/components/OpenAkkoLogo";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BUILD } from "@/lib/backend";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Titlebar({ model, audio, onAudio }: { model: string; audio: boolean; onAudio: () => void }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (BUILD !== "app") return;
    const window = getCurrentWindow(); let disposed = false; let unlisten: (() => void) | undefined;
    const sync = () => void window.isMaximized().then(v => { if (!disposed) setMaximized(v); }).catch(() => {});
    sync(); void window.onResized(sync).then(off => { if (disposed) off(); else unlisten = off; });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  async function action(run: () => Promise<unknown>) { try { await run(); } catch (e) { toast.error(String(e)); } }
  return <header className="flex h-12 shrink-0 select-none items-center bg-sidebar px-3">
    <div className="flex h-full min-w-0 flex-1 items-center gap-2.5 pl-2" onMouseDown={e => {
      if (BUILD !== "app" || e.button !== 0) return;
      void action(() => e.detail === 2 ? getCurrentWindow().toggleMaximize() : getCurrentWindow().startDragging());
    }}>
      <OpenAkkoLogo size={30} />
      <span className="pointer-events-none text-sm font-semibold tracking-tight">Open Akko</span>
      <span className="pointer-events-none ml-2 text-xs text-muted-foreground">{model}</span>
    </div>
    {audio && <Button variant="ghost" size="sm" onClick={onAudio} className="mr-3 text-xs text-primary"><AudioLines className="size-3.5" />Mode audio actif</Button>}
    {BUILD === "app" && <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon-sm" aria-label="Réduire la fenêtre" title="Réduire" onClick={() => void action(() => getCurrentWindow().minimize())}><Minus className="size-4" /></Button>
      <Button variant="ghost" size="icon-sm" aria-label={maximized ? "Restaurer la fenêtre" : "Agrandir la fenêtre"} title={maximized ? "Restaurer" : "Agrandir"} onClick={() => void action(() => getCurrentWindow().toggleMaximize())}>{maximized ? <Copy className="size-3.5" /> : <Square className="size-3.5" />}</Button>
      <Button variant="ghost" size="icon-sm" aria-label="Fermer la fenêtre" title="Fermer" className="hover:bg-destructive/15 hover:text-destructive" onClick={() => void action(() => getCurrentWindow().close())}><X className="size-4" /></Button>
    </div>}
  </header>;
}
const EDGES = [
  ["North", "left-2 right-2 top-0 h-1 cursor-n-resize"], ["South", "bottom-0 left-2 right-2 h-1 cursor-s-resize"],
  ["East", "bottom-2 right-0 top-2 w-1 cursor-e-resize"], ["West", "bottom-2 left-0 top-2 w-1 cursor-w-resize"],
  ["NorthWest", "left-0 top-0 size-2 cursor-nw-resize"], ["NorthEast", "right-0 top-0 size-2 cursor-ne-resize"],
  ["SouthWest", "bottom-0 left-0 size-2 cursor-sw-resize"], ["SouthEast", "bottom-0 right-0 size-2 cursor-se-resize"],
] as const;
export function WindowResizeHandles() {
  if (BUILD !== "app") return null;
  return <>{EDGES.map(([edge, className]) => <div aria-hidden="true" key={edge} className={`fixed z-50 ${className}`} onPointerDown={e => {
    if (e.button === 0) void getCurrentWindow().startResizeDragging(edge).catch(e => toast.error(String(e)));
  }} />)}</>;
}
