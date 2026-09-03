/** All persisted keys and database names start with this prefix. */
export const STORAGE_PREFIX = 'vanity_';

export const IDB_NAME = `${STORAGE_PREFIX}idb`;
export const IDB_STORE = `${STORAGE_PREFIX}store`;

const LEGACY_IDB_NAMES = ['DomainGenDB'];

export function storageKey(suffix) {
  const name = String(suffix || '');
  return name.startsWith(STORAGE_PREFIX) ? name : STORAGE_PREFIX + name;
}

let frozen = false;
const freezeHooks = [];

export function storageFrozen() {
  return frozen;
}

export function onStorageFreeze(fn) {
  freezeHooks.push(fn);
}

function freezeStorage() {
  frozen = true;
  freezeHooks.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

function removePrefixed(storage) {
  if (!storage) return;
  const doomed = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) doomed.push(key);
  }
  doomed.forEach((key) => storage.removeItem(key));
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function deletePrefixedDatabases() {
  const extra = new Set(LEGACY_IDB_NAMES);
  extra.add(IDB_NAME);
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db?.name && (db.name.startsWith(STORAGE_PREFIX) || extra.has(db.name))) {
          extra.add(db.name);
        }
      }
    }
  } catch {
    /* Safari < 16 has no databases() */
  }
  await Promise.all([...extra].map(deleteDatabase));
}

async function deleteCaches() {
  if (typeof caches === 'undefined' || !caches.keys) return;
  try {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  } catch {
    /* private mode */
  }
}

async function unregisterWorkers() {
  try {
    if (!navigator.serviceWorker?.getRegistrations) return;
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
  } catch {
    /* unsupported */
  }
}

function stripUrl() {
  const url = new URL(window.location.href);
  return `${url.pathname}${url.hash}`;
}

/**
 * Wipe every vanity_* localStorage/sessionStorage key, IndexedDB database,
 * Cache Storage entry, and URL query string, then reload a clean page.
 */
export async function clearAllLocalData() {
  freezeStorage();
  try {
    removePrefixed(window.localStorage);
  } catch {
    /* private mode */
  }
  try {
    removePrefixed(window.sessionStorage);
  } catch {
    /* private mode */
  }
  await deletePrefixedDatabases();
  await deleteCaches();
  await unregisterWorkers();
  const clean = stripUrl();
  window.location.replace(clean);
}
