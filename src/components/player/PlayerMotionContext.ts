import { createContext } from 'react';
import type { MotionValue } from 'motion/react';

export const PlayerMotionContext = createContext<{
  x: MotionValue<number>;
  direction: number;
  begin: () => void;
  drag: (offset: number) => void;
  release: (direction: -1 | 1, velocity: number) => void;
} | null>(null);
