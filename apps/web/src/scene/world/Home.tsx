// Дом хозяина острова: два этажа, балкон-навес, тёплые окна и небольшой сад на холме.
import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, type Group, type Mesh } from 'three';
import { PAL } from '../palette';
import { box, cached, cyl, gableRoof, ico, mat, torus } from '../materials';
import { FACE_CAMERA, HILL_POS, HILL_TOP } from '../layout';
import { useBus } from '../bus';
import { Baked } from '../models/Baked';
import { LIT_OPTS, M, Smoke, Win, type V3 } from '../models/parts';

const W = 3.2, D = 2.4, H = 2.7, RH = 1.24;
const TOP = 0.26 + H, FZ = D / 2 + 0.06, BALCONY_Y = 1.64;
const CHIMNEY: V3 = [0.8, 4.45, -0.45];
const POLE: V3 = [-2.15, 0, 0.1];
// Полотнище идёт от штока в −x. Даже при ±0.525 рад оно остаётся левее карниза (−1.88).
const flagGeo = () => cached('homeFlag:outward', () => new BoxGeometry(0.7, 0.42, 0.03).translate(-0.35, 0, 0));

/** Светлые рамы, переплёт, бирюзовые ставни и подоконник. */
function Window({ p, r = [0, 0, 0] }: { p: V3; r?: V3 }) {
  const w = 0.48, h = 0.56;
  return (
    <group position={p} rotation={r}>
      <M g={box(w + 0.12, h + 0.12, 0.09)} c={PAL.woodDark} />
      <Win p={[0, 0, 0.055]} w={w} h={h} lit />
      {[-1, 1].map((side) => (
        <group key={side}>
          <M g={box(0.05, h + 0.08, 0.06)} c={PAL.white} p={[side * (w / 2 + 0.025), 0, 0.1]} />
          <M g={box(w + 0.1, 0.05, 0.06)} c={PAL.white} p={[0, side * (h / 2 + 0.025), 0.1]} />
          <M g={box(0.17, h + 0.06, 0.06)} c={PAL.roofTeal} p={[side * (w / 2 + 0.16), 0, 0]} />
          {[-0.16, 0, 0.16].map((y) => (
            <M key={y} g={box(0.13, 0.025, 0.03)} c={PAL.white} p={[side * (w / 2 + 0.16), y, 0.045]} />
          ))}
        </group>
      ))}
      <M g={box(0.035, h, 0.04)} c={PAL.white} p={[0, 0, 0.12]} />
      <M g={box(w, 0.035, 0.04)} c={PAL.white} p={[0, 0, 0.12]} />
      <M g={box(w + 0.2, 0.07, 0.2)} c={PAL.stone} p={[0, -h / 2 - 0.07, 0.03]} />
    </group>
  );
}

function Planter({ x }: { x: number }) {
  return (
    <group position={[x, 0, 1.72]}>
      <M g={cyl(0.22, 0.16, 0.3, 7)} c={PAL.roofCoral} p={[0, 0.15, 0]} />
      <M g={cyl(0.24, 0.24, 0.06, 7)} c={PAL.stone} p={[0, 0.3, 0]} />
      <M g={ico(0.23)} c={PAL.leaf} p={[0, 0.4, 0]} s={[1, 0.75, 1]} />
      {[-0.12, 0, 0.12].map((dx, i) => (
        <M key={dx} g={ico(0.08)} c={i === 1 ? PAL.roofGold : PAL.white} p={[dx, 0.55, (i % 2) * 0.1]} />
      ))}
    </group>
  );
}

