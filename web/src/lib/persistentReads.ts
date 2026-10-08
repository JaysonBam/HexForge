// Disposable read snapshots. Authentication tokens and queued writes never enter this store.
const memory = new Map<string, unknown>();
let database: Promise<IDBDatabase | null> | undefined;

const openDatabase = () => database ??= new Promise<IDBDatabase | null>(resolve => {
  if (typeof indexedDB === 'undefined') { resolve(null); return; }
  const request = indexedDB.open('hexforge-read-snapshots', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('reads');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => resolve(null);
  request.onblocked = () => resolve(null);
});

export async function readSnapshot<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  if (!db) return memory.get(key) as T | undefined;
  return new Promise(resolve => {
    try {
      const request = db.transaction('reads').objectStore('reads').get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

export async function writeSnapshot<T>(key: string, value: T): Promise<void> {
  memory.set(key, value);
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const transaction = db.transaction('reads', 'readwrite');
      transaction.objectStore('reads').put(value, key);
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    } catch { resolve(); }
  });
}

export async function clearReadSnapshots(): Promise<void> {
  memory.clear();
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const transaction = db.transaction('reads', 'readwrite');
      transaction.objectStore('reads').clear();
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    } catch { resolve(); }
  });
}
