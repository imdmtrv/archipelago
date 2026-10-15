import { CUES, CUE_IDS, type AudioBus, type CueId } from './cues';
import { synthesize, type SynthVoice } from './synth';
import { getAudioSettings, getCueSource, subscribeAudioSettings, type AudioSource } from './settings';

export type MusicScene = 'island' | 'free' | 'epilogue';
interface PlayOptions { delayMs?: number; pitchStep?: number; variant?: number; source?: AudioSource }
interface AudioLogEntry { t: number; cue: CueId; bus: AudioBus; source: 'file' | 'synth'; pitchStep?: number; variant?: number }
declare global { interface Window { __audioLog?: AudioLogEntry[] } }
type Role = 'effect' | 'sample' | 'music' | 'ambience';
interface Voice {
  id: number; cue: CueId; role: Role; gain: GainNode; handle: SynthVoice;
  endAt: number; timer?: ReturnType<typeof setTimeout>; fadeTimer?: ReturnType<typeof setTimeout>;
  source?: AudioLogEntry['source']; media?: HTMLAudioElement; resume?: () => void; pause?: () => void;
  choice: AudioSource; fileReady?: boolean;
}
const randomBetween = (low: number, high: number) => low + Math.random() * (high - low);
const SAMPLE_SECONDS = 6;
const FANFARES = new Set<CueId>(['freedom', 'freedom.level', 'dream.stage', 'dream.launch', 'epilogue']);
function releaseStream(element: HTMLAudioElement, node?: MediaElementAudioSourceNode) {
  element.onended = element.onerror = null;
  try { element.pause(); } catch {}
  try { element.removeAttribute('src'); } catch {}
  try { element.load(); } catch {}
  try { node?.disconnect(); } catch {}
}

class AudioEngine {
  private context?: AudioContext;
  private master?: GainNode;
  private buses?: Record<AudioBus, GainNode>;
  private musicDuck?: GainNode;
  private failed = false;
  private epoch = 0;
  private sequence = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private voices: Voice[] = [];
  private lastPlayed = new Map<CueId, number>();
  private decoded = new Map<string, AudioBuffer>();
  private loading = new Map<string, Promise<void>>();
  private scene: MusicScene | null = null;
  private sceneListeners = new Set<() => void>();
  private ambience = false;
  private weather: 'clear' | 'storm' = 'clear';
  private musicVoice?: Voice;
  private musicTimer?: ReturnType<typeof setTimeout>;
  private gullTimer?: ReturnType<typeof setTimeout>;
  private thunderTimer?: ReturnType<typeof setTimeout>;
  private variant = 0;
  private resuming?: Promise<void>;
  private epilogueEvent?: PlayOptions;
  private auditionSequence = 0;

  getScene = () => this.scene;
  subscribeScene = (listener: () => void) => {
    this.sceneListeners.add(listener);
    return () => { this.sceneListeners.delete(listener); };
  };
  private notifyScene() {
    this.sceneListeners.forEach((listener) => {
      try { listener(); } catch { /* A UI subscriber must never interrupt audio. */ }
    });
  }

