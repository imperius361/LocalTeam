import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface LayerTransitionProps {
  children: React.ReactNode;
  layerKey: string; // pass navState.layer as key for AnimatePresence
}

// Zoom-in variants: drill-down feels like zooming into detail
const variants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit:    { opacity: 0, scale: 1.02 },
};

export function LayerTransition({ children, layerKey }: LayerTransitionProps) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={layerKey}
        variants={variants}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={{ duration: 0.18, ease: 'easeOut' }}
        style={{ width: '100%', height: '100%' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
