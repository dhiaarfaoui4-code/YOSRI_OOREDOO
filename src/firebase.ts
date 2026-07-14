import { Item, Sale, OtherIncome, Debt, CardStockEntry, Expense, ForfaitPlan, ForfaitBalance, AuditLogEntry } from './types';

export const FIREBASE_URL = 'https://boutique-4f915-default-rtdb.europe-west1.firebasedatabase.app';
export const FIREBASE_API_KEY = 'AIzaSyB1ZKcYdZtv1pDlwizYFrtQp14xzHBDEYg';
export const MANAGER_AUTH_EMAIL = 'admin@yosri-boutique.local';
const MANAGER_REFRESH_KEY = 'yosri_mgr_rt_v1';
const OUTBOX_KEY = 'yosri_outbox_v1';

export let idToken: string | null = null;
let refreshTokenVal: string | null = null;

// Convert PIN to password (min 6 chars)
export function pinToAuthPassword(pin: string): string {
  let p = String(pin);
  while (p.length < 6) p += '0';
  return p;
}

export function dbUrl(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return FIREBASE_URL + path + (idToken ? sep + 'auth=' + encodeURIComponent(idToken) : '');
}

// Ensure Auth Token
export async function ensureAuth(retries = 3): Promise<boolean> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.idToken) {
          idToken = data.idToken;
          refreshTokenVal = data.refreshToken;
          scheduleTokenRefresh(parseInt(data.expiresIn || '3600'));
          return true;
        }
      }
    } catch (e) {
      console.error('Anonymous auth attempt failed:', e);
    }
    await new Promise(res => setTimeout(res, 800 * (attempt + 1)));
  }
  return false;
}

function scheduleTokenRefresh(expiresInSeconds: number) {
  const refreshInMs = Math.max((expiresInSeconds - 300), 60) * 1000;
  setTimeout(refreshIdToken, refreshInMs);
}

async function refreshIdToken() {
  if (!refreshTokenVal) return;
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshTokenVal)}`
    });
    const data = await res.json();
    if (data.id_token) {
      idToken = data.id_token;
      refreshTokenVal = data.refresh_token;
      scheduleTokenRefresh(parseInt(data.expires_in || '3600'));
    }
  } catch (e) {
    console.error('Token refresh failed:', e);
  }
}

// Manager Sign In
export async function signInManager(pin: string): Promise<boolean> {
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: MANAGER_AUTH_EMAIL, password: pinToAuthPassword(pin), returnSecureToken: true })
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.idToken) return false;
    idToken = data.idToken;
    refreshTokenVal = data.refreshToken;
    scheduleTokenRefresh(parseInt(data.expiresIn || '3600'));
    try { sessionStorage.setItem(MANAGER_REFRESH_KEY, refreshTokenVal); } catch (e) {}
    return true;
  } catch (e) {
    return false;
  }
}

// Resume Manager Session
export async function resumeManagerSession(): Promise<boolean> {
  let savedRefresh: string | null = null;
  try { savedRefresh = sessionStorage.getItem(MANAGER_REFRESH_KEY); } catch (e) {}
  if (!savedRefresh) return false;
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(savedRefresh)}`
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.id_token) return false;
    idToken = data.id_token;
    refreshTokenVal = data.refresh_token;
    scheduleTokenRefresh(parseInt(data.expires_in || '3600'));
    try { sessionStorage.setItem(MANAGER_REFRESH_KEY, refreshTokenVal); } catch (e) {}
    return true;
  } catch (e) {
    return false;
  }
}

// Reset credentials to Anonymous Auth immediately (Security Fix 4)
export async function logoutManager(): Promise<void> {
  try {
    sessionStorage.removeItem(MANAGER_REFRESH_KEY);
    idToken = null;
    refreshTokenVal = null;
    await ensureAuth();
  } catch (e) {
    console.error('Logout error:', e);
  }
}

