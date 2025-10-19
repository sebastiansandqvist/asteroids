import explosionWav from './sounds/explosion.wav';
import explosionShipWav from './sounds/explosion-ship.wav';
import shootWav from './sounds/shoot.wav';

let cachedGlobalAudio: { audioContext: AudioContext; masterGain: GainNode; disconnect: () => void } | null = null;

function createAudio() {
  const { audioContext, masterGain, disconnect } =
    cachedGlobalAudio ||
    (() => {
      const audioContext = new AudioContext({ latencyHint: 'interactive' });
      const masterGain = audioContext.createGain();
      masterGain.connect(audioContext.destination);
      const resume = () => {
        if (audioContext.state === 'suspended') {
          audioContext.resume();
        }
      };
      // fixes: "The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page."
      // @see https://goo.gl/7K7WLu / https://developer.chrome.com/blog/autoplay/#webaudio
      document.body.addEventListener('click', resume);
      const disconnect = () => {
        masterGain.disconnect();
        audioContext.close();
        document.body.removeEventListener('click', resume);
        cachedGlobalAudio = null;
      };
      cachedGlobalAudio = { audioContext, masterGain, disconnect };
      return { audioContext, masterGain, disconnect };
    })();

  return {
    audioContext,
    masterGain,
    disconnect,
  };
}

// const { audioContext, masterGain } = createAudio();

// async function prepAudio(url: string) {
//   const data = await fetch(url)
//   const ab = await data.arrayBuffer();
//   const audioBuffer = await audioContext.decodeAudioData(ab);
//   const source = audioContext.createBufferSource();
//   source.buffer = audioBuffer;
//   source.connect(masterGain);
// }

// prepAudio(explosionShipWav);

function createSounds<T extends Record<string, string>>(sources: T) {
  const { audioContext, masterGain, disconnect } = createAudio();

  type Key = keyof T;

  const soundCache: Partial<Record<Key, AudioBuffer>> = {};
  const activeSources = new Map<Key, Set<AudioBufferSourceNode>>();

  const makeHandle = (
    name: Key,
    src: string,
  ): {
    readonly src: string;
    play: (options?: { volume?: number; speed?: number; echo?: boolean }) => void;
    cancel: () => void;
    fadeOut: (options?: { duration?: number }) => Promise<void>;
    connect: () => void;
    load: () => Promise<void>;
    disconnect: () => void;
  } => {
    const connect = () => {};

    const load = async () => {
      if (soundCache[name]) return;
      const res = await fetch(src);
      const ab = await res.arrayBuffer();
      const buf = await audioContext.decodeAudioData(ab);
      soundCache[name] = buf;
    };

    const play = async ({ volume, speed }: { volume?: number; speed?: number } = { volume: 1, speed: 1 }) => {
      if (!soundCache[name]) {
        await load();
      }
      const buffer = soundCache[name];
      if (!buffer) return;

      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = speed ?? 1;

      const gain = audioContext.createGain();
      gain.gain.value = volume ?? 1;

      source.connect(gain);
      gain.connect(masterGain);

      const set = activeSources.get(name) ?? new Set<AudioBufferSourceNode>();
      set.add(source);
      activeSources.set(name, set);

      source.addEventListener('ended', () => {
        set.delete(source);
      });

      source.start();
    };

    const cancel = () => {
      const set = activeSources.get(name);
      if (!set) return;
      for (const s of set) {
        try {
          s.stop();
        } catch {}
      }
      set.clear();
    };

    const fadeOut = async () => {
      // intentionally left minimal for v1
    };

    return {
      src,
      load,
      play,
      connect,
      cancel,
      fadeOut,
      disconnect,
    };
  };

  const get = <K extends Key>(name: K) => makeHandle(name, sources[name]!);

  get.preload = async <K extends Key>(keys: K[]) => {
    await Promise.all(keys.map((key) => get(key).load()));
  };

  return get;
}

export const sounds = createSounds({
  explode: explosionWav,
  kaboom: explosionShipWav,
  shoot: shootWav,
});
