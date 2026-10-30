import { createContext } from 'react';
import type { MotionValue } from 'motion/react';
export const PlayerMotionContext = createContext<MotionValue<number> | null>(null);