  constructor() {
    subscribeAudioSettings(() => {
      this.applySettings();
      this.preloadSelected();
      if (getAudioSettings().enabled) this.reconcile();
    });
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
      const context = this.context;
      if (!context) return;
      if (document.hidden) {
        this.cancel(this.gullTimer); this.gullTimer = undefined;
        this.cancel(this.thunderTimer); this.thunderTimer = undefined;
        this.voices.forEach((voice) => { try { voice.pause?.(); } catch {} });
        try { void context.suspend().then(() => { if (!document.hidden) this.resume(); }, () => {}); } catch {}
      } else {
        this.resume();
      }
    });
  }

  /** Call synchronously from a trusted pointer or keyboard gesture, never from an effect. */
  unlock() {
    if (this.failed || document.hidden) return;
    try {
      if (!this.context) {
        const Constructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Constructor) { this.failed = true; return; }
        const context = this.context = new Constructor();
        this.master = context.createGain();
        this.musicDuck = context.createGain();
        this.buses = { music: context.createGain(), sfx: context.createGain(), ambience: context.createGain() };
        this.buses.music.connect(this.musicDuck); this.musicDuck.connect(this.master);
        this.buses.sfx.connect(this.master); this.buses.ambience.connect(this.master);
        const limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -3; limiter.knee.value = 6; limiter.ratio.value = 12;
        limiter.attack.value = 0.005; limiter.release.value = 0.12;
        this.master.connect(limiter); limiter.connect(context.destination);
        this.applySettings();
        this.preloadSelected();
      }
      this.resume(true);
    } catch { this.failed = true; this.stop(); }
  }

  private resume(fromGesture = false) {
    if (!this.context || document.hidden || (this.resuming && !fromGesture)) return;
    try {
      const ready = () => {
        try {
          if (document.hidden) {
            void this.context?.suspend().catch(() => {});
            return;
          }
          if (this.context?.state !== 'running') { this.resume(); return; }
          this.voices.forEach((voice) => { if (voice.media?.paused) voice.resume?.(); });
          this.reconcile();
        } catch { /* Visibility can interrupt browser audio operations. */ }
      };
      if (this.context.state === 'running') { this.resuming = undefined; ready(); return; }
      // Новый жест повторяет попытку, даже если браузер удерживает прежний промис.
      const pending = this.context.resume().then(() => {
        if (this.resuming !== pending) return;
        this.resuming = undefined;
        ready();
      }, () => { if (this.resuming === pending) this.resuming = undefined; });
      this.resuming = pending;
    } catch { /* Unsupported or interrupted audio must never affect play. */ }
  }

  private later(callback: () => void, delay: number) {
    const epoch = this.epoch;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (epoch === this.epoch) { try { callback(); } catch { /* Audio is optional. */ } }
    }, Math.max(0, delay));
    this.timers.add(timer);
    return timer;
  }
  private cancel(timer?: ReturnType<typeof setTimeout>) { if (timer !== undefined) { clearTimeout(timer); this.timers.delete(timer); } }

  private applySettings() {
    if (!this.context || !this.master || !this.buses) return;
    try {
      const settings = getAudioSettings();
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(settings.enabled ? 1 : 0, this.context.currentTime);
      for (const bus of ['music', 'sfx', 'ambience'] as const) this.buses[bus].gain.setValueAtTime(settings[bus], this.context.currentTime);
    } catch { /* A closed context is harmless. */ }
  }

  private log(cue: CueId, source: AudioLogEntry['source'], options: PlayOptions = {}, variant?: number) {
    try {
      if (localStorage.getItem('archipelago.audio.debug') !== '1') return;
      const entry: AudioLogEntry = { t: performance.now(), cue, bus: CUES[cue].bus, source, ...(options.pitchStep === undefined ? {} : { pitchStep: options.pitchStep }), ...(variant === undefined ? {} : { variant }) };
      (window.__audioLog ??= []).push(entry);
      console.debug('[audio]', cue, entry);
    } catch { /* No storage or console: no diagnostics. */ }
  }

  private started(voice: Voice, source: AudioLogEntry['source'], options: PlayOptions, variant: number) {
    voice.source = source;
    this.log(voice.cue, source, options, CUES[voice.cue].bus === 'music' ? variant : undefined);
    if (voice.role === 'music' && voice.cue === 'music.epilogue' && this.epilogueEvent) {
      this.log('epilogue', source, this.epilogueEvent, variant);
      this.epilogueEvent = undefined;
    }
  }

  private async load(file: string) {
    if (this.loading.has(file)) return this.loading.get(file);
    const loading = (async () => {
      try {
        const response = await fetch(file);
        if (!response.ok || !this.context) return;
        this.decoded.set(file, await this.context.decodeAudioData(await response.arrayBuffer()));
      } catch { /* Keep the synth fallback. */ }
    })();
    this.loading.set(file, loading);
    return loading;
  }

  private preloadSelected() {
    if (!this.context) return;
    for (const cue of CUE_IDS) {
      if (CUES[cue].bus !== 'music' && getCueSource(cue) === 'file') {
        CUES[cue].files?.forEach((file) => { void this.load(file).then(() => this.reconcile()).catch(() => {}); });
      }
    }
  }

  /** Catalogue samples wait for their files; game events keep their immediate synth fallback. */
  async audition(cue: CueId, options: PlayOptions = {}): Promise<boolean> {
    if (!this.context || this.failed) return false;
    const epoch = this.epoch;
    const audition = ++this.auditionSequence;
    const chosen = { ...options, source: options.source ?? getCueSource(cue) };
    // A/B listening replaces the previous sample, including pending file decodes.
    this.voices.filter((voice) => voice.role === 'sample').forEach((voice) => this.finish(voice));
    if (this.resuming) await this.resuming;
    if (CUES[cue].bus !== 'music' && chosen.source === 'file') await Promise.all(CUES[cue].files?.map((file) => this.load(file)) ?? []);
    return epoch === this.epoch && audition === this.auditionSequence && this.playCue(cue, chosen, 'sample');
  }

  play(cue: CueId, options: PlayOptions = {}): boolean {
    return this.playCue(cue, options, 'effect');
  }
  private playCue(cue: CueId, options: PlayOptions, role: Role): boolean {
    if (this.failed || !this.context || document.hidden || !getAudioSettings().enabled) return false;
    if (options.delayMs && options.delayMs > 0) {
      const { delayMs, ...delayedOptions } = options;
      this.later(() => { this.playCue(cue, delayedOptions, role); }, delayMs);
      return true;
    }
    if (this.context.state !== 'running') {
      const epoch = this.epoch;
      if (this.resuming) void this.resuming.then(() => { if (epoch === this.epoch) this.playCue(cue, options, role); });
      return false;
    }
    if (cue === 'epilogue' && options.source === undefined) {
      this.epilogueEvent = options;
      if (this.scene === 'epilogue' && this.musicVoice?.source) {
        this.log(cue, this.musicVoice.source, options, 0);
        this.epilogueEvent = undefined;
      }
      this.duck(); this.setScene('epilogue');
      return true;
    }
    const now = this.context.currentTime * 1000;
    const definition = CUES[cue];
    if (role !== 'sample' && now - (this.lastPlayed.get(cue) ?? -Infinity) < (definition.cooldownMs ?? 0)) return false;
    if (this.voices.filter((voice) => voice.cue === cue).length >= (definition.maxVoices ?? 4)) {
      const oldest = this.voices.find((voice) => voice.cue === cue && (voice.role === 'effect' || voice.role === 'sample'));
      if (!oldest) return false;
      this.finish(oldest);
    }
    const variant = options.variant === undefined
      ? definition.bus === 'music' ? Math.floor(Math.random() * ((options.source ?? getCueSource(cue)) === 'file' ? definition.files?.length || 2 : 2)) : 0
      : Math.max(0, Math.floor(options.variant));
    const voice = definition.bus === 'music'
      ? this.startTrack(cue, role, options, variant, 0)
      : this.startVoice(cue, role, false, options, variant);
    if (!voice) return false;
    if (role !== 'sample') this.lastPlayed.set(cue, now);
    if (FANFARES.has(cue)) this.duck();
    return true;
  }

  private startVoice(cue: CueId, role: Role, loop: boolean, options: PlayOptions = {}, variant = 0, fade = 0, forceSynth = false): Voice | undefined {
    const context = this.context;
    if (!context || !this.buses || context.state !== 'running' || document.hidden || !getAudioSettings().enabled) return;
    // Continuous layers have reserved voices; bursts steal the oldest disposable effect.
    if (this.voices.length >= 16) {
      const oldest = this.voices.find((voice) => voice.role === 'effect' || voice.role === 'sample');
      if (!oldest) return;
      this.finish(oldest);
    }
    let handle: SynthVoice | undefined;
    let gain: GainNode | undefined;
    try {
      const definition = CUES[cue];
      gain = context.createGain(); gain.connect(this.buses[definition.bus]);
      gain.gain.setValueAtTime(fade ? 0 : definition.volume, context.currentTime);
      if (fade) gain.gain.linearRampToValueAtTime(definition.volume, context.currentTime + fade);
      const pitch = 2 ** ((options.pitchStep ?? 0) / 12) * (1 + randomBetween(-(definition.pitchJitter ?? 0), definition.pitchJitter ?? 0));
      const choice = options.source ?? getCueSource(cue);
      const files = choice === 'file' && !forceSynth ? options.variant === undefined ? definition.files : definition.files?.slice(variant, variant + 1) : undefined;
      const buffers = files?.map((file) => this.decoded.get(file)).filter((buffer): buffer is AudioBuffer => !!buffer);
      const limit = (role === 'effect' || role === 'sample') && definition.synth.loop ? SAMPLE_SECONDS : Infinity;
      let source: AudioLogEntry['source'] = 'synth';
      if (buffers?.length) {
        const buffer = buffers[Math.floor(Math.random() * buffers.length)];
        let node: AudioBufferSourceNode | undefined;
        try {
          node = context.createBufferSource(); node.buffer = buffer; node.loop = loop; node.playbackRate.value = pitch; node.connect(gain); node.start();
          const duration = loop ? Infinity : Math.min(buffer.duration / pitch, limit);
          if (duration < buffer.duration / pitch) node.stop(context.currentTime + duration);
          const bufferSource = node;
          handle = { duration, stop() { try { bufferSource.stop(); } catch {} bufferSource.disconnect(); } };
          source = 'file';
        } catch { try { node?.stop(); } catch {} try { node?.disconnect(); } catch {} }
      }
      if (!handle) {
        // Catalogue loop auditions last a few seconds; actual nature layers are continuous.
        handle = synthesize(context, gain, { ...definition.synth, loop, duration: Math.min(definition.synth.duration, limit) }, pitch, variant);
      }
      const voice: Voice = { id: ++this.sequence, cue, role, gain, handle, choice, fileReady: !!buffers?.length, endAt: loop ? Infinity : context.currentTime + handle.duration };
      this.voices.push(voice); this.started(voice, source, options, variant);
      if (!loop) this.watchEnd(voice);
      return voice;
    } catch { try { handle?.stop(); gain?.disconnect(); } catch {} return; }
  }

  private watchEnd(voice: Voice) {
    this.cancel(voice.timer);
    const remaining = voice.endAt - (this.context?.currentTime ?? voice.endAt);
    voice.timer = this.later(() => {
      if (!this.voices.includes(voice)) return;
      const left = voice.endAt - (this.context?.currentTime ?? voice.endAt);
      if (left > 0.03) { this.watchEnd(voice); return; }
      const wasMusic = voice === this.musicVoice;
      this.finish(voice);
      if (wasMusic && this.scene) {
        if (this.scene === 'epilogue') { this.scene = 'free'; this.notifyScene(); this.startMusic(); }
        else this.musicTimer = this.later(() => { this.musicTimer = undefined; this.startMusic(); }, randomBetween(20000, 60000));
      }
    }, this.context?.state === 'running' ? Math.max(50, remaining * 1000 + 30) : 1000);
  }
  private finish(voice: Voice) {
    this.cancel(voice.timer);
    this.cancel(voice.fadeTimer);
    this.voices = this.voices.filter((item) => item !== voice);
    if (voice === this.musicVoice) this.musicVoice = undefined;
    try { voice.handle.stop(); } catch {}
    try { voice.gain.disconnect(); } catch {}
  }
  private fadeOut(voice: Voice, seconds: number) {
    if (!this.context) { this.finish(voice); return; }
    try {
      voice.gain.gain.cancelAndHoldAtTime(this.context.currentTime);
      voice.gain.gain.linearRampToValueAtTime(0, this.context.currentTime + seconds);
      this.cancel(voice.fadeTimer);
      voice.fadeTimer = this.later(() => { this.finish(voice); this.reconcile(); }, seconds * 1000 + 30);
    } catch { this.finish(voice); }
  }

  setScene(scene: MusicScene | null) {
    if (scene === this.scene) return;
    if (scene !== 'epilogue') this.epilogueEvent = undefined;
    this.scene = scene;
    this.notifyScene();
    this.cancel(this.musicTimer); this.musicTimer = undefined;
    if (this.musicVoice) {
      const old = this.musicVoice; this.musicVoice = undefined;
      this.fadeOut(old, scene === 'epilogue' ? 0.1 : 2.5);
    }
    if (scene) this.startMusic();
  }
  private startMusic() {
    if (!this.scene || this.musicVoice || this.musicTimer || !this.context || this.context.state !== 'running' || document.hidden || !getAudioSettings().enabled) return;
    const cue: CueId = `music.${this.scene}`;
    const variant = this.scene === 'epilogue' ? 0 : this.variant++ % 2;
    this.musicVoice = this.startTrack(cue, 'music', {}, variant, this.scene === 'epilogue' ? 0 : 2.5);
  }

  private startTrack(cue: CueId, role: Role, options: PlayOptions, variant: number, fade: number) {
    const files = CUES[cue].files;
    return (options.source ?? getCueSource(cue)) === 'file' && files?.length
      ? this.startStream(cue, files[variant % files.length], role, options, variant, fade)
      : this.startVoice(cue, role, false, options, variant, fade);
  }

  private startStream(cue: CueId, file: string, role: Role, options: PlayOptions, variant: number, fade: number): Voice | undefined {
    const context = this.context!;
    if (this.voices.length >= 16) {
      const oldest = this.voices.find((voice) => voice.role === 'effect' || voice.role === 'sample');
      if (!oldest) return;
      this.finish(oldest);
    }
    let media: HTMLAudioElement | undefined;
    let source: MediaElementAudioSourceNode | undefined;
    let gain: GainNode | undefined;
    try {
      media = new Audio(); media.preload = 'metadata'; media.src = file;
      source = context.createMediaElementSource(media);
      gain = context.createGain();
      gain.gain.setValueAtTime(fade ? 0 : CUES[cue].volume, context.currentTime);
      if (fade) gain.gain.linearRampToValueAtTime(CUES[cue].volume, context.currentTime + fade);
      source.connect(gain); gain.connect(this.buses!.music);
      const element = media, node = source;
      let attempt = 0;
      const voice: Voice = {
        id: ++this.sequence, cue, role, gain, choice: options.source ?? getCueSource(cue), endAt: Infinity, media,
        handle: { duration: Infinity, stop() { attempt++; releaseStream(element, node); } },
      };
      this.voices.push(voice);
      const epoch = this.epoch;
      const failed = () => {
        if (epoch !== this.epoch || !this.voices.includes(voice)) return;
        const current = role !== 'music' || voice === this.musicVoice;
        this.finish(voice);
        if (!current) return;
        const fallback = this.startVoice(cue, role, false, options, variant, 0.2, true);
        if (role === 'music') this.musicVoice = fallback;
      };
      media.onerror = failed;
      media.onended = () => { voice.endAt = context.currentTime; this.watchEnd(voice); };
      voice.pause = () => { attempt++; element.pause(); };
      voice.resume = () => {
        if (epoch !== this.epoch || !this.voices.includes(voice) || document.hidden) return;
        const currentAttempt = ++attempt;
        try {
          void element.play().then(() => {
            if (currentAttempt !== attempt || epoch !== this.epoch || !this.voices.includes(voice)) return;
            if (document.hidden) { voice.pause?.(); return; }
            if (voice.source === 'file') return;
            this.started(voice, 'file', options, variant);
          }, () => { if (currentAttempt === attempt && !document.hidden) failed(); });
        } catch { failed(); }
      };
      // Start after the caller installs the current music voice; a synchronous failure cannot replace a new scene.
      queueMicrotask(() => voice.resume?.());
      return voice;
    } catch {
      if (media) releaseStream(media, source);
      try { gain?.disconnect(); } catch {}
      return this.startVoice(cue, role, false, options, variant, fade, true);
    }
  }

  setAmbience(enabled: boolean) {
    this.ambience = enabled;
    if (enabled) this.reconcile();
    else {
      this.cancel(this.gullTimer); this.gullTimer = undefined;
      this.cancel(this.thunderTimer); this.thunderTimer = undefined;
      this.voices.filter((voice) => voice.role === 'ambience').forEach((voice) => this.fadeOut(voice, 1.5));
    }
  }
  setWeather(weather: 'clear' | 'storm') {
    if (weather === this.weather) return;
    this.weather = weather;
    if (!this.ambience || !this.context) return;
    const wind = [...this.voices].reverse().find((voice) => voice.role === 'ambience' && voice.cue === 'amb.wind');
    if (wind) try {
      wind.gain.gain.cancelAndHoldAtTime(this.context.currentTime);
      wind.gain.gain.linearRampToValueAtTime(CUES['amb.wind'].volume * (weather === 'storm' ? 2.4 : 1), this.context.currentTime + 1.5);
    } catch {}
    if (weather === 'clear') {
      this.cancel(this.thunderTimer); this.thunderTimer = undefined;
      this.voices.filter((voice) => voice.role === 'ambience' && (voice.cue === 'amb.rain' || voice.cue === 'amb.thunder')).forEach((voice) => this.fadeOut(voice, 1.5));
    }
    this.reconcile();
  }
  private reconcile() {
    if (!this.context || this.context.state !== 'running' || document.hidden || !getAudioSettings().enabled) return;
    if (this.musicVoice && this.musicVoice.choice !== getCueSource(this.musicVoice.cue)) {
      const old = this.musicVoice; this.musicVoice = undefined;
      this.fadeOut(old, this.scene === 'epilogue' ? 0.1 : 2.5);
    }
    this.startMusic();
    if (!this.ambience) return;
    for (const cue of ['amb.sea', 'amb.wind', ...(this.weather === 'storm' ? ['amb.rain'] : [])] as CueId[]) {
      const existing = [...this.voices].reverse().find((voice) => voice.role === 'ambience' && voice.cue === cue);
      const choice = getCueSource(cue);
      // Upgrade a loading fallback once; a decoded source that failed must not restart on every reconcile.
      if (existing && (existing.choice !== choice || (choice === 'file' && existing.source === 'synth' && !existing.fileReady && CUES[cue].files?.some((file) => this.decoded.has(file))))) {
        const replacement = this.startVoice(cue, 'ambience', true, {}, 0, 1.5);
        if (replacement) {
          if (cue === 'amb.wind' && this.weather === 'storm') replacement.gain.gain.linearRampToValueAtTime(CUES[cue].volume * 2.4, this.context.currentTime + 1.5);
          this.fadeOut(existing, 1.5);
        }
      } else if (existing?.fadeTimer !== undefined) {
        this.cancel(existing.fadeTimer); existing.fadeTimer = undefined;
        existing.gain.gain.cancelAndHoldAtTime(this.context.currentTime);
        existing.gain.gain.linearRampToValueAtTime(CUES[cue].volume * (cue === 'amb.wind' && this.weather === 'storm' ? 2.4 : 1), this.context.currentTime + 1.5);
      } else if (!existing) {
        const voice = this.startVoice(cue, 'ambience', true, {}, 0, 1.5);
        if (cue === 'amb.wind' && voice && this.weather === 'storm') voice.gain.gain.linearRampToValueAtTime(CUES[cue].volume * 2.4, this.context.currentTime + 1.5);
      }
    }
    if (!this.gullTimer) this.gullTimer = this.later(() => {
      this.gullTimer = undefined;
      if (this.ambience && !document.hidden) { this.startVoice('amb.gulls', 'ambience', false); this.reconcile(); }
    }, randomBetween(15000, 40000));
    if (this.weather === 'storm' && !this.thunderTimer) this.thunderTimer = this.later(() => {
      this.thunderTimer = undefined;
      if (this.ambience && this.weather === 'storm' && !document.hidden) { this.startVoice('amb.thunder', 'ambience', false); this.reconcile(); }
    }, randomBetween(3000, 6000));
  }

  duck(ms = 3000) {
    if (!this.context || !this.musicDuck) return;
    try {
      const now = this.context.currentTime;
      const gain = this.musicDuck.gain;
      gain.cancelAndHoldAtTime(now);
      gain.linearRampToValueAtTime(10 ** (-9 / 20), now + 0.05);
      gain.setValueAtTime(10 ** (-9 / 20), now + Math.max(0.05, ms / 1000));
      gain.linearRampToValueAtTime(1, now + ms / 1000 + 0.4);
    } catch {}
  }
  stop() {
    const sceneChanged = this.scene !== null;
    this.epoch++;
    this.auditionSequence++;
    this.timers.forEach(clearTimeout); this.timers.clear();
    this.voices.slice().forEach((voice) => this.finish(voice));
    this.musicTimer = this.gullTimer = this.thunderTimer = undefined;
    this.musicVoice = undefined; this.scene = null; this.ambience = false; this.weather = 'clear';
    this.epilogueEvent = undefined;
    if (sceneChanged) this.notifyScene();
    this.lastPlayed.clear();
    if (this.musicDuck && this.context) {
      this.musicDuck.gain.cancelScheduledValues(this.context.currentTime);
      this.musicDuck.gain.setValueAtTime(1, this.context.currentTime);
    }
  }

  /** Explicit inspection for the acceptance script; never installed on window. */
  snapshot() {
    return {
      contextState: this.context?.state ?? 'locked', scene: this.scene, weather: this.weather,
      ambience: this.ambience, voices: this.voices.map((voice) => ({ cue: voice.cue, role: voice.role, source: voice.source, choice: voice.choice })),
      pending: this.timers.size, master: this.master?.gain.value ?? 0,
      buses: this.buses ? Object.fromEntries(Object.entries(this.buses).map(([bus, node]) => [bus, node.gain.value])) : null,
    };
  }
}
export const audio = new AudioEngine();
