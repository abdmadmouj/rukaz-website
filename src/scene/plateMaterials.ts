import {
  Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshPhysicalMaterial, Quaternion, ShaderChunk, Vector3,
  type BufferGeometry, type IUniform,
} from 'three';
import { artDirection as AD, type MaterialKey, type MaterialSpec } from '../config/artDirection';
import { plateGeometry } from './plateGeometry';
import { P, STRIDE, type Identity } from './poses';

/** layer the floor reflection renders (plates only) */
export const REFLECT_LAYER = 1;

/** 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT) */
const NOISE = /* glsl */ `
vec3 _mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 _permute(vec4 x) { return _mod289(((x * 34.0) + 10.0) * x); }
vec4 _taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = _mod289(i);
  vec4 p = _permute(_permute(_permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = _taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export interface SharedUniforms {
  uKeyDirView: IUniform<Vector3>;
  uHoverGlow: IUniform<number>;
}

/**
 * Glass and stone. A physical material with frosted clouds and hairline crackle in the
 * surface, light from inside (sub-surface glow, strongest at the base, lit from beneath),
 * and real transmission on the high-quality path.
 */
export function plateMaterial(key: MaterialKey, spec: MaterialSpec, shared: SharedUniforms, transmissive = true) {
  const useT = transmissive && spec.transmission > 0;
  const m = new MeshPhysicalMaterial({
    color: new Color(spec.color),
    roughness: spec.roughness,
    metalness: 0,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: spec.clearcoatRoughness,
    ior: 1.46,
    specularIntensity: spec.transmission > 0 ? 0.7 : 0.4,
    envMapIntensity: 1,
    transmission: useT ? spec.transmission : 0,
    thickness: useT ? spec.thickness : 0,
    attenuationColor: new Color(spec.attenuationColor),
    attenuationDistance: useT ? spec.attenuationDistance : Infinity,
  });
  // without transmission, glass reads a little denser and greener
  if (!useT && spec.transmission > 0) m.color.lerp(new Color(spec.attenuationColor), 0.25);
  m.name = `plate-${key}`;
  const uniforms = {
    uMarble: { value: spec.marble },
    uMarbleScale: { value: spec.marbleScale },
    uGlow: { value: spec.glow },
    uGlowColor: { value: new Color(spec.glowColor) },
    uTransl: { value: spec.translucency },
    uKeyDirView: shared.uKeyDirView,
    uHoverGlow: shared.uHoverGlow,
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aSgn;
attribute vec2 aU;
attribute vec2 aBev;
attribute vec3 aHalf;
attribute vec4 aShape; // R, r, taper, seed
attribute vec2 aFx;    // hover, highlight
varying vec3 vObj;
varying float vUnitY;
varying float vSeed;
varying vec2 vFx;
varying float vPlateThick;
`)
      .replace('#include <beginnormal_vertex>', `
vec3 objectNormal = normalize(vec3(aSgn.x * aBev.x, aU * aBev.y));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif
`)
      .replace('#include <begin_vertex>', `
float pr = min(aShape.y, aHalf.x * 0.98);
float pR = clamp(aShape.x, pr, min(aHalf.y, aHalf.z));
vec3 transformed;
transformed.x = aSgn.x * (aHalf.x - pr + aBev.x * pr);
transformed.yz = aSgn.yz * (aHalf.yz - pR) + aU * (pR - pr + aBev.y * pr);
transformed.z *= 1.0 + aShape.z * (transformed.y / max(aHalf.y, 1e-3));
vObj = transformed;
vUnitY = transformed.y / max(aHalf.y, 1e-3);
vSeed = aShape.w;
vFx = aFx;
vPlateThick = aHalf.x * 2.0;
`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uMarble;
uniform float uMarbleScale;
uniform float uGlow;
uniform vec3 uGlowColor;
uniform float uTransl;
uniform vec3 uKeyDirView;
uniform float uHoverGlow;
varying vec3 vObj;
varying float vUnitY;
varying float vSeed;
varying vec2 vFx;
varying float vPlateThick;
${NOISE}
float plateFbm(vec3 p) {
  float n = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    n += a * snoise(p);
    p = p * 2.03 + 1.7;
    a *= 0.5;
  }
  return n;
}
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 mp = vObj * uMarbleScale + vec3(vSeed * 17.13, vSeed * 3.71, vSeed * 9.29);
float mf = plateFbm(mp * 0.35);
float clouds = clamp(0.5 + 0.8 * plateFbm(mp * 0.5 + vec3(mf * 1.2)), 0.0, 1.0);
float ridge = 1.0 - abs(snoise(mp * 1.6 + vec3(mf * 1.5)));
float crack = pow(ridge, 26.0) * smoothstep(0.35, 0.8, clouds);
diffuseColor.rgb *= mix(1.0, 0.9 + 0.16 * clouds, uMarble);
diffuseColor.rgb = mix(diffuseColor.rgb, min(diffuseColor.rgb * 1.2 + 0.05, vec3(1.0)), crack * uMarble * 0.6);
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (clouds - 0.5) * 0.22 * uMarble + crack * 0.1, 0.04, 1.0);
`)
      .replace('#include <transmission_fragment>', ShaderChunk.transmission_fragment.replace('material.thickness = thickness;', 'material.thickness = min(thickness, vPlateThick * 1.1);'))
      .replace('#include <opaque_fragment>', `
{
  vec3 V = normalize(vViewPosition);
  float facing = clamp(dot(normal, V), 0.0, 1.0);
  float rim = pow(1.0 - facing, 2.2);
  float bottom = smoothstep(0.55, -1.05, vUnitY);
  float through = pow(clamp(dot(-V, normalize(uKeyDirView)), 0.0, 1.0), 3.0);
  float body = 0.08 + 0.85 * pow(bottom, 1.4) + 0.32 * rim + 0.8 * through;
  vec3 sss = uGlowColor * uGlow * body * (0.6 + 0.4 * clouds + crack * 0.5);
  outgoingLight *= mix(1.0, 0.86, facing * uTransl);
  outgoingLight += sss * 0.7;
  // hover: a faint inner brightening; highlight: the active gate or way
  outgoingLight += uGlowColor * (vFx.x * uHoverGlow + vFx.y * 0.1) * (0.4 + uGlow);
}
#include <opaque_fragment>
`);
  };
  m.customProgramCacheKey = () => 'rukaz-plate-v2';
  return m;
}

const KEYS: MaterialKey[] = ['forest', 'teal', 'jade', 'mist', 'ivory'];

interface Group {
  key: MaterialKey;
  mesh: InstancedMesh;
  half: InstancedBufferAttribute;
  shape: InstancedBufferAttribute;
  fx: InstancedBufferAttribute;
  plates: number[];
}

/** All plates: one instanced mesh per finish. */
export class Plates {
  readonly groups: Group[] = [];
  readonly materials: MeshPhysicalMaterial[] = [];
  readonly translucency: Float32Array;
  private readonly geometry: BufferGeometry;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly p = new Vector3();
  private readonly s = new Vector3(1, 1, 1);

  constructor(ids: Identity[], shared: SharedUniforms, transmissive = true) {
    this.geometry = plateGeometry(AD.plate.cornerSegments, AD.plate.bevelSegments);
    this.translucency = new Float32Array(ids.length);
    for (const key of KEYS) {
      const plates = ids.filter((id) => id.mat === key).map((id) => id.index);
      if (!plates.length) continue;
      const spec = AD.materials[key];
      const mat = plateMaterial(key, spec, shared, transmissive);
      this.materials.push(mat);
      const n = plates.length;
      const geo = this.geometry.clone();
      const half = new InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
      const shape = new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage);
      const fx = new InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(DynamicDrawUsage);
      geo.setAttribute('aHalf', half);
      geo.setAttribute('aShape', shape);
      geo.setAttribute('aFx', fx);
      const mesh = new InstancedMesh(geo, mat, n);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.layers.enable(REFLECT_LAYER);
      mesh.name = `plates-${key}`;
      plates.forEach((p, k) => {
        shape.array[k * 4 + 3] = ids[p].seed;
        this.translucency[p] = spec.translucency;
      });
      this.groups.push({ key, mesh, half, shape, fx, plates });
    }
  }

  upload(poses: Float32Array, hover: Float32Array) {
    for (const g of this.groups) {
      const half = g.half.array as Float32Array, shape = g.shape.array as Float32Array, fx = g.fx.array as Float32Array;
      for (let k = 0; k < g.plates.length; k++) {
        const o = g.plates[k] * STRIDE;
        this.p.set(poses[o + P.px], poses[o + P.py], poses[o + P.pz]);
        this.q.set(poses[o + P.qx], poses[o + P.qy], poses[o + P.qz], poses[o + P.qw]).normalize();
        this.m.compose(this.p, this.q, this.s);
        g.mesh.setMatrixAt(k, this.m);
        half[k * 3] = poses[o + P.hx];
        half[k * 3 + 1] = poses[o + P.hy];
        half[k * 3 + 2] = poses[o + P.hz];
        shape[k * 4] = poses[o + P.R];
        shape[k * 4 + 1] = poses[o + P.r];
        shape[k * 4 + 2] = poses[o + P.taper];
        fx[k * 2] = hover[g.plates[k]];
        fx[k * 2 + 1] = poses[o + P.hl];
      }
      g.mesh.instanceMatrix.needsUpdate = true;
      g.half.needsUpdate = true;
      g.shape.needsUpdate = true;
      g.fx.needsUpdate = true;
    }
  }

  dispose() {
    for (const g of this.groups) {
      g.mesh.geometry.dispose();
      g.mesh.dispose();
    }
    this.geometry.dispose();
    this.materials.forEach((m) => m.dispose());
  }
}
