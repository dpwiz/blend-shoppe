import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Image as ImageIcon, X, RefreshCw, Sliders, Music, Activity } from 'lucide-react';
import { get, set, del } from 'idb-keyval';

const vsSource = `
attribute vec2 position;
varying vec2 vUv;
void main() {
    vUv = position * 0.5 + 0.5;
    vUv.y = 1.0 - vUv.y;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fsSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;
uniform sampler2D tex1;
uniform sampler2D tex2;
uniform sampler2D tex3;
uniform sampler2D tex4;
uniform sampler2D tex1_alt;
uniform sampler2D tex2_alt;
uniform sampler2D tex3_alt;
uniform sampler2D tex4_alt;
uniform vec4 u_balances;
uniform float time;
uniform vec2 resolution;
uniform vec4 activeChannels;
uniform float u_noiseScale;
uniform float u_timeSpeed;
uniform float u_timeOffset;
uniform float u_warpStrength;
uniform vec2 u_contrast;

vec3 hash(vec3 p) {
    p = vec3( dot(p,vec3(127.1,311.7, 74.7)),
              dot(p,vec3(269.5,183.3,246.1)),
              dot(p,vec3(113.5,271.9,124.6)));
    return -1.0 + 2.0*fract(sin(p)*43758.5453123);
}

float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f*f*(3.0-2.0*f);
    return mix( mix( mix( dot( hash( i + vec3(0.0,0.0,0.0) ), f - vec3(0.0,0.0,0.0) ), 
                          dot( hash( i + vec3(1.0,0.0,0.0) ), f - vec3(1.0,0.0,0.0) ), u.x),
                     mix( dot( hash( i + vec3(0.0,1.0,0.0) ), f - vec3(0.0,1.0,0.0) ), 
                          dot( hash( i + vec3(1.0,1.0,0.0) ), f - vec3(1.0,1.0,0.0) ), u.x), u.y),
                mix( mix( dot( hash( i + vec3(0.0,0.0,1.0) ), f - vec3(0.0,0.0,1.0) ), 
                          dot( hash( i + vec3(1.0,0.0,1.0) ), f - vec3(1.0,0.0,1.0) ), u.x),
                     mix( dot( hash( i + vec3(0.0,1.0,1.0) ), f - vec3(0.0,1.0,1.0) ), 
                          dot( hash( i + vec3(1.0,1.0,1.0) ), f - vec3(1.0,1.0,1.0) ), u.x), u.y), u.z );
}

float fbm(vec3 x) {
    float v = 0.0;
    float a = 0.5;
    vec3 shift = vec3(100.0);
    for (int i = 0; i < 4; ++i) {
        v += a * noise(x);
        x = x * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = vUv;
    vec2 noiseUv = uv;
    if (resolution.y > 0.0) {
        noiseUv.x *= resolution.x / resolution.y;
    }
    
    float scale = u_noiseScale;
    float t = time * u_timeSpeed + u_timeOffset;
    
    // Domain warping
    vec2 q = vec2(
        fbm(vec3(noiseUv * scale, t)),
        fbm(vec3(noiseUv * scale + vec2(5.2, 1.3), t))
    );
    
    vec2 warpedUv = noiseUv * scale + u_warpStrength * q;
    
    float n1 = fbm(vec3(warpedUv, t));
    float n2 = fbm(vec3(warpedUv + vec2(15.2, 3.1), t + 100.0));
    float n3 = fbm(vec3(warpedUv + vec2(-5.3, 12.4), t + 200.0));
    float n4 = fbm(vec3(warpedUv + vec2(8.1, -4.2), t + 300.0));
    
    // Map from roughly [-1, 1] to [0, 1]
    n1 = clamp(n1 * 0.5 + 0.5, 0.0, 1.0);
    n2 = clamp(n2 * 0.5 + 0.5, 0.0, 1.0);
    n3 = clamp(n3 * 0.5 + 0.5, 0.0, 1.0);
    n4 = clamp(n4 * 0.5 + 0.5, 0.0, 1.0);
    
    // Increase contrast for sharper transitions
    n1 = smoothstep(u_contrast.x, u_contrast.y, n1);
    n2 = smoothstep(u_contrast.x, u_contrast.y, n2);
    n3 = smoothstep(u_contrast.x, u_contrast.y, n3);
    n4 = smoothstep(u_contrast.x, u_contrast.y, n4);
    
    n1 = n1 * n1 * activeChannels.x;
    n2 = n2 * n2 * activeChannels.y;
    n3 = n3 * n3 * activeChannels.z;
    n4 = n4 * n4 * activeChannels.w;
    
    float sum = n1 + n2 + n3 + n4;
    vec4 factors;
    if (sum > 0.0001) {
        factors = vec4(n1, n2, n3, n4) / sum;
    } else {
        float activeCount = activeChannels.x + activeChannels.y + activeChannels.z + activeChannels.w;
        if (activeCount > 0.0) {
            factors = activeChannels / activeCount;
        } else {
            factors = vec4(0.25);
        }
    }
    
    vec4 c1_main = texture2D(tex1, uv);
    vec4 c2_main = texture2D(tex2, uv);
    vec4 c3_main = texture2D(tex3, uv);
    vec4 c4_main = texture2D(tex4, uv);
    
    vec4 c1_alt = texture2D(tex1_alt, uv);
    vec4 c2_alt = texture2D(tex2_alt, uv);
    vec4 c3_alt = texture2D(tex3_alt, uv);
    vec4 c4_alt = texture2D(tex4_alt, uv);
    
    vec4 c1 = mix(c1_main, c1_alt, u_balances.x);
    vec4 c2 = mix(c2_main, c2_alt, u_balances.y);
    vec4 c3 = mix(c3_main, c3_alt, u_balances.z);
    vec4 c4 = mix(c4_main, c4_alt, u_balances.w);
    
    vec3 finalColor = c1.rgb * factors.x + c2.rgb * factors.y + c3.rgb * factors.z + c4.rgb * factors.w;
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vs: string, fs: string) {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vs);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  if (!vertexShader || !fragmentShader) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}

function createTexture(gl: WebGLRenderingContext, image: HTMLImageElement | undefined, index: number) {
  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + index);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  
  if (image) {
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    } catch (e) {
      console.error('Texture upload failed:', e);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 255, 255]));
    }
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }
  return texture;
}

const createSolidImage = (color: string) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1024, 1024);
  }
  return canvas.toDataURL('image/png');
};

const DEFAULT_ALT_IMAGE = createSolidImage('#000000');

export default function App() {
  const [images, setImages] = useState<(string | null)[]>(() => [
    createSolidImage('#ff0000'),
    createSolidImage('#00ff00'),
    createSolidImage('#0000ff'),
    createSolidImage('#ffff00')
  ]);
  const [altImages, setAltImages] = useState<(string | null)[]>(() => [
    DEFAULT_ALT_IMAGE,
    DEFAULT_ALT_IMAGE,
    DEFAULT_ALT_IMAGE,
    DEFAULT_ALT_IMAGE
  ]);
  const [loadedImages, setLoadedImages] = useState<(HTMLImageElement | null)[]>([null, null, null, null]);
  const [loadedAltImages, setLoadedAltImages] = useState<(HTMLImageElement | null)[]>([null, null, null, null]);
  const [isStarted, setIsStarted] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [imageWeights, setImageWeights] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('imageWeights');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse imageWeights from sessionStorage', e);
        }
      }
    }
    return [1.0, 1.0, 1.0, 1.0];
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('imageWeights', JSON.stringify(imageWeights));
    }
  }, [imageWeights]);

  const [imageBalances, setImageBalances] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('imageBalances');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse imageBalances from sessionStorage', e);
        }
      }
    }
    return [0.0, 0.0, 0.0, 0.0];
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('imageBalances', JSON.stringify(imageBalances));
    }
  }, [imageBalances]);

  const [noiseParams, setNoiseParams] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('noiseParams');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          return { timeOffset: 0.0, ...parsed };
        } catch (e) {
          console.error('Failed to parse noiseParams from sessionStorage', e);
        }
      }
    }
    return {
      scale: 3.0,
      timeSpeed: 0.2,
      timeOffset: 0.0,
      warpStrength: 4.0,
      contrastMin: 0.3,
      contrastMax: 0.7
    };
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('noiseParams', JSON.stringify(noiseParams));
    }
  }, [noiseParams]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeSlot, setActiveSlot] = useState<{ index: number, isAlt: boolean } | null>(null);

  const [audioTracks, setAudioTracks] = useState(() => {
    const defaultTracks = [
      { src: null as string | null, name: null as string | null, volume: 1.0, playbackRate: 1.0, preservesPitch: true, offset: 0, duration: 0 },
      { src: null as string | null, name: null as string | null, volume: 1.0, playbackRate: 1.0, preservesPitch: true, offset: 0, duration: 0 }
    ];
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('audioParams');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length === 2) {
            return defaultTracks.map((track, i) => ({
              ...track,
              volume: parsed[i].volume ?? 1.0,
              playbackRate: parsed[i].playbackRate ?? 1.0,
              preservesPitch: parsed[i].preservesPitch ?? true,
              offset: parsed[i].offset ?? 0
            }));
          }
        } catch (e) {
          console.error('Failed to parse audioParams from sessionStorage', e);
        }
      }
    }
    return defaultTracks;
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const paramsToSave = audioTracks.map(t => ({
        volume: t.volume,
        playbackRate: t.playbackRate,
        preservesPitch: t.preservesPitch,
        offset: t.offset
      }));
      sessionStorage.setItem('audioParams', JSON.stringify(paramsToSave));
    }
  }, [audioTracks]);
  const audioInputRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const audioRefs = [useRef<HTMLAudioElement>(null), useRef<HTMLAudioElement>(null)];
  const [isDbLoaded, setIsDbLoaded] = useState(false);

  const [midiInputs, setMidiInputs] = useState<any[]>([]);
  const [selectedMidiInputId, setSelectedMidiInputId] = useState<string>('');
  const [midiLog, setMidiLog] = useState<{ id: number, text: string }[]>([]);
  const midiLogIdRef = useRef(0);

  useEffect(() => {
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then(
        (midiAccess) => {
          const updateInputs = () => {
            const inputs = Array.from(midiAccess.inputs.values());
            setMidiInputs(inputs);
            if (inputs.length > 0 && !selectedMidiInputId) {
              setSelectedMidiInputId(inputs[0].id);
            }
          };
          updateInputs();
          midiAccess.onstatechange = updateInputs;
        },
        (err) => console.error("MIDI access failed", err)
      );
    }
  }, [selectedMidiInputId]);

  useEffect(() => {
    if (!selectedMidiInputId) return;
    
    let midiAccess: any = null;
    let selectedInput: any = null;

    const handleMidiMessage = (event: any) => {
      const [status, data1, data2] = event.data;
      const isCC = status >= 176 && status <= 191;
      const channel = status & 0x0F;
      
      if (isCC) {
        const logEntry = `CH${channel + 1} CC${data1}: ${data2}`;
        const id = midiLogIdRef.current++;
        setMidiLog(prev => [{ id, text: logEntry }, ...prev].slice(0, 8));

        // Map CC to parameters (only for CH1, which is channel 0)
        if (channel === 0) {
          // CC 0-3: Image Slot Gain (0 to ~2.0, 64 is exactly 1.0)
          if (data1 >= 0 && data1 <= 3) {
            const slotIndex = data1;
            const newWeight = data2 / 64.0;
            setImageWeights(prev => {
              const next = [...prev];
              next[slotIndex] = newWeight;
              return next;
            });
          }
          // CC 16-19: Image Slot Balance (0.0 to 1.0)
          else if (data1 >= 16 && data1 <= 19) {
            const slotIndex = data1 - 16;
            const newBalance = data2 / 127.0;
            setImageBalances(prev => {
              const next = [...prev];
              next[slotIndex] = newBalance;
              return next;
            });
          }
          // CC 6-7: Audio Slot Volume (0.0 to 1.0)
          else if (data1 === 6 || data1 === 7) {
            const slotIndex = data1 - 6;
            const newVolume = data2 / 127.0;
            setAudioTracks(prev => {
              const next = [...prev];
              next[slotIndex] = { ...next[slotIndex], volume: newVolume };
              return next;
            });
          }
          // CC 22-23: Audio Slot Speed
          else if (data1 === 22 || data1 === 23) {
            const slotIndex = data1 - 22;
            let newSpeed;
            if (data2 === 64) {
              newSpeed = 1.0;
            } else if (data2 < 64) {
              // 0..63 maps to 0.25x .. ~0.98x (log2: -2 to <0)
              newSpeed = Math.pow(2, -2 + (data2 / 64) * 2);
            } else {
              // 65..127 maps to ~1.02x .. 4.0x (log2: >0 to 2)
              newSpeed = Math.pow(2, ((data2 - 64) / 63) * 2);
            }
            setAudioTracks(prev => {
              const next = [...prev];
              next[slotIndex] = { ...next[slotIndex], playbackRate: newSpeed };
              return next;
            });
          }
        }
      }
    };

    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then(access => {
        midiAccess = access;
        selectedInput = access.inputs.get(selectedMidiInputId) || null;
        if (selectedInput) {
          selectedInput.onmidimessage = handleMidiMessage;
        }
      });
    }

    return () => {
      if (selectedInput) {
        selectedInput.onmidimessage = null;
      }
    };
  }, [selectedMidiInputId]);

  useEffect(() => {
    const loadFromDB = async () => {
      try {
        const defaultImages = [
          createSolidImage('#ff0000'),
          createSolidImage('#00ff00'),
          createSolidImage('#0000ff'),
          createSolidImage('#ffff00')
        ];
        
        for (let i = 0; i < 4; i++) {
          const file = await get(`image_${i}`);
          if (file instanceof File || file instanceof Blob) {
            defaultImages[i] = URL.createObjectURL(file);
          } else if (file === 'empty') {
            defaultImages[i] = null;
          }
        }
        setImages(defaultImages);

        const defaultAltImages = [
          DEFAULT_ALT_IMAGE,
          DEFAULT_ALT_IMAGE,
          DEFAULT_ALT_IMAGE,
          DEFAULT_ALT_IMAGE
        ];
        
        for (let i = 0; i < 4; i++) {
          const file = await get(`altImage_${i}`);
          if (file instanceof File || file instanceof Blob) {
            defaultAltImages[i] = URL.createObjectURL(file);
          } else if (file === 'empty') {
            defaultAltImages[i] = DEFAULT_ALT_IMAGE;
          }
        }
        setAltImages(defaultAltImages);

        const audioFiles = await Promise.all([get('audio_0'), get('audio_1')]);
        setAudioTracks(prev => {
          const next = [...prev];
          if (audioFiles[0] instanceof File || audioFiles[0] instanceof Blob) {
            next[0] = { ...next[0], src: URL.createObjectURL(audioFiles[0]), name: audioFiles[0].name || 'Audio 1' };
          }
          if (audioFiles[1] instanceof File || audioFiles[1] instanceof Blob) {
            next[1] = { ...next[1], src: URL.createObjectURL(audioFiles[1]), name: audioFiles[1].name || 'Audio 2' };
          }
          return next;
        });
      } catch (e) {
        console.error("Failed to load from DB", e);
      } finally {
        setIsDbLoaded(true);
      }
    };
    loadFromDB();
  }, []);

  useEffect(() => {
    audioTracks.forEach((track, i) => {
      const ref = audioRefs[i].current;
      if (ref) {
        ref.playbackRate = track.playbackRate;
        ref.preservesPitch = track.preservesPitch;
        ref.volume = track.volume;
      }
    });
  }, [audioTracks]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) {
      const newImages = files.map(f => URL.createObjectURL(f));
      setImages(prev => {
        const next = [...prev];
        let newIdx = 0;
        for (let i = 0; i < 4 && newIdx < newImages.length; i++) {
          if (next[i] === null) {
            next[i] = newImages[newIdx];
            set(`image_${i}`, files[newIdx]);
            newIdx++;
          }
        }
        return next;
      });
    }
  }, []);

  const handleSlotClick = (index: number, isAlt: boolean = false) => {
    setActiveSlot({ index, isAlt });
    fileInputRef.current?.click();
  };

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        if (activeSlot) {
          if (activeSlot.isAlt) {
            setAltImages(prev => {
              const next = [...prev];
              next[activeSlot.index] = url;
              set(`altImage_${activeSlot.index}`, file);
              return next;
            });
          } else {
            setImages(prev => {
              const next = [...prev];
              next[activeSlot.index] = url;
              set(`image_${activeSlot.index}`, file);
              return next;
            });
          }
        }
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    setActiveSlot(null);
  }, [activeSlot]);

  const removeImage = (index: number, isAlt: boolean = false) => {
    if (isAlt) {
      setAltImages(prev => {
        const next = [...prev];
        next[index] = DEFAULT_ALT_IMAGE;
        set(`altImage_${index}`, 'empty');
        return next;
      });
    } else {
      setImages(prev => {
        const next = [...prev];
        next[index] = null;
        set(`image_${index}`, 'empty');
        return next;
      });
    }
  };

  const handleAudioInput = useCallback((index: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.type.startsWith('audio/')) {
        setAudioTracks(prev => {
          const next = [...prev];
          next[index] = { ...next[index], src: URL.createObjectURL(file), name: file.name };
          set(`audio_${index}`, file);
          return next;
        });
      }
    }
    if (audioInputRefs[index].current) audioInputRefs[index].current!.value = '';
  }, []);

  const updateAudioTrack = (index: number, updates: Partial<typeof audioTracks[0]>) => {
    setAudioTracks(prev => {
      const next = [...prev];
      next[index] = { ...next[index], ...updates };
      if (updates.src === null) {
        del(`audio_${index}`);
      }
      return next;
    });
  };



  useEffect(() => {
    const activeImages = images.filter(src => src !== null);
    if (activeImages.length > 0) {
      let loadedCount = 0;
      const imgs: (HTMLImageElement | null)[] = [null, null, null, null];
      
      images.forEach((src, i) => {
        if (src === null) return;
        
        const img = new Image();
        img.onload = () => {
          imgs[i] = img;
          loadedCount++;
          if (loadedCount === activeImages.length) {
            setLoadedImages([...imgs]);
          }
        };
        img.onerror = (e) => {
          console.error("Image load error", e);
          const dummy = new Image();
          dummy.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
          imgs[i] = dummy;
          loadedCount++;
          if (loadedCount === activeImages.length) {
            setLoadedImages([...imgs]);
          }
        };
        img.src = src;
      });
    } else {
      setLoadedImages([null, null, null, null]);
    }
  }, [images]);

  useEffect(() => {
    const activeImages = altImages.filter(src => src !== null);
    if (activeImages.length > 0) {
      let loadedCount = 0;
      const imgs: (HTMLImageElement | null)[] = [null, null, null, null];
      
      altImages.forEach((src, i) => {
        if (src === null) return;
        
        const img = new Image();
        img.onload = () => {
          imgs[i] = img;
          loadedCount++;
          if (loadedCount === activeImages.length) {
            setLoadedAltImages([...imgs]);
          }
        };
        img.onerror = (e) => {
          console.error("Alt image load error", e);
          const dummy = new Image();
          dummy.src = DEFAULT_ALT_IMAGE!;
          imgs[i] = dummy;
          loadedCount++;
          if (loadedCount === activeImages.length) {
            setLoadedAltImages([...imgs]);
          }
        };
        img.src = src;
      });
    } else {
      setLoadedAltImages([null, null, null, null]);
    }
  }, [altImages]);

  useEffect(() => {
    const activeLoadedCount = loadedImages.filter(img => img !== null).length;
    if (activeLoadedCount === 0 || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      console.error("WebGL not supported");
      return;
    }

    const firstImage = loadedImages.find(img => img !== null);
    if (firstImage) {
      canvas.width = firstImage.width;
      canvas.height = firstImage.height;
    }

    const program = createProgram(gl, vsSource, fsSource);
    if (!program) return;

    gl.useProgram(program);

    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1,
    ]);
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    createTexture(gl, loadedImages[0] || undefined, 0);
    createTexture(gl, loadedImages[1] || undefined, 1);
    createTexture(gl, loadedImages[2] || undefined, 2);
    createTexture(gl, loadedImages[3] || undefined, 3);
    createTexture(gl, loadedAltImages[0] || undefined, 4);
    createTexture(gl, loadedAltImages[1] || undefined, 5);
    createTexture(gl, loadedAltImages[2] || undefined, 6);
    createTexture(gl, loadedAltImages[3] || undefined, 7);

    const tex1Loc = gl.getUniformLocation(program, "tex1");
    const tex2Loc = gl.getUniformLocation(program, "tex2");
    const tex3Loc = gl.getUniformLocation(program, "tex3");
    const tex4Loc = gl.getUniformLocation(program, "tex4");
    const tex1AltLoc = gl.getUniformLocation(program, "tex1_alt");
    const tex2AltLoc = gl.getUniformLocation(program, "tex2_alt");
    const tex3AltLoc = gl.getUniformLocation(program, "tex3_alt");
    const tex4AltLoc = gl.getUniformLocation(program, "tex4_alt");
    const activeChannelsLoc = gl.getUniformLocation(program, "activeChannels");
    const balancesLoc = gl.getUniformLocation(program, "u_balances");
    
    const uNoiseScaleLoc = gl.getUniformLocation(program, "u_noiseScale");
    const uTimeSpeedLoc = gl.getUniformLocation(program, "u_timeSpeed");
    const uTimeOffsetLoc = gl.getUniformLocation(program, "u_timeOffset");
    const uWarpStrengthLoc = gl.getUniformLocation(program, "u_warpStrength");
    const uContrastLoc = gl.getUniformLocation(program, "u_contrast");
    
    gl.uniform1i(tex1Loc, 0);
    gl.uniform1i(tex2Loc, 1);
    gl.uniform1i(tex3Loc, 2);
    gl.uniform1i(tex4Loc, 3);
    gl.uniform1i(tex1AltLoc, 4);
    gl.uniform1i(tex2AltLoc, 5);
    gl.uniform1i(tex3AltLoc, 6);
    gl.uniform1i(tex4AltLoc, 7);
    
    gl.uniform4f(
      activeChannelsLoc, 
      loadedImages[0] ? imageWeights[0] : 0.0,
      loadedImages[1] ? imageWeights[1] : 0.0,
      loadedImages[2] ? imageWeights[2] : 0.0,
      loadedImages[3] ? imageWeights[3] : 0.0
    );

    gl.uniform4f(
      balancesLoc,
      imageBalances[0],
      imageBalances[1],
      imageBalances[2],
      imageBalances[3]
    );
    
    gl.uniform1f(uNoiseScaleLoc, noiseParams.scale);
    gl.uniform1f(uTimeSpeedLoc, noiseParams.timeSpeed);
    gl.uniform1f(uTimeOffsetLoc, noiseParams.timeOffset);
    gl.uniform1f(uWarpStrengthLoc, noiseParams.warpStrength);
    gl.uniform2f(uContrastLoc, noiseParams.contrastMin, noiseParams.contrastMax);

    const timeLoc = gl.getUniformLocation(program, "time");
    const resLoc = gl.getUniformLocation(program, "resolution");

    gl.uniform2f(resLoc, canvas.width, canvas.height);

    if (startTimeRef.current === 0) {
      startTimeRef.current = performance.now();
    }

    const render = (now: number) => {
      const time = (now - startTimeRef.current) * 0.001;
      
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform1f(timeLoc, time);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      requestRef.current = requestAnimationFrame(render);
    };

    requestRef.current = requestAnimationFrame(render);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [loadedImages, loadedAltImages, noiseParams, imageWeights, imageBalances]);

  const activeImageCount = images.filter(img => img !== null).length;
  const activeLoadedCount = loadedImages.filter(img => img !== null).length;

  if (!isDbLoaded) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
        <div className="animate-pulse text-zinc-500 flex items-center gap-2">
          <RefreshCw className="animate-spin" size={20} />
          <span>Loading saved media...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center relative overflow-hidden">
      {/* Background / Fullscreen Canvas */}
      <div className={`fixed inset-0 z-0 transition-all duration-700 ${isStarted ? 'bg-black' : isPreviewing ? 'opacity-100 blur-none pointer-events-none' : 'opacity-30 blur-sm pointer-events-none'}`}>
        <canvas
          ref={canvasRef}
          className="w-full h-full transition-all duration-700 object-cover"
        />
      </div>

      {/* Fullscreen Close Button */}
      {isStarted && (
        <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
          <button 
            onClick={() => {
              setIsStarted(false);
            }}
            className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full backdrop-blur-md transition-colors text-sm font-medium"
            title="Go Back (Keep Playing)"
          >
            Back (Playing)
          </button>
          <button 
            onClick={() => {
              setIsStarted(false);
              audioRefs.forEach(ref => {
                if (ref.current) {
                  ref.current.pause();
                }
              });
            }}
            className="bg-white/10 hover:bg-white/20 text-white p-2 rounded-full backdrop-blur-md transition-colors"
            title="Go Back & Pause"
          >
            <X size={24} />
          </button>
        </div>
      )}

      {/* Settings UI */}
      <div className={`relative z-10 max-w-7xl w-full p-4 sm:p-6 max-h-screen overflow-y-auto transition-opacity duration-500 ${isStarted ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          {/* Images Column */}
          <div 
            className={`rounded-2xl p-4 sm:p-6 text-center transition-colors backdrop-blur-md border flex flex-col ${
              isDragging ? 'bg-emerald-500/20 border-emerald-500 border-dashed' : 'bg-zinc-900/60 border-white/10'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <div className="grid grid-cols-1 gap-6 mb-4 flex-grow">
            {images.map((src, i) => (
              <div key={i} className="flex flex-col gap-2 bg-zinc-800/30 p-3 rounded-xl border border-white/5">
                <div className="flex items-center gap-3">
                  {/* Main Image */}
                  <div 
                    className={`relative flex-1 aspect-square rounded-xl overflow-hidden border-2 transition-colors cursor-pointer flex items-center justify-center ${
                      src ? 'bg-zinc-900 border-zinc-700' : 'border-dashed border-zinc-700 hover:border-zinc-500 bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
                    }`}
                    onClick={() => !src && handleSlotClick(i, false)}
                  >
                    {src ? (
                      <>
                        <img src={src} alt={`Slot ${i + 1}`} className="w-full h-full object-cover" />
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeImage(i, false); }}
                          className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload size={24} />
                        <span className="text-xs font-medium">Main {i + 1}</span>
                      </div>
                    )}
                  </div>

                  {/* Vertical Gain Slider */}
                  {src && (
                    <div className="flex flex-col items-center gap-1 h-full py-2">
                      <span className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">Gain</span>
                      <div className="h-24 w-6 flex items-center justify-center relative">
                        <input 
                          type="range" min="0" max="2" step="0.1"
                          value={imageWeights[i]}
                          onChange={(e) => {
                            const newWeights = [...imageWeights];
                            newWeights[i] = parseFloat(e.target.value);
                            setImageWeights(newWeights);
                          }}
                          className="accent-emerald-500 absolute w-24 h-1.5 bg-zinc-700 rounded-full appearance-none"
                          style={{ transform: 'rotate(-90deg)' }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <span className="text-xs text-zinc-300 font-mono">{imageWeights[i].toFixed(1)}</span>
                    </div>
                  )}

                  {/* Alt Image */}
                  <div 
                    className={`relative flex-1 aspect-square rounded-xl overflow-hidden border-2 transition-colors cursor-pointer flex items-center justify-center ${
                      altImages[i] && altImages[i] !== DEFAULT_ALT_IMAGE ? 'bg-zinc-900 border-zinc-700' : 'border-dashed border-zinc-700 hover:border-zinc-500 bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
                    }`}
                    onClick={() => handleSlotClick(i, true)}
                  >
                    {altImages[i] && altImages[i] !== DEFAULT_ALT_IMAGE ? (
                      <>
                        <img src={altImages[i]!} alt={`Alt Slot ${i + 1}`} className="w-full h-full object-cover" />
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeImage(i, true); }}
                          className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload size={24} />
                        <span className="text-xs font-medium">Alt {i + 1}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Horizontal Balance Slider */}
                {src && (
                  <div className="flex items-center gap-3 px-2 pt-2 border-t border-white/5 mt-1">
                    <span className="text-xs text-zinc-400 font-medium w-10">Main</span>
                    <input 
                      type="range" min="0" max="1" step="0.05"
                      value={imageBalances[i]}
                      onChange={(e) => {
                        const newBalances = [...imageBalances];
                        newBalances[i] = parseFloat(e.target.value);
                        setImageBalances(newBalances);
                      }}
                      className="flex-1 accent-emerald-500 h-1.5 bg-zinc-700 rounded-full appearance-none"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="text-xs text-zinc-400 font-medium w-10 text-right">Alt</span>
                  </div>
                )}
              </div>
            ))}
            </div>
            
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-zinc-400">Drag and drop images anywhere, or click a slot to upload.</p>
            </div>
            
            <input 
              type="file" 
              ref={fileInputRef}
              className="hidden" 
              accept="image/*"
              onChange={handleFileInput}
            />
          </div>

          {/* Middle Column */}
          <div className="flex flex-col gap-4">
            {/* Controls Panel */}
            <div className="bg-zinc-900/60 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-white/10 flex flex-col items-center justify-center gap-4">
              <div className="flex flex-wrap justify-center gap-3 w-full">
                {activeImageCount > 0 && activeImageCount === activeLoadedCount ? (
                  <>
                    <div className="flex gap-3 w-full">
                      <button
                        onClick={() => {
                          startTimeRef.current = performance.now();
                          setIsStarted(true);
                          audioRefs.forEach((ref, i) => {
                            if (ref.current && ref.current.src) {
                              ref.current.currentTime = audioTracks[i].offset;
                              ref.current.play().catch(e => console.error("Audio playback failed:", e));
                            }
                          });
                        }}
                        className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-medium transition-colors shadow-lg shadow-emerald-500/20"
                      >
                        Start
                      </button>
                      <button
                        onClick={() => {
                          startTimeRef.current = performance.now();
                          audioRefs.forEach((ref, i) => {
                            if (ref.current && ref.current.src) {
                              ref.current.currentTime = audioTracks[i].offset;
                              ref.current.play().catch(e => console.error("Audio playback failed:", e));
                            }
                          });
                        }}
                        className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full font-medium transition-colors border border-white/10 flex items-center justify-center gap-2"
                      >
                        <RefreshCw size={16} />
                        Restart
                      </button>
                      <button
                        onClick={() => {
                          setIsStarted(false);
                          audioRefs.forEach(ref => {
                            if (ref.current) {
                              ref.current.pause();
                            }
                          });
                        }}
                        className="flex-1 py-2 bg-red-500/80 hover:bg-red-500 text-white rounded-full font-medium transition-colors border border-white/10"
                      >
                        Stop
                      </button>
                    </div>
                    <button
                      onClick={() => setIsStarted(true)}
                      onMouseEnter={() => setIsPreviewing(true)}
                      onMouseLeave={() => setIsPreviewing(false)}
                      className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full font-medium transition-colors border border-white/10"
                    >
                      Fullscreen
                    </button>
                  </>
                ) : activeImageCount > 0 ? (
                  <button
                    disabled
                    className="px-6 py-2 bg-emerald-500 text-white rounded-full font-medium opacity-50 cursor-not-allowed shadow-lg shadow-emerald-500/20 w-full"
                  >
                    Loading...
                  </button>
                ) : (
                  <div className="py-2 text-zinc-500 text-sm font-medium">
                    Add images to start
                  </div>
                )}
              </div>
            </div>

            {/* MIDI Settings Panel */}
            <div className="space-y-3 bg-zinc-900/60 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={18} className="text-zinc-300" />
                <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">MIDI Controller</h2>
              </div>
              
              <select 
                value={selectedMidiInputId}
                onChange={(e) => setSelectedMidiInputId(e.target.value)}
                className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 transition-colors"
              >
                <option value="">Select MIDI Device...</option>
                {midiInputs.map(input => (
                  <option key={input.id} value={input.id}>{input.name || `Device ${input.id}`}</option>
                ))}
              </select>

              <div className="bg-zinc-950/50 rounded-lg p-3 h-32 overflow-y-auto font-mono text-xs text-zinc-400 flex flex-col gap-1 border border-white/5">
                {midiLog.length === 0 ? (
                  <span className="text-zinc-600 italic">Waiting for CC events...</span>
                ) : (
                  midiLog.map((log, i) => (
                    <div key={log.id} className={i === 0 ? "text-emerald-400 font-medium" : "opacity-70"}>
                      {log.text}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Noise Settings Panel */}
            <div className="space-y-3 bg-zinc-900/60 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-white/10">
              <div className="flex items-center gap-2 mb-2">
              <Sliders size={18} className="text-zinc-300" />
              <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Noise Settings</h2>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <label className="text-zinc-300">Time Speed</label>
                  <span className="text-zinc-500">{noiseParams.timeSpeed.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0.0" max="2.0" step="0.05" 
                  value={noiseParams.timeSpeed}
                  onChange={e => setNoiseParams(p => ({...p, timeSpeed: parseFloat(e.target.value)}))}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <label className="text-zinc-300">Time Offset</label>
                  <span className="text-zinc-500">{noiseParams.timeOffset.toFixed(1)}s</span>
                </div>
                <input 
                  type="range" min="-60.0" max="60.0" step="0.1" 
                  value={noiseParams.timeOffset}
                  onChange={e => setNoiseParams(p => ({...p, timeOffset: parseFloat(e.target.value)}))}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <label className="text-zinc-300">Noise Scale</label>
                  <span className="text-zinc-500">{noiseParams.scale.toFixed(1)}</span>
                </div>
                <input 
                  type="range" min="0.5" max="10.0" step="0.1" 
                  value={noiseParams.scale}
                  onChange={e => setNoiseParams(p => ({...p, scale: parseFloat(e.target.value)}))}
                  className="w-full accent-emerald-500"
                />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <label className="text-zinc-300">Warp Strength</label>
                  <span className="text-zinc-500">{noiseParams.warpStrength.toFixed(1)}</span>
                </div>
                <input 
                  type="range" min="0.0" max="20.0" step="0.5" 
                  value={noiseParams.warpStrength}
                  onChange={e => setNoiseParams(p => ({...p, warpStrength: parseFloat(e.target.value)}))}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <label className="text-zinc-300">Contrast (Min/Max)</label>
                  <span className="text-zinc-500">{noiseParams.contrastMin.toFixed(2)} - {noiseParams.contrastMax.toFixed(2)}</span>
                </div>
                <div className="flex gap-2">
                  <input 
                    type="range" min="0.0" max="0.5" step="0.05" 
                    value={noiseParams.contrastMin}
                    onChange={e => setNoiseParams(p => ({...p, contrastMin: Math.min(parseFloat(e.target.value), noiseParams.contrastMax - 0.05)}))}
                    className="w-1/2 accent-emerald-500"
                  />
                  <input 
                    type="range" min="0.5" max="1.0" step="0.05" 
                    value={noiseParams.contrastMax}
                    onChange={e => setNoiseParams(p => ({...p, contrastMax: Math.max(parseFloat(e.target.value), noiseParams.contrastMin + 0.05)}))}
                    className="w-1/2 accent-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>
          </div>

          {/* Audio Column */}
          <div className="space-y-3 flex flex-col">
          {audioTracks.map((track, i) => (
            <div key={i} className="bg-zinc-900/60 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-white/10 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Music size={18} className="text-zinc-300" />
                  <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Audio Slot {i + 1}</h2>
                </div>
              </div>
              
              <div 
                className={`relative rounded-xl border-2 transition-colors cursor-pointer flex items-center justify-center p-4 flex-grow ${
                  track.src ? 'bg-zinc-900 border-zinc-700' : 'border-dashed border-zinc-700 hover:border-zinc-500 bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
                }`}
                onClick={() => !track.src && audioInputRefs[i].current?.click()}
              >
                {track.src ? (
                  <div className="w-full flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-medium truncate pr-4 text-zinc-300">{track.name}</span>
                      <button 
                        onClick={(e) => { e.stopPropagation(); updateAudioTrack(i, { src: null, name: null }); }}
                        className="p-1.5 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <audio 
                      ref={audioRefs[i]} 
                      src={track.src} 
                      controls 
                      loop 
                      className="w-full h-10" 
                      onLoadedMetadata={(e) => {
                        const duration = e.currentTarget.duration;
                        updateAudioTrack(i, { duration });
                        if (track.offset > 0 && track.offset <= duration) {
                          e.currentTarget.currentTime = track.offset;
                        }
                      }}
                    />
                    <div className="grid grid-cols-1 gap-4 pt-4 border-t border-white/5">
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <label className="text-zinc-300">Offset</label>
                          <span className="text-zinc-500">{track.offset.toFixed(1)}s</span>
                        </div>
                        <input 
                          type="range" min="0" max={track.duration || 100} step="0.1" 
                          value={track.offset}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            updateAudioTrack(i, { offset: val });
                            if (audioRefs[i].current) {
                              audioRefs[i].current.currentTime = val;
                            }
                          }}
                          className="w-full accent-emerald-500"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <label className="text-zinc-300">Volume</label>
                          <span className="text-zinc-500">{Math.round(track.volume * 100)}%</span>
                        </div>
                        <input 
                          type="range" min="0" max="1" step="0.01" 
                          value={track.volume}
                          onChange={(e) => updateAudioTrack(i, { volume: parseFloat(e.target.value) })}
                          className="w-full accent-emerald-500"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <label className="text-zinc-300">Speed</label>
                          <span className="text-zinc-500">{track.playbackRate.toFixed(2)}x</span>
                        </div>
                        <input 
                          type="range" min="-2" max="2" step="0.01" 
                          value={Math.log2(track.playbackRate)}
                          onChange={(e) => updateAudioTrack(i, { playbackRate: Math.pow(2, parseFloat(e.target.value)) })}
                          className="w-full accent-emerald-500"
                        />
                      </div>
                      
                      <div className="space-y-2 pt-1">
                        <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={track.preservesPitch}
                            onChange={(e) => updateAudioTrack(i, { preservesPitch: e.target.checked })}
                            className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 accent-emerald-500 cursor-pointer"
                          />
                          Preserve Pitch
                        </label>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Music size={24} />
                    <span className="text-sm font-medium">Select Audio File</span>
                  </div>
                )}
              </div>
              <input 
                type="file" 
                ref={audioInputRefs[i]}
                className="hidden" 
                accept="audio/*"
                onChange={handleAudioInput(i)}
              />
            </div>
          ))}
        </div>
        </div>
      </div>
    </div>
  );
}
