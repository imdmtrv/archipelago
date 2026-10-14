// Маяк на мысе и дом игрока на холме (с флагом и дымком из трубы).
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending, BufferAttribute, Color, ConeGeometry, DoubleSide, type Group, MeshBasicMaterial, MeshStandardMaterial,
} from 'three';
import { PAL } from '../palette';
import { cone, cyl } from '../materials';
import { LIGHT_POS } from '../layout';
import { useBus } from '../bus';
import { M, noRay } from '../models/parts';
import { Baked } from '../models/Baked';
export { Home } from './Home';

const H = 4.6, SEGS = 4;
const LAMP_Y = 0.5 + H + 0.16 + 0.37;

export function Lighthouse() {
  const bus = useBus();
  const beam = useRef<Group>(null!);
  const { lampMat, beamMat, beamGeo } = useMemo(() => {
    // луч: конус от лампы, к дальнему концу гаснет (цвет в вершинах + аддитивное смешение)
    const beamGeo = new ConeGeometry(1.7, 16, 14, 4, true);
    beamGeo.translate(0, -8, 0);
    const pos = beamGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const c = new Color(PAL.window);
    for (let i = 0; i < pos.count; i++) {
      const f = Math.pow(1 - Math.min(1, -pos.getY(i) / 16), 1.6);
      col[i * 3] = c.r * f; col[i * 3 + 1] = c.g * f; col[i * 3 + 2] = c.b * f;
    }
    beamGeo.setAttribute('color', new BufferAttribute(col, 3));
    return {
      lampMat: new MeshStandardMaterial({ color: PAL.window, emissive: PAL.window, emissiveIntensity: 1, flatShading: true }),
      beamMat: new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false }),
      beamGeo,
    };
  }, []);
  useEffect(() => () => { lampMat.dispose(); beamMat.dispose(); beamGeo.dispose(); }, [lampMat, beamMat, beamGeo]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const k = bus.weather.k;
    lampMat.emissiveIntensity = 0.8 + 0.5 * Math.max(0, Math.sin(t * 2.2)) + 0.8 * k;
    // в шторм маяк крутит луч
    beam.current.visible = k > 0.02;
    beam.current.rotation.y = t * 1.1;
    beamMat.opacity = 0.35 * k;
  });

  return (
    <group position={LIGHT_POS} raycast={noRay}>
      <Baked id="lighthouse">
      <M g={cyl(1.4, 1.65, 0.5, 10)} c={PAL.rock} p={[0, 0.25, 0]} />
      {Array.from({ length: SEGS }, (_, i) => {
        const r0 = 1.05 - (0.32 * i) / SEGS, r1 = 1.05 - (0.32 * (i + 1)) / SEGS;
        return <M key={i} g={cyl(r1, r0, H / SEGS, 12)} c={i % 2 ? PAL.roofCoral : PAL.white} p={[0, 0.5 + (H / SEGS) * (i + 0.5), 0]} />;
      })}
      <M g={cyl(0.98, 0.98, 0.16, 12)} c={PAL.night} p={[0, 0.5 + H + 0.08, 0]} />
      <M g={cone(0.78, 0.85, 8)} c={PAL.roofCoral} p={[0, LAMP_Y + 0.37 + 0.42, 0]} />
      </Baked>
      <mesh geometry={cyl(0.5, 0.5, 0.75, 8)} material={lampMat} position={[0, LAMP_Y, 0]} />
      <group ref={beam} position={[0, LAMP_Y, 0]} visible={false}>
        <mesh geometry={beamGeo} material={beamMat} rotation={[0, 0, Math.PI / 2 - 0.05]} raycast={noRay} />
      </group>
    </group>
  );
}
