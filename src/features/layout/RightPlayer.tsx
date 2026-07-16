import React, { memo } from 'react';
import { Player } from '../player/Player';

export const RightPlayer: React.FC = memo(() => {
  return <Player className="lg:left-64" />;
});
RightPlayer.displayName = 'RightPlayer';