import { BackSide, BoxGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, type WebGLRenderer } from 'three';
import { artDirection as AD } from '../config/artDirection';

/**
 * A small studio baked once into a prefiltered environment map: a dark gradient room,
 * a large soft key above, a tall strip light at the side and an emerald bounce from below.
 * This is what the glass reflects.
 */
export function studioEnvironment(renderer: WebGLRenderer) {
  const E = AD.lighting.env;
  const room = new Scene();
  room.add(new Mesh(
    new SphereGeometry(20, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { top: { value: new Color(E.top) }, mid: { value: new Color(E.mid) }, bottom: { value: new Color(E.bottom) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.7, h)) : mix(mid, bottom, smoothstep(0.0, -0.5, h)); gl_FragColor = vec4(c, 1.0); }`,
    }),
  ));
  const panel = (w: number, h: number, level: number, color = '#ffffff') => {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: new Color(color).multiplyScalar(level), side: DoubleSide }));
    room.add(m);
    return m;
  };
  const key = panel(14, 9, E.key, '#f2f8f5');
  key.position.set(5, 11, -6);
  key.lookAt(0, 0, 0);
  const strip = panel(2.2, 14, E.strip);
  strip.position.set(13, 5, 4);
  strip.lookAt(0, 2, 0);
  const fill = panel(10, 6, 0.18, '#b8c8c5');
  fill.position.set(-10, 4, 9);
  fill.lookAt(0, 1, 0);
  const ground = new Mesh(new BoxGeometry(40, 0.1, 40), new MeshBasicMaterial({ color: new Color(E.mid).multiplyScalar(0.8) }));
  ground.position.y = -2;
  room.add(ground);
  const bounce = panel(18, 3, E.bounceLevel * 3, E.bounce);
  bounce.position.set(0, -1.6, 7);
  bounce.lookAt(0, 3, 0);
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.035);
  pmrem.dispose();
  room.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      (m.material as MeshBasicMaterial).dispose();
    }
  });
  return target.texture;
}
