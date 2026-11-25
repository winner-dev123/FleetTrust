/**
 * Where to go after a deliberate sign-out (for example after deleting the account), instead
 * of the signed-in area's usual "sign in again" redirect.
 */
let exitPath: string | null = null;

export function leaveSignedInAreaTo(path: string): void {
  exitPath = path;
}

/** Returns and clears the pending destination. */
export function takeExitPath(): string | null {
  const path = exitPath;
  exitPath = null;
  return path;
}
