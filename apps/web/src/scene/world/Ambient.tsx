// Жизнь вокруг острова: облака на дальнем кольце, чайки, соседние острова на горизонте, дождь в шторм.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, Group, type LineSegments, Mesh,
  MeshStandardMaterial, ShaderMaterial,
} from 'three';
import { PAL } from '../palette';
import { VERTEX_MAT, WINDOW_OPTS, box, cached, cone, cyl, hullGeo, ico, mat } from '../materials';
import { bake, blobGeometry, coneTree, houseObj, palm, part, roundTree } from '../builders';
import { BEACH_R, BEACH_Y, GRASS_R, GRASS_Y, makeRng, onBeach, onGrass } from '../layout';
import { useBus } from '../bus';
import { WX, mixWx } from '../weather';
import { noRay } from '../models/parts';
import type { ArchSceneProps } from '../contract';
import { ARCH_ISLAND_ORDER, ARCH_ISLAND_SCALE, archIslandPosition } from '../archLayout';

// ───── Облака ─────
interface Cloud { geo: BufferGeometry; scale: number; a: number; r: number; y: number }

export function Clouds() {
  const bus = useBus();
  const refs = useRef<(Mesh | null)[]>([]);
  const { clouds, material } = useMemo(() => {
    const { rr, rand } = makeRng(4242);
    const clouds: Cloud[] = [];
    for (let i = 0; i < 8; i++) {
      const g = new Group();
      const n = 3 + Math.floor(rand() * 3);
      for (let j = 0; j < n; j++) {
        const s = rr(1.3, 2.4);
        const c = part(ico(1), PAL.white);
        c.scale.setScalar(s);
        c.position.set(j * 1.7 - n * 0.85 + rr(-0.3, 0.3), rr(-0.2, 0.6), rr(-0.7, 0.7));
        c.rotation.set(rr(0, 3), rr(0, 3), 0);
        g.add(c);
      }
      clouds.push({ geo: bake(g)!, scale: rr(1.4, 2.2), a: (i / 8) * Math.PI * 2 + rr(-0.3, 0.3), r: rr(90, 140), y: rr(12, 20) });
    }
    const material = new MeshStandardMaterial({ color: PAL.white, roughness: 1, metalness: 0, flatShading: true });
    return { clouds, material };
  }, []);
  useEffect(() => () => { clouds.forEach((c) => c.geo.dispose()); material.dispose(); }, [clouds, material]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const k = bus.weather.k;
    mixWx(material.color, WX.cloud, k);
    for (let i = 0; i < clouds.length; i++) {
      const m = refs.current[i];
      if (!m) continue;
      const c = clouds[i];
      const a = c.a + t * (0.012 + 0.02 * k);
      m.position.set(Math.cos(a) * c.r, c.y - 4 * k, Math.sin(a) * c.r);
      m.rotation.y = -a;
      m.scale.setScalar(c.scale * (1 + 0.35 * k));
    }
  });

  return (
    <>
      {clouds.map((c, i) => (
        <mesh key={i} ref={(el) => { refs.current[i] = el; }} geometry={c.geo} material={material} raycast={noRay} />
      ))}
    </>
  );
}

// ───── Чайки ─────
const wingGeo = () => cached('gullWing', () => new BoxGeometry(0.18, 0.03, 0.8).translate(0, 0, 0.4));
interface GullData { R: number; h: number; speed: number; phase: number }

function Gull({ d }: { d: GullData }) {
  const bus = useBus();
  const g = useRef<Group>(null!);
  const wl = useRef<Mesh>(null!);
  const wr = useRef<Mesh>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const a = t * d.speed + d.phase;
    g.current.position.set(Math.cos(a) * d.R, d.h + Math.sin(t * 0.7 + d.phase) * 0.6, Math.sin(a) * d.R);
    g.current.rotation.set(0.25, -(a + Math.PI / 2), 0);
    // в шторм чайки прячутся
    g.current.scale.setScalar(Math.max(0.001, 1 - bus.weather.k));
    const s = Math.sin(t * 7 + d.phase) * 0.55;
    wl.current.rotation.x = -s;
    wr.current.rotation.set(s, Math.PI, 0);
  });
  return (
    <group ref={g}>
      <mesh geometry={box(0.5, 0.13, 0.15)} material={mat(PAL.white)} castShadow />
      <mesh ref={wl} geometry={wingGeo()} material={mat(PAL.wing)} castShadow />
      <mesh ref={wr} geometry={wingGeo()} material={mat(PAL.wing)} castShadow />
    </group>
  );
}

