// Небо, туман и свет: тёплое солнце золотого часа + холодная полусфера. Шторм плавно гасит всё в серое.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BackSide, Color, type DirectionalLight, type Fog, type HemisphereLight, type Mesh, ShaderMaterial, SphereGeometry,
} from 'three';
import { PAL } from '../palette';
import { useBus } from '../bus';
import { WX, mixWx, stepWeather } from '../weather';

const WHITE = new Color(PAL.white);

function Sky({ archOn }: { archOn: boolean }) {
  const bus = useBus();
  const sky = useRef<Mesh>(null!);
  const { geo, material } = useMemo(() => {
    const material = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { top: { value: new Color(PAL.skyTop) }, horizon: { value: new Color(PAL.skyHorizon) } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
        void main() {
          float h = clamp(vDir.y * 1.8 + 0.04, 0.0, 1.0);
          gl_FragColor = vec4(mix(horizon, top, pow(h, 0.75)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    return { geo: new SphereGeometry(500, 32, 16), material };
  }, []);

  useFrame(() => {
    sky.current.scale.setScalar(archOn || document.documentElement.dataset.archCamera === 'flying' ? 4 : 1);
    const { k, flash } = bus.weather;
    const u = material.uniforms;
    mixWx(u.top.value as Color, WX.skyTop, k);
    mixWx(u.horizon.value as Color, WX.horizon, k);
    if (flash > 0) {
      (u.top.value as Color).lerp(WHITE, flash * 0.45);
      (u.horizon.value as Color).lerp(WHITE, flash * 0.3);
    }
  });

  return <mesh ref={sky} geometry={geo} material={material} scale={archOn ? 4 : 1} renderOrder={-1} frustumCulled={false} raycast={() => null} />;
}

export function Atmosphere({ archOn = false }: { archOn?: boolean }) {
  const bus = useBus();
  const hemi = useRef<HemisphereLight>(null!);
  const sun = useRef<DirectionalLight>(null!);
  const fog = useRef<Fog>(null!);

  useLayoutEffect(() => {
    const s = sun.current;
    s.shadow.mapSize.set(2048, 2048);
    Object.assign(s.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 100 });
    s.shadow.camera.updateProjectionMatrix();
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.04;
  }, []);

  // Шаг погоды — раньше всех остальных подписчиков кадра
  useFrame((state, dt) => stepWeather(bus.weather, Math.min(dt, 0.1), state.clock.elapsedTime), -2);

  useFrame((state) => {
    const { k, flash } = bus.weather;
    mixWx(hemi.current.color, WX.hemiSky, k);
    mixWx(hemi.current.groundColor, WX.hemiGround, k);
    hemi.current.intensity = 1.5 - 0.45 * k + flash * 2.2;
    mixWx(sun.current.color, WX.sun, k);
    sun.current.intensity = 2.7 - 2.05 * k;
    const f = fog.current;
    mixWx(f.color, WX.horizon, k);
    const wide = archOn || document.documentElement.dataset.archCamera === 'flying';
    f.near = wide ? Math.max(170, state.camera.position.length() + 90) : 85 - 35 * k;
    f.far = wide ? f.near + 330 : 210 - 60 * k;
  });

  return (
    <>
      <fog ref={fog} attach="fog" args={[PAL.skyHorizon, 85, 210]} />
      <hemisphereLight ref={hemi} args={[PAL.hemiSky, PAL.hemiGround, 1.5]} />
      <directionalLight ref={sun} color={PAL.sun} intensity={2.7} position={[-14, 32, 26]} castShadow />
      <Sky archOn={archOn} />
    </>
  );
}
