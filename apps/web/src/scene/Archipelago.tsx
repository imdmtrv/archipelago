import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { Group, QuadraticBezierCurve3, Vector3 } from 'three';
import { ARCH_ICONS, type ArchSceneIsland, type ArchSceneProps } from './contract';
import { ARCH_ISLAND_SCALE, ARCH_ROOFS, archIslandPosition } from './archLayout';
import { ArchBusiness, ArchDock, ArchFerry } from './ArchBusiness';
import { GRASS_Y } from './layout';
import { PAL } from './palette';
import { useBus } from './bus';
import { useReducedMotion } from './useReducedMotion';

function FerryRoute({ data, reduced }: { data: ArchSceneIsland; reduced: boolean }) {
  const boat = useRef<Group>(null);
  const { curve, points, point, tangent } = useMemo(() => {
    const destination = new Vector3(...archIslandPosition(data.island));
    const unit = destination.clone().normalize();
    const start = unit.clone().multiplyScalar(18).setY(0.9);
    const end = destination.clone().addScaledVector(unit, -18 * ARCH_ISLAND_SCALE).setY(0.9);
    const mid = start.clone().lerp(end, 0.5).add(new Vector3(-unit.z * 6, 0, unit.x * 6));
    const curve = new QuadraticBezierCurve3(start, mid, end);
    return { curve, points: curve.getPoints(64), point: new Vector3(), tangent: new Vector3() };
  }, [data.island]);
  useFrame((state) => {
    const group = boat.current;
    if (!group) return;
    const cycle = (state.clock.elapsedTime + archIslandPosition(data.island)[0] + 70) % 12;
    const t = reduced ? 0.5 : Math.min(1, cycle / 8);
    group.visible = reduced || cycle < 8;
    group.position.copy(curve.getPoint(t, point));
    group.rotation.y = -Math.atan2(curve.getTangent(t, tangent).z, tangent.x);
  });
  return (
    <>
      <Line points={points} color={PAL.sail} lineWidth={1.5} dashed dashSize={1.5} gapSize={1.1} transparent opacity={0.8} raycast={() => null} />
      <group ref={boat} scale={0.8}><ArchFerry roof={ARCH_ROOFS[data.tone]} /></group>
    </>
  );
}

interface LabelNode { data: ArchSceneIsland; button: HTMLButtonElement; point: Vector3 }

function IslandLabels({ arch }: { arch: ArchSceneProps }) {
  const bus = useBus();
  const nodes = useRef<LabelNode[]>([]);
  const projected = useMemo(() => new Vector3(), []);
  useEffect(() => {
    // floatLayer монтируется после Canvas; создание делаем в useFrame, как FloatLabels.
    nodes.current = arch.islands.map((data) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `isl-arch-label isl-arch-${data.tone}${data.attention ? ' isl-arch-attention' : ''}`;
      button.dataset.damaged = String(data.damaged);
      button.dataset.built = String(data.built);
      button.dataset.island = data.island;
      button.setAttribute('aria-pressed', String(arch.focus === data.island));
      button.textContent = data.label.includes(ARCH_ICONS[data.business]) ? data.label : `${ARCH_ICONS[data.business]} ${data.label}`;
      button.setAttribute('aria-label', data.label);
      button.onclick = () => arch.onIslandClick(data.island);
      button.onpointerdown = (event) => event.stopPropagation();
      const point = new Vector3(...archIslandPosition(data.island)).setY(data.built ? 10 : 5);
      return { data, button, point };
    });
    return () => { nodes.current.forEach(({ button }) => button.remove()); nodes.current = []; };
  }, [arch.islands, arch.focus, arch.onIslandClick]);

  useFrame(({ camera, size }) => {
    const layer = bus.floatLayer;
    if (!layer) return;
    for (const { button, point } of nodes.current) {
      if (button.parentElement !== layer) layer.appendChild(button);
      projected.copy(point).project(camera);
      const visible = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
      button.hidden = !visible;
      if (visible) button.style.transform = `translate(${(projected.x * 0.5 + 0.5) * size.width}px, ${(-projected.y * 0.5 + 0.5) * size.height}px) translate(-50%, -100%)`;
    }
  });
  return null;
}

export function Archipelago({ arch }: { arch: ArchSceneProps }) {
  const reduced = useReducedMotion();
  return (
    <>
      {arch.islands.map((data) => {
        const [x, , z] = archIslandPosition(data.island);
        return (
          <group key={data.island}>
            {data.route && <FerryRoute data={data} reduced={reduced} />}
            <group position={[x, 0, z]} scale={ARCH_ISLAND_SCALE}
              onClick={(event) => { event.stopPropagation(); arch.onIslandClick(data.island); }}>
              <group position={[0, GRASS_Y, 0]} rotation={[0, Math.PI / 4, 0]}><ArchBusiness data={data} /></group>
              {data.route && <group rotation={[0, Math.atan2(-x, -z), 0]}><ArchDock roof={ARCH_ROOFS[data.tone]} /></group>}
            </group>
          </group>
        );
      })}
      <IslandLabels arch={arch} />
    </>
  );
}
