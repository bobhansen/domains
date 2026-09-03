import { IDB_NAME, IDB_STORE, onStorageFreeze, storageFrozen, storageKey } from './storage.js';

let openConn = null;

onStorageFreeze(() => {
  if (openConn) {
    try {
      openConn.close();
    } catch {
      /* already closed */
    }
    openConn = null;
  }
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => {
      openConn = req.result;
      openConn.onversionchange = () => {
        openConn.close();
        openConn = null;
      };
      resolve(openConn);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getCache(key) {
  if (storageFrozen()) return null;
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(storageKey(key));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function setCache(key, value) {
  if (storageFrozen()) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, storageKey(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