function House() {
  return (
    <>
      <M g={box(W + 0.3, 0.26, D + 0.3)} c={PAL.stone} p={[0, 0.13, 0]} />
      <M g={box(W, H, D)} c={PAL.wall} p={[0, 0.26 + H / 2, 0]} />
      <M g={box(W + 0.1, 0.09, D + 0.1)} c={PAL.wood} p={[0, BALCONY_Y, 0]} />
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <M key={`${sx}:${sz}`} g={box(0.12, H, 0.12)} c={PAL.white} p={[sx * (W / 2 - 0.03), 0.26 + H / 2, sz * (D / 2 - 0.03)]} />
      )))}
      <M g={gableRoof(W, D, RH)} c={PAL.roofTeal} p={[0, TOP, 0]} />
      {[-1, 1].map((side) => (
        <M key={side} g={box(W + 0.56, 0.09, 0.08)} c={PAL.white} p={[0, TOP, side * (D / 2 + 0.28)]} />
      ))}
      <M g={box(0.1, 0.08, D + 0.56)} c={PAL.roofGold} p={[0, TOP + RH, 0]} />
      {/* круглое окно на фронтоне, труба с каменным колпаком */}
      <M g={cyl(0.22, 0.22, 0.06, 12)} c={PAL.window} o={LIT_OPTS} p={[0, TOP + 0.52, D / 2 + 0.3]} r={[Math.PI / 2, 0, 0]} shadow={false} />
      <M g={torus(0.23, 0.045, 4, 12)} c={PAL.white} p={[0, TOP + 0.52, D / 2 + 0.34]} />
      <M g={box(0.035, 0.42, 0.04)} c={PAL.white} p={[0, TOP + 0.52, D / 2 + 0.34]} />
      <M g={box(0.42, 0.035, 0.04)} c={PAL.white} p={[0, TOP + 0.52, D / 2 + 0.34]} />
      <M g={box(0.34, 0.9, 0.34)} c={PAL.rock} p={[CHIMNEY[0], CHIMNEY[1] - 0.55, CHIMNEY[2]]} />
      <M g={box(0.46, 0.1, 0.46)} c={PAL.stone} p={[CHIMNEY[0], CHIMNEY[1] - 0.05, CHIMNEY[2]]} />
      {/* окна на каждом этаже, в том числе на боковых и заднем фасадах */}
      {[1.0, 2.28].map((y) => (
        <group key={y}>
          {[-1.05, 1.05].map((x) => <Window key={x} p={[x, y, FZ]} />)}
          {[-1, 1].map((side) => <Window key={side} p={[side * (W / 2 + 0.05), y, 0]} r={[0, side * Math.PI / 2, 0]} />)}
          {[-0.75, 0.75].map((x) => <Window key={`back:${x}`} p={[x, y, -FZ]} r={[0, Math.PI, 0]} />)}
        </group>
      ))}
      {/* вход и балконная дверь */}
      <M g={box(0.65, 1.14, 0.1)} c={PAL.white} p={[0, 0.83, FZ]} />
      <M g={box(0.53, 1.02, 0.08)} c={PAL.woodDark} p={[0, 0.82, FZ + 0.06]} />
      <Win p={[0, 1.08, FZ + 0.11]} w={0.32} h={0.28} lit />
      <M g={ico(0.04)} c={PAL.roofGold} p={[0.18, 0.75, FZ + 0.13]} />
      <M g={box(0.6, 1.01, 0.1)} c={PAL.white} p={[0, 2.2, FZ]} />
      <M g={box(0.48, 0.89, 0.08)} c={PAL.woodDark} p={[0, 2.2, FZ + 0.06]} />
      <Win p={[0, 2.35, FZ + 0.11]} w={0.32} h={0.42} lit />
      {/* широкие ступени и балкон, который служит навесом над крыльцом */}
      <M g={box(1.44, 0.08, 1.16)} c={PAL.stone} p={[0, 0.04, 1.78]} />
      <M g={box(1.32, 0.16, 0.9)} c={PAL.stone} p={[0, 0.08, 1.65]} />
      <M g={box(1.2, 0.26, 0.64)} c={PAL.stone} p={[0, 0.13, 1.52]} />
      <M g={box(1.64, 0.12, 0.86)} c={PAL.wood} p={[0, BALCONY_Y, 1.58]} />
      {[-0.68, 0.68].map((x) => (
        <M key={x} g={box(0.1, BALCONY_Y - 0.26, 0.1)} c={PAL.white} p={[x, (BALCONY_Y + 0.26) / 2, 1.87]} />
      ))}
      {[-0.76, -0.38, 0, 0.38, 0.76].map((x) => (
        <M key={x} g={box(0.05, 0.44, 0.05)} c={PAL.white} p={[x, BALCONY_Y + 0.28, 2.0]} />
      ))}
      <M g={box(1.62, 0.07, 0.07)} c={PAL.roofTeal} p={[0, BALCONY_Y + 0.5, 2.0]} />
      {[-0.76, 0.76].map((x) => (
        <M key={x} g={box(0.07, 0.07, 0.8)} c={PAL.roofTeal} p={[x, BALCONY_Y + 0.5, 1.6]} />
      ))}
      <Planter x={-1.24} /><Planter x={1.24} />
      {/* скамейка сбоку и короткий забор по краям сада; всё внутри радиуса 3 */}
      <group position={[1.98, 0, 0.45]} rotation={[0, Math.PI / 2, 0]}>
        <M g={box(0.88, 0.09, 0.36)} c={PAL.wood} p={[0, 0.43, 0]} />
        <M g={box(0.88, 0.32, 0.07)} c={PAL.wood} p={[0, 0.66, -0.16]} />
        {[-0.32, 0.32].map((x) => <M key={x} g={box(0.08, 0.4, 0.28)} c={PAL.woodDark} p={[x, 0.2, 0]} />)}
      </group>
      {[-1, 1].map((side) => (
        <group key={side}>
          {[1.08, 1.4, 1.72].map((x) => <M key={x} g={box(0.07, 0.48, 0.07)} c={PAL.white} p={[side * x, 0.24, 2.08]} />)}
          {[0.17, 0.37].map((y) => <M key={y} g={box(0.7, 0.06, 0.05)} c={PAL.white} p={[side * 1.4, y, 2.08]} />)}
        </group>
      ))}
    </>
  );
}

export function Home() {
  const bus = useBus();
  const group = useRef<Group>(null!);
  const flag = useRef<Mesh>(null!);

  useLayoutEffect(() => {
    bus.anchors.set('home', { obj: group.current, h: 5.4 });
    return () => { bus.anchors.delete('home'); };
  }, [bus]);

  useFrame(() => {
    const { waveTime: t, k } = bus.weather;
    flag.current.rotation.y = Math.sin(t * 2.4 * (1 + 0.6 * k)) * 0.35 * (1 + 0.5 * k);
  });

  return (
    <group ref={group} position={[HILL_POS.x, HILL_TOP, HILL_POS.z]} rotation={[0, FACE_CAMERA, 0]}>
      <Baked id="home:owner">
        <House />
        <M g={cyl(0.16, 0.18, 0.12, 8)} c={PAL.stone} p={[POLE[0], 0.06, POLE[2]]} />
        <M g={cyl(0.04, 0.05, 2.65, 6)} c={PAL.night} p={[POLE[0], 1.325, POLE[2]]} />
        <M g={ico(0.07)} c={PAL.roofGold} p={[POLE[0], 2.68, POLE[2]]} />
      </Baked>
      <mesh ref={flag} geometry={flagGeo()} material={mat(PAL.roofGold)} position={[POLE[0], 2.35, POLE[2]]} castShadow receiveShadow />
      <Smoke origin={CHIMNEY} count={5} size={0.26} speed={0.2} rise={2.6} />
    </group>
  );
}
