import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

export function canonicalizeWorkspacePath(workspacePath: string): string {
  const resolvedPath = resolve(workspacePath);

  try {
    // Normalize Windows 8.3 aliases and symlinked paths to a stable on-disk path.
    return realpathSync(resolvedPath);
  } catch {
    return resolvedPath;
  }
}
