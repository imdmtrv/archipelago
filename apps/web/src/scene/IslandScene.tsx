// 3D-сцена острова — реализация контракта IslandSceneProps (см. contract.ts).
// Полноэкранный Canvas (position: fixed, z-index 0) + DOM-слои: tilt-shift, виньетка, всплывающие суммы.
import { type CSSProperties, useCallback, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { NeutralToneMapping, PerspectiveCamera, Vector2 } from 'three';
import type { IslandSceneProps } from './contract';
import { BusContext, createBus } from './bus';
import { CAM_DIR, TARGET, idealDistance } from './layout';
import { Atmosphere } from './world/Atmosphere';
import { Water } from './world/Water';
import { Terrain } from './world/Terrain';
import { Decor } from './world/Decor';
import { Home, Lighthouse } from './world/Landmarks';
import { Clouds, Gulls, Neighbors, Rain } from './world/Ambient';
import { Items } from './Items';
import { Shipyard } from './world/Shipyard';
import { FloatLabels } from './FloatLabels';
import { CameraRig, type CameraFocus } from './CameraRig';
import { DirectorCamera } from './DirectorCamera';
import { dreamFocusPoint } from './slots';
import { Archipelago } from './Archipelago';
import './scene.css';
import { registerIslandCapture } from './snapshot';

const GL = { antialias: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1.05 };

function SnapshotCapture() {
  const { gl, scene, camera } = useThree();
  useEffect(() => registerIslandCapture(() => {
    if (gl.getContext().isContextLost()) throw new Error('WebGL context lost');
    const size = gl.getSize(new Vector2()), pixelRatio = gl.getPixelRatio();
    // Тот же остров и ракурс, но без сдвига под шторку и боковые панели.
    const shot = camera.clone() as PerspectiveCamera;
    shot.aspect = 1080 / 800; shot.zoom = 1; shot.clearViewOffset();
    shot.position.sub(TARGET).normalize().multiplyScalar(idealDistance(shot.aspect)).add(TARGET);
    shot.lookAt(TARGET); shot.updateProjectionMatrix();
    try {
      gl.setPixelRatio(1); gl.setSize(1080, 800, false);
      gl.render(scene, shot);
      const frame = document.createElement('canvas');
      frame.width = 1080; frame.height = 800;
      const ctx = frame.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(gl.domElement, 0, 0);
      ctx.getImageData(0, 0, 1, 1); // недоступный для экспорта кадр → градиент карточки
      return frame;
    } finally {
      gl.setPixelRatio(pixelRatio); gl.setSize(size.x, size.y, false);
      gl.render(scene, camera);
    }
  }), [gl, scene, camera]);
  return null;
}

export function IslandScene({ items, floats, weather, dream, bottomInset = 0, sideInsets, cameraPose, dpr, onItemClick, arch }: IslandSceneProps) {
  const storm = weather === 'storm';
  // шина создаётся один раз; погода стартует сразу в нужном состоянии
  const bus = useMemo(() => createBus(weather === 'storm'), []);
  useEffect(() => { bus.weather.target = storm ? 1 : 0; }, [bus, storm]);

  const clickRef = useRef(onItemClick);
  useEffect(() => { clickRef.current = onItemClick; }, [onItemClick]);

  const setFloatLayer = useCallback((el: HTMLDivElement | null) => { bus.floatLayer = el; }, [bus]);

  // куда камере поворачиваться при изменении мечты (по примитивам — объект dream может быть новым после каждого действия)
  const dBuilt = dream?.built, dStages = dream?.stages, dBuilding = dream?.building;
  const focus = useMemo<CameraFocus | null>(() => {
    if (dBuilt === undefined || dStages === undefined) return null;
    const p = dreamFocusPoint({ built: dBuilt, stages: dStages, building: !!dBuilding });
    return p && { key: `${dBuilt}:${dBuilding ? 1 : 0}`, ...p };
  }, [dBuilt, dStages, dBuilding]);

  const { camera, small } = useMemo(() => {
    const w = window.innerWidth, h = Math.max(1, window.innerHeight);
    const p = TARGET.clone().addScaledVector(CAM_DIR, idealDistance(w / h));
    return {
      camera: { fov: 30, near: 0.5, far: 1200, position: [p.x, p.y, p.z] as [number, number, number] },
      small: Math.min(w, h) < 600,
    };
  }, []);

  return (
    <div
      className={`isl-root${storm ? ' isl-storm' : ''}${arch?.on ? ' isl-arch' : ''}`}
      style={{ '--isl-inset': Math.min(0.6, Math.max(0, bottomInset || 0)) } as CSSProperties}
    >
      <Canvas shadows="percentage" dpr={dpr ?? [1, 2]} gl={GL} camera={camera}>
        <SnapshotCapture />
        <BusContext.Provider value={bus}>
          <Atmosphere archOn={!!arch?.on} />
          <Water segments={small ? 170 : 230} wide={!!arch?.on} />
          <Terrain />
          <Decor />
          <Lighthouse />
          <Home />
          <Neighbors arch={arch} />
          {arch?.on && <Archipelago arch={arch} />}
          <Clouds />
          <Gulls />
          <Rain count={small ? 600 : 900} />
          <Items items={items} clickRef={clickRef} />
          {dream && <Shipyard dream={dream} clickRef={clickRef} />}
          <FloatLabels floats={floats} items={items} />
          {cameraPose ? <DirectorCamera pose={cameraPose} /> : <CameraRig bottomInset={bottomInset} sideInsets={sideInsets} focus={focus} arch={arch} />}
        </BusContext.Provider>
      </Canvas>
      <div className="isl-tilt isl-tilt-top" />
      <div className="isl-tilt isl-tilt-bottom" />
      <div className="isl-vignette" />
      <div className="isl-storm-veil" />
      <div className="isl-floats" ref={setFloatLayer} />
    </div>
  );
}

export default IslandScene;
