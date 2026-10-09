// Sync through one JSON file in a private GitHub repository (REST "contents" API).
//
// Each sync downloads the file, merges it with local data (store.mergeDocs), and uploads
// the result if anything changed. Every upload is a commit, so the repository's history
// is also a version history of the log.

import * as store from './store.js';

const API = 'https://api.github.com';
const DEBOUNCE_MS = 5000;
const POLL_MS = 3 * 60 * 1000;

let state = 'off';        // off | synced | pending | syncing | offline | error
let timer = null;
let running = null;
let rerun = false;
const listeners = new Set();

export const onChange = (fn) => listeners.add(fn);
export const getState = () => state;

function set(s) {
  state = s;
  listeners.forEach((fn) => fn(s));
}

class SyncError extends Error {
  constructor(message, { status, conflict = false } = {}) {
    super(message);
    this.status = status;
    this.conflict = conflict;
  }
}

// ------------------------------------------------------------------ GitHub API

async function request(cfg, path, opts = {}) {
  try {
    return await fetch(API + path, {
      ...opts,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...opts.headers,
      },
    });
  } catch {
    throw new SyncError('You’re offline.', { status: 0 });
  }
}

const body = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

function explain(res, data) {
  if (res.status === 401) return 'GitHub rejected the token. It may have expired: paste a new one in Settings → Sync.';
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') return 'GitHub’s rate limit was reached. Sync will retry later.';
  if (res.status === 403) return 'The token can’t write to this repository. Give it “Contents: Read and write” permission for it.';
  if (res.status === 404) return 'Repository not found, or the token has no access to it.';
  return `GitHub error ${res.status}${data?.message ? `: ${data.message}` : ''}`;
}

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

const filePath = (cfg) => `/repos/${cfg.repo}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;

/** → { doc, sha }, or null when the file doesn't exist yet. */
async function readRemote(cfg) {
  const res = await request(cfg, filePath(cfg));
  if (res.status === 404) {
    // Missing file (first sync, or an empty repository) — unless the repository itself is gone.
    const repo = await request(cfg, `/repos/${cfg.repo}`);
    if (repo.ok) return null;
    throw new SyncError(explain(repo, await body(repo)), { status: repo.status });
  }
  if (!res.ok) throw new SyncError(explain(res, await body(res)), { status: res.status });
  const meta = await res.json();
  let text;
  if (meta.encoding === 'base64' && meta.content) {
    text = fromBase64(meta.content);
  } else {
    // Files over 1 MB come without inline content.
    const raw = await request(cfg, filePath(cfg), { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!raw.ok) throw new SyncError(explain(raw, await body(raw)), { status: raw.status });
    text = await raw.text();
  }
  try {
    return { doc: JSON.parse(text), sha: meta.sha };
  } catch {
    throw new SyncError(`The sync file in ${cfg.repo} is damaged (not valid JSON).`);
  }
}

async function writeRemote(cfg, doc, sha) {
  const res = await request(cfg, filePath(cfg), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Sync from ${deviceName()}`,
      content: toBase64(JSON.stringify(doc, null, 1)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (res.ok) return;
  const data = await body(res);
  // Someone else wrote the file since we read it: read, merge and try again.
  if (res.status === 409 || (res.status === 422 && /sha/i.test(data?.message ?? ''))) {
    throw new SyncError('conflict', { status: res.status, conflict: true });
  }
  throw new SyncError(explain(res, data), { status: res.status });
}

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'a browser';
}

// ------------------------------------------------------------------ sync cycle

export function syncNow() {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    const cfg = store.syncConfig();
    if (!cfg) return set('off');
    if (!navigator.onLine) return set('offline');
    clearTimeout(timer);
    set('syncing');
    try {
      for (let attempt = 1; ; attempt++) {
        const remote = await readRemote(cfg);
        const editsAtMerge = store.editCount();
        const merged = store.absorb(remote?.doc);
        try {
          if (!remote || !store.sameContent(merged, remote.doc)) await writeRemote(cfg, merged, remote?.sha);
          store.markSynced(editsAtMerge);
          break;
        } catch (e) {
          if (!e.conflict || attempt >= 4) throw e;
        }
      }
      set(store.syncConfig()?.dirty ? 'pending' : 'synced');
    } catch (e) {
      if (e.status === 0) {
        set('offline');
      } else {
        store.updateSyncState({ lastError: e.message });
        set('error');
      }
    } finally {
      running = null;
      // More edits arrived while syncing.
      if (rerun || (state === 'pending' && store.syncConfig()?.dirty)) {
        rerun = false;
        schedule(1000);
      }
    }
  })();
  return running;
}

export function schedule(delay = DEBOUNCE_MS) {
  if (!store.syncConfig()) return;
  clearTimeout(timer);
  if (state !== 'syncing') set(navigator.onLine ? 'pending' : 'offline');
  timer = setTimeout(syncNow, delay);
}

/** Validates the repository and token, saves them, and runs the first sync. */
export async function connect({ repo, token }) {
  repo = repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  token = token.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Enter the repository as owner/name, for example octocat/project-log-data.');
  if (!token) throw new Error('Paste your access token.');
  const cfg = { repo, token, path: 'project-log.json' };
  const res = await request(cfg, `/repos/${repo}`);
  if (!res.ok) throw new Error(explain(res, await body(res)));
  if (!(await res.json()).private) {
    throw new Error('That repository is public, so anyone could read your log. Use a private repository.');
  }
  store.setSyncConfig(cfg);
  await syncNow();
  if (state === 'error' || state === 'offline') {
    const msg = store.syncConfig()?.lastError ?? 'You’re offline.';
    disconnect();
    throw new Error(msg);
  }
}

export function disconnect() {
  clearTimeout(timer);
  store.setSyncConfig(null);
  set('off');
}

export function init() {
  store.subscribe((reason) => {
    if (reason === 'edit') schedule();
  });
  document.addEventListener('visibilitychange', () => {
    if (!store.syncConfig()) return;
    // Push pending edits before the app is backgrounded; pull when it comes back.
    if (!document.hidden || store.syncConfig().dirty) syncNow();
  });
  window.addEventListener('online', () => store.syncConfig() && syncNow());
  window.addEventListener('offline', () => store.syncConfig() && set('offline'));
  setInterval(() => {
    if (!document.hidden && store.syncConfig()) syncNow();
  }, POLL_MS);
  if (store.syncConfig()) {
    set(store.syncConfig().dirty ? 'pending' : 'synced');
    syncNow();
  }
}
