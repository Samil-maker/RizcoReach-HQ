/**
 * Liquid chrome — a single full-screen fragment shader.
 *
 * A sine-warped height field gives a slow, viscous liquid surface; normals are
 * taken by finite differences and shaded as polished black chrome (studio
 * reflection bands + cursor-driven specular + fresnel rim). No libraries.
 *
 * Performance guards: adaptive render scale, paused when off-screen or the tab
 * is hidden, a single static frame for reduced-motion users, and a graceful
 * CSS fallback if WebGL is unavailable.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;
uniform float uTime;
uniform vec2 uMouse;
uniform float uHover;
uniform vec2 uCenter;
uniform float uSpread;
uniform float uIntro;
varying vec2 vUv;

float field(vec2 p, float t) {
  vec2 q = p;
  for (int i = 1; i < 6; i++) {
    float fi = float(i);
    q.x += 0.46 / fi * sin(fi * 1.25 * q.y + t * 0.5 + 0.37 * fi);
    q.y += 0.42 / fi * cos(fi * 1.05 * q.x + t * 0.38 + 0.61 * fi);
  }
  return 0.5 + 0.5 * sin(q.x * 0.85 + q.y * 1.05 + t * 0.12);
}

float heightAt(vec2 uv, float t, float aspect) {
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.8 * mix(1.7, 1.0, clamp(aspect, 0.0, 1.0));
  float h = field(p, t);
  // Cursor: a soft lens bulge with a travelling ripple ring.
  vec2 d = (uv - uMouse) * vec2(aspect, 1.0);
  float r2 = dot(d, d);
  h += uHover * (exp(-r2 * 22.0) * 0.26 + sin(sqrt(r2) * 40.0 - t * 6.0) * exp(-r2 * 12.0) * 0.035);
  return h;
}

// Studio environment: bright sky gradient, razor horizon, dark floor, two softboxes.
float envMap(vec3 r) {
  float y = r.y;
  float sky = smoothstep(0.02, 0.9, y);
  float horizon = exp(-pow(y * 15.0, 2.0));
  float above = smoothstep(-0.025, 0.025, y);
  float ground = 0.02 + 0.03 * smoothstep(-1.0, -0.3, y);
  float c = mix(ground, 0.05 + sky * 0.55, above);
  c += horizon * 1.15;
  c += exp(-pow((r.x - 0.5) * 4.0, 2.0)) * smoothstep(0.1, 0.7, y) * 0.6;
  c += exp(-pow((r.x + 0.62) * 7.0, 2.0)) * smoothstep(-0.05, 0.5, y) * 0.3;
  return c;
}

void main() {
  float aspect = uRes.x / uRes.y;
  float t = uTime;
  vec2 uv = vUv;

  float e = 1.5 / uRes.y;
  float h = heightAt(uv, t, aspect);
  float hx = heightAt(uv + vec2(e, 0.0), t, aspect);
  float hy = heightAt(uv + vec2(0.0, e), t, aspect);
  vec2 g = vec2(hx - h, hy - h) / e;
  vec3 n = normalize(vec3(-g * 0.3, 1.0));

  vec3 v = vec3(0.0, 0.0, 1.0);
  vec3 r = reflect(-v, n);
  r = normalize(r + vec3(0.0, 0.05, 0.0));
  float c = envMap(r);

  // Cursor key light + fresnel rim.
  vec3 L = normalize(vec3((uMouse - uv) * vec2(aspect, 1.0) * 1.2, 0.9));
  float spec = pow(max(dot(reflect(-L, n), v), 0.0), 90.0) * (0.25 + uHover * 0.8);
  float rim = pow(1.0 - max(n.z, 0.0), 3.0) * 0.6;
  c += spec + rim;

  // Shape the liquid into a pool so the headline sits on calm black.
  vec2 cd = (uv - uCenter) * vec2(aspect, 1.0);
  float edge = length(cd) / uSpread + (h - 0.5) * 0.7;
  float mask = smoothstep(1.0, 0.35, edge);
  mask *= uIntro;
  c *= mask;

  c = pow(c, 1.15);
  c = c / (1.0 + c * 0.25) * 1.08;

  vec3 col = vec3(c * 0.985, c * 0.995, c * 1.02);
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

interface Opts {
  center?: [number, number];
  centerMobile?: [number, number];
  spread?: number;
  spreadMobile?: number;
}

export function mountChrome(canvas: HTMLCanvasElement, opts: Opts = {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = (canvas.getContext('webgl', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  }) || null) as WebGLRenderingContext | null;
  if (!gl) {
    canvas.dataset.state = 'fallback';
    return;
  }

  // Software rendering (no GPU: SwiftShader/llvmpipe, e.g. Lighthouse, VMs, some
  // low-end devices) would run the shader on the CPU every frame. Draw a single
  // still frame instead. Same for Save-Data users.
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  const still = reduced || software || saveData;

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn(gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) {
    canvas.dataset.state = 'fallback';
    return;
  }
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    canvas.dataset.state = 'fallback';
    return;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = {
    res: gl.getUniformLocation(prog, 'uRes'),
    time: gl.getUniformLocation(prog, 'uTime'),
    mouse: gl.getUniformLocation(prog, 'uMouse'),
    hover: gl.getUniformLocation(prog, 'uHover'),
    center: gl.getUniformLocation(prog, 'uCenter'),
    spread: gl.getUniformLocation(prog, 'uSpread'),
    intro: gl.getUniformLocation(prog, 'uIntro'),
  };

  const mobile = window.matchMedia('(max-width: 760px)');
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  let scale = coarse ? 0.55 : 0.8;
  const rtl = document.documentElement.dir === 'rtl';

  const layout = () => {
    const isM = mobile.matches;
    let c = isM ? opts.centerMobile ?? [0.7, 0.9] : opts.center ?? [0.72, 0.56];
    if (rtl) c = [1 - c[0], c[1]];
    gl.uniform2f(u.center, c[0], c[1]);
    gl.uniform1f(u.spread, isM ? opts.spreadMobile ?? 0.44 : opts.spread ?? 0.78);
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr * scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform2f(u.res, w, h);
    layout();
  };

  // Pointer (smoothed)
  const target = { x: 0.68, y: 0.6, hover: 0 };
  const cur = { x: 0.68, y: 0.6, hover: 0 };
  const host = canvas.parentElement ?? canvas;
  const onMove = (x: number, y: number) => {
    const r = canvas.getBoundingClientRect();
    target.x = (x - r.left) / r.width;
    target.y = 1 - (y - r.top) / r.height;
    target.hover = 1;
  };
  host.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY), { passive: true });
  host.addEventListener('pointerleave', () => (target.hover = 0), { passive: true });
  host.addEventListener('touchmove', (e) => e.touches[0] && onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  host.addEventListener('touchend', () => (target.hover = 0), { passive: true });

  let running = false;
  let visible = true;
  let raf = 0;
  let last = performance.now();
  let t = 14.0;
  let intro = still ? 1 : 0;
  const frames: number[] = [];

  const draw = () => {
    cur.x += (target.x - cur.x) * 0.06;
    cur.y += (target.y - cur.y) * 0.06;
    cur.hover += (target.hover - cur.hover) * 0.04;
    gl.uniform1f(u.time, t);
    gl.uniform2f(u.mouse, cur.x, cur.y);
    gl.uniform1f(u.hover, cur.hover);
    gl.uniform1f(u.intro, 1 - Math.pow(1 - intro, 3));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const loop = (now: number) => {
    raf = 0;
    if (!running) return;
    const real = (now - last) / 1000;
    const dt = Math.min(0.05, real);
    last = now;
    t += dt * 0.6;
    if (intro < 1) intro = Math.min(1, intro + Math.min(real, 0.25) * 0.6);

    // Adaptive resolution: if the GPU struggles, render fewer pixels.
    frames.push(dt);
    if (frames.length === 40) {
      const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
      frames.length = 0;
      if (avg > 0.024 && scale > 0.36) {
        scale = Math.max(0.36, scale * 0.78);
        resize();
      }
    }
    draw();
    raf = requestAnimationFrame(loop);
  };

  const start = () => {
    if (running || still || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  resize();
  draw();
  canvas.dataset.state = 'ready';

  if (still) {
    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = window.setTimeout(() => {
        resize();
        draw();
      }, 150);
    });
    return;
  }

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible ? start() : stop();
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  let rt = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = window.setTimeout(() => {
      resize();
      if (!running) draw();
    }, 120);
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stop();
    canvas.dataset.state = 'fallback';
  });
  start();
}
