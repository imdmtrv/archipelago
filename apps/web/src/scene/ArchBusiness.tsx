import type { BusinessId } from '@arch/engine';
import { useEffect, useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { useI18n } from '../i18n';
import type { ArchSceneIsland } from './contract';
import { ARCH_ROOFS } from './archLayout';
import { PAL } from './palette';
import { box, cyl, gableRoof, hullGeo } from './materials';
import { Baked } from './models/Baked';
import { Beam, Crate, DARK_SMOKE, House, Lounger, M, Smoke, Umbrella, Win } from './models/parts';

/** Небольшой паром: корпус ориентирован носом по +x. */
export function ArchFerry({ roof = PAL.roofTeal }: { roof?: number }) {
  return (
    <Baked id={`arch:ferry:${roof}`}>
      <M g={hullGeo(3.4, 0.65, 1.4, 'arch-ferry')} c={PAL.woodDark} />
      <M g={box(2.8, 0.12, 1.2)} c={PAL.marble} p={[-0.1, 0.35, 0]} />
      <M g={box(1.35, 0.85, 1.0)} c={PAL.wall} p={[-0.4, 0.8, 0]} />
      <M g={box(1.65, 0.15, 1.3)} c={roof} p={[-0.4, 1.3, 0]} />
      <Win p={[-0.4, 0.9, 0.53]} w={0.75} h={0.4} />
      <Win p={[-0.4, 0.9, -0.53]} w={0.75} h={0.4} />
    </Baked>
  );
}

function BusinessModel({ business, roof }: { business: BusinessId; roof: number }) {
  switch (business) {
    case 'cannery':
      return (
        <>
          <House w={3.7} d={2.7} h={1.9} roof={roof} roofH={0.7} chimney={false} />
          <M g={cyl(0.24, 0.38, 4.8, 8)} c={PAL.rock} p={[1.5, 2.4, -0.9]} />
          <M g={cyl(0.28, 0.28, 0.22, 8)} c={roof} p={[1.5, 4.45, -0.9]} />
          {[-1, 0, 1].map((x) => (
            <group key={x} position={[x, 0, 2.1]}>
              <M g={cyl(0.33, 0.33, 0.85, 8)} c={PAL.woodDark} p={[0, 0.43, 0]} />
              <M g={cyl(0.35, 0.35, 0.1, 8)} c={PAL.rock} p={[0, 0.65, 0]} />
            </group>
          ))}
          <Crate p={[2.4, 0, 0.8]} s={0.7} />
        </>
      );
    case 'hotel':
      return (
        <>
          <M g={box(6, 0.25, 4.8)} c={PAL.wood} p={[0, 0.13, 0.7]} />
          <group position={[0, 0.25, -0.4]}>
            <House w={3.7} d={2.7} h={3.2} roof={roof} roofH={1.0} chimney={false} />
            <Win p={[-0.9, 2.8, 1.4]} w={0.7} h={0.65} />
            <Win p={[0.9, 2.8, 1.4]} w={0.7} h={0.65} />
          </group>
          <M g={box(5.7, 0.1, 0.1)} c={PAL.white} p={[0, 1.05, 3]} />
          {[-2.7, -1.35, 0, 1.35, 2.7].map((x) => <M key={x} g={box(0.1, 0.8, 0.1)} c={PAL.white} p={[x, 0.65, 3]} />)}
          {[-2.1, 2.1].map((x) => <Umbrella key={x} p={[x, 0.25, 1.8]} color={roof} r={0.8} h={1.6} />)}
          <Lounger p={[-1, 0.25, 2]} />
          <Lounger p={[1, 0.25, 2]} />
        </>
      );
    case 'coldStore':
      return (
        <>
          <M g={box(5.8, 0.25, 3.8)} c={PAL.rock} p={[0, 0.13, 0]} />
          <M g={box(5.5, 2, 3.5)} c={PAL.marble} p={[0, 1.25, 0]} />
          <M g={box(5.8, 0.25, 3.8)} c={PAL.white} p={[0, 2.35, 0]} />
          <M g={box(5.9, 0.18, 0.12)} c={roof} p={[0, 2.4, 1.95]} />
          <M g={box(5.9, 0.18, 0.12)} c={roof} p={[0, 2.4, -1.95]} />
          {[-1.6, 1.6].map((x) => <M key={x} g={box(1.35, 1.6, 0.08)} c={PAL.rock} p={[x, 1.05, 1.8]} />)}
          <M g={box(1.2, 0.7, 0.6)} c={PAL.white} p={[0, 1.6, 2.05]} />
          <Crate p={[3.3, 0, 1]} s={0.8} />
        </>
      );
    case 'shipyard':
      return (
        <>
          {/* Рельсы, шпалы и кильблоки в том же устройстве, что у верфи мечты. */}
          {[-1.1, 1.1].map((z) => <M key={z} g={box(7, 0.24, 0.25)} c={PAL.wood} p={[0, 0.45, z]} />)}
          {[-3, -2, -1, 0, 1, 2, 3].map((x) => <M key={x} g={box(0.25, 0.2, 3)} c={PAL.woodDark} p={[x, 0.25, 0]} />)}
          {[-1.8, 0, 1.8].map((x) => <M key={x} g={box(0.5, 0.55, 0.8)} c={PAL.woodDark} p={[x, 0.8, 0]} />)}
          <M g={hullGeo(5.8, 1.3, 2.5, 'arch-yard')} c={roof} p={[0, 1.7, 0]} />
          <M g={box(4.8, 0.12, 2.1)} c={PAL.wood} p={[-0.15, 2.4, 0]} />
          <Beam a={[-3.5, 0, -2]} b={[-3.5, 4, -2]} t={0.24} c={PAL.woodDark} />
          <Beam a={[-3.5, 4, -2]} b={[-0.5, 4, -2]} t={0.24} c={PAL.wood} />
          <Beam a={[-0.5, 4, -2]} b={[-0.5, 2.7, -2]} t={0.04} c={PAL.night} />
        </>
      );
    case 'bank':
      return (
        <>
          <M g={box(5.5, 0.4, 4.5)} c={PAL.stone} p={[0, 0.2, 0]} />
          <M g={box(3.4, 0.2, 0.8)} c={PAL.marble} p={[0, 0.1, 2.5]} />
          <M g={box(4, 2.5, 2.5)} c={PAL.wall} p={[0, 1.65, -0.5]} />
          <M g={box(0.8, 1.7, 0.08)} c={PAL.woodDark} p={[0, 1.25, 0.8]} />
          {[-1.8, -0.6, 0.6, 1.8].map((x) => <M key={x} g={cyl(0.2, 0.25, 2.5, 8)} c={PAL.marble} p={[x, 1.65, 1.55]} />)}
          <M g={box(5.1, 0.3, 4.1)} c={PAL.marble} p={[0, 3.05, 0]} />
          <M g={gableRoof(5.1, 4.1, 1.1, 0.12)} c={roof} p={[0, 3.2, 0]} />
          <M g={cyl(0.4, 0.4, 0.08, 12)} c={PAL.gold} p={[0, 3.6, 2.23]} r={[Math.PI / 2, 0, 0]} />
          <M g={cyl(0.05, 0.05, 2.4, 6)} c={PAL.woodDark} p={[2.4, 4, -1.5]} />
          <M g={box(1, 0.6, 0.06)} c={roof} p={[2.9, 4.8, -1.5]} />
        </>
      );
  }
}

export function ArchBusiness({ data }: { data: ArchSceneIsland }) {
  const roof = ARCH_ROOFS[data.tone];
  const patchY = data.business === 'hotel' ? 4.25 : data.business === 'bank' ? 3.8 : 2.55;
  return (
    <group scale={1.5}>
      <Baked id={`arch:business:${data.business}:${data.built}:${data.tone}:${data.damaged}`}>
        {data.built ? <BusinessModel business={data.business} roof={roof} /> : (
          <>
            <M g={box(6, 0.08, 4.8)} c={PAL.sand} p={[0, 0.04, 0]} />
            {[-3, 3].flatMap((x) => [-2.4, 2.4].map((z) => <M key={`${x}:${z}`} g={box(0.15, 0.9, 0.15)} c={PAL.wood} p={[x, 0.45, z]} />))}
            <M g={box(0.15, 1.5, 0.15)} c={PAL.woodDark} p={[0, 0.75, 2.4]} />
            <M g={box(2.1, 0.8, 0.12)} c={PAL.marble} p={[0, 1.25, 2.4]} />
          </>
        )}
        {data.built && data.damaged && <M g={box(1.8, 0.16, 1.2)} c={PAL.night} p={[0.3, patchY, 0.7]} r={[0, 0, -0.15]} />}
      </Baked>
      {!data.built && <FreePlotSign />}
      {data.built && (data.damaged || data.business === 'cannery') && (
        <Smoke origin={data.business === 'cannery' ? [1.5, 4.85, -0.9] : [0.3, patchY + 0.2, 0.7]}
          color={data.damaged ? DARK_SMOKE : PAL.puff} count={5} size={0.28} rise={3} speed={0.22} />
      )}
    </group>
  );
}

function FreePlotSign() {
  const { t } = useI18n();
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 192;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#f6f2ea'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#2e3a55'; context.font = 'bold 68px sans-serif';
    context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(t.arch.status.free, 256, 96, 480);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, [t.arch.status.free]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={[0, 1.25, 2.47]}>
      <planeGeometry args={[2.1, 0.8]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}

export function ArchDock({ roof }: { roof: number }) {
  return (
    <group>
      <Baked id="arch:dock">
        <M g={box(2.4, 0.24, 8)} c={PAL.wood} p={[0, 0.7, 14]} />
        {[11, 14, 17].flatMap((z) => [-1, 1].map((x) => <M key={`${x}:${z}`} g={cyl(0.16, 0.2, 2.5, 6)} c={PAL.woodDark} p={[x, -0.2, z]} />))}
      </Baked>
      <group position={[2.4, 0.45, 16.5]} rotation={[0, -Math.PI / 2, 0]}><ArchFerry roof={roof} /></group>
    </group>
  );
}
