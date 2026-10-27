/**
 * Per-account storage scope.
 *
 * Iron Log keeps its data in localStorage / IndexedDB under fixed `ironlog_*` names. Before accounts existed,
 * everything on a device shared those names. To stop one signed-in account from reading (or overwriting)
 * another account's data, every persisted name is passed through `scopedKey` / `scopedDbName`:
 *
 *   - no scope set (null)  -> the legacy, unscoped name. Existing on-device data lives here. It is never
 *                             read by a signed-in account, never deleted and never migrated automatically.
 *   - scope = <user id>    -> `<name>::u:<user id>`, a namespace private to that account on this device.
 *
 * The scope is set by AuthGate *before* any private UI renders, and the private tree is remounted when it changes.
 * This is client-side separation on a shared browser profile, NOT access control: anyone with devtools on the
 * same browser profile can still read all keys. Server-side protection comes from Row Level Security.
 */

const SCOPE_SEPARATOR = '::u:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Scope used while nobody is signed in. It is an empty namespace, so a late write from a component that is
 * still tearing down can reach neither the legacy data nor the previous account's data.
 */
export const SIGNED_OUT_SCOPE = '00000000-0000-0000-0000-000000000000';

let currentScope: string | null = null;

export function getStorageScope(): string | null {
  return currentScope;
}

/** Throws on anything that is not a UUID so a malformed id can never produce a colliding namespace. */
export function setStorageScope(userId: string | null): void {
  if (userId !== null && !UUID_RE.test(userId)) {
    throw new Error('Invalid storage scope');
  }
  currentScope = userId ? userId.toLowerCase() : null;
}

export function scopedKey(baseKey: string): string {
  return currentScope ? `${baseKey}${SCOPE_SEPARATOR}${currentScope}` : baseKey;
}

export function scopedDbName(baseName: string): string {
  return currentScope ? `${baseName}${SCOPE_SEPARATOR}${currentScope}` : baseName;
}

/** Every localStorage key that belongs to the current scope (used by reset so it never touches other accounts). */
export function keysInCurrentScope(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k === null) continue;
    if (currentScope) {
      if (k.endsWith(`${SCOPE_SEPARATOR}${currentScope}`)) keys.push(k);
    } else if (!k.includes(SCOPE_SEPARATOR)) {
      keys.push(k);
    }
  }
  return keys;
}
