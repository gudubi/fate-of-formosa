import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { GEO, RASTER, RW, RH, GRID, GW, GH, heightAt, rasterAt, type Raster } from '../map/mapData';
import { MAP_EXTENT } from '../map/projection';

const BASE = 1.0;       // 陸地底座高度（公里）
const EXAG = 5;         // 地形垂直誇張倍率
const MAX_ID = 32;

const TERRAIN_VS = /* glsl */`
attribute float elev;
varying vec3 vW;
varying vec3 vN;
varying float vH;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vH = elev;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const TERRAIN_FS = /* glsl */`
uniform sampler2D idTex;
uniform sampler2D colorTex;
uniform vec2 rOrigin;
uniform vec2 rSize;
uniform float mode;
uniform float hoverId;
uniform float selId;
uniform float hlId;
uniform vec3 hlColor;
uniform float hlAmt;
uniform float time;
uniform float pixAngle;
varying vec3 vW;
varying vec3 vN;
varying float vH;
float idAt(vec2 uv) { return floor(texture2D(idTex, uv).r * 255.0 + 0.5); }
void main() {
  vec2 uv = (vW.xz - rOrigin) / rSize;
  float id = idAt(uv);
  if (id < 0.5) discard;
  // 邊界線寬以「相機距離 × 單像素視角」計算，不受坡度影響
  vec2 px = vec2(length(cameraPosition - vW) * pixAngle * 1.3) / rSize;
  float l = idAt(uv - vec2(px.x, 0.0)), r = idAt(uv + vec2(px.x, 0.0));
  float d = idAt(uv - vec2(0.0, px.y)), u = idAt(uv + vec2(0.0, px.y));
  float border = ((l != id && l > 0.5) || (r != id && r > 0.5) || (d != id && d > 0.5) || (u != id && u > 0.5)) ? 1.0 : 0.0;
  float coast = (l < 0.5 || r < 0.5 || d < 0.5 || u < 0.5) ? 1.0 : 0.0;

  float h = vH;
  vec3 t = mix(vec3(0.46, 0.55, 0.38), vec3(0.29, 0.41, 0.27), smoothstep(40.0, 900.0, h));
  t = mix(t, vec3(0.43, 0.40, 0.32), smoothstep(1400.0, 2700.0, h));
  t = mix(t, vec3(0.82, 0.80, 0.76), smoothstep(3200.0, 3850.0, h));
  vec3 layer = texture2D(colorTex, vec2((id + 0.5) / ${MAX_ID}.0, 0.5)).rgb;

  vec3 L = normalize(vec3(-0.45, 0.8, -0.4));
  float sh = clamp(dot(normalize(vN), L), 0.0, 1.0);
  vec3 col = mode < 0.5 ? t * (0.32 + 0.9 * sh) : layer * (0.6 + 0.5 * sh);

  if (abs(id - selId) < 0.5) col = mix(col, vec3(1.0), 0.22);
  if (abs(id - hoverId) < 0.5) col = mix(col, vec3(1.0), 0.1);
  if (abs(id - hlId) < 0.5) {
    float p = 0.5 + 0.5 * sin(time * 5.0);
    col = mix(col, hlColor, hlAmt * (0.3 + 0.4 * p));
  }
  col = mix(col, vec3(0.06, 0.06, 0.09), border * 0.8);
  col = mix(col, vec3(0.85, 0.92, 1.0), coast * 0.55);
  gl_FragColor = vec4(col, 1.0);
}`;

const OCEAN_VS = /* glsl */`
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const OCEAN_FS = /* glsl */`
uniform float time;
varying vec3 vW;
void main() {
  float d = length(vW.xz - vec2(-40.0, 0.0));
  vec3 shallow = vec3(0.05, 0.17, 0.27), deep = vec3(0.02, 0.07, 0.14), far = vec3(0.012, 0.035, 0.07);
  vec3 col = mix(shallow, deep, smoothstep(60.0, 520.0, d));
  float n = sin(vW.x * 0.045 + time * 0.5) * sin(vW.z * 0.052 - time * 0.35)
          + 0.5 * sin(vW.x * 0.11 - vW.z * 0.07 + time * 0.8);
  col += 0.01 * n;
  col = mix(col, far, smoothstep(520.0, 1300.0, d));
  gl_FragColor = vec4(col, 1.0);
}`;

