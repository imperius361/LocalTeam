export type NavLayer =
  | { layer: 'global' }
  | { layer: 'project'; projectPath: string }
  | { layer: 'team'; projectPath: string; teamId: string }
  | { layer: 'agent'; projectPath: string; teamId: string; agentId: string };

// Helper: extract the layer name as a string key for AnimatePresence
export type LayerName = NavLayer['layer'];
