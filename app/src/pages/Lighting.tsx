// SPDX-FileCopyrightText: JR Lanteigne <root@dnim.dev>
// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Banner, Chip, PageHeader, Section } from "@/components/Page";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {unavailableEffect} from "@/lib/keyboard-profile";
import {STYLE_PRESETS} from "@/lib/style-presets";
import {gridImage} from "@/lib/grid-palette";
import { REACTIVE_PRESETS, reactiveParams, matchesReactive } from "@/lib/reactive-presets";
import { EFFECT_INFO } from "@/lib/effect-info";
import { Input } from "@/components/ui/input";
import { t } from "@/lib/i18n";
import Waiting from "@/components/Waiting";
import EffectPreview from "@/components/EffectPreview";
import { useBoardLayout } from "@/lib/layout-loader";
import { readChoice, writeChoice } from "@/lib/led-flags-store";
import type { Family } from "@/lib/effects";
import { BE_MODES, MODE_LABELS, type LightMode } from "@/lib/lighting-modes";
import {
  getLedParam,
  getSettings,
  setLedFlagsSwapped,
  setLedParam,
  writePerKey,
  setOptions,
  setSideLight,
  type KbOptions,
  type ConnectedDevice,
  type LedParam,
  type SledParam,
} from "@/lib/backend";

// Side/edge light: its own small mode table, and speed is not inverted.
const SIDE_MODES = [
  { value: 0, label: "Off" },
  { value: 1, label: "Static" },
  { value: 2, label: "Breathing" },
  { value: 3, label: "Spectrum", noColor: true },
  { value: 4, label: "Wave" },
  { value: 5, label: "Snake" },
];

const SWATCHES = [
  "#ff0000",
  "#ff8000",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0000ff",
  "#ff00ff",
  "#ffffff",
];

