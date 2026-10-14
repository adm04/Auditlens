// IndexedDB storage shared by the service worker, popup and workspace.
//
// Store "audits" (keyPath id). One record per audit:
// {
//   id, url, title, createdAt, updatedAt, status: 'capturing'|'ready'|'error', error?,
//   options: { mobile, psi, pageType, conversion },
//   views: {
//     desktop: { snapshot, shot: Blob|null, shotMeta: {width,height,scale,screens,truncated} },
//     mobile:  { ... } | undefined
//   },
//   psi: { mobile?: parsedResult, desktop?: parsedResult, error? },
//   context: { pageType, businessModel, conversion, platform },   // editable by the auditor
//   findings: Finding[], strengths: Strength[],
//   checklist: { [itemId]: { status: 'pass'|'weak'|'missing'|'na'|'', note } },
//   attachments: [{ id, name, caption, blob }],
//   ai: { summary?, copy? }, notes: ''
// }

const DB_NAME = 'auditlens';
const DB_VERSION = 2;
let dbPromise = null;

export const uid = () => crypto.randomUUID();

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('audits')) db.createObjectStore('audits', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('sites')) db.createObjectStore('sites', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        req.result.onclose = () => { dbPromise = null; };
        resolve(req.result);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn, store = 'audits') {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then((r) => { out = r; }, reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const getAudit = (id) => tx('readonly', (s) => promisify(s.get(id)));
export const putAudit = (audit) => tx('readwrite', (s) => promisify(s.put({ ...audit, updatedAt: Date.now() })));
export const deleteAudit = (id) => tx('readwrite', (s) => promisify(s.delete(id)));

// Sites group page audits from one multi-page run:
// { id, host, title, createdAt, status:'capturing'|'analyzing'|'ready', options, pageIds:[], errors:[], verdict?, notes? }
export const getSite = (id) => tx('readonly', (s) => promisify(s.get(id)), 'sites');
export const putSite = (site) => tx('readwrite', (s) => promisify(s.put({ ...site, updatedAt: Date.now() })), 'sites');
export async function deleteSite(id, withPages = true) {
  const site = await getSite(id);
  if (withPages && site) for (const pid of site.pageIds) await deleteAudit(pid);
  await tx('readwrite', (s) => promisify(s.delete(id)), 'sites');
}
export async function listSites() {
  const all = await tx('readonly', (s) => promisify(s.getAll()), 'sites');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

/** Light list for sidebars (drops heavy blobs). */
export async function listAudits() {
  const all = await tx('readonly', (s) => promisify(s.getAll()));
  return all
    .map((a) => ({
      id: a.id, url: a.url, title: a.title, createdAt: a.createdAt, updatedAt: a.updatedAt, status: a.status, siteId: a.siteId || null,
      openCount: (a.findings || []).filter((f) => f.status !== 'fixed' && f.status !== 'wontfix').length,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}