const RIPPLE_FS = /* glsl */`
uniform vec3 color;
uniform float t;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float p = fract(t * 0.55 - float(i) / 3.0);
    a += smoothstep(0.06, 0.0, abs(r - p)) * (1.0 - p);
  }
  a += smoothstep(0.12, 0.0, r) * 0.9;
  if (r > 1.0) discard;
  gl_FragColor = vec4(color, a);
}`;

export type MapMode = 'terrain' | 'layer';

interface Ripple { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; age: number; life: number }

export class MapScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: MapControls;
  private terrain!: THREE.Mesh;
  private terrainMat!: THREE.ShaderMaterial;
  private colorData = new Uint8Array(MAX_ID * 4);
  private colorTex: THREE.DataTexture;
  private oceanMat!: THREE.ShaderMaterial;
  private ripples: Ripple[] = [];
  private flight: null | { t: number; dur: number; fromT: THREE.Vector3; toT: THREE.Vector3; fromD: number; toD: number; fromPolar: number; toPolar: number } = null;
  private time = 0;
  private ray = new THREE.Raycaster();
  /** 畫布位置快取：每幀轉換標籤座標時不必重新查詢版面 */
  private rect = { left: 0, top: 0, width: 1, height: 1 };
  private v3 = new THREE.Vector3();
  /** 減少動態：鏡頭移動改為瞬間到位 */
  reducedMotion = false;

  /** 載入預先算好的地圖柵格後建立場景 */
  static async create(canvas: HTMLCanvasElement, raster: Raster) {
    return new MapScene(canvas, raster);
  }

  private constructor(private canvas: HTMLCanvasElement, readonly raster: Raster) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    // 手機 GPU 較弱：觸控裝置的像素比上限 1.5
    const touch = matchMedia('(pointer: coarse)').matches;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, touch ? 1.5 : 2));
    this.scene.background = new THREE.Color(0x03090f);
    this.camera = new THREE.PerspectiveCamera(40, 1, 5, 6000);
    this.controls = new MapControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true, dampingFactor: 0.08, minDistance: 35, maxDistance: 1500,
      maxPolarAngle: 1.1, zoomSpeed: 1.1, screenSpacePanning: false,
    });
    this.controls.addEventListener('start', () => { this.flight = null; });

    this.colorTex = new THREE.DataTexture(this.colorData, MAX_ID, 1, THREE.RGBAFormat);
    this.colorTex.needsUpdate = true;

    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x0b1a22, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(-300, 600, -350);
    this.scene.add(sun);

    this.buildOcean();
    this.buildGraticule();
    this.buildNeighbors();
    this.buildWalls();
    this.buildTerrain();
    this.resize();
    this.overview(false);
  }

  // ---------- 建構 ----------

  private buildOcean() {
    this.oceanMat = new THREE.ShaderMaterial({ vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS, uniforms: { time: { value: 0 } } });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), this.oceanMat);
    m.rotation.x = -Math.PI / 2;
    this.scene.add(m);
  }

  private buildGraticule() {
    const pts: number[] = [];
    for (const line of GEO.graticule) for (let i = 0; i < line.length - 1; i++) {
      pts.push(line[i][0], 0.15, line[i][1], line[i + 1][0], 0.15, line[i + 1][1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x3a6f9a, transparent: true, opacity: 0.22 })));
  }

  private shapeFromRing(ring: number[][]): THREE.Shape {
    return new THREE.Shape(ring.map(([x, y]) => new THREE.Vector2(x, -y)));
  }

  private buildNeighbors() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x2a3540 });
    const edgePts: number[] = [];
    for (const n of GEO.neighbors) {
      const shapes = n.rings.map(r => this.shapeFromRing(r));
      const geo = new THREE.ExtrudeGeometry(shapes, { depth: 0.6, bevelEnabled: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
      for (const r of n.rings) r.forEach(([x, y], i) => {
        const [nx, ny] = r[(i + 1) % r.length];
        edgePts.push(x, 0.65, y, nx, 0.65, ny);
      });
    }
    // 所有海岸線合併成一次繪製
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
    this.scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x6d8496, transparent: true, opacity: 0.6 })));
  }

  /** 縣市擠出的側牆（海岸峭壁）；頂面被地形覆蓋 */
  private buildWalls() {
    const shapes: THREE.Shape[] = [];
    for (const c of GEO.counties) for (const poly of c.polygons) {
      const s = this.shapeFromRing(poly[0]);
      for (const hole of poly.slice(1)) s.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, -y))));
      shapes.push(s);
    }
    const geo = new THREE.ExtrudeGeometry(shapes, { depth: BASE, bevelEnabled: false });
    const mesh = new THREE.Mesh(geo, [
      new THREE.MeshLambertMaterial({ color: 0x55664a }),
      new THREE.MeshLambertMaterial({ color: 0x8a8068 }),
    ]);
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
  }

  private buildTerrain() {
    const nx = GW, ny = GH;
    const pos = new Float32Array(nx * ny * 3);
    const elev = this.raster.heights;
    const land = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = RASTER.x0 + i * GRID, y = RASTER.y0 + j * GRID;
      const k = j * nx + i;
      land[k] = rasterAt(this.raster, x, y) ? 1 : 0;
      pos[k * 3] = x; pos[k * 3 + 1] = BASE + 0.08 + (elev[k] / 1000) * EXAG; pos[k * 3 + 2] = y;
    }
    const idx: number[] = [];
    const g2 = GRID / 2;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      const x = RASTER.x0 + i * GRID, y = RASTER.y0 + j * GRID;
      const any = land[a] || land[b] || land[c] || land[d]
        || rasterAt(this.raster, x + g2, y + g2) || rasterAt(this.raster, x + g2, y) || rasterAt(this.raster, x, y + g2);
      if (any) idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('elev', new THREE.BufferAttribute(elev, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const idTex = new THREE.DataTexture(this.raster.ids, RW, RH, THREE.RedFormat, THREE.UnsignedByteType);
    idTex.magFilter = idTex.minFilter = THREE.NearestFilter;
    idTex.generateMipmaps = false;
    idTex.needsUpdate = true;
    this.terrainMat = new THREE.ShaderMaterial({
      vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS,
      uniforms: {
        idTex: { value: idTex }, colorTex: { value: this.colorTex },
        rOrigin: { value: new THREE.Vector2(RASTER.x0, RASTER.y0) },
        rSize: { value: new THREE.Vector2(RW * RASTER.res, RH * RASTER.res) },
        mode: { value: 0 }, hoverId: { value: -1 }, selId: { value: -1 }, hlId: { value: -1 },
        hlColor: { value: new THREE.Color(1, 1, 1) }, hlAmt: { value: 0 }, time: { value: 0 }, pixAngle: { value: 0.001 },
      },
    });
    this.terrain = new THREE.Mesh(geo, this.terrainMat);
    this.scene.add(this.terrain);
  }

  // ---------- 外部控制 ----------

  /** 平面公里座標 → 該處地表高度（世界座標 y） */
  surfaceY(x: number, y: number): number {
    return BASE + 0.08 + (heightAt(this.raster, x, y) / 1000) * EXAG;
  }

  setMode(m: MapMode) { this.terrainMat.uniforms.mode.value = m === 'terrain' ? 0 : 1; }

  /** colors[i] 對應縣市編號 i+1 */
  setCountyColors(colors: THREE.Color[]) {
    colors.forEach((c, i) => {
      const o = (i + 1) * 4;
      this.colorData[o] = c.r * 255; this.colorData[o + 1] = c.g * 255; this.colorData[o + 2] = c.b * 255; this.colorData[o + 3] = 255;
    });
    this.colorTex.needsUpdate = true;
  }

  setSelected(countyIdx: number | null) { this.terrainMat.uniforms.selId.value = countyIdx === null ? -1 : countyIdx + 1; }
  setHover(countyIdx: number | null) { this.terrainMat.uniforms.hoverId.value = countyIdx === null ? -1 : countyIdx + 1; }

  private hlTimer = 0;
  highlight(countyIdx: number | null, color: THREE.Color, seconds = 4) {
    const u = this.terrainMat.uniforms;
    u.hlId.value = countyIdx === null ? -1 : countyIdx + 1;
    u.hlColor.value.copy(color);
    u.hlAmt.value = 1;
    this.hlTimer = seconds;
  }

  ripple(x: number, y: number, color: THREE.Color, radius = 30, life = 4.5) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: RIPPLE_FS, uniforms: { color: { value: color.clone() }, t: { value: 0 } },
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, this.surfaceY(x, y) + 0.5, y);
    mesh.renderOrder = 10;
    this.scene.add(mesh);
    this.ripples.push({ mesh, mat, age: 0, life });
  }

  /** 鏡頭飛往指定平面座標 */
  flyTo(x: number, y: number, distance: number, dur = 1.4, polar = 0.78) {
    if (this.reducedMotion) dur = 0.01;
    const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    this.flight = {
      t: 0, dur, fromT: this.controls.target.clone(), toT: new THREE.Vector3(x, 0, y),
      fromD: sph.radius, toD: distance, fromPolar: sph.phi, toPolar: polar,
    };
  }

  /** 全島視角：依畫面比例調整距離，直式手機也能看到整座島 */
  overview(animate = true) {
    const fovH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 2;
    const d = Math.max(470 / fovH, 300 / (fovH * this.camera.aspect));
    if (animate) this.flyTo(-25, 10, d, 1.6, 0.5);
    else {
      this.controls.target.set(-25, 0, 10);
      this.camera.position.set(-25, d * Math.cos(0.5), 10 + d * Math.sin(0.5));
      this.controls.update();
    }
  }

  /** 從高空俯衝至全島視角（開場用） */
  introFrom() {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 2800, 900);
    this.controls.update();
  }

  /**
   * 螢幕座標 → 縣市索引（無則 null）與平面座標。
   * 不對十幾萬個三角形做射線檢測：先與平面相交，再依地表高度迭代修正幾次即可。
   */
  pick(clientX: number, clientY: number): { county: number | null; x: number; y: number } | null {
    const r = this.rect;
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    let h = BASE;
    for (let i = 0; i < 4; i++) {
      if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -h), p)) return null;
      h = this.surfaceY(p.x, p.z);
    }
    const id = rasterAt(this.raster, p.x, p.z);
    return { county: id ? id - 1 : null, x: p.x, y: p.z };
  }

  /** 世界座標 → 螢幕座標（CSS 像素）；在鏡頭後方回傳 null */
  toScreen(x: number, yWorld: number, z: number): { x: number; y: number } | null {
    const v = this.v3.set(x, yWorld, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x * 0.5 + 0.5) * this.rect.width, y: (-v.y * 0.5 + 0.5) * this.rect.height };
  }

  cameraDistance() { return this.camera.position.distanceTo(this.controls.target); }

  resize() {
    const b = this.canvas.getBoundingClientRect();
    this.rect = { left: b.left, top: b.top, width: b.width, height: b.height };
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.terrainMat) {
      this.terrainMat.uniforms.pixAngle.value = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / Math.max(1, h);
    }
  }

  render(dt: number) {
    this.time += dt;
    const u = this.terrainMat.uniforms;
    u.time.value = this.time;
    this.oceanMat.uniforms.time.value = this.time;
    if (this.hlTimer > 0) {
      this.hlTimer -= dt;
      u.hlAmt.value = Math.min(1, Math.max(0, this.hlTimer));
    }

    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = f.t < 0.5 ? 4 * f.t ** 3 : 1 - (-2 * f.t + 2) ** 3 / 2;
      const sph = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
      this.controls.target.lerpVectors(f.fromT, f.toT, e);
      sph.radius = f.fromD + (f.toD - f.fromD) * e;
      sph.phi = f.fromPolar + (f.toPolar - f.fromPolar) * e;
      this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(sph));
      if (f.t >= 1) this.flight = null;
    }
    this.controls.update();
    // 限制平移範圍
    const t = this.controls.target, [[x0, y0], [x1, y1]] = MAP_EXTENT;
    const cx = THREE.MathUtils.clamp(t.x, x0, x1), cz = THREE.MathUtils.clamp(t.z, y0, y1);
    if (cx !== t.x || cz !== t.z) {
      const dx = cx - t.x, dz = cz - t.z;
      t.x = cx; t.z = cz; this.camera.position.x += dx; this.camera.position.z += dz;
    }

    for (const r of this.ripples) {
      r.age += dt;
      r.mat.uniforms.t.value = r.age;
      r.mat.opacity = 1;
      const fade = Math.min(1, (r.life - r.age) / 1);
      r.mat.uniforms.color.value.multiplyScalar(fade < 1 ? 0.97 : 1);
    }
    this.ripples = this.ripples.filter(r => {
      if (r.age < r.life) return true;
      this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mat.dispose();
      return false;
    });
    this.renderer.render(this.scene, this.camera);
  }
}
