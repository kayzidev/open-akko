// SPDX-License-Identifier: GPL-3.0-or-later
//! Platform-independent analysis and model-specific LED composition.
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

pub const BANDS: usize = 32;
const N: usize = 512;
const RATE: f32 = 24000.0;
mod capture;
#[cfg(any(target_os = "windows", test))]
mod pcm;
use crate::profiles::AudioProfile;
pub use capture::sources;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub target: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrackConfig {
    pub enabled: bool,
    pub source_id: String,
    pub effect: String,
    pub gain: f32,
    pub floor_db: f32,
    pub release_ms: f32,
}
impl TrackConfig {
    fn validate(&self, kind: &str) -> bool {
        (!self.enabled || self.source_id.starts_with(&format!("{kind}:")))
            && matches!(self.effect.as_str(), "spectrum" | "volume" | "bass")
            && (kind != "microphone" || self.effect == "volume")
            && self.gain.is_finite()
            && (0.25..=8.0).contains(&self.gain)
            && self.floor_db.is_finite()
            && (-80.0..=-15.0).contains(&self.floor_db)
            && self.release_ms.is_finite()
            && (20.0..=1000.0).contains(&self.release_ms)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub output: TrackConfig,
    pub microphone: TrackConfig,
    pub brightness: u8,
    pub rainbow: bool,
    pub color: [u8; 3],
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !self.output.validate("system")
            || !self.microphone.validate("microphone")
            || self.brightness > 4
        {
            return Err("Réglage audio invalide.".into());
        }
        if !self.output.enabled && !self.microphone.enabled {
            return Err("Activez la sortie audio ou le microphone.".into());
        }
        Ok(())
    }
    pub fn same_light(&self, other: &Self) -> bool {
        (self.brightness, self.rainbow, self.color)
            == (other.brightness, other.rainbow, other.color)
    }
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meter {
    pub active: bool,
    pub ready: bool,
    pub level: f32,
    pub frames: u64,
    pub error: Option<String>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub running: bool,
    pub bands: [u8; BANDS],
    pub output: Meter,
    pub microphone: Meter,
    pub frames: u64,
    pub error: Option<String>,
    pub config: Option<Config>,
}
#[derive(Clone)]
struct Snapshot {
    values: [f32; BANDS],
    meter: Meter,
    updated: Instant,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            values: [0.0; BANDS],
            meter: Meter {
                active: true,
                ..Meter::default()
            },
            updated: Instant::now(),
        }
    }
}
struct Track {
    source_id: String,
    stop: Arc<AtomicBool>,
    capture: Box<dyn capture::StopCapture>,
    config: Arc<Mutex<TrackConfig>>,
    snapshot: Arc<Mutex<Snapshot>>,
    worker: Option<JoinHandle<()>>,
}
impl Track {
    fn open(config: &TrackConfig, source: &Source) -> Result<Self, String> {
        let capture::Capture { mut input, control } = capture::open(source)?;
        let stop = Arc::new(AtomicBool::new(false));
        let reader_stop = stop.clone();
        let shared_config = Arc::new(Mutex::new(config.clone()));
        let reader_config = shared_config.clone();
        let snapshot = Arc::new(Mutex::new(Snapshot::default()));
        let reader_snapshot = snapshot.clone();
        let initial = config.clone();
        let worker = std::thread::spawn(move || {
            let mut analyzer = Analyzer::new(initial);
            while !reader_stop.load(Ordering::Relaxed) {
                let samples = match input.read_frame() {
                    Ok(samples) => samples,
                    Err(error) => {
                        if !reader_stop.load(Ordering::Relaxed) {
                            let mut s = reader_snapshot.lock();
                            s.meter.active = false;
                            s.meter.error = Some(error);
                        }
                        break;
                    }
                };
                if reader_stop.load(Ordering::Relaxed) {
                    break;
                }
                analyzer.config = reader_config.lock().clone();
                let (values, level) = analyzer.process(&samples);
                let mut s = reader_snapshot.lock();
                s.values = values;
                s.meter.level = level;
                s.meter.ready = true;
                s.meter.frames += 1;
                s.updated = Instant::now();
            }
        });
        Ok(Self {
            source_id: source.id.clone(),
            stop,
            capture: control,
            config: shared_config,
            snapshot,
            worker: Some(worker),
        })
    }
    fn sample(&self) -> Snapshot {
        let mut s = self.snapshot.lock().clone();
        if s.updated.elapsed() > Duration::from_secs(3) {
            s.meter.active = false;
            s.meter.error =
                Some("La source ne fournit plus de son. Choisissez une source active.".into());
        }
        if !s.meter.active {
            s.values = [0.0; BANDS];
            s.meter.level = 0.0;
        }
        s
    }
}
impl Drop for Track {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.capture.stop();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

pub struct Inputs {
    output: Option<Track>,
    microphone: Option<Track>,
}
impl Inputs {
    pub fn open(config: &Config, sources: &[Source]) -> Result<Self, String> {
        let mut inputs = Self {
            output: None,
            microphone: None,
        };
        inputs.update(config, sources)?;
        Ok(inputs)
    }
    fn update(&mut self, config: &Config, sources: &[Source]) -> Result<(), String> {
        // Prepare both replacements before dropping an existing capture.
        let prepare = |current: &Option<Track>,
                       c: &TrackConfig,
                       kind: &str|
         -> Result<Option<Track>, String> {
            if !c.enabled {
                return Ok(None);
            }
            let source = sources
                .iter()
                .find(|s| s.id == c.source_id && s.kind == kind)
                .ok_or("Cette source audio n’est plus disponible.")?;
            if current
                .as_ref()
                .is_some_and(|t| t.source_id == c.source_id && t.sample().meter.active)
            {
                return Ok(None);
            }
            Track::open(c, source).map(Some)
        };
        let output = prepare(&self.output, &config.output, "system")?;
        let microphone = prepare(&self.microphone, &config.microphone, "microphone")?;
        if !config.output.enabled {
            self.output = None;
        } else if output.is_some() {
            self.output = output;
        }
        if !config.microphone.enabled {
            self.microphone = None;
        } else if microphone.is_some() {
            self.microphone = microphone;
        }
        if let Some(t) = &self.output {
            *t.config.lock() = config.output.clone();
        }
        if let Some(t) = &self.microphone {
            *t.config.lock() = config.microphone.clone();
        }
        Ok(())
    }
}
enum Control {
    Configure(Config, Vec<Source>, mpsc::SyncSender<Result<(), String>>),
}
pub struct Session {
    stop: Arc<AtomicBool>,
    control: mpsc::Sender<Control>,
    worker: Option<JoinHandle<()>>,
}
impl Session {
    pub fn start(
        mut inputs: Inputs,
        config: Config,
        profile: AudioProfile,
        status: Arc<Mutex<Status>>,
        mut send: impl FnMut([u8; BANDS]) -> Result<(), String> + Send + 'static,
        finish: impl FnOnce() -> Result<(), String> + Send + 'static,
    ) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let (control, requests) = mpsc::channel();
        *status.lock() = Status {
            running: true,
            config: Some(config),
            ..Status::default()
        };
        let worker = std::thread::spawn(move || {
            let mut error = None;
            while !worker_stop.load(Ordering::Relaxed) {
                let tick = Instant::now();
                while let Ok(Control::Configure(next, sources, reply)) = requests.try_recv() {
                    let result = inputs.update(&next, &sources);
                    if result.is_ok() {
                        status.lock().config = Some(next);
                    }
                    if reply.send(result).is_err() {
                        log::warn!("Audio configuration reply channel closed");
                    }
                }
                let output = inputs.output.as_ref().map(Track::sample);
                let mic = inputs.microphone.as_ref().map(Track::sample);
                if !output.as_ref().is_some_and(|s| s.meter.active)
                    && !mic.as_ref().is_some_and(|s| s.meter.active)
                {
                    error=Some("Les sources audio sont indisponibles. L’éclairage précédent a été rétabli.".into());
                    break;
                }
                let bands = compose(
                    &profile,
                    output.as_ref().map(|s| &s.values),
                    mic.as_ref().map(|s| s.meter.level),
                );
                if let Err(e) = send(bands) {
                    error = Some(e);
                    break;
                }
                {
                    let mut s = status.lock();
                    s.bands = bands;
                    s.output = output.map(|v| v.meter).unwrap_or_default();
                    s.microphone = mic.map(|v| v.meter).unwrap_or_default();
                    s.frames += 1;
                }
                // One USB writer for both inputs. Capture threads overwrite snapshots.
                if let Some(wait) = Duration::from_millis(20).checked_sub(tick.elapsed()) {
                    std::thread::sleep(wait);
                }
            }
            drop(inputs);
            if let Err(e) = finish() {
                error = Some(format!("Impossible de rétablir l’éclairage : {e}"));
            }
            let mut s = status.lock();
            s.running = false;
            s.bands = [0; BANDS];
            s.output = Meter::default();
            s.microphone = Meter::default();
            s.error = error;
        });
        Self {
            stop,
            control,
            worker: Some(worker),
        }
    }
    pub fn update(&self, config: Config, sources: Vec<Source>) -> Result<(), String> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.control
            .send(Control::Configure(config, sources, tx))
            .map_err(|_| "Le mode audio s’est arrêté.".to_string())?;
        rx.recv_timeout(Duration::from_secs(5)).map_err(|_| {
            "La modification audio a pris trop de temps. Arrêtez puis réactivez le mode audio."
                .to_string()
        })?
    }
    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.stop();
    }
}

