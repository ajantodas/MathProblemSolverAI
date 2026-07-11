// Mimics the window.storage API available inside Claude.ai artifacts,
// backed by the browser's localStorage so the same App.jsx code works here.
// NOTE: localStorage is per-browser, not shared across devices/users.
// For a real multi-user deployed app, swap this for calls to your own
// backend + database (Postgres, etc.) instead.

function scopePrefix(shared) {
  return shared ? "shared::" : "local::";
}

const storage = {
  async get(key, shared = false) {
    const raw = localStorage.getItem(scopePrefix(shared) + key);
    if (raw === null) return null;
    return { key, value: raw, shared };
  },
  async set(key, value, shared = false) {
    localStorage.setItem(scopePrefix(shared) + key, value);
    return { key, value, shared };
  },
  async delete(key, shared = false) {
    localStorage.removeItem(scopePrefix(shared) + key);
    return { key, deleted: true, shared };
  },
  async list(prefix = "", shared = false) {
    const sp = scopePrefix(shared);
    const keys = Object.keys(localStorage)
      .filter((k) => k.startsWith(sp + prefix))
      .map((k) => k.slice(sp.length));
    return { keys, prefix, shared };
  },
};

if (typeof window !== "undefined") {
  window.storage = storage;
}

export default storage;
