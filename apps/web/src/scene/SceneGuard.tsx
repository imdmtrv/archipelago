import { Component, useEffect, type ReactNode } from 'react';
import { errorTitle, track } from '../analytics';
import { asset } from '../asset';
import { useI18n } from '../i18n';
import { useGame } from '../store';
import type { IslandSceneProps } from './contract';
import { IslandScene } from './IslandScene';
import { webglAvailable } from './webgl';

let noWebglTracked = false;
let noteShown = false;

function StillIsland() {
  const world = useGame((s) => s.world);
  const { t } = useI18n();
  useEffect(() => {
    if (!world || noteShown) return;
    noteShown = true;
    useGame.getState().showToast(t.ui.stillIslandNote);
  }, [world, t]);

  return (
    <picture className="isl-still">
      <source media="(max-aspect-ratio: 1/1)" srcSet={asset('island-still-tall.jpg')} />
      <img src={asset('island-still-wide.jpg')} alt="" />
    </picture>
  );
}

// Ошибка сцены не снимает интерфейс игры.
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Scene error';
    track('scene-error', errorTitle(message));
  }

  render() { return this.state.failed ? <StillIsland /> : this.props.children; }
}

export function SceneGuard(props: IslandSceneProps) {
  const available = webglAvailable();
  useEffect(() => {
    if (available || noWebglTracked) return;
    noWebglTracked = true;
    track('no-webgl');
  }, [available]);
  return available ? <SceneBoundary><IslandScene {...props} /></SceneBoundary> : <StillIsland />;
}
