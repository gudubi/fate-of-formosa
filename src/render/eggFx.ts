// 彩蛋事件的地圖特效：每個特效是一組臨時物件，依時間更新後自動移除
import * as THREE from 'three';
import { GEO } from '../map/mapData';

interface Fx { obj: THREE.Object3D; t: number; life: number; update: (t: number, k: number) => void }

/** 0→1→0 的淡入淡出：前後各 fade 比例 */
const envelope = (k: number, fade = 0.15) => Math.min(1, k / fade, (1 - k) / fade);

export class EggEffects {
  private list: Fx[] = [];

  constructor(private scene: THREE.Scene, private surfaceY: (x: number, y: number) => number) {}

  private add(obj: THREE.Object3D, life: number, update: Fx['update']) {
    this.scene.add(obj);
    this.list.push({ obj, t: 0, life, update });
  }

  update(dt: number) {
    this.list = this.list.filter(f => {
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      f.update(f.t, k);
      if (k < 1) return true;
      this.scene.remove(f.obj);
      f.obj.traverse(o => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose();
      });
      return false;
    });
  }

  private points(count: number, color: string, size: number, place: (i: number, p: Float32Array) => void) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) place(i, pos);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    return new THREE.Points(g, mat);
  }

  /** 夜空星點閃爍 */
  stars(x: number, y: number) {
    const p = this.points(380, '#e8f4ff', 2.6, (i, a) => {
      a[i * 3] = x + (Math.random() - 0.5) * 520; a[i * 3 + 1] = 90 + Math.random() * 140; a[i * 3 + 2] = y + (Math.random() - 0.5) * 520;
    });
    const mat = p.material as THREE.PointsMaterial;
    this.add(p, 8, (t, k) => { mat.opacity = envelope(k) * (0.75 + 0.25 * Math.sin(t * 9)); mat.size = 2.2 + Math.sin(t * 5) * 0.6; });
  }

  /** 金色光點升起散開 */
  sparkle(x: number, y: number, color = '#ffd36b') {
    const base = this.surfaceY(x, y);
    const n = 90;
    const vel = Array.from({ length: n }, () => new THREE.Vector3((Math.random() - 0.5) * 30, 12 + Math.random() * 28, (Math.random() - 0.5) * 30));
    const p = this.points(n, color, 3, (i, a) => { a[i * 3] = x; a[i * 3 + 1] = base + 2; a[i * 3 + 2] = y; });
    const mat = p.material as THREE.PointsMaterial;
    const pos = p.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.add(p, 3.2, (t, k) => {
      for (let i = 0; i < n; i++) {
        pos.setXYZ(i, x + vel[i].x * t, base + 2 + vel[i].y * t - 6 * t * t, y + vel[i].z * t);
      }
      pos.needsUpdate = true;
      mat.opacity = envelope(k, 0.1);
    });
  }

  /** 火球劃過天際，落地處泛起光暈 */
  meteor(x: number, y: number) {
    const from = new THREE.Vector3(x + 260, 260, y - 300), to = new THREE.Vector3(x, this.surfaceY(x, y) + 4, y);
    const dir = to.clone().sub(from).normalize();
    const additive = (color: string, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    // 圓錐尾巴：寬的一端（radiusBottom）在火球處，細的一端拖在後方
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 2.4, 70, 10, 1, true), additive('#ffb36b', 0.85));
    tail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
    const head = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), additive('#fff3d0'));
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), additive('#ff9a4a', 0));
    flash.position.copy(to);
    const group = new THREE.Group();
    group.add(tail, head, flash);
    const fly = 1.8;
    this.add(group, 4, t => {
      const k = Math.min(1, t / fly);
      const pos = from.clone().lerp(to, k * k);
      head.position.copy(pos);
      tail.position.copy(pos).addScaledVector(dir, -35);
      (tail.material as THREE.MeshBasicMaterial).opacity = t < fly ? 0.85 : Math.max(0, 0.85 - (t - fly) * 2);
      (head.material as THREE.MeshBasicMaterial).opacity = t < fly ? 1 : 0;
      if (t >= fly) {
        const e = t - fly;
        flash.scale.setScalar(3 + Math.min(e, 0.8) * 16);
        (flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 - e * 0.35);
      }
    });
  }

  /** 山頭降雪 */
  snow(x: number, y: number) {
    const n = 900, top = this.surfaceY(x, y) + 70;
    const p = this.points(n, '#ffffff', 1.6, (i, a) => {
      const r = Math.sqrt(Math.random()) * 45, th = Math.random() * Math.PI * 2;
      a[i * 3] = x + Math.cos(th) * r; a[i * 3 + 1] = top - Math.random() * 70; a[i * 3 + 2] = y + Math.sin(th) * r;
    });
    (p.material as THREE.PointsMaterial).blending = THREE.NormalBlending;
    const mat = p.material as THREE.PointsMaterial;
    const pos = p.geometry.getAttribute('position') as THREE.BufferAttribute;
    const floor = this.surfaceY(x, y);
    this.add(p, 9, (t, k) => {
      for (let i = 0; i < n; i++) {
        let h = pos.getY(i) - 0.16;
        if (h < floor) h = top;
        pos.setY(i, h);
        pos.setX(i, pos.getX(i) + Math.sin(t * 2 + i) * 0.03);
      }
      pos.needsUpdate = true;
      mat.opacity = envelope(k) * 0.9;
    });
  }

  /** 縣市上空光暈：一圈緩慢擴張、脈動的光環 */
  halo(x: number, y: number, color = '#ffe9a8') {
    const ring = new THREE.Mesh(new THREE.RingGeometry(24, 30, 72),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, this.surfaceY(x, y) + 22, y);
    const mat = ring.material as THREE.MeshBasicMaterial;
    this.add(ring, 7, (t, k) => {
      ring.scale.setScalar(1 + k * 0.6 + Math.sin(t * 3) * 0.05);
      mat.opacity = envelope(k) * 0.8;
    });
  }

  /** 海峽中游動的鯨群（白色噴氣點隨之出現） */
  whales(x: number, y: number) {
    const group = new THREE.Group();
    const bodies: THREE.Mesh[] = [];
    for (let i = 0; i < 7; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 8),
        new THREE.MeshBasicMaterial({ color: '#9fd8ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.scale.set(1, 0.4, 2.2);
      m.userData = { dx: (Math.random() - 0.5) * 30, dz: i * 9 + Math.random() * 6, ph: Math.random() * 6 };
      group.add(m);
      bodies.push(m);
    }
    this.add(group, 11, (t, k) => {
      for (const b of bodies) {
        const u = b.userData as { dx: number; dz: number; ph: number };
        b.position.set(x + u.dx + Math.sin(t + u.ph) * 4, 0.8 + Math.max(0, Math.sin(t * 2 + u.ph)) * 1.5, y + 90 - t * 16 - u.dz);
        (b.material as THREE.MeshBasicMaterial).opacity = envelope(k) * (0.55 + 0.45 * Math.max(0, Math.sin(t * 2 + u.ph)));
      }
    });
  }

  /** 一串腳印走過去再走回來 */
  footprints(fromX: number, fromY: number, toX: number, toY: number, color = '#2b2116') {
    const group = new THREE.Group();
    const steps = 18;
    const dir = new THREE.Vector2(toX - fromX, toY - fromY);
    const side = new THREE.Vector2(-dir.y, dir.x).normalize().multiplyScalar(2.2);
    const prints: THREE.Mesh[] = [];
    for (let i = 0; i < steps; i++) {
      const k = i / (steps - 1);
      const px = fromX + dir.x * k + (i % 2 ? side.x : -side.x), py = fromY + dir.y * k + (i % 2 ? side.y : -side.y);
      const m = new THREE.Mesh(new THREE.CircleGeometry(1.8, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(px, this.surfaceY(px, py) + 0.4, py);
      group.add(m);
      prints.push(m);
    }
    this.add(group, 9, t => {
      prints.forEach((m, i) => {
        const appear = i * 0.22, gone = appear + 4.5;
        const o = t < appear ? 0 : t < gone ? 0.85 : Math.max(0, 0.85 - (t - gone));
        (m.material as THREE.MeshBasicMaterial).opacity = o;
      });
    });
  }

  /** 海峽上空倒懸的島嶼輪廓 */
  mirage(x: number, y: number) {
    const pts: number[] = [];
    for (const line of GEO.coast) for (let i = 0; i < line.length - 1; i++) {
      pts.push(line[i][0], 0, line[i][1], line[i + 1][0], 0, line[i + 1][1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: '#bfe8ff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const lines = new THREE.LineSegments(g, mat);
    // 半透明的島嶼本體：以各縣市外環填色，看起來像微微發光的海市蜃樓
    const shapes = GEO.counties.flatMap(c => c.polygons.map(poly => new THREE.Shape(poly[0].map(([px, py]) => new THREE.Vector2(px, -py)))));
    const fillMat = new THREE.MeshBasicMaterial({ color: '#8fd3ff', transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(shapes), fillMat);
    fill.rotation.x = -Math.PI / 2;
    const island = new THREE.Group();
    island.add(fill, lines);
    // 以海峽為中心、上下顛倒（南北翻轉）懸在半空
    island.scale.set(0.7, 1, -0.7);
    island.position.set(x, 70, y);
    this.add(island, 11, (t, k) => {
      const a = envelope(k, 0.25);
      mat.opacity = a * (0.75 + 0.2 * Math.sin(t * 1.7));
      fillMat.opacity = a * (0.24 + 0.06 * Math.sin(t * 1.3));
      island.position.y = 70 + Math.sin(t * 0.8) * 3;
    });
  }

  /** 颱風路徑畫成一顆心 */
  heart(x: number, y: number, color = '#ff7aa8') {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      const hx = 16 * Math.sin(a) ** 3, hy = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
      pts.push(new THREE.Vector3(x + hx * 3.2, 1.5, y - hy * 3.2));
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
    const line = new THREE.Line(g, mat);
    g.setDrawRange(0, 0);
    this.add(line, 9, (t, k) => {
      g.setDrawRange(0, Math.min(pts.length, Math.floor((t / 4) * pts.length)));
      mat.opacity = k > 0.8 ? (1 - k) / 0.2 : 1;
    });
  }

  /** 地標射出光束 */
  beam(x: number, y: number, color = '#ffe08a') {
    const base = this.surfaceY(x, y);
    const group = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.6, 160, 20, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    col.position.set(x, base + 80, y);
    group.add(col);
    this.add(group, 7, (t, k) => {
      (col.material as THREE.MeshBasicMaterial).opacity = envelope(k, 0.12) * (0.55 + 0.25 * Math.sin(t * 6));
      col.scale.set(1 + Math.sin(t * 3) * 0.15, 1, 1 + Math.sin(t * 3) * 0.15);
    });
    this.halo(x, y, color);
  }
}