export function Gulls() {
  const data = useMemo(() => {
    const { rr } = makeRng(99);
    return Array.from({ length: 3 }, (_, i) => ({ R: rr(9, 15), h: rr(9, 12), speed: rr(0.18, 0.3), phase: i * 2.1 }));
  }, []);
  return <>{data.map((d, i) => <Gull key={i} d={d} />)}</>;
}

// ───── Соседи на горизонте (мультиплеерный архипелаг) ─────
const NEIGHBORS: [number, number, number, number][] = [
  [-1.55, 62, 0.42, PAL.roofCoral], [-2.55, 78, 0.5, PAL.roofGold], [2.75, 58, 0.36, PAL.roofTeal],
  [-0.2, 85, 0.45, PAL.roofCoral], [1.9, 90, 0.4, PAL.roofGold],
];

export function Neighbors({ arch }: { arch?: ArchSceneProps | null }) {
  const faded = useMemo(() => new MeshStandardMaterial({ vertexColors: true, flatShading: true, color: PAL.marble, transparent: true, opacity: 0.68, roughness: 0.85 }), []);
  useEffect(() => () => faded.dispose(), [faded]);
  const islands = useMemo(() => {
    const rng = makeRng(777);
    const { rr } = rng;
    return NEIGHBORS.map(([a, r, scale, roof], index) => {
      const g = new Group();
      const b = part(blobGeometry(BEACH_R, BEACH_R * 1.08, 2.6, 1, 32, scale * 7), PAL.sand);
      b.position.y = BEACH_Y - 1.3; g.add(b);
      const gr = part(blobGeometry(GRASS_R, GRASS_R * 1.04, 1.0, 1, 30, scale * 7), PAL.grass);
      gr.position.y = GRASS_Y - 0.5; g.add(gr);
      // Жилой дом остаётся только на старом горизонте: в режиме архипелага здесь участок дела.
      const h = houseObj({ roof, w: 3, d: 2.6, h: 2 });
      h.scale.setScalar(1.6); h.position.set(-2, GRASS_Y, -1); h.rotation.y = rr(0, 3); g.add(h);
      for (let i = 0; i < 5; i++) {
        const p = palm(rng, rr(4, 5.5)).root;
        p.position.copy(onBeach(rr(-Math.PI, Math.PI), 0.2)); p.scale.setScalar(1.3); g.add(p);
      }
      for (let i = 0; i < 4; i++) {
        const t = roundTree(rng); t.scale.setScalar(1.6);
        t.position.copy(onGrass(rr(-Math.PI, Math.PI), rr(0.3, 0.8))); g.add(t);
      }
      // Декор — отдельно от жилого дома, чтобы центр дел оставался свободным.
      g.remove(h);
      const archGroup = g.clone(true);
      for (const tree of archGroup.children.slice(2)) {
        if (Math.hypot(tree.position.x, tree.position.z) < 8) {
          const angle = Math.atan2(tree.position.z, tree.position.x);
          tree.position.set(Math.cos(angle) * 9, tree.position.y, Math.sin(angle) * 9);
        }
      }
      const id = ARCH_ISLAND_ORDER[index];
      const detail = makeRng(900 + index);
      if (id === 'cedar') {
        for (let i = 0; i < 9; i++) {
          const tree = coneTree(detail), angle = i * Math.PI * 2 / 9;
          tree.position.copy(onGrass(angle, 0.8)); tree.scale.setScalar(1.5); archGroup.add(tree);
        }
      } else if (id === 'lighthouse') {
        const tower = part(cyl(0.65, 0.9, 5.5, 8), PAL.marble);
        tower.position.set(8, GRASS_Y + 2.75, -5); archGroup.add(tower);
        const cap = part(cone(1, 1.1, 8), PAL.roofCoral);
        cap.position.set(8, GRASS_Y + 6, -5); archGroup.add(cap);
      } else if (id === 'shell') {
        for (const x of [-5, 5]) {
          const pole = part(cyl(0.07, 0.07, 2, 6), PAL.white);
          pole.position.set(x, BEACH_Y + 1, 11); archGroup.add(pole);
          const shade = part(cone(1.5, 0.6, 8), PAL.roofCoral);
          shade.position.set(x, BEACH_Y + 2, 11); archGroup.add(shade);
        }
      } else if (id === 'pelican') {
        const fishingBoat = part(hullGeo(4, 0.8, 1.5, 'arch-fishing'), PAL.roofTeal);
        fishingBoat.position.set(8, BEACH_Y + 0.3, 9); fishingBoat.rotation.y = -0.4; archGroup.add(fishingBoat);
      } else {
        for (const x of [-6, 6]) {
          const home = houseObj({ w: 2.4, d: 2, h: 2.3, roof: PAL.roofCoral });
          home.position.set(x, GRASS_Y, -7); archGroup.add(home);
        }
      }
      const archSolid = bake(archGroup)!;
      g.add(h);
      return { solid: bake(g)!, archSolid, glow: bake(g, true), x: Math.cos(a) * r, z: Math.sin(a) * r, scale };
    });
  }, []);
  useEffect(() => () => islands.forEach((n) => { n.solid.dispose(); n.archSolid.dispose(); n.glow?.dispose(); }), [islands]);

  return (
    <>
      {islands.map((n, i) => {
        const id = ARCH_ISLAND_ORDER[i];
        const data = arch?.islands.find((island) => island.island === id);
        const on = !!arch?.on;
        return (
          <group key={id} position={on ? archIslandPosition(id) : [n.x, 0, n.z]} scale={on ? ARCH_ISLAND_SCALE : n.scale}
            onClick={on ? (event) => { event.stopPropagation(); arch?.onIslandClick(id); } : undefined}>
            <mesh geometry={on ? n.archSolid : n.solid} material={on && !data?.route ? faded : VERTEX_MAT} raycast={on ? Mesh.prototype.raycast : noRay} />
            {!on && n.glow && <mesh geometry={n.glow} material={mat(PAL.window, WINDOW_OPTS)} raycast={noRay} />}
          </group>
        );
      })}
    </>
  );
}

// ───── Дождь: штрихи-отрезки, падение считается в шейдере ─────
export function Rain({ count = 900 }: { count?: number }) {
  const bus = useBus();
  const ref = useRef<LineSegments>(null!);
  const { geo, material } = useMemo(() => {
    const { rr, rand } = makeRng(31337);
    const pos = new Float32Array(count * 6);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const a = rr(0, Math.PI * 2), r = Math.sqrt(rand()) * 40;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, y = rr(0, 30);
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new BufferAttribute(end, 1));
    const material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new Color(PAL.stone) } },
      vertexShader: /* glsl */ `
        attribute float aEnd;
        uniform float uTime;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * 24.0, 30.0) - 1.0 - aEnd * 1.2;
          p.x += aEnd * 0.3;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uOpacity;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity);
          #include <colorspace_fragment>
        }`,
    });
    return { geo, material };
  }, [count]);
  useEffect(() => () => { geo.dispose(); material.dispose(); }, [geo, material]);

  useFrame((state) => {
    const k = bus.weather.k;
    ref.current.visible = k > 0.01;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uOpacity.value = 0.42 * k;
  });

  return <lineSegments ref={ref} geometry={geo} material={material} frustumCulled={false} visible={false} raycast={noRay} />;
}