fn compose(
    profile: &AudioProfile,
    output: Option<&[f32; BANDS]>,
    microphone: Option<f32>,
) -> [u8; BANDS] {
    let mut frame = [0; BANDS];
    let output_columns: Vec<_> = profile
        .columns
        .iter()
        .copied()
        .filter(|c| microphone.is_none() || !profile.microphone_columns.contains(c))
        .collect();
    let columns = output_columns.len();
    if let Some(values) = output {
        for (column, wire_column) in output_columns.iter().enumerate() {
            let dest = &mut frame[usize::from(*wire_column)];
            let start = column * BANDS / columns;
            let end = ((column + 1) * BANDS / columns).max(start + 1);
            let value = values[start..end].iter().copied().fold(0.0_f32, f32::max);
            *dest = (value * 6.0).round().clamp(0.0, 6.0) as u8;
        }
    }
    if let Some(level) = microphone {
        for column in &profile.microphone_columns {
            frame[usize::from(*column)] = (level * 6.0).round().clamp(0.0, 6.0) as u8;
        }
    }
    frame
}
struct Analyzer {
    config: TrackConfig,
    smooth: [f32; BANDS],
    level: f32,
    window: [f32; N],
}
impl Analyzer {
    fn new(config: TrackConfig) -> Self {
        Self {
            config,
            smooth: [0.0; BANDS],
            level: 0.0,
            window: std::array::from_fn(|i| {
                0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (N - 1) as f32).cos()
            }),
        }
    }
    fn process(&mut self, samples: &[f32; N]) -> ([f32; BANDS], f32) {
        let mean = samples.iter().sum::<f32>() / N as f32;
        let rms = (samples.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / N as f32).sqrt();
        let normalize = |value: f32| {
            ((20.0 * (value * self.config.gain).max(1e-8).log10() - self.config.floor_db)
                / -self.config.floor_db)
                .clamp(0.0, 1.0)
        };
        let floor = 10.0_f32.powf(self.config.floor_db / 20.0);
        let level = if rms < floor { 0.0 } else { normalize(rms) };
        let decay = (-(N as f32 / RATE) / (self.config.release_ms / 1000.0)).exp();
        self.level = level.max(self.level * decay);
        let mut values = [0.0; BANDS];
        // Microphone / volume mode skips the FFT entirely.
        if self.config.effect == "volume" {
            values.fill(level);
        } else if rms >= floor {
            let mut re = std::array::from_fn(|i| (samples[i] - mean) * self.window[i]);
            let mut im = [0.0; N];
            fft(&mut re, &mut im);
            for (band, v) in values.iter_mut().enumerate() {
                let low = (50.0_f32 * 200.0_f32.powf(band as f32 / BANDS as f32) * N as f32 / RATE)
                    .floor() as usize;
                let high = (50.0_f32 * 200.0_f32.powf((band + 1) as f32 / BANDS as f32) * N as f32
                    / RATE)
                    .ceil() as usize;
                let mag = (low.max(1)..high.max(low + 1).min(N / 2))
                    .map(|k| (re[k] * re[k] + im[k] * im[k]).sqrt() * 4.0 / N as f32)
                    .fold(0.0_f32, f32::max);
                *v = normalize(mag);
            }
            if self.config.effect == "bass" {
                let bass = values[..10].iter().copied().fold(0.0_f32, f32::max);
                values.fill(bass);
            }
        }
        for (s, v) in self.smooth.iter_mut().zip(values) {
            *s = v.max(*s * decay);
        }
        (self.smooth, self.level)
    }
}

