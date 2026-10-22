export type RecoveryStorage = Pick<Storage, "length" | "key" | "getItem" | "removeItem">;
export function ownRecoveryKeys(storage: RecoveryStorage, userId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(userId)) return [];
  const prefixes = [`hestia:collab-op:${userId}:`, `hestia:collab-recovery-snapshot:${encodeURIComponent(userId)}:`, `hestia:title-draft:${encodeURIComponent(userId)}:`];
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key && prefixes.some(prefix => key.startsWith(prefix))) keys.push(key); }
  return keys;
}
export function clearOwnRecovery(storage: RecoveryStorage, userId: string) { const keys = ownRecoveryKeys(storage, userId); for (const key of keys) storage.removeItem(key); return keys.length; }
