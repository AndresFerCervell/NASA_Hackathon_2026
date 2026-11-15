const STORAGE_KEY = 'ossm_sound_enabled';
const MUSIC_VOL_KEY = 'ossm_music_volume';
const SFX_VOL_KEY = 'ossm_sfx_volume';
const BG_MUSIC_URL = '/audio/space_ambient.ogg';

class SpaceSoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgMusic: HTMLAudioElement | null = null;
  private enabled = true;
  private musicVolume = 0.35;
  private sfxVolume = 0.85;

  constructor() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === 'false') {
        this.enabled = false;
      }
      const savedMusic = Number(window.localStorage.getItem(MUSIC_VOL_KEY));
      if (!Number.isNaN(savedMusic) && window.localStorage.getItem(MUSIC_VOL_KEY) !== null) {
        this.musicVolume = Math.max(0, Math.min(1, savedMusic));
      }
      const savedSfx = Number(window.localStorage.getItem(SFX_VOL_KEY));
      if (!Number.isNaN(savedSfx) && window.localStorage.getItem(SFX_VOL_KEY) !== null) {
        this.sfxVolume = Math.max(0, Math.min(1, savedSfx));
      }
    } catch {
      // Ignore storage access errors
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getMusicVolume(): number {
    return this.musicVolume;
  }

  public getSfxVolume(): number {
    return this.sfxVolume;
  }

  public setMusicVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.musicVolume = clamped;
    try {
      window.localStorage.setItem(MUSIC_VOL_KEY, String(clamped));
    } catch {
      // Ignore storage errors
    }
    const audio = this.ensureBgMusic();
    if (audio) {
      audio.volume = this.enabled ? clamped : 0;
      if (this.enabled && clamped > 0 && audio.paused) {
        void audio.play().catch(() => {});
      } else if (clamped === 0 && !audio.paused) {
        audio.pause();
      }
    }
  }

  public setSfxVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.sfxVolume = clamped;
    try {
      window.localStorage.setItem(SFX_VOL_KEY, String(clamped));
    } catch {
      // Ignore storage errors
    }
    const ctx = this.ensureContext();
    if (ctx && this.masterGain) {
      const now = ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.enabled ? clamped : 0, now, 0.05);
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.enabled ? this.sfxVolume : 0;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private ensureBgMusic(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!this.bgMusic) {
      const audio = new Audio(BG_MUSIC_URL);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = this.musicVolume;
      this.bgMusic = audio;
    }
    return this.bgMusic;
  }

  public unlockAndStartAmbient(): void {
    if (!this.enabled || this.musicVolume <= 0) return;
    this.ensureContext();
    const audio = this.ensureBgMusic();
    if (audio && audio.paused) {
      void audio.play().catch(() => {
        // Autoplay blocked until next user gesture
      });
    }
  }

  public setEnabled(next: boolean): void {
    this.enabled = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // Ignore storage errors
    }

    const ctx = this.ensureContext();
    if (ctx && this.masterGain) {
      const now = ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(next ? this.sfxVolume : 0, now, 0.12);
    }

    const audio = this.ensureBgMusic();
    if (audio) {
      if (next && this.musicVolume > 0) {
        audio.volume = this.musicVolume;
        void audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    }
  }

  public playUiClick(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(840, now);
    osc.frequency.exponentialRampToValueAtTime(1120, now + 0.045);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.045, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  public playLaunchIgnition(): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const duration = 1.05;

    // Filtered noise for thruster whoosh
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(160, now);
    filter.frequency.exponentialRampToValueAtTime(620, now + 0.7);
    filter.Q.value = 1.1;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.11, now + 0.18);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.masterGain);
    noise.start(now);
    noise.stop(now + duration);

    // Sub-bass engine rumble
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(62, now);
    sub.frequency.exponentialRampToValueAtTime(92, now + 0.6);
    subGain.gain.setValueAtTime(0.001, now);
    subGain.gain.exponentialRampToValueAtTime(0.08, now + 0.12);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    sub.connect(subGain);
    subGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.95);
  }

  public playSimulationResult(success: boolean): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    const notes = success ? [523.25, 659.25, 783.99] : [250, 190];
    const step = success ? 0.085 : 0.14;

    notes.forEach((freq, idx) => {
      const start = now + idx * step;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = success ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(success ? 0.075 : 0.08, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

      osc.connect(gain);
      gain.connect(this.masterGain!);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  }

  public playLandingEvent(type: 'touchdown' | 'impact'): void {
    if (!this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    const now = ctx.currentTime;
    if (type === 'touchdown') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.exponentialRampToValueAtTime(52, now + 0.22);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.26);
      return;
    }

    // Loud, punchy rocket explosion that cuts clearly over background music
    const duration = 1.9;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }

    const expBus = ctx.createGain();
    expBus.gain.value = 1.35;
    expBus.connect(this.masterGain);

    // 1. Sharp initial blast crack (mid-high punch audible on all speakers)
    const crack = ctx.createBufferSource();
    crack.buffer = buffer;
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.setValueAtTime(1400, now);
    crackFilter.Q.value = 0.55;
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.95, now);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    crack.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(expBus);
    crack.start(now);
    crack.stop(now + 0.35);

    // 2. Deep shockwave boom (sawtooth + sine for harmonics on small speakers)
    const boom = ctx.createOscillator();
    const boomGain = ctx.createGain();
    boom.type = 'sawtooth';
    boom.frequency.setValueAtTime(175, now);
    boom.frequency.exponentialRampToValueAtTime(36, now + 1.05);
    boomGain.gain.setValueAtTime(0.75, now);
    boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.25);
    boom.connect(boomGain);
    boomGain.connect(expBus);
    boom.start(now);
    boom.stop(now + 1.3);

    // 3. Long debris & explosion rumble
    const rumble = ctx.createBufferSource();
    rumble.buffer = buffer;
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.setValueAtTime(2400, now);
    rumbleFilter.frequency.exponentialRampToValueAtTime(110, now + duration);
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.85, now);
    rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    rumble.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(expBus);
    rumble.start(now);
    rumble.stop(now + duration);
  }
}

export const soundEngine = new SpaceSoundEngine();
