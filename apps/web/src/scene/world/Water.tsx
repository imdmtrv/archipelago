// Вода: гранёные волны, бирюзовая лагуна у берега (onBeforeCompile из концепта) + шторм.
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MeshStandardMaterial, PlaneGeometry } from 'three';
import { PAL } from '../palette';
import { useBus } from '../bus';
import { WX, mixWx } from '../weather';

export function Water({ segments = 230, wide = false }: { segments?: number; wide?: boolean }) {
  const bus = useBus();
  const { geo, material, uniforms } = useMemo(() => {
    const geo = new PlaneGeometry(700, 700, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const uniforms = {
      uTime: { value: 0 },
      uStorm: { value: 0 },
      uShallow: { value: new Color(PAL.seaShallow) },
      uDeep: { value: new Color(PAL.seaDeep) },
    };
    const material = new MeshStandardMaterial({ color: PAL.seaDeep, roughness: 0.3, metalness: 0, flatShading: true });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uStorm;\nvarying vec2 vXZ;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec2 p = position.xz;
          float calm = 0.3 + 0.7 * smoothstep(14.0, 34.0, length(p));
          float amp = 1.0 + 1.3 * uStorm;
          transformed.y += calm * amp * (sin(p.x * 0.35 + uTime * 1.1) * 0.18 + cos(p.y * 0.3 + uTime * 0.9) * 0.16 + sin((p.x + p.y) * 0.6 + uTime * 1.7) * 0.06);
          transformed.y += calm * uStorm * sin(p.x * 0.9 - p.y * 1.2 + uTime * 2.6) * 0.12;
          vXZ = p;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uShallow;\nuniform vec3 uDeep;\nvarying vec2 vXZ;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb = mix(uShallow, uDeep, smoothstep(15.0, 36.0, length(vXZ)));`,
        );
    };
    return { geo, material, uniforms };
  }, [segments]);

  useEffect(() => () => { geo.dispose(); material.dispose(); }, [geo, material]);

  useFrame(() => {
    const { k, waveTime } = bus.weather;
    uniforms.uTime.value = waveTime;
    uniforms.uStorm.value = k;
    mixWx(uniforms.uShallow.value, WX.shallow, k);
    mixWx(uniforms.uDeep.value, WX.deep, k);
  });

  return <mesh geometry={geo} material={material} scale={wide ? [3, 1, 3] : [1, 1, 1]} receiveShadow raycast={() => null} />;
}
