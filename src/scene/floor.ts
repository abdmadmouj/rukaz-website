import {
  BackSide, Color, DataTexture, FloatType, HalfFloatType, LinearFilter, Matrix4, Mesh, NearestFilter, OrthographicCamera, PerspectiveCamera,
  Plane, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, SphereGeometry, Vector3, Vector4, WebGLRenderTarget, type WebGLRenderer,
} from 'three';
import { artDirection as AD } from '../config/artDirection';
import { REFLECT_LAYER } from './plateMaterials';
import { P, STRIDE } from './poses';

/** the shadow map holds up to this many plates */
export const MAX_PLATES = 160;

/**
 * The floor: polished dark stone. Soft contact shadows and light pooling through the glass
 * are computed analytically from the plates (signed distance to each slab, marched toward
 * the key light) into a small map, refreshed only when plates move. A planar reflection
 * mirrors the plates on the high-quality path. The backdrop dissolves into the horizon.
 */
export class Floor {
  readonly mesh: Mesh;
  readonly backdrop: Mesh;
  reflections = true;
  private shadowScene = new Scene();
  private shadowCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private shadowRT: WebGLRenderTarget;
  private reflectRT: WebGLRenderTarget | null = null;
  private virtualCam = new PerspectiveCamera();
  private textureMatrix = new Matrix4();
  private shadowDirty = true;
  private plateData: Float32Array;
  private plateTex: DataTexture;
  private shadowMat: ShaderMaterial;
  private floorMat: ShaderMaterial;
  private _normal = new Vector3(0, 1, 0);
  private _view = new Vector3();
  private _target = new Vector3();
  private _look = new Vector3();
  private _rot = new Matrix4();
  private _plane = new Plane();
  private _clip = new Vector4();
  private _q = new Vector4();

