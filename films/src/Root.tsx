import React from 'react'
import { Composition } from 'remotion'
import { Film, sceneFrames } from './Film'
import type { FilmProps } from './types'
import { sample } from './sample'

export const Root: React.FC = () => (
  <Composition
    id="Film"
    component={Film}
    defaultProps={sample}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={300}
    calculateMetadata={({ props }: { props: FilmProps }) => {
      const fps = props.fps ?? 30
      const portrait = props.aspect === '9:16'
      return {
        fps,
        width: portrait ? 1080 : 1920,
        height: portrait ? 1920 : 1080,
        durationInFrames: Math.max(1, props.scenes.reduce((n, sc) => n + sceneFrames(sc, fps), 0)),
      }
    }}
  />
)
