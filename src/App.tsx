import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Image as ImageIcon, X, RefreshCw, Sliders, Music } from 'lucide-react';
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
uniform float time;
uniform vec2 resolution;
uniform vec4 activeChannels;
uniform float u_noiseScale;
uniform float u_timeSpeed;
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
    float t = time * u_timeSpeed;
    
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
    
    vec4 c1 = texture2D(tex1, uv);
    vec4 c2 = texture2D(tex2, uv);
    vec4 c3 = texture2D(tex3, uv);
    vec4 c4 = texture2D(tex4, uv);
    
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

export default function App() {
  const [images, setImages] = useState<(string | null)[]>(() => [
    createSolidImage('#ff0000'),
    createSolidImage('#00ff00'),
    createSolidImage('#0000ff'),
    createSolidImage('#ffff00')
  ]);
  const [loadedImages, setLoadedImages] = useState<(HTMLImageElement | null)[]>([null, null, null, null]);
  const [isStarted, setIsStarted] = useState(false);
  const [noiseParams, setNoiseParams] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem('noiseParams');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch (e) {
          console.error('Failed to parse noiseParams from sessionStorage', e);
        }
      }
    }
    return {
      scale: 3.0,
      timeSpeed: 0.2,
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
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

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

  const handleSlotClick = (index: number) => {
    setActiveSlot(index);
    fileInputRef.current?.click();
  };

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        setImages(prev => {
          const next = [...prev];
          if (activeSlot !== null) {
            next[activeSlot] = url;
            set(`image_${activeSlot}`, file);
          }
          return next;
        });
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    setActiveSlot(null);
  }, [activeSlot]);

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

  const removeImage = (index: number) => {
    setImages(prev => {
      const next = [...prev];
      next[index] = null;
      set(`image_${index}`, 'empty');
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

    const tex1Loc = gl.getUniformLocation(program, "tex1");
    const tex2Loc = gl.getUniformLocation(program, "tex2");
    const tex3Loc = gl.getUniformLocation(program, "tex3");
    const tex4Loc = gl.getUniformLocation(program, "tex4");
    const activeChannelsLoc = gl.getUniformLocation(program, "activeChannels");
    
    const uNoiseScaleLoc = gl.getUniformLocation(program, "u_noiseScale");
    const uTimeSpeedLoc = gl.getUniformLocation(program, "u_timeSpeed");
    const uWarpStrengthLoc = gl.getUniformLocation(program, "u_warpStrength");
    const uContrastLoc = gl.getUniformLocation(program, "u_contrast");
    
    gl.uniform1i(tex1Loc, 0);
    gl.uniform1i(tex2Loc, 1);
    gl.uniform1i(tex3Loc, 2);
    gl.uniform1i(tex4Loc, 3);
    
    gl.uniform4f(
      activeChannelsLoc, 
      loadedImages[0] ? 1.0 : 0.0,
      loadedImages[1] ? 1.0 : 0.0,
      loadedImages[2] ? 1.0 : 0.0,
      loadedImages[3] ? 1.0 : 0.0
    );
    
    gl.uniform1f(uNoiseScaleLoc, noiseParams.scale);
    gl.uniform1f(uTimeSpeedLoc, noiseParams.timeSpeed);
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
  }, [loadedImages, noiseParams]);

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
      <div className={`fixed inset-0 z-0 transition-all duration-700 ${isStarted ? 'bg-black' : 'opacity-30 blur-sm pointer-events-none'}`}>
        <canvas
          ref={canvasRef}
          className={`w-full h-full transition-all duration-700 ${isStarted ? 'object-contain' : 'object-cover'}`}
        />
      </div>

      {/* Fullscreen Close Button */}
      {isStarted && (
        <button 
          onClick={() => {
            setIsStarted(false);
            audioRefs.forEach(ref => {
              if (ref.current) {
                ref.current.pause();
              }
            });
          }}
          className="absolute top-4 right-4 z-50 bg-white/10 hover:bg-white/20 text-white p-2 rounded-full backdrop-blur-md transition-colors"
          title="Go Back"
        >
          <X size={24} />
        </button>
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
            <div className="grid grid-cols-2 gap-4 mb-4 flex-grow">
            {images.map((src, i) => (
              <div 
                key={i} 
                className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-colors cursor-pointer flex items-center justify-center ${
                  src ? 'bg-zinc-900 border-zinc-700' : 'border-dashed border-zinc-700 hover:border-zinc-500 bg-zinc-800/50 text-zinc-500 hover:text-zinc-300'
                }`}
                onClick={() => !src && handleSlotClick(i)}
              >
                {src ? (
                  <>
                    <img src={src} alt={`Slot ${i + 1}`} className="w-full h-full object-cover" />
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                      className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/80 text-white rounded-full backdrop-blur-sm transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload size={24} />
                    <span className="text-xs font-medium">Slot {i + 1}</span>
                  </div>
                )}
              </div>
            ))}
            </div>
            
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-zinc-400">Drag and drop images anywhere, or click a slot to upload.</p>
              <div className="flex flex-wrap justify-center gap-3">
                {activeImageCount > 0 && activeImageCount === activeLoadedCount ? (
                  <>
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
                      className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-full font-medium transition-colors shadow-lg shadow-emerald-500/20"
                    >
                      Start
                    </button>
                    <button
                      onClick={() => setIsStarted(true)}
                      className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full font-medium transition-colors border border-white/10"
                    >
                      Fullscreen
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
                      className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-full font-medium transition-colors border border-white/10 flex items-center gap-2"
                    >
                      <RefreshCw size={16} />
                      Restart
                    </button>
                  </>
                ) : activeImageCount > 0 ? (
                  <button
                    disabled
                    className="px-6 py-2 bg-emerald-500 text-white rounded-full font-medium opacity-50 cursor-not-allowed shadow-lg shadow-emerald-500/20"
                  >
                    Loading...
                  </button>
                ) : null}
              </div>
            </div>
            
            <input 
              type="file" 
              ref={fileInputRef}
              className="hidden" 
              accept="image/*"
              onChange={handleFileInput}
            />
          </div>

          {/* Noise Settings Column */}
          <div className="space-y-3 bg-zinc-900/60 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Sliders size={18} className="text-zinc-300" />
              <h2 className="text-sm font-medium text-zinc-300 uppercase tracking-wider">Noise Settings</h2>
            </div>
            
            <div className="grid grid-cols-1 gap-4">
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