  constructor() {
    const F = AD.floor;
    const light = new Vector3(...AD.lighting.keyDirection).normalize();
    this.plateData = new Float32Array(MAX_PLATES * 3 * 4);
    this.plateTex = new DataTexture(this.plateData, MAX_PLATES, 3, RGBAFormat, FloatType);
    this.plateTex.minFilter = NearestFilter;
    this.plateTex.magFilter = NearestFilter;
    this.plateTex.needsUpdate = true;
    this.shadowRT = new WebGLRenderTarget(F.mapResolution, F.mapResolution, { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false });
    this.shadowMat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPlates: { value: this.plateTex },
        uCount: { value: 0 },
        uRegion: { value: new Vector4(...F.region) },
        uLight: { value: light },
        uAoRadius: { value: F.aoRadius },
        uSoft: { value: F.shadowSoftness },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uPlates;
        uniform int uCount;
        uniform vec4 uRegion;
        uniform vec3 uLight;
        uniform float uAoRadius;
        uniform float uSoft;
        varying vec2 vUv;
        vec3 qInv(vec4 q, vec3 v) {
          vec3 u = -q.xyz;
          return 2.0 * dot(u, v) * u + (q.w * q.w - dot(u, u)) * v + 2.0 * q.w * cross(u, v);
        }
        float sdBox(vec3 p, vec3 b, float r) {
          vec3 q = abs(p) - (b - r);
          return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
        }
        void main() {
          vec3 wp = vec3(mix(uRegion.x, uRegion.z, vUv.x), 0.0, mix(uRegion.y, uRegion.w, vUv.y));
          float ao = 0.0;
          float lit = 1.0;
          float glow = 0.0;
          for (int i = 0; i < ${MAX_PLATES}; i++) {
            if (i >= uCount) break;
            vec4 a = texelFetch(uPlates, ivec2(i, 0), 0);
            vec4 q = texelFetch(uPlates, ivec2(i, 1), 0);
            vec4 c = texelFetch(uPlates, ivec2(i, 2), 0);
            vec3 rel = wp - a.xyz;
            float ext = length(c.xyz);
            // reach: footprint + light march (plates up to ~6 m high)
            if (length(rel.xz) > ext + 6.5) continue;
            float d0 = sdBox(qInv(q, rel), c.xyz, c.w);
            ao = max(ao, 1.0 - smoothstep(0.0, uAoRadius, d0));
            float occ = 0.0;
            float gl = 0.0;
            for (int k = 0; k < 6; k++) {
              float t = 0.25 + float(k) * float(k) * 0.16;
              vec3 ps = rel + uLight * t;
              float d = sdBox(qInv(q, ps), c.xyz, c.w);
              float o = 1.0 - smoothstep(0.0, uSoft * (0.35 + 0.22 * t), d);
              // occluders high above the floor cast fainter, softer shadows and almost no glow
              occ = max(occ, o * exp(-t * 0.32));
              gl = max(gl, o * exp(-t * 0.85));
            }
            lit *= 1.0 - occ * (1.0 - a.w * 0.8);
            glow += gl * a.w;
          }
          gl_FragColor = vec4(ao, 1.0 - lit, min(glow, 1.5), 1.0);
        }`,
    });
    const quad = new Mesh(new PlaneGeometry(1, 1), this.shadowMat);
    quad.frustumCulled = false;
    this.shadowScene.add(quad);
    this.floorMat = new ShaderMaterial({
      toneMapped: false,
      uniforms: {
        uShadow: { value: this.shadowRT.texture },
        uReflect: { value: null },
        uUseReflect: { value: 0 },
        uTexMatrix: { value: this.textureMatrix },
        uRegion: { value: new Vector4(...F.region) },
        uNear: { value: new Color(F.near) },
        uFar: { value: new Color(F.far) },
        uHorizon: { value: new Color(F.backdropHorizon) },
        uGlowColor: { value: new Color(F.glowColor) },
        uCam: { value: new Vector3() },
        uFade: { value: [F.fadeStart, F.fadeEnd] },
        uReflStrength: { value: F.reflectionStrength },
        uReflBlur: { value: F.reflectionBlur },
        uShadowStrength: { value: F.shadowStrength },
        uAo: { value: F.aoStrength },
        uGlow: { value: F.glowStrength },
      },
      vertexShader: /* glsl */ `
        uniform mat4 uTexMatrix;
        varying vec3 vWorld;
        varying vec4 vMirror;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          vMirror = uTexMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uShadow;
        uniform sampler2D uReflect;
        uniform float uUseReflect;
        uniform vec4 uRegion;
        uniform vec3 uNear, uFar, uHorizon, uGlowColor, uCam;
        uniform vec2 uFade;
        uniform float uReflStrength, uReflBlur, uShadowStrength, uAo, uGlow;
        varying vec3 vWorld;
        varying vec4 vMirror;
        void main() {
          vec2 suv = (vWorld.xz - uRegion.xy) / (uRegion.zw - uRegion.xy);
          vec4 s = texture2D(uShadow, suv);
          float inside = step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
          s *= inside;
          float dist = length(vWorld.xz - uCam.xz);
          vec3 col = mix(uNear, uFar, smoothstep(2.0, uFade.y * 0.8, dist));
          if (uUseReflect > 0.5) {
            vec2 ruv = vMirror.xy / vMirror.w;
            vec4 acc = vec4(0.0);
            float b = uReflBlur * (1.0 + dist * 0.05);
            acc += texture2D(uReflect, ruv) * 0.2;
            acc += texture2D(uReflect, ruv + vec2(b, 0.0)) * 0.1;
            acc += texture2D(uReflect, ruv - vec2(b, 0.0)) * 0.1;
            acc += texture2D(uReflect, ruv + vec2(0.0, b * 1.6)) * 0.1;
            acc += texture2D(uReflect, ruv - vec2(0.0, b * 1.6)) * 0.1;
            acc += texture2D(uReflect, ruv + vec2(b, b) * 1.4) * 0.1;
            acc += texture2D(uReflect, ruv - vec2(b, b) * 1.4) * 0.1;
            acc += texture2D(uReflect, ruv + vec2(-b, b) * 1.4) * 0.1;
            acc += texture2D(uReflect, ruv + vec2(b, -b) * 1.4) * 0.1;
            float fres = 0.55 + 0.45 * pow(1.0 - clamp(normalize(uCam - vWorld).y, 0.0, 1.0), 2.0);
            col = mix(col, acc.rgb, acc.a * uReflStrength * fres);
          }
          col *= 1.0 - uAo * s.r;
          col *= 1.0 - uShadowStrength * s.g;
          col += uGlowColor * s.b * uGlow;
          col = mix(col, uHorizon, smoothstep(uFade.x, uFade.y, dist));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new Mesh(new PlaneGeometry(400, 400), this.floorMat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.updateMatrixWorld();
    this.mesh.renderOrder = -1;
    this.backdrop = new Mesh(
      new SphereGeometry(180, 32, 16),
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        toneMapped: false,
        uniforms: { uTop: { value: new Color(F.backdropTop) }, uHorizon: { value: new Color(F.backdropHorizon) } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
        fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
          void main(){ gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(-0.02, 0.35, vDir.y)), 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    );
    this.backdrop.renderOrder = -2;
    this.backdrop.frustumCulled = false;
  }

  /** recolour the floor and the backdrop (light and dark theme) */
  setPalette(p: { backdropTop: string; backdropHorizon: string; near: string; far: string; glowStrength: number; shadowStrength: number }) {
    const u = this.floorMat.uniforms;
    u.uNear.value.set(p.near);
    u.uFar.value.set(p.far);
    u.uHorizon.value.set(p.backdropHorizon);
    u.uGlow.value = p.glowStrength;
    u.uShadowStrength.value = p.shadowStrength;
    const b = (this.backdrop.material as ShaderMaterial).uniforms;
    b.uTop.value.set(p.backdropTop);
    b.uHorizon.value.set(p.backdropHorizon);
  }

  /** feed the plates into the shadow map: position + translucency, rotation, half size + bevel */
  updatePlates(poses: Float32Array, count: number, translucency: Float32Array) {
    const d = this.plateData;
    const n = Math.min(count, MAX_PLATES);
    const row = MAX_PLATES * 4;
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE, c = i * 4;
      d[c] = poses[o + P.px]; d[c + 1] = poses[o + P.py]; d[c + 2] = poses[o + P.pz]; d[c + 3] = translucency[i];
      d[row + c] = poses[o + P.qx]; d[row + c + 1] = poses[o + P.qy]; d[row + c + 2] = poses[o + P.qz]; d[row + c + 3] = poses[o + P.qw];
      d[2 * row + c] = poses[o + P.hx]; d[2 * row + c + 1] = poses[o + P.hy]; d[2 * row + c + 2] = poses[o + P.hz];
      d[2 * row + c + 3] = Math.min(poses[o + P.r] * 1.5, poses[o + P.hx]);
    }
    this.shadowMat.uniforms.uCount.value = n;
    this.plateTex.needsUpdate = true;
    this.shadowDirty = true;
  }

  setReflectionSize(w: number, h: number) {
    if (!this.reflections) return;
    if (this.reflectRT) this.reflectRT.setSize(w, h);
    else {
      this.reflectRT = new WebGLRenderTarget(w, h, { type: HalfFloatType });
      this.floorMat.uniforms.uReflect.value = this.reflectRT.texture;
      this.floorMat.uniforms.uUseReflect.value = 1;
    }
  }

  prepare(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    this.floorMat.uniforms.uCam.value.copy(camera.position);
    const prev = renderer.getRenderTarget();
    if (this.shadowDirty) {
      renderer.setRenderTarget(this.shadowRT);
      renderer.render(this.shadowScene, this.shadowCam);
      this.shadowDirty = false;
    }
    if (this.reflections && this.reflectRT) this.renderReflection(renderer, scene, camera);
    renderer.setRenderTarget(prev);
  }

  /** planar mirror with an oblique near plane, rendering only the plates layer */
  private renderReflection(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) {
    const rt = this.reflectRT!, cam = this.virtualCam, eye = camera.position;
    if (eye.y <= 0.01) return;
    this._view.set(0, 0, 0).sub(eye).reflect(this._normal).negate();
    this._rot.extractRotation(camera.matrixWorld);
    this._look.set(0, 0, -1).applyMatrix4(this._rot).add(eye);
    this._target.set(0, 0, 0).sub(this._look).reflect(this._normal).negate();
    cam.position.copy(this._view);
    cam.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(this._normal);
    cam.lookAt(this._target);
    cam.far = camera.far;
    cam.near = camera.near;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.layers.set(REFLECT_LAYER);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse).multiply(this.mesh.matrixWorld);
    this._plane.setFromNormalAndCoplanarPoint(this._normal, new Vector3()).applyMatrix4(cam.matrixWorldInverse);
    this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const e = cam.projectionMatrix.elements;
    this._q.x = (Math.sign(this._clip.x) + e[8]) / e[0];
    this._q.y = (Math.sign(this._clip.y) + e[9]) / e[5];
    this._q.z = -1;
    this._q.w = (1 + e[10]) / e[14];
    this._clip.multiplyScalar(2 / this._clip.dot(this._q));
    e[2] = this._clip.x;
    e[6] = this._clip.y;
    e[10] = this._clip.z + 1;
    e[14] = this._clip.w;
    const bg = scene.background;
    scene.background = null;
    this.mesh.visible = false;
    this.backdrop.visible = false;
    const alpha = renderer.getClearAlpha();
    const clear = new Color();
    renderer.getClearColor(clear);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setClearColor(clear, alpha);
    this.mesh.visible = true;
    this.backdrop.visible = true;
    scene.background = bg;
  }

  dispose() {
    this.shadowRT.dispose();
    this.reflectRT?.dispose();
    this.plateTex.dispose();
    this.shadowMat.dispose();
    this.floorMat.dispose();
    this.mesh.geometry.dispose();
    this.backdrop.geometry.dispose();
    (this.backdrop.material as ShaderMaterial).dispose();
    this.shadowScene.traverse((o) => (o as Mesh).geometry?.dispose());
  }
}
