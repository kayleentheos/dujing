// Storage adapter.
// Personal data lives in the artifact's private per-user database
// (data/users/<id>/...) when the hosted runtime offers it; every value is
// also mirrored in localStorage so the page paints instantly and still works
// offline or outside the host. Callers only see an async key/value + simple
// collection API, so the backend can change without touching the views.

const LS_PREFIX = "dujing:";
const ls = {
  get(k) { try { const v = localStorage.getItem(LS_PREFIX + k); return v == null ? undefined : JSON.parse(v); } catch { return undefined; } },
  set(k, v) { try { localStorage.setItem(LS_PREFIX + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(LS_PREFIX + k); } catch { } },
};

let db = null, uid = null, ready = null;
const listeners = new Set();
export const status = { backend: "local", note: "" };

function emit() { listeners.forEach(fn => fn(status)); }
export function onStatus(fn) { listeners.add(fn); fn(status); return () => listeners.delete(fn); }

export function init() {
  if (ready) return ready;
  ready = (async () => {
    const c = globalThis.claude;
    if (!c || typeof c.use !== "function") { status.note = "Saved in this browser."; emit(); return; }
    try {
      const timeout = new Promise(r => setTimeout(() => r(null), 8000));
      const [d, u] = await Promise.race([Promise.all([c.use("db"), c.use("user")]), timeout.then(() => [null, null])]);
      const id = u && typeof u.id === "function" ? await u.id() : null;
      if (d && id) {
        db = d; uid = String(id);
        status.backend = "cloud"; status.note = "Synced to your account.";
        await pullAll();
      } else {
        status.note = "Saved in this browser.";
      }
    } catch (e) {
      status.note = "Saved in this browser.";
    }
    emit();
  })();
  return ready;
}

// ---- documents (one JSON object per name) ---------------------------------
const docRef = name => db.doc(`data/users/${uid}/${name}`);
const pending = new Map();      // name -> latest value waiting to be written
const writing = new Set();

export function getDoc(name, fallback = {}) {
  const v = ls.get("doc:" + name);
  return v === undefined ? structuredClone(fallback) : v;
}

export function setDoc(name, value) {
  ls.set("doc:" + name, value);
  if (!db) return;
  pending.set(name, value);
  flushSoon(name);
}

const timers = new Map();
function flushSoon(name) {
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => flush(name), 700));   // coalesce bursts
}
async function flush(name) {
  if (writing.has(name) || !pending.has(name)) return;
  const value = pending.get(name); pending.delete(name);
  writing.add(name);
  try { await docRef(name).set(JSON.parse(JSON.stringify(value))); }
  catch (e) { if (e && e.code === "unavailable") pending.has(name) || pending.set(name, value); }
  finally { writing.delete(name); if (pending.has(name)) flushSoon(name); }
}

// ---- collections (many small records, e.g. notes, saved words) ---------
const collRef = name => db.doc(`data/users/${uid}/coll-${name}`).collection("items");

export function list(name) { return Object.values(ls.get("coll:" + name) || {}); }
export function getItem(name, id) { return (ls.get("coll:" + name) || {})[id]; }

export async function putItem(name, id, value) {
  const all = ls.get("coll:" + name) || {};
  all[id] = value; ls.set("coll:" + name, all);
  if (db) { try { await collRef(name).doc(safeId(id)).set(JSON.parse(JSON.stringify(value))); } catch { } }
}
export async function removeItem(name, id) {
  const all = ls.get("coll:" + name) || {};
  delete all[id]; ls.set("coll:" + name, all);
  if (db) { try { await collRef(name).doc(safeId(id)).delete(); } catch { } }
}
const safeId = id => String(id).replace(/[^A-Za-z0-9_.~:@+-]/g, c => "-" + c.codePointAt(0).toString(16));

// On start, bring the cloud copy into the local mirror (cloud wins).
const DOCS = ["prefs", "progress"];
const COLLS = [];          // registered by features (Phase 3/4)
export function registerCollection(name) { if (!COLLS.includes(name)) COLLS.push(name); }

async function pullAll() {
  for (const name of DOCS) {
    try {
      const snap = await docRef(name).get();
      if (snap.exists) ls.set("doc:" + name, snap.data());
      else { const local = ls.get("doc:" + name); if (local) await docRef(name).set(local); }
    } catch { }
  }
  for (const name of COLLS) {
    try {
      const snap = await collRef(name).get();
      const local = ls.get("coll:" + name) || {};
      const merged = {};
      snap.docs.forEach(d => { const v = d.data(); if (v && v.id) merged[v.id] = v; });
      for (const [id, v] of Object.entries(local)) if (!merged[id]) { merged[id] = v; await collRef(name).doc(safeId(id)).set(v); }
      ls.set("coll:" + name, merged);
    } catch { }
  }
}
export function registerDoc(name) { if (!DOCS.includes(name)) DOCS.push(name); }