function hexToRgb(hex: string) {
  const v = parseInt(hex.replace("#", ""), 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Below this the firmware renders "all LEDs off" (the backend floors such
// writes); picking it means the user wants the backlight off.
const isNearBlack = (c: { r: number; g: number; b: number }) =>
  Math.max(c.r, c.g, c.b) < 8;

// Lighting is flash. Drag previews; write once on release.
const WRITE_GAP = 300;

/** The effects to offer: the board's own table when the registry has one,
 *  else the common set. Speed is capped at the wire's 0..4 whatever the
 *  vendor's slider claims. */
function modesFor(device: ConnectedDevice | null): { modes: LightMode[]; brightnessMax: number } {
  const table = device?.spec.light;
  if (!table) return { modes: BE_MODES, brightnessMax: 4 };
  const modes: LightMode[] = table.effects
    .filter((e) => e.mode in MODE_LABELS)
    .map((e) => ({
      value: e.mode,
      label: MODE_LABELS[e.mode],
      options: e.options ?? undefined,
      noColor: !e.rgb,
      noSpeed: e.speedMax == null,
      speedMax: Math.min(e.speedMax ?? 4, 4),
    }));
  return { modes, brightnessMax: Math.max(1, table.brightnessMax) };
}

export default function LightingPage({ device }: { device: ConnectedDevice | null }) {
  const [styleBusy,setStyleBusy]=useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("Tous");
  const [palette,setPalette]=useState(["#7c3aed","#06b6d4","#f59e0b","#ef4444"]);
  const [gridBusy,setGridBusy]=useState(false);
  const [gridDeadline,setGridDeadline]=useState(0),[gridNow,setGridNow]=useState(() => Date.now());
  useEffect(()=>{const id=setInterval(()=>setGridNow(Date.now()),500);return()=>clearInterval(id);},[]);
  const gridWait=Math.max(0,Math.ceil((gridDeadline-gridNow)/1000));
  const connected = !!device;
  const { modes, brightnessMax } = modesFor(device);
  const { layout, resolving } = useBoardLayout(device);
  const [param, setParam] = useState<LedParam | null>(null);
  const [side, setSide] = useState<SledParam | null>(null);
  const [opts, setOpts] = useState<KbOptions | null>(null);
  /** Which way round this board reads the rainbow flag, and whether that is
   *  the owner's answer rather than the registry's. */
  const [swapped, setSwapped] = useState(false);
  const [owned, setOwned] = useState(false);
  const defaultSwap = useRef(false);
  const paramRef = useRef<LedParam | null>(null);
  const sideRef = useRef<SledParam | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSent = useRef(0);
  const lastSideSent = useRef(0);

  useEffect(() => {
    if (!device) {
      // Reset lighting params when device disconnects
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setParam(null);
      return;
    }
    // The flag decides how a reply is read as well as how a packet is
    // written, so the owner's answer goes in before the first read.
    const id = device.spec.id;
    const dflt = device.spec.ledFlagsSwapped ?? false;
    const stale = readChoice(id);
    const choice = stale && stale.dflt === dflt ? stale : null;
    if (stale && !choice) writeChoice(id, null);
    defaultSwap.current = dflt;
    setSwapped(choice ? choice.swapped : dflt);
    setOwned(!!choice);
    (choice ? setLedFlagsSwapped(choice.swapped) : Promise.resolve())
      .then(getLedParam)
      .then((p) => {
        paramRef.current = p;
        setParam(p);
      })
      .catch((e) => toast.error(t("Failed to read lighting: {e}", { e })));
    getSettings()
      .then((s) => {
        sideRef.current = s.sideLight;
        setSide(s.sideLight);
        setOpts(s.options);
      })
      .catch(() => {
        setSide(null);
        setOpts(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, device?.spec.id]);

  const setLedOff = (ledOff: boolean) => {
    if (!opts || opts.ledOff === ledOff) return;
    const next = { ...opts, ledOff };
    setOpts(next);
    setOptions(next).catch((e) => toast.error(t("Write failed: {e}", { e })));
  };

  /// Preview only. Nothing reaches the keyboard until commitSide.
  const updateSide = (patch: Partial<SledParam>) => {
    const base = sideRef.current;
    if (!base) return;
    const next = { ...base, ...patch };
    sideRef.current = next;
    setSide(next);
  };

  const commitSide = (patch?: Partial<SledParam>) => {
    if (patch) updateSide(patch);
    const next = sideRef.current;
    if (!next) return;
    clearTimeout(sideTimer.current);
    // Calculate write throttle delay
    // eslint-disable-next-line react-hooks/purity
    const delay = Math.max(0, WRITE_GAP - (Date.now() - lastSideSent.current));
    sideTimer.current = setTimeout(
      () => {
        lastSideSent.current = Date.now();
        setSideLight(next).catch((e) => toast.error(t("Write failed: {e}", { e })));
      },
      delay,
    );
  };

  /// Preview only. Nothing reaches the keyboard until commit.
  const update = (patch: Partial<LedParam>) => {
    const base = paramRef.current;
    if (!base) return;
    const next = { ...base, ...patch };
    paramRef.current = next;
    setParam(next);
  };

  /// For controls that stream while in use, like the OS colour dialog:
  /// preview every step, write once the user stops moving.
  const commitIdle = (patch: Partial<LedParam>) => {
    update(patch);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => commit(), 800);
  };

  const commit = (patch?: Partial<LedParam>) => {
    if (patch) update(patch);
    const next = paramRef.current;
    if (!next) return;
    clearTimeout(pushTimer.current);
    // Calculate write throttle delay
    // eslint-disable-next-line react-hooks/purity
    const delay = Math.max(0, WRITE_GAP - (Date.now() - lastSent.current));
    pushTimer.current = setTimeout(
      () => {
        lastSent.current = Date.now();
        setLedParam(next).catch((e) => toast.error(t("Write failed: {e}", { e })));
      },
      delay,
    );
  };

  // Black is not a colour the LEDs can show, so route it to the real
  // backlight-off switch instead, and wake the backlight on any colour pick.
  const pickColor = (rgb: { r: number; g: number; b: number }) => {
    if (isNearBlack(rgb) && opts) {
      setLedOff(true);
      toast(t("Backlight off. Pick a colour to light it back up."));
      return;
    }
    setLedOff(false);
    commit({ ...rgb, dazzle: false });
  };

  // The board keeps the flag it was sent, so the same settings go back out
  // under the other reading and the keyboard follows at once.
  const applySwap = (next: boolean) => {
    if (!device) return;
    const own = next !== defaultSwap.current;
    setSwapped(next);
    setOwned(own);
    writeChoice(device.spec.id, own ? { swapped: next, dflt: defaultSwap.current } : null);
    setLedFlagsSwapped(next)
      .then(() => commit())
      .catch((e) => toast.error(t("Write failed: {e}", { e })));
  };

  if (!connected) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t("Connect your keyboard to configure lighting.")}
      </div>
    );
  }
  if (!param) {
    return (
      <div className="flex h-full items-center justify-center">
        <Waiting label={t("Reading current lighting…")} />
      </div>
    );
  }

  const mode = modes.find((m) => m.value === param.mode);
  const hex = rgbToHex(param.r, param.g, param.b);
  const colorless = mode?.noColor ?? false;
  const sideColorless = SIDE_MODES.find((m) => m.value === side?.mode)?.noColor ?? false;
  // The preview is timed from the firmware of the two families; a board
  // whose family is still unknown is drawn on the gen2 clock.
  const family: Family = device.spec.family === "yc500" ? "yc500" : "gen2";

  const slider = (
    label: string,
    value: number,
    max: number,
    onChange: (v: number) => void,
    onCommit: (v: number) => void,
    muted = false,
  ) => (
    <div className={cn("space-y-2", muted && "pointer-events-none opacity-50")}>
      <div className="flex justify-between text-sm">
        <Label>{label}</Label>
        <span className="text-muted-foreground">
          {value}/{max}
        </span>
      </div>
      <Slider
        min={0}
        max={max}
        step={1}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={([v]) => onCommit(v)}
      />
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      <PageHeader
        title={t("Lighting")}
        hint={t("Backlight effect, color and motion. Changes apply live.")}
      />

      <Section title="Styles prêts à utiliser" hint="Un clic assortit le clavier et les bandes latérales. Les réglages détaillés restent disponibles dessous.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{STYLE_PRESETS.filter(s=>modes.some(m=>m.value===s.main.mode)).map(style=><button key={style.id} disabled={styleBusy||device?.readOnly} onClick={async()=>{
          if(styleBusy)return;setStyleBusy(true);clearTimeout(pushTimer.current);clearTimeout(sideTimer.current);clearTimeout(idleTimer.current);
          try{
            if(opts){const next={...opts,ledOff:false,sideLedOff:false};await setOptions(next);setOpts(next);}
            await setLedParam(style.main);paramRef.current=style.main;setParam(style.main);
            if(device?.spec.features.sideLight){await setSideLight(style.side);sideRef.current=style.side;setSide(style.side);}
            toast.success(`Style ${style.name} appliqué.`);
          }catch(e){toast.error(String(e));}finally{setStyleBusy(false);}
        }} className="rounded-xl border border-border bg-card p-4 text-left hover:bg-accent disabled:opacity-50">
          <span className="mb-3 block h-2 rounded-full" style={{background:`linear-gradient(90deg,rgb(${style.main.r},${style.main.g},${style.main.b}),rgb(${style.side.r},${style.side.g},${style.side.b}))`}} />
          <div className="font-medium">{style.name}</div><div className="mt-1 text-xs text-muted-foreground">{style.description}</div>
        </button>)}</div>
        {styleBusy&&<p role="status" className="text-sm text-primary">Application du style au clavier et aux bandes latérales…</p>}
      </Section>

      {!resolving && !opts?.ledOff && param.mode!==13 && (
        <EffectPreview
            layout={layout}
            family={family}
            param={{
              mode: param.mode,
              speed: param.speed,
              brightness: param.brightness,
              brightnessMax,
              option: param.option,
              rainbow: colorless || param.dazzle,
              r: param.r,
              g: param.g,
              b: param.b,
            }}
          />
      )}

      {modes.some(m=>m.value===8) && <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-medium">Variantes réactives et inspirations communautaires</summary><Section title="Préréglages réactifs" hint="Variantes des effets natifs Réaction aux touches, Rayonnement et Ondulation : couleur, vitesse et luminosité. Un clic applique le réglage.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {REACTIVE_PRESETS.filter(p=>modes.some(m=>m.value===p.mode)).map(preset=>{
            const active=matchesReactive(param,preset);
            return <button key={preset.id} aria-pressed={active} disabled={device?.readOnly}
              onClick={()=>{setLedOff(false);commit(reactiveParams(paramRef.current??param,preset));}}
              className={cn('rounded-xl border p-3 text-left transition-colors disabled:opacity-50',active?'border-primary bg-primary/10':'border-border bg-card hover:bg-accent')}>
              <span className="mb-2 block h-2 rounded-full" style={{background:preset.rainbow?'linear-gradient(90deg, #ff4141,#ffcf40,#40ef88,#488bff,#c346ff)':`rgb(${preset.color.join(',')})`}} />
              <div className="text-sm font-medium">{preset.name}</div>
              <div className="mt-1 text-xs text-muted-foreground">{preset.description}</div>
              {preset.inspiration&&<span className="mt-2 block text-xs text-primary">Inspiré de QMK · adaptation native</span>}
            </button>;
          })}
        </div>
        {[5,8,14].includes(param.mode)&&<div className="space-y-2 rounded-lg border border-border p-3">
          <label htmlFor="reactive-try" className="text-sm font-medium">Tester la réaction des touches</label>
          <Input id="reactive-try" placeholder="Tapez ici et observez le clavier…" aria-label="Tester les touches réactives" />
          <p className="text-xs text-muted-foreground">La réaction est exécutée par le clavier. Le texte saisi ici n’est pas enregistré dans un profil ou une macro.</p>
        </div>}
      </Section></details>}

      {[13,16].includes(param.mode)&&<Section title="Grille multicolore personnalisée" hint="Motif fixe avec plusieurs couleurs. L’effet animé natif Grille de couleurs reste disponible séparément.">
        <div className="flex flex-wrap gap-4">{palette.map((hex,i)=><label key={i} className="space-y-1 text-sm">
          <span className="block">Couleur {i+1}</span><input type="color" aria-label={`Couleur de grille ${i+1}`} value={hex} onChange={e=>setPalette(prev=>prev.map((c,j)=>j===i?e.target.value:c))} />
        </label>)}</div>
        <button disabled={gridBusy||gridWait>0||device?.readOnly} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" onClick={async()=>{
          if(gridBusy||gridWait)return;setGridBusy(true);
          try{setLedOff(false);await writePerKey(gridImage(palette),true);const p=await getLedParam();paramRef.current=p;setParam(p);toast.success('Motif multicolore appliqué.');}
          catch(e){toast.error(String(e));}finally{setGridBusy(false);setGridDeadline(Date.now()+10000);}
        }}>{gridBusy?'Application…':gridWait?`Patientez ${gridWait} s`:'Appliquer le motif multicolore'}</button>
        <p className="text-xs text-muted-foreground">Le motif remplace les couleurs par touche enregistrées. Modifier la palette ne lance aucun envoi ; seul ce bouton applique le motif.</p>
      </Section>}

      <Section title={t("Effect")}>
        <Input aria-label="Rechercher un effet" placeholder="Rechercher un effet…" value={query} onChange={e=>setQuery(e.target.value)} />
        <div className="flex flex-wrap gap-1">{["Tous","Ambiances","Mouvements","Réactifs","Indisponibles"].map(g=><Chip key={g} on={group===g} onClick={()=>setGroup(g)}>{g}</Chip>)}</div>
        <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
          {modes.filter(m=>t(m.label).toLocaleLowerCase('fr').includes(query.toLocaleLowerCase('fr'))&&(group==='Tous'||EFFECT_INFO[m.value]?.group===group)).map(m=>{
            const unavailable=unavailableEffect(device,m.value);
            return <button key={m.value} disabled={unavailable} onClick={()=>commit({mode:m.value,option:0})}
              className={cn('rounded-xl border p-3 text-left transition-colors',param.mode===m.value?'border-primary bg-primary/10':'border-border bg-card hover:bg-accent',unavailable&&'cursor-not-allowed opacity-60')}>
              <div className="text-sm font-medium">{t(m.label)}</div>
              <div className="mt-1 text-xs text-muted-foreground">{EFFECT_INFO[m.value]?.hint}</div>
              <div className="mt-2 text-xs text-primary">{unavailable?'Indisponible sur ce clavier':m.noColor?'Couleurs automatiques':[5,8,14].includes(m.value)?'Réagit aux touches':'Couleur personnalisable'}</div>
            </button>;
          })}
        </div>
        <p className="text-xs text-muted-foreground">Aperçu indicatif : le rendu et la vitesse du clavier peuvent différer.</p>
        {mode?.options && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
            <span className="text-sm font-semibold">{t("Direction")}</span>
            {mode.options.map((opt, i) =>
              opt === null ? null : (
                <Chip key={opt} on={param.option === i} onClick={() => commit({ option: i })} className="min-h-9 px-4 text-sm">
                  {t(opt)}
                </Chip>
              ),
            )}
          </div>
        )}
      </Section>

      {[5,8,14].includes(param.mode) && (
        <p className="text-sm text-muted-foreground">
          Cet effet réagit aux touches. Appuyez sur plusieurs touches pour le voir.
        </p>
      )}
      {family === "yc500" && param.speed === 0 && param.mode === 3 && (
        <p className="text-sm text-muted-foreground">
          À vitesse 0, l’animation peut rester immobile. Augmentez la vitesse.
        </p>
      )}

      <Section
        title={t("Color")}
        hint={colorless ? t("This effect brings its own colours.") : undefined}
        className={cn(colorless && "opacity-50")}
      >
        {opts?.ledOff && (
          <Banner>{t("The backlight is off. Pick a colour or rainbow to light it back up.")}</Banner>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {SWATCHES.map((c) => (
            <button
              key={c}
              disabled={colorless}
              onClick={() => pickColor(hexToRgb(c))}
              className={cn(
                "h-8 w-8 rounded-full transition-transform enabled:hover:scale-110",
                !param.dazzle && hex === c && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
          <input
            type="color"
            value={hex}
            disabled={colorless}
            onChange={(e) => {
              const rgb = hexToRgb(e.target.value);
              if (isNearBlack(rgb) && opts) {
                setLedOff(true);
                return;
              }
              setLedOff(false);
              commitIdle({ ...rgb, dazzle: false });
            }}
            className="h-8 w-8 cursor-pointer rounded-full bg-transparent"
            aria-label={t("Custom color")}
          />
          <label htmlFor="dazzle" className="ml-auto flex items-center gap-2 text-sm">
            {t("Rainbow")}
            <Switch
              id="dazzle"
              disabled={colorless}
              checked={colorless ? true : param.dazzle}
              onCheckedChange={(v) => {
                if (v) setLedOff(false);
                commit({ dazzle: v });
              }}
            />
          </label>
        </div>
        {!colorless && (
          <p className="text-xs text-muted-foreground">
            {owned ? (
              <>
                {t("Swapped for this board.")}{" "}
                <button
                  className="text-primary underline underline-offset-2"
                  onClick={() => applySwap(defaultSwap.current)}
                >
                  {t("Undo")}
                </button>
              </>
            ) : (
              <>
                {t("Rainbow where you picked a colour, or one colour where you asked for the rainbow?")}{" "}
                <button
                  className="text-primary underline underline-offset-2"
                  onClick={() => applySwap(!swapped)}
                >
                  {t("Swap them")}
                </button>
              </>
            )}
          </p>
        )}
      </Section>

      <Section title={t("Motion")}>
        <p className="text-xs text-muted-foreground">La vitesse règle le moteur du clavier, pas un nombre de secondes. Les durées de l’aperçu sont indicatives ; la durée réelle de disparition et la superposition dépendent de l’effet.</p>
          {/* eslint-disable-next-line react-hooks/refs */}
        <div className="grid gap-6 sm:grid-cols-2">
          {/* eslint-disable-next-line react-hooks/refs */}
          {slider(t("Brightness"), param.brightness, brightnessMax, (v) => update({ brightness: v }), (v) => commit({ brightness: v }))}
          {/* eslint-disable-next-line react-hooks/refs */}
          {slider(t("Speed"), param.speed, mode?.speedMax ?? 4, (v) => update({ speed: v }), (v) => commit({ speed: v }), !!mode?.noSpeed)}
        </div>
      </Section>

      {side && (
        <Section title={t("Edge light")} hint={sideColorless ? t("This effect brings its own colours.") : undefined}>
          <div className="flex flex-wrap gap-1">
            {SIDE_MODES.map((m) => (
              <Chip key={m.value} on={side.mode === m.value} onClick={() => commitSide({ mode: m.value })}>
                {t(m.label)}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {SWATCHES.map((c) => (
              <button
                key={c}
                disabled={sideColorless}
                onClick={() => commitSide({ ...hexToRgb(c), dazzle: false })}
                className={cn(
                  "h-7 w-7 rounded-full transition-transform hover:scale-110",
                  !side.dazzle && rgbToHex(side.r, side.g, side.b) === c && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
            <label htmlFor="side-dazzle" className="ml-auto flex items-center gap-2 text-sm">
              {t("Rainbow")}
              <Switch
                id="side-dazzle"
                disabled={sideColorless}
                checked={sideColorless || side.dazzle}
                onCheckedChange={(v) => commitSide({ dazzle: v })}
              />
            </label>
          </div>
          <div className="grid gap-6 sm:grid-cols-2">
            {/* eslint-disable-next-line react-hooks/refs */}
            {slider(t("Brightness"), side.brightness, 4, (v) => updateSide({ brightness: v }), (v) => commitSide({ brightness: v }))}
            {/* eslint-disable-next-line react-hooks/refs */}
            {slider(t("Speed"), side.speed, 4, (v) => updateSide({ speed: v }), (v) => commitSide({ speed: v }))}
          </div>
        </Section>
      )}
    </div>
  );
}
