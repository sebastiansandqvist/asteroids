function assert(condition: boolean): asserts condition {
  if (!condition) throw new Error('failed assertion');
}

// Bloom configuration
const bloomConfig = {
  threshold: 0.9,
  intensity: 0.6,
  radius: 2.5,
  scales: [1.0, 0.8, 0.6, 0.5, 0.4], // More passes at higher resolutions
};

// Scanline configuration
const scanlineConfig = {
  intensity: 0.4, // How strong the scanlines are (0-1)
  speed: 2.0, // Animation speed
  offset: 0.0, // Phase offset
};

// White noise configuration
const noiseConfig = {
  intensity: 0.04, // How strong the noise is (0-1)
};

// Glitch configuration (master intensity + per-type controls)

// Vignette configuration
const curveConfig = {
  vignetteStrength: 0.2, // Darkness at edges (0-1)
  vignetteSize: 0.4, // Size of vignette effect (0-1)
};

export function createOffscreenCanvas() {
  const offscreenCanvas = new OffscreenCanvas(0, 0);
  const offscreenCtx = offscreenCanvas.getContext('2d')!;
  return {
    offscreenCanvas,
    offscreenCtx,
  };
}

type GL = WebGLRenderingContext | WebGL2RenderingContext;

// Vertex shader source (shared by all programs)
const vertexShaderSource = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
uniform bool u_flipY;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = u_flipY ? vec2(a_texCoord.x, 1.0 - a_texCoord.y) : a_texCoord;
}
`;

// Base fragment shader that just blits the texture
const baseFragmentShaderSource = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;

void main() {
  gl_FragColor = texture2D(u_texture, v_texCoord);
}
`;

// Bright pass shader - extracts bright pixels
const brightPassFragmentShaderSource = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_threshold;

void main() {
  vec4 color = texture2D(u_texture, v_texCoord);
  float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));

  if (luminance > u_threshold) {
    gl_FragColor = color;
  } else {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}
`;

// Gaussian blur shader (separable)
const blurFragmentShaderSource = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec2 u_direction;
uniform vec2 u_resolution;
uniform float u_radius;

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec4 color = vec4(0.0);

  // Gaussian weights for 21-tap blur (much larger radius)
  float weights[11];
  weights[0] = 0.05299;
  weights[1] = 0.05268;
  weights[2] = 0.05175;
  weights[3] = 0.05020;
  weights[4] = 0.04810;
  weights[5] = 0.04551;
  weights[6] = 0.04252;
  weights[7] = 0.03924;
  weights[8] = 0.03576;
  weights[9] = 0.03220;
  weights[10] = 0.02867;

  // Sample center
  color += texture2D(u_texture, v_texCoord) * weights[0];

  // Sample both directions with increased radius
  for(int i = 1; i < 11; i++) {
    vec2 offset = u_direction * texelSize * float(i) * u_radius;
    color += texture2D(u_texture, v_texCoord + offset) * weights[i];
    color += texture2D(u_texture, v_texCoord - offset) * weights[i];
  }

  gl_FragColor = color;
}
`;