fn fft(re: &mut [f32; N], im: &mut [f32; N]) {
    let mut j = 0;
    for i in 1..N {
        let mut bit = N >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= N {
        let angle = -2.0 * std::f32::consts::PI / len as f32;
        let (step_i, step_r) = angle.sin_cos();
        for start in (0..N).step_by(len) {
            let (mut wr, mut wi) = (1.0, 0.0);
            for k in 0..len / 2 {
                let a = start + k;
                let b = a + len / 2;
                let tr = wr * re[b] - wi * im[b];
                let ti = wr * im[b] + wi * re[b];
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                (wr, wi) = (wr * step_r - wi * step_i, wr * step_i + wi * step_r);
            }
        }
        len *= 2;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn layout() -> AudioProfile {
        crate::profiles::for_spec(&crate::registry::by_id(1165).unwrap())
            .unwrap()
            .audio
            .clone()
            .unwrap()
    }
    fn track(kind: &str) -> TrackConfig {
        TrackConfig {
            enabled: true,
            source_id: format!("{kind}:test"),
            effect: if kind == "microphone" {
                "volume"
            } else {
                "spectrum"
            }
            .into(),
            gain: 1.0,
            floor_db: -55.0,
            release_ms: 60.0,
        }
    }
    fn config() -> Config {
        Config {
            output: track("system"),
            microphone: track("microphone"),
            brightness: 3,
            rainbow: true,
            color: [0, 200, 255],
        }
    }
    fn sine(hz: f32, amplitude: f32) -> [f32; N] {
        std::array::from_fn(|i| {
            amplitude * (2.0 * std::f32::consts::PI * hz * i as f32 / RATE).sin()
        })
    }
    #[test]
    fn silence_and_dc_are_dark() {
        for input in [[0.0; N], [0.4; N]] {
            let (b, l) = Analyzer::new(track("system")).process(&input);
            assert_eq!(b, [0.0; BANDS]);
            assert!(l < 0.001);
        }
    }
    #[test]
    fn fft_locates_tone() {
        let (b, _) = Analyzer::new(track("system")).process(&sine(1000.0, 0.6));
        let peak = b
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.total_cmp(b))
            .unwrap()
            .0;
        assert!((15..=20).contains(&peak), "{b:?}");
        assert!(b[peak] > 0.7);
        assert!(b[0] < b[peak]);
    }
    #[test]
    fn microphone_attack_is_one_short_frame() {
        let mut a = Analyzer::new(track("microphone"));
        assert_eq!(a.process(&[0.0; N]).1, 0.0);
        assert!(a.process(&sine(500.0, 0.8)).1 > 0.8);
        assert!(N as f32 / RATE < 0.022);
    }
    #[test]
    fn louder_voice_gives_higher_level() {
        let (_, quiet) = Analyzer::new(track("microphone")).process(&sine(500.0, 0.01));
        let (_, loud) = Analyzer::new(track("microphone")).process(&sine(500.0, 0.8));
        assert!(loud > quiet);
    }
    #[test]
    fn silence_gate_and_fast_release() {
        let mut a = Analyzer::new(track("microphone"));
        assert_eq!(a.process(&sine(500.0, 0.00001)).1, 0.0);
        a.process(&sine(500.0, 0.8));
        for _ in 0..15 {
            a.process(&[0.0; N]);
        }
        assert!(a.level < 0.01);
    }
    #[test]
    fn dual_mix_keeps_microphone_exclusive_to_right_column() {
        let output = [0.4; BANDS];
        let frame = compose(&layout(), Some(&output), Some(1.0));
        assert!(frame[..16].iter().all(|v| *v == 2));
        assert_eq!(frame[16], 6);
        assert_eq!(frame[17..], [0; 15]);
    }
    #[test]
    fn microphone_never_leaks_into_output_zone() {
        let frame = compose(&layout(), None, Some(0.8));
        assert_eq!(frame[..16], [0; 16]);
        assert_eq!(frame[16], 5);
        assert_eq!(frame[17..], [0; 15]);
    }
    #[test]
    fn reserved_column_is_not_affected_by_output() {
        let frame = compose(&layout(), Some(&[1.0; BANDS]), Some(0.0));
        assert_eq!(frame[16], 0);
        assert!(frame[..16].iter().all(|v| *v == 6));
    }
    #[test]
    fn disabling_microphone_returns_column_to_output() {
        let frame = compose(&layout(), Some(&[1.0; BANDS]), None);
        assert!(frame[..17].iter().all(|v| *v == 6));
    }
    #[test]
    fn whole_spectrum_is_remapped_when_microphone_is_enabled() {
        let mut values = [0.0; BANDS];
        values[31] = 1.0;
        let frame = compose(&layout(), Some(&values), Some(0.0));
        assert_eq!(frame[15], 6);
        assert_eq!(frame[16], 0);
    }
    #[test]
    fn model_geometry_can_reserve_non_contiguous_microphone_columns() {
        let mut profile = layout();
        profile.columns = vec![1, 3, 6, 9];
        profile.microphone_columns = vec![3, 9];
        assert!(profile.valid());
        let frame = compose(&profile, Some(&[0.5; BANDS]), Some(1.0));
        assert_eq!(frame[1], 3);
        assert_eq!(frame[6], 3);
        assert_eq!(frame[3], 6);
        assert_eq!(frame[9], 6);
        assert_eq!(frame[16], 0);
        assert_eq!(frame.iter().filter(|v| **v > 0).count(), 4);
    }
    #[test]
    fn invalid_input_configuration_is_refused() {
        let mut c = config();
        c.microphone.source_id = "system:not-a-mic".into();
        assert!(c.validate().is_err());
        c = config();
        c.output.gain = f32::NAN;
        assert!(c.validate().is_err());
        c = config();
        c.output.enabled = false;
        c.microphone.enabled = false;
        assert!(c.validate().is_err());
    }
    #[test]
    #[ignore = "requires the user's PipeWire inputs; no sound is saved, no USB writes"]
    fn pipewire_dual_capture_and_live_toggles() {
        let sources = sources().unwrap();
        let mut c = config();
        c.output.source_id = sources
            .iter()
            .find(|s| s.kind == "system")
            .expect("output")
            .id
            .clone();
        c.microphone.source_id = sources
            .iter()
            .find(|s| s.kind == "microphone")
            .expect("microphone")
            .id
            .clone();
        let inputs = Inputs::open(&c, &sources).unwrap();
        let status = Arc::new(Mutex::new(Status::default()));
        let finished = Arc::new(AtomicBool::new(false));
        let finish = finished.clone();
        let mut session = Session::start(
            inputs,
            c.clone(),
            layout(),
            status.clone(),
            |_| Ok(()),
            move || {
                finish.store(true, Ordering::Relaxed);
                Ok(())
            },
        );
        std::thread::sleep(Duration::from_secs(3));
        {
            let s = status.lock();
            println!(
                "Mixed frames {}, output blocks {}, microphone blocks {}",
                s.frames, s.output.frames, s.microphone.frames
            );
            assert!(s.running);
            assert!(s.output.ready);
            assert!(s.microphone.ready);
            assert!(s.frames > 90);
            assert!(s.output.error.is_none());
            assert!(s.microphone.error.is_none());
        }
        c.microphone.enabled = false;
        session.update(c.clone(), sources.clone()).unwrap();
        std::thread::sleep(Duration::from_millis(150));
        {
            let s = status.lock();
            assert!(s.running);
            assert!(!s.microphone.active);
            assert!(s.output.active);
            assert!(!finished.load(Ordering::Relaxed));
        }
        c.microphone.enabled = true;
        session.update(c, sources).unwrap();
        std::thread::sleep(Duration::from_secs(2));
        assert!(status.lock().microphone.ready);
        session.stop();
        assert!(!status.lock().running);
        assert!(status.lock().error.is_none());
        assert!(finished.load(Ordering::Relaxed));
    }
}
