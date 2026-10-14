// Золотая статуя хозяина острова на мраморном постаменте: пузико, корона, плащ, рука к небу.
// Немного комичная и самодовольная. Повреждённая — фигура покосилась, корона упала.
import { PAL } from '../palette';
import { box, cone, cyl, ico } from '../materials';
import { M } from './parts';
import type { ModelProps } from './types';
import { Baked } from './Baked';

const PLINTH = 1.44;

export function Statue({ damaged }: ModelProps) {
  const G = PAL.gold;
  return (
    <group>
      <Baked id={`statue:face:${+damaged}`}>
      {/* постамент */}
      <M g={box(1.5, 0.3, 1.5)} c={PAL.stone} p={[0, 0.15, 0]} />
      <M g={box(1.1, 1.0, 1.1)} c={PAL.marble} p={[0, 0.8, 0]} />
      <M g={box(1.3, 0.14, 1.3)} c={PAL.marble} p={[0, 1.37, 0]} />
      <M g={box(0.62, 0.26, 0.04)} c={PAL.gold} p={[0, 0.85, 0.57]} />
      {/* фигура */}
      <group position={[0, PLINTH, 0]} rotation={damaged ? [0.1, 0, 0.26] : [0, 0, 0]}>
        <M g={box(0.2, 0.55, 0.26)} c={G} p={[-0.15, 0.275, 0]} />
        <M g={box(0.2, 0.55, 0.26)} c={G} p={[0.15, 0.275, 0]} />
        <M g={cyl(0.3, 0.38, 0.72, 7)} c={G} p={[0, 0.9, 0.02]} />
        <M g={box(0.66, 0.95, 0.06)} c={PAL.roofCoral} p={[0, 0.86, -0.32]} r={[0.16, 0, 0]} />
        {/* лицо на +z, подбородок лишь чуть поднят; корона наклоняется вместе с головой */}
        <group position={[0, 1.52, 0.02]} rotation={[-0.1, 0, 0]}>
          <M g={ico(0.26)} c={G} />
          {[-1, 1].map((side) => (
            <group key={side}>
              <M g={ico(0.035)} c={PAL.night} p={[side * 0.095, 0.04, 0.225]} />
              <M g={box(0.1, 0.025, 0.04)} c={PAL.goldDeep} p={[side * 0.095, 0.1, 0.215]} r={[0, 0, side * -0.15]} />
              <M g={box(0.12, 0.045, 0.06)} c={PAL.goldDeep} p={[side * 0.065, -0.08, 0.235]} r={[0, 0, side * 0.18]} />
            </group>
          ))}
          <M g={ico(0.075)} c={G} p={[0, -0.015, 0.25]} s={[0.7, 0.8, 1.3]} />
          {!damaged && <Crown y={0.26} />}
        </group>
        {/* правая рука указывает в небо */}
        <group position={[-0.3, 1.16, 0]} rotation={[0, 0, 0.45]}>
          <M g={box(0.15, 0.62, 0.15)} c={G} p={[0, 0.31, 0]} />
          <M g={ico(0.11)} c={G} p={[0, 0.66, 0]} />
        </group>
        {/* левая — «руки в боки» */}
        <group position={[0.31, 1.14, 0]} rotation={[0, 0, -2.5]}>
          <M g={box(0.14, 0.38, 0.14)} c={G} p={[0, 0.19, 0]} />
          <group position={[0, 0.36, 0]} rotation={[0, 0, -1.75]}>
            <M g={box(0.13, 0.34, 0.13)} c={G} p={[0, 0.17, 0]} />
          </group>
        </group>
      </group>
      {damaged && (
        <group position={[0.38, PLINTH, 0.32]} rotation={[0.9, 0, 0.3]}>
          <Crown y={0.07} />
        </group>
      )}
      </Baked>
    </group>
  );
}

function Crown({ y }: { y: number }) {
  return (
    <group position={[0, y, 0.02]}>
      <M g={cyl(0.2, 0.18, 0.14, 7)} c={PAL.goldDeep} />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * Math.PI * 2;
        return <M key={i} g={cone(0.05, 0.16, 4)} c={PAL.goldDeep} p={[Math.cos(a) * 0.17, 0.14, Math.sin(a) * 0.17]} />;
      })}
    </group>
  );
}