// Securely verify manager pin via Firebase Auth without exposing any hash to client
export async function verifyManagerPinViaAuth(pin: string): Promise<boolean> {
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: MANAGER_AUTH_EMAIL, password: pinToAuthPassword(pin), returnSecureToken: false })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// Securely update manager pin/password in Firebase Auth
export async function updateManagerPinViaAuth(newPin: string): Promise<boolean> {
  if (!idToken) return false;
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        password: pinToAuthPassword(newPin),
        returnSecureToken: true
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.idToken) {
        idToken = data.idToken;
        refreshTokenVal = data.refreshToken;
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

// Fetch helper with retries
export async function fetchJsonWithRetry(path: string, tries = 3): Promise<any> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const r = await fetch(dbUrl(path));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (attempt < tries - 1) {
        await new Promise(res => setTimeout(res, 600 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ---- Optimistic Concurrency Control (Fix 1: CORS ETag Fallback for Chrome) ----
export async function safeDecrementItemQty(itemId: string, amount: number, maxRetries = 6): Promise<{ success: boolean; newQty?: number; reason?: string; available?: number }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let currentQty: any, etag: string | null = null;
    try {
      const getRes = await fetch(dbUrl('/items/' + itemId + '/qty.json'), {
        headers: { 'X-Firebase-ETag': 'true' }
      });
      etag = getRes.headers.get('ETag');
      currentQty = await getRes.json();
    } catch (e) {
      return { success: false, reason: 'network' };
    }
    if (typeof currentQty !== 'number') {
      return { success: false, reason: 'notfound' };
    }
    if (currentQty < amount) {
      return { success: false, reason: 'insufficient', available: currentQty };
    }
    const newQty = currentQty - amount;
    
    try {
      // Fix 1: If ETag is null or not exposed (due to Chrome CORS settings), perform standard PUT as fallback
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (etag) {
        headers['if-match'] = etag;
      }
      
      const putRes = await fetch(dbUrl('/items/' + itemId + '/qty.json'), {
        method: 'PUT',
        headers,
        body: JSON.stringify(newQty)
      });
      
      if (putRes.status === 200) {
        return { success: true, newQty };
      }
      // If status is 412, someone modified it in between, loop again
    } catch (e) {
      return { success: false, reason: 'network' };
    }
  }
  return { success: false, reason: 'conflict' };
}

export async function safeIncrementItemQty(itemId: string, amount: number, maxRetries = 6): Promise<{ success: boolean; newQty?: number; reason?: string }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let currentQty: any, etag: string | null = null;
    try {
      const getRes = await fetch(dbUrl('/items/' + itemId + '/qty.json'), {
        headers: { 'X-Firebase-ETag': 'true' }
      });
      etag = getRes.headers.get('ETag');
      currentQty = await getRes.json();
    } catch (e) {
      return { success: false, reason: 'network' };
    }
    if (typeof currentQty !== 'number') {
      return { success: false, reason: 'notfound' };
    }
    const newQty = currentQty + amount;
    
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (etag) {
        headers['if-match'] = etag;
      }
      const putRes = await fetch(dbUrl('/items/' + itemId + '/qty.json'), {
        method: 'PUT',
        headers,
        body: JSON.stringify(newQty)
      });
      if (putRes.status === 200) {
        return { success: true, newQty };
      }
    } catch (e) {
      return { success: false, reason: 'network' };
    }
  }
  return { success: false, reason: 'conflict' };
}

// ---- Offline Outbox Queue ----
export interface OutboxEntry {
  id: string;
  path: string;
  payload: any;
  createdAt: number;
}

export function loadOutbox(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function saveOutboxList(list: OutboxEntry[]) {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
  } catch (e) {}
}

export function addToOutbox(path: string, payload: any): string {
  const list = loadOutbox();
  const entryId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  list.push({ id: entryId, path, payload, createdAt: Date.now() });
  // Max 500 entries to prevent memory leak
  while (list.length > 500) list.shift();
  saveOutboxList(list);
  return entryId;
}

export function removeFromOutbox(entryId: string) {
  saveOutboxList(loadOutbox().filter(e => e.id !== entryId));
}

export async function tryPutRemote(path: string, payload: any): Promise<boolean> {
  try {
    const r = await fetch(dbUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

export async function putWithOutbox(path: string, payload: any): Promise<boolean> {
  const entryId = addToOutbox(path, payload);
  const ok = await tryPutRemote(path, payload);
  if (ok) removeFromOutbox(entryId);
  return ok;
}

export async function flushOutbox(onSuccess?: (count: number) => void): Promise<void> {
  const list = loadOutbox();
  if (list.length === 0) return;
  let sentCount = 0;
  for (const entry of list) {
    const ok = await tryPutRemote(entry.path, entry.payload);
    if (ok) {
      removeFromOutbox(entry.id);
      sentCount++;
    }
  }
  if (sentCount > 0 && onSuccess) {
    onSuccess(sentCount);
  }
}