// Final combine shader (bloom + noise + scanlines; no curvature)
const combineFragmentShaderSource = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_original;
uniform sampler2D u_bloom1;
uniform sampler2D u_bloom2;
uniform sampler2D u_bloom3;
uniform float u_bloomIntensity;
uniform float u_scanlineIntensity;
uniform float u_noiseIntensity;
uniform float u_noisePixelSize;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_vignetteStrength;
uniform float u_vignetteSize;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec2 uv = v_texCoord;

  vec4 original = texture2D(u_original, uv);

  // Bloom
  vec4 bloom1 = texture2D(u_bloom1, uv);
  vec4 bloom2 = texture2D(u_bloom2, uv);
  vec4 bloom3 = texture2D(u_bloom3, uv);
  vec4 bloom = (bloom1 + bloom2 + bloom3) * u_bloomIntensity;

  vec4 finalColor = original + bloom;

  // White noise
  vec2 noiseCoord = floor(uv * u_resolution / u_noisePixelSize) * u_noisePixelSize / u_resolution;
  float noise = random(noiseCoord + u_time * 0.1) * 2.0 - 1.0;
  finalColor.rgb += noise * u_noiseIntensity;

  // Scanlines
  float pixelY = uv.y * u_resolution.y;
  float scanlinePhase = mod(pixelY, u_noisePixelSize) / u_noisePixelSize;
  float sineValue = sin(scanlinePhase * 3.14159265359) * 0.5 + 0.5;
  sineValue = pow(sineValue, 2.5);
  float scanline = 1.0 - sineValue;
  float scanlineFactor = 1.0 - (scanline * u_scanlineIntensity * 1.5);
  finalColor.rgb *= scanlineFactor;

  // Vignette
  vec2 vignetteCoord = v_texCoord * 2.0 - 1.0;
  float vignette = 1.0 - smoothstep(u_vignetteSize, 1.0, length(vignetteCoord));
  vignette = mix(1.0 - u_vignetteStrength, 1.0, vignette);
  finalColor.rgb *= vignette;

  gl_FragColor = vec4(finalColor.rgb, 1.0);
}
`;

function createShader(gl: GL, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  assert(shader !== null);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  const status = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!status) {
    gl.deleteShader(shader);
    throw new Error('Failed to compile shader');
  }

  return shader;
}

function createProgram(gl: GL, vertexShader: WebGLShader, fragmentShader: WebGLShader): WebGLProgram {
  const program = gl.createProgram();
  assert(program !== null);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const status = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!status) {
    gl.deleteProgram(program);
    throw new Error('Failed to link program');
  }

  return program;
}

function createTexture(gl: GL, width: number, height: number): WebGLTexture {
  const texture = gl.createTexture();
  assert(texture !== null);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

function createFramebuffer(gl: GL, texture: WebGLTexture): WebGLFramebuffer {
  const framebuffer = gl.createFramebuffer();
  assert(framebuffer !== null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer not complete');
  }

  return framebuffer;
}

type Programs = {
  vertexShader: WebGLShader;
  baseProgram: WebGLProgram;
  brightPassProgram: WebGLProgram;
  blurProgram: WebGLProgram;
  combineProgram: WebGLProgram;
};

type BrightPassUniforms = {
  texture: WebGLUniformLocation;
  threshold: WebGLUniformLocation;
  flipY: WebGLUniformLocation;
};

type BlurUniforms = {
  texture: WebGLUniformLocation;
  direction: WebGLUniformLocation;
  resolution: WebGLUniformLocation;
  radius: WebGLUniformLocation;
  flipY: WebGLUniformLocation;
};

type CombineUniforms = {
  original: WebGLUniformLocation;
  bloom1: WebGLUniformLocation;
  bloom2: WebGLUniformLocation;
  bloom3: WebGLUniformLocation;
  bloomIntensity: WebGLUniformLocation;
  scanlineIntensity: WebGLUniformLocation;
  noiseIntensity: WebGLUniformLocation;
  noisePixelSize: WebGLUniformLocation;
  time: WebGLUniformLocation;
  resolution: WebGLUniformLocation;
  vignetteStrength: WebGLUniformLocation;
  vignetteSize: WebGLUniformLocation;
};

type Attributes = {
  positionAttributeLocation: number;
  texCoordAttributeLocation: number;
};

type GeometryBuffers = {
  positionBuffer: WebGLBuffer;
  texCoordBuffer: WebGLBuffer;
};

export function initPrograms(gl: GL): {
  programs: Programs;
  uniforms: { bright: BrightPassUniforms; blur: BlurUniforms; combine: CombineUniforms };
} {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);

  const baseProgram = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, baseFragmentShaderSource));
  const brightPassProgram = createProgram(
    gl,
    vertexShader,
    createShader(gl, gl.FRAGMENT_SHADER, brightPassFragmentShaderSource),
  );
  const blurProgram = createProgram(gl, vertexShader, createShader(gl, gl.FRAGMENT_SHADER, blurFragmentShaderSource));
  const combineProgram = createProgram(
    gl,
    vertexShader,
    createShader(gl, gl.FRAGMENT_SHADER, combineFragmentShaderSource),
  );

  const brightUniforms: BrightPassUniforms = {
    texture: gl.getUniformLocation(brightPassProgram, 'u_texture')!,
    threshold: gl.getUniformLocation(brightPassProgram, 'u_threshold')!,
    flipY: gl.getUniformLocation(brightPassProgram, 'u_flipY')!,
  };

  const blurUniforms: BlurUniforms = {
    texture: gl.getUniformLocation(blurProgram, 'u_texture')!,
    direction: gl.getUniformLocation(blurProgram, 'u_direction')!,
    resolution: gl.getUniformLocation(blurProgram, 'u_resolution')!,
    radius: gl.getUniformLocation(blurProgram, 'u_radius')!,
    flipY: gl.getUniformLocation(blurProgram, 'u_flipY')!,
  };

  const combineUniforms: CombineUniforms = {
    original: gl.getUniformLocation(combineProgram, 'u_original')!,
    bloom1: gl.getUniformLocation(combineProgram, 'u_bloom1')!,
    bloom2: gl.getUniformLocation(combineProgram, 'u_bloom2')!,
    bloom3: gl.getUniformLocation(combineProgram, 'u_bloom3')!,
    bloomIntensity: gl.getUniformLocation(combineProgram, 'u_bloomIntensity')!,
    scanlineIntensity: gl.getUniformLocation(combineProgram, 'u_scanlineIntensity')!,
    noiseIntensity: gl.getUniformLocation(combineProgram, 'u_noiseIntensity')!,
    noisePixelSize: gl.getUniformLocation(combineProgram, 'u_noisePixelSize')!,
    time: gl.getUniformLocation(combineProgram, 'u_time')!,
    resolution: gl.getUniformLocation(combineProgram, 'u_resolution')!,
    vignetteStrength: gl.getUniformLocation(combineProgram, 'u_vignetteStrength')!,
    vignetteSize: gl.getUniformLocation(combineProgram, 'u_vignetteSize')!,
  };

  return {
    programs: { vertexShader, baseProgram, brightPassProgram, blurProgram, combineProgram },
    uniforms: { bright: brightUniforms, blur: blurUniforms, combine: combineUniforms },
  };
}

export function initGeometry(gl: GL, baseProgram: WebGLProgram): { attributes: Attributes; buffers: GeometryBuffers } {
  const positionAttributeLocation = gl.getAttribLocation(baseProgram, 'a_position');
  const texCoordAttributeLocation = gl.getAttribLocation(baseProgram, 'a_texCoord');

  const positionBuffer = gl.createBuffer();
  assert(positionBuffer !== null);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  const texCoordBuffer = gl.createBuffer();
  assert(texCoordBuffer !== null);
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  const texCoords = [0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0];
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

  return {
    attributes: { positionAttributeLocation, texCoordAttributeLocation },
    buffers: { positionBuffer, texCoordBuffer },
  };
}

function setupVertexAttributes(gl: GL, attributes: Attributes, buffers: GeometryBuffers) {
  gl.enableVertexAttribArray(attributes.positionAttributeLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positionBuffer);
  gl.vertexAttribPointer(attributes.positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

  gl.enableVertexAttribArray(attributes.texCoordAttributeLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.texCoordBuffer);
  gl.vertexAttribPointer(attributes.texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);
}

function renderFullscreenQuad(gl: GL, attributes: Attributes, buffers: GeometryBuffers) {
  setupVertexAttributes(gl, attributes, buffers);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

type BloomResources = {
  originalTexture: WebGLTexture;
  brightTexture: WebGLTexture;
  brightFramebuffer: WebGLFramebuffer;
  blurTextures: WebGLTexture[];
  blurFramebuffers: WebGLFramebuffer[];
  tempTextures: WebGLTexture[];
  tempFramebuffers: WebGLFramebuffer[];
  width: number;
  height: number;
};

export function createBloomResourcesManager(gl: GL) {
  let bloomResources: BloomResources | null = null;

  const dispose = () => {
    if (!bloomResources) return;
    gl.deleteTexture(bloomResources.originalTexture);
    gl.deleteTexture(bloomResources.brightTexture);
    gl.deleteFramebuffer(bloomResources.brightFramebuffer);
    bloomResources.blurTextures.forEach((tex) => gl.deleteTexture(tex));
    bloomResources.blurFramebuffers.forEach((fb) => gl.deleteFramebuffer(fb));
    bloomResources.tempTextures.forEach((tex) => gl.deleteTexture(tex));
    bloomResources.tempFramebuffers.forEach((fb) => gl.deleteFramebuffer(fb));
  };

  const ensure = (width: number, height: number): BloomResources => {
    if (bloomResources && bloomResources.width === width && bloomResources.height === height) {
      return bloomResources;
    }

    if (bloomResources) {
      dispose();
    }

    const originalTexture = createTexture(gl, width, height);

    const brightTexture = createTexture(gl, width, height);
    const brightFramebuffer = createFramebuffer(gl, brightTexture);

    const blurTextures: WebGLTexture[] = [];
    const blurFramebuffers: WebGLFramebuffer[] = [];
    const tempTextures: WebGLTexture[] = [];
    const tempFramebuffers: WebGLFramebuffer[] = [];

    for (let i = 1; i < bloomConfig.scales.length; i++) {
      const scale = bloomConfig.scales[i]!;
      const scaledWidth = Math.max(1, Math.floor(width * scale));
      const scaledHeight = Math.max(1, Math.floor(height * scale));

      const blurTexture = createTexture(gl, scaledWidth, scaledHeight);
      const blurFramebuffer = createFramebuffer(gl, blurTexture);
      blurTextures.push(blurTexture);
      blurFramebuffers.push(blurFramebuffer);

      const tempTexture = createTexture(gl, scaledWidth, scaledHeight);
      const tempFramebuffer = createFramebuffer(gl, tempTexture);
      tempTextures.push(tempTexture);
      tempFramebuffers.push(tempFramebuffer);
    }

    bloomResources = {
      originalTexture,
      brightTexture,
      brightFramebuffer,
      blurTextures,
      blurFramebuffers,
      tempTextures,
      tempFramebuffers,
      width,
      height,
    };

    return bloomResources;
  };

  return { ensure };
}

export type ShaderData = {
  programs: Programs;
  uniforms: { bright: BrightPassUniforms; blur: BlurUniforms; combine: CombineUniforms };
  attributes: Attributes;
  buffers: GeometryBuffers;
  bloomManager: { ensure: (width: number, height: number) => BloomResources };
  offscreenCanvas: OffscreenCanvas;
  offscreenCtx: OffscreenCanvasRenderingContext2D;
};

export function setupWebglCanvas(offscreenCanvas: OffscreenCanvas, offscreenCtx: OffscreenCanvasRenderingContext2D) {
  const canvas = document.createElement('canvas');

  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  assert(gl !== null);

  const { programs, uniforms } = initPrograms(gl);
  const { attributes, buffers } = initGeometry(gl, programs.baseProgram);
  const bloomManager = createBloomResourcesManager(gl);

  const shaderData: ShaderData = {
    programs,
    uniforms,
    attributes,
    buffers,
    bloomManager,
    offscreenCanvas,
    offscreenCtx,
  };

  return { canvas, gl, shaderData };
}

export function drawWithShaders(
  gl: GL,
  webglCanvas: HTMLCanvasElement,
  shaderData: ShaderData,
  renderTerminalToOffscreen: (
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
    webglCanvas: HTMLCanvasElement,
  ) => void,
) {
  const {
    programs,
    uniforms,
    attributes,
    buffers,
    bloomManager,
    offscreenCanvas: offscreenCanvasLocal,
    offscreenCtx: offscreenCtxLocal,
  } = shaderData;

  // Set up WebGL canvas size
  const canvasRect = webglCanvas.getBoundingClientRect();
  const displayWidth = Math.floor(canvasRect.width * window.devicePixelRatio);
  const displayHeight = Math.floor(canvasRect.height * window.devicePixelRatio);
  webglCanvas.width = displayWidth;
  webglCanvas.height = displayHeight;

  // Render terminal to offscreen canvas
  renderTerminalToOffscreen(offscreenCanvasLocal, offscreenCtxLocal, webglCanvas);

  // Setup bloom resources
  const resources = bloomManager.ensure(displayWidth, displayHeight);

  // Step 1: Upload terminal content to original texture
  gl.bindTexture(gl.TEXTURE_2D, resources.originalTexture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreenCanvasLocal);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

  // Step 2: Bright pass - extract bright pixels
  gl.bindFramebuffer(gl.FRAMEBUFFER, resources.brightFramebuffer);
  gl.viewport(0, 0, displayWidth, displayHeight);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(programs.brightPassProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, resources.originalTexture);
  gl.uniform1i(uniforms.bright.texture, 0);
  gl.uniform1f(uniforms.bright.threshold, bloomConfig.threshold);
  gl.uniform1i(uniforms.bright.flipY, 1);
  renderFullscreenQuad(gl, attributes, buffers);

  // Step 3: Multi-scale blur passes
  let currentTexture = resources.brightTexture;

  for (let i = 0; i < resources.blurTextures.length; i++) {
    const scale = bloomConfig.scales[i + 1]!;
    const scaledWidth = Math.max(1, Math.floor(displayWidth * scale));
    const scaledHeight = Math.max(1, Math.floor(displayHeight * scale));

    // Horizontal blur pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.tempFramebuffers[i]!);
    gl.viewport(0, 0, scaledWidth, scaledHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const radiusScale = Math.max(0.3, scale);
    gl.useProgram(programs.blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, currentTexture);
    gl.uniform1i(uniforms.blur.texture, 0);
    gl.uniform2f(uniforms.blur.direction, 1.0, 0.0); // Horizontal
    gl.uniform2f(uniforms.blur.resolution, scaledWidth, scaledHeight);
    gl.uniform1f(uniforms.blur.radius, bloomConfig.radius * radiusScale);
    gl.uniform1i(uniforms.blur.flipY, 1);
    renderFullscreenQuad(gl, attributes, buffers);

    // Vertical blur pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.blurFramebuffers[i]!);
    gl.viewport(0, 0, scaledWidth, scaledHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resources.tempTextures[i]!);
    gl.uniform1i(uniforms.blur.texture, 0);
    gl.uniform2f(uniforms.blur.direction, 0.0, 1.0); // Vertical
    gl.uniform2f(uniforms.blur.resolution, scaledWidth, scaledHeight);
    gl.uniform1f(uniforms.blur.radius, bloomConfig.radius * radiusScale);
    gl.uniform1i(uniforms.blur.flipY, 1);
    renderFullscreenQuad(gl, attributes, buffers);

    // Use this blur result as input for next iteration (if any)
    currentTexture = resources.blurTextures[i]!;
  }

  // Step 4: Final combine pass - render to screen
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, displayWidth, displayHeight);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(programs.combineProgram);

  // Bind original texture
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, resources.originalTexture);
  gl.uniform1i(uniforms.combine.original, 0);

  // Bind bloom textures
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, resources.blurTextures[0] || resources.brightTexture);
  gl.uniform1i(uniforms.combine.bloom1, 1);

  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, resources.blurTextures[1] || resources.brightTexture);
  gl.uniform1i(uniforms.combine.bloom2, 2);

  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, resources.blurTextures[2] || resources.brightTexture);
  gl.uniform1i(uniforms.combine.bloom3, 3);

  gl.uniform1f(uniforms.combine.bloomIntensity, bloomConfig.intensity);

  gl.uniform1f(uniforms.combine.scanlineIntensity, scanlineConfig.intensity);
  gl.uniform1f(uniforms.combine.noiseIntensity, noiseConfig.intensity);
  gl.uniform1f(uniforms.combine.noisePixelSize, devicePixelRatio * 2.0);
  gl.uniform1f(uniforms.combine.time, performance.now() * 0.001);
  gl.uniform2f(uniforms.combine.resolution, displayWidth, displayHeight);
  gl.uniform1f(uniforms.combine.vignetteStrength, curveConfig.vignetteStrength);
  gl.uniform1f(uniforms.combine.vignetteSize, curveConfig.vignetteSize);

  renderFullscreenQuad(gl, attributes, buffers);
}
