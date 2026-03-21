import React, { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { NavLayer } from './types';

interface NavContextValue {
  navState: NavLayer;              // current layer (top of stack)
  navStack: NavLayer[];            // full stack for breadcrumbs [global, project, team, ...]
  navigate: (to: NavLayer) => void; // push to stack
  navigateBack: () => void;         // pop stack (min: global)
  navigateTo: (index: number) => void; // jump to specific breadcrumb index
}

const NavContext = createContext<NavContextValue | null>(null);

export function NavProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [navStack, setNavStack] = useState<NavLayer[]>([{ layer: 'global' }]);

  const navigate = useCallback((to: NavLayer) => {
    setNavStack((prevStack) => {
      const topOfStack = prevStack[prevStack.length - 1];

      // Check if top of stack has same layer+path combo
      if (isSameNavLayer(topOfStack, to)) {
        return prevStack; // no-op
      }

      return [...prevStack, to];
    });
  }, []);

  const navigateBack = useCallback(() => {
    setNavStack((prevStack) => {
      // Never pop below [{ layer: 'global' }]
      if (prevStack.length <= 1) {
        return prevStack;
      }
      return prevStack.slice(0, -1);
    });
  }, []);

  const navigateTo = useCallback((index: number) => {
    setNavStack((prevStack) => {
      // Clamp index to valid range
      const validIndex = Math.max(0, Math.min(index, prevStack.length - 1));
      return prevStack.slice(0, validIndex + 1);
    });
  }, []);

  const navState = navStack[navStack.length - 1];

  const value: NavContextValue = {
    navState,
    navStack,
    navigate,
    navigateBack,
    navigateTo,
  };

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavContextValue {
  const context = useContext(NavContext);

  if (!context) {
    throw new Error('useNav must be called within a NavProvider');
  }

  return context;
}

/**
 * Helper function to check if two NavLayer objects represent the same layer+path combo.
 * Compares all properties to determine equality.
 */
function isSameNavLayer(a: NavLayer, b: NavLayer): boolean {
  if (a.layer !== b.layer) {
    return false;
  }

  switch (a.layer) {
    case 'global':
      return b.layer === 'global';
    case 'project':
      return (
        b.layer === 'project' &&
        a.projectPath === (b as Extract<NavLayer, { layer: 'project' }>).projectPath
      );
    case 'team':
      return (
        b.layer === 'team' &&
        a.projectPath === (b as Extract<NavLayer, { layer: 'team' }>).projectPath &&
        a.teamId === (b as Extract<NavLayer, { layer: 'team' }>).teamId
      );
    case 'agent':
      return (
        b.layer === 'agent' &&
        a.projectPath === (b as Extract<NavLayer, { layer: 'agent' }>).projectPath &&
        a.teamId === (b as Extract<NavLayer, { layer: 'agent' }>).teamId &&
        a.agentId === (b as Extract<NavLayer, { layer: 'agent' }>).agentId
      );
    default:
      const _exhaustive: never = a;
      return _exhaustive;
  }
}
