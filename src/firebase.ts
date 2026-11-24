import { Item, Sale, OtherIncome, Debt, CardStockEntry, Expense, ForfaitPlan, ForfaitBalance, AuditLogEntry, PendingSale , PendingDeleteHistorySale } from './types';

export const FIREBASE_URL = 'https://boutique-4f915-default-rtdb.europe-west1.firebasedatabase.app';
export const FIREBASE_API_KEY = 'AIzaSyB1ZKcYdZtv1pDlwizYFrtQp14xzHBDEYg';
export const MANAGER_AUTH_EMAIL = 'admin@yosri-boutique.local';
const MANAGER_REFRESH_KEY = 'yosri_mgr_rt_v1';
const OUTBOX_KEY = 'yosri_outbox_v1';
const PENDING_SALES_KEY = 'yosri_pending_sales_v1';
const PENDING_DEBT_PAYMENTS_KEY = 'yosri_pending_debt_payments_v1';
const PENDING_DELETE_DEBTS_KEY = 'yosri_pending_delete_debts_v1';

export let idToken: string | null = null;
let refreshTokenVal: string | null = null;
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;

function roundTND(val: number): number {
  return Math.round((val + Number.EPSILON) * 1000) / 1000;
}

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
export async function ensureAuth(retries = 2): Promise<boolean> {
  if (idToken) return true;
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
    } catch (e: any) {
      console.warn('Anonymous auth note (continuing in local/offline mode):', e?.message || e);
    }
    if (attempt < retries - 1) {
      await new Promise(res => setTimeout(res, 500 * (attempt + 1)));
    }
  }
  return false;
}

function scheduleTokenRefresh(expiresInSeconds: number) {
  if (refreshTimerId) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }
  const safeExpires = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 3600;
  const refreshInMs = Math.max((safeExpires - 300), 60) * 1000;
  refreshTimerId = setTimeout(refreshIdToken, refreshInMs);
}

async function refreshIdToken() {
  if (!refreshTokenVal) return;
  try {
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshTokenVal)}`
    });
    if (!res.ok) {
      console.warn('Token refresh HTTP error:', res.status);
      return;
    }
    const data = await res.json();
    if (data.id_token) {
      idToken = data.id_token;
      refreshTokenVal = data.refresh_token || refreshTokenVal;
      try {
        if (sessionStorage.getItem(MANAGER_REFRESH_KEY) && refreshTokenVal) {
          sessionStorage.setItem(MANAGER_REFRESH_KEY, refreshTokenVal);
        }
      } catch (e) {}
      scheduleTokenRefresh(parseInt(data.expires_in || '3600', 10));
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
    if (refreshTimerId) {
      clearTimeout(refreshTimerId);
      refreshTimerId = null;
    }
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
        refreshTokenVal = data.refreshToken || refreshTokenVal;
        if (refreshTokenVal) {
          try { sessionStorage.setItem(MANAGER_REFRESH_KEY, refreshTokenVal); } catch (e) {}
        }
        scheduleTokenRefresh(parseInt(data.expiresIn || '3600', 10));
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

// ---- Optimistic Concurrency Control with Offline Outbox Fallback ----

export async function safeAtomicUpdate(
  path: string,
  payload: number | Record<string, number>,
  method: 'INCREMENT' | 'DECREMENT',
  fallbackCurrentQty?: number,
  maxRetries = 6,
  allowNegative = false,
  opId?: string,
  dependsOn?: string
): Promise<{ success: boolean; pending: boolean; newQty?: number; reason?: string; available?: number }> {
  const finalOpId = opId || ('op_' + Date.now() + Math.random().toString(36).substring(2));
  
  const res = await tryPutRemote(path, payload, method, maxRetries, allowNegative, finalOpId);
  
  if (res === true) {
     return { success: true, pending: false };
  } else if (typeof res === 'object' && res !== null && 'error' in res) {
     if (res.error && res.error.startsWith('insufficient')) {
        return { success: false, pending: false, reason: 'insufficient', available: res.available };
     }
     if (res.error === 'not_found') {
        return { success: false, pending: false, reason: 'not_found' };
     }
     return { success: false, pending: false, reason: res.error };
  }
  
  // Network failed or offline. Add to outbox!
  const entryId = addToOutbox(path, payload, method, finalOpId, dependsOn);
  if (!entryId) {
     return { success: false, pending: false, reason: 'outbox_full' };
  }
  return { success: true, pending: true };
}

export async function safeDecrementItemQty(itemId: string, amount: number, fallbackCurrentQty?: number, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/items/${itemId}.json`, amount, 'DECREMENT', fallbackCurrentQty, maxRetries, false, opId, dependsOn);
}
export async function safeIncrementItemQty(itemId: string, amount: number, fallbackCurrentQty?: number, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/items/${itemId}.json`, amount, 'INCREMENT', fallbackCurrentQty, maxRetries, true, opId, dependsOn);
}
export async function safeDecrementCardQty(cardId: string, amount: number, fallbackCurrentQty?: number, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/cardStock/${cardId}.json`, amount, 'DECREMENT', fallbackCurrentQty, maxRetries, false, opId, dependsOn);
}
export async function safeIncrementCardQty(cardId: string, amount: number, fallbackCurrentQty?: number, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/cardStock/${cardId}.json`, amount, 'INCREMENT', fallbackCurrentQty, maxRetries, true, opId, dependsOn);
}
export async function safeDecrementPhotoStock(amount: number, fallbackCurrentQty?: number, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/photoPaperStock.json`, amount, 'DECREMENT', fallbackCurrentQty, maxRetries, false, opId, dependsOn);
}
export async function safeIncrementPhotoStock(amount: number, fallbackCurrentQty?: number, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/photoPaperStock.json`, amount, 'INCREMENT', fallbackCurrentQty, maxRetries, true, opId, dependsOn);
}
export async function safeDecrementForfait(payload: Record<string, number>, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/forfaitBalance.json`, payload, 'DECREMENT', undefined, maxRetries, false, opId, dependsOn);
}
export async function safeIncrementForfait(payload: Record<string, number>, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/forfaitBalance.json`, payload, 'INCREMENT', undefined, maxRetries, true, opId, dependsOn);
}
export async function safeIncrementSparePartQty(id: string, delta: number, unitCost: number, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/spareParts/${id}.json`, { qty: delta, totalCost: delta * unitCost }, 'INCREMENT', undefined, maxRetries, true, opId, dependsOn);
}
export async function safeDecrementSparePartQty(id: string, delta: number, unitCost: number, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/spareParts/${id}.json`, { qty: delta, totalCost: delta * unitCost }, 'DECREMENT', undefined, maxRetries, false, opId, dependsOn);
}
export async function safeIncrementDebtPaid(id: string, amount: number, maxRetries = 6, opId?: string, dependsOn?: string) {
  return safeAtomicUpdate(`/debts/${id}.json`, { paid: amount }, 'INCREMENT', undefined, maxRetries, true, opId, dependsOn);
}

// ---- Offline Outbox Queue ----
export interface OutboxEntry {
  id: string;
  path: string;
  payload: any;
  method?: 'PUT' | 'PATCH' | 'INCREMENT' | 'DECREMENT';
  createdAt: number;
  opId?: string;
  dependsOn?: string;
  status?: 'pending' | 'failed' | 'synced';
  error?: string;
  reason?: string;
}

type OutboxChangeListener = (count: number) => void;
const outboxListeners: OutboxChangeListener[] = [];

export function subscribeOutboxChange(listener: OutboxChangeListener): () => void {
  outboxListeners.push(listener);
  try { listener(loadOutbox().length); } catch (e) {}
  return () => {
    const idx = outboxListeners.indexOf(listener);
    if (idx >= 0) outboxListeners.splice(idx, 1);
  };
}
function notifyOutboxChange() {
  const count = loadOutbox().length;
  outboxListeners.forEach(l => {
    try { l(count); } catch (e) {}
  });
}
export function loadOutbox(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}
export function saveOutboxList(list: OutboxEntry[]): boolean {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(list));
    const readBack = localStorage.getItem(OUTBOX_KEY);
    if (!readBack) return false;
    notifyOutboxChange();
    return true;
  } catch (e) {
    return false;
  }
}
export function addToOutbox(
  path: string, 
  payload: any, 
  method: 'PUT' | 'PATCH' | 'INCREMENT' | 'DECREMENT' = 'PUT', 
  opId?: string,
  dependsOn?: string
): string | null {
  const list = loadOutbox();

  if (opId) {
    const existing = list.find(e => e.opId === opId && e.method === method && e.path === path);
    if (existing) {
      return existing.id;
    }
  }

  if (list.length >= 500) {
    return null; // Do not silently drop. Refuse new entries.
  }
  const entryId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  list.push({ 
    id: entryId, 
    path, 
    payload, 
    method, 
    createdAt: Date.now(), 
    opId: opId || entryId, 
    dependsOn: dependsOn || undefined,
    status: 'pending' 
  });
  if (saveOutboxList(list)) {
    return entryId;
  }
  return null;
}
export function removeFromOutbox(entryId: string) {
  saveOutboxList(loadOutbox().filter(e => e.id !== entryId));
}
export function updateOutboxEntry(entryId: string, updates: Partial<OutboxEntry>) {
  const list = loadOutbox();
  const idx = list.findIndex(e => e.id === entryId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...updates };
    saveOutboxList(list);
  }
}
export function clearOutboxForPaths(prefixes: string[]) {
  const list = loadOutbox().filter(e => !prefixes.some(p => e.path.startsWith(p)));
  saveOutboxList(list);
}

export async function tryPutRemote(
  path: string, 
  payload: any, 
  method: 'PUT' | 'PATCH' | 'INCREMENT' | 'DECREMENT' = 'PUT', 
  retries = 6, 
  allowNegative = false, 
  opId?: string
): Promise<boolean | { error: string; available?: number }> {
  if (method === 'INCREMENT' || method === 'DECREMENT') {
    if (!opId) opId = 'op_sys_' + Date.now() + Math.random().toString(36).substring(2);

    const isPhoto = path === '/photoPaperStock.json' || path.startsWith('/photoPaperStock');

    for (let attempt = 0; attempt < retries; attempt++) {
      let currentObj: any = null;
      let etag: string | null = null;

      try {
        const getRes = await fetch(dbUrl(path), { headers: { 'X-Firebase-ETag': 'true' } });
        if (getRes.ok) {
          etag = getRes.headers.get('ETag');
          currentObj = await getRes.json();
        } else if (getRes.status === 404) {
          currentObj = isPhoto ? { qty: 0, processedOps: {} } : null;
        } else {
          throw new Error('HTTP ' + getRes.status);
        }
      } catch (e) {
        break; 
      }

      // 1. Strict Existence Check: Prevent phantom records when document is missing
      if (currentObj === null) {
        if (path.startsWith('/debts/')) {
          // Debt was deleted or does not exist. NEVER create a new or corrupted debt object!
          return { error: 'not_found' };
        }
        if (path.startsWith('/items/') || path.startsWith('/cardStock/') || path.startsWith('/spareParts/')) {
          if (method === 'DECREMENT' && !allowNegative) {
            return { error: 'insufficient', available: 0 };
          }
        }
      }

      // 2. Photo Paper Stock atomic handling (qty + processedOps in the SAME atomic document)
      let updatedObj: any;
      if (isPhoto) {
        let currentQty = 0;
        let processedOps: Record<string, number> = {};
        if (typeof currentObj === 'number') {
          currentQty = currentObj;
        } else if (currentObj && typeof currentObj === 'object') {
          currentQty = typeof currentObj.qty === 'number' ? currentObj.qty : 0;
          processedOps = currentObj.processedOps && typeof currentObj.processedOps === 'object' ? currentObj.processedOps : {};
        }

        // Idempotency check: Already processed this exact operation
        if (processedOps[opId]) {
          return true;
        }

        const delta = typeof payload === 'number' ? payload : Number(payload?.qty);
        if (!Number.isFinite(delta) || delta < 0) {
          return { error: 'invalid_amount' };
        }
        const newQty = method === 'INCREMENT' ? currentQty + delta : currentQty - delta;
        if (method === 'DECREMENT' && !allowNegative && newQty < 0) {
          return { error: 'insufficient', available: currentQty };
        }

        updatedObj = {
          qty: Math.max(0, roundTND(newQty)),
          processedOps: { ...processedOps, [opId]: Date.now() }
        };
      } else {
        // Standard object data type handling (items, cardStock, debts, forfait, spareParts)
        if (currentObj && typeof currentObj === 'object' && currentObj.processedOps && currentObj.processedOps[opId]) {
          return true; // Already processed!
        }

        // Extra check for debts to ensure it has valid debt structure
        if (path.startsWith('/debts/') && (!currentObj || typeof currentObj !== 'object' || !currentObj.customerName || currentObj.amount === undefined)) {
          return { error: 'not_found' };
        }

        updatedObj = (currentObj !== null && typeof currentObj === 'object') ? { ...currentObj } : {};

        if (typeof payload === 'number') {
          if (!Number.isFinite(payload) || payload < 0) {
            return { error: 'invalid_amount' };
          }
          const qty = typeof updatedObj.qty === 'number' ? updatedObj.qty : 0;
          const newQty = method === 'INCREMENT' ? qty + payload : qty - payload;
          if (method === 'DECREMENT' && !allowNegative && newQty < 0) {
            return { error: 'insufficient', available: qty };
          }
          updatedObj.qty = roundTND(newQty);
        } else if (typeof payload === 'object' && payload !== null) {
          if (path.startsWith('/spareParts/')) {
            const curQty = typeof updatedObj.qty === 'number' ? updatedObj.qty : 0;
            const curCost = typeof updatedObj.totalCost === 'number' ? updatedObj.totalCost : 0;
            const dQty = Number(payload.qty);
            const dCost = Number(payload.totalCost);
            if (!Number.isFinite(dQty) || !Number.isFinite(dCost)) {
              return { error: 'invalid_amount' };
            }
            const newQty = method === 'INCREMENT' ? curQty + dQty : curQty - dQty;
            const newCost = method === 'INCREMENT' ? curCost + dCost : curCost - dCost;
            if (method === 'DECREMENT' && !allowNegative && newQty < 0) {
              return { error: 'insufficient', available: curQty };
            }
            updatedObj.qty = roundTND(newQty);
            updatedObj.totalCost = Math.max(0, roundTND(newCost));
          } else if (path.startsWith('/debts/')) {
            const dPaid = Number(payload.paid);
            if (!Number.isFinite(dPaid)) {
              return { error: 'invalid_amount' };
            }
            const curPaid = typeof updatedObj.paid === 'number' ? updatedObj.paid : 0;
            const newPaid = method === 'INCREMENT' ? curPaid + dPaid : curPaid - dPaid;
            updatedObj.paid = Math.max(0, roundTND(newPaid));
            updatedObj.status = updatedObj.paid >= (updatedObj.amount || 0) - 0.001 ? 'paid' : 'open';
          } else {
            // ForfaitBalance or arbitrary key-value object
            for (const key of Object.keys(payload)) {
              const currentVal = typeof updatedObj[key] === 'number' ? updatedObj[key] : 0;
              const amt = Number(payload[key]);
              if (!Number.isFinite(amt)) {
                return { error: 'invalid_amount' };
              }
              const newVal = method === 'INCREMENT' ? currentVal + amt : currentVal - amt;
              if (method === 'DECREMENT' && !allowNegative && newVal < 0) {
                return { error: 'insufficient_' + key, available: currentVal };
              }
              updatedObj[key] = roundTND(newVal);
            }
            if (Object.prototype.hasOwnProperty.call(payload, 'Ooredoo_1005') || Object.prototype.hasOwnProperty.call(payload, 'Ooredoo_1006')) {
              updatedObj.Ooredoo = roundTND((updatedObj.Ooredoo_1005 || 0) + (updatedObj.Ooredoo_1006 || 0));
            }
          }
        }

        updatedObj.processedOps = { ...(updatedObj.processedOps || {}) };
        updatedObj.processedOps[opId] = Date.now();
      }

      // Cleanup old processedOps (> 30 days)
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      if (updatedObj.processedOps) {
        for (const key of Object.keys(updatedObj.processedOps)) {
          if (now - updatedObj.processedOps[key] > THIRTY_DAYS) {
            delete updatedObj.processedOps[key];
          }
        }
      }

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (etag) headers['if-match'] = etag;
        
        const putRes = await fetch(dbUrl(path), {
          method: 'PUT',
          headers,
          body: JSON.stringify(updatedObj)
        });
        
        if (putRes.status === 200) return true;
        // If 412 (ETag mismatch), the loop retries with fresh currentObj and ETag
      } catch (e) {
        break; 
      }
    }
    return false;
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const r = await fetch(dbUrl(path), {
        method: method === 'PATCH' ? 'PATCH' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (r.ok) return true;
    } catch (e) {
    }
    if (attempt < retries - 1) {
      await new Promise(res => setTimeout(res, 350 * (attempt + 1)));
    }
  }
  return false;
}

export async function putWithOutbox(
  path: string, 
  payload: any, 
  opId?: string, 
  dependsOn?: string
): Promise<{ success: boolean; pending: boolean }> {
  const entryId = addToOutbox(path, payload, 'PUT', opId, dependsOn);
  if (!entryId) return { success: false, pending: false };
  const ok = await tryPutRemote(path, payload, 'PUT', 6, false, opId);
  if (ok === true) {
    removeFromOutbox(entryId);
    return { success: true, pending: false };
  }
  return { success: true, pending: true };
}

export async function patchWithOutbox(
  path: string, 
  payload: any, 
  opId?: string, 
  dependsOn?: string
): Promise<{ success: boolean; pending: boolean }> {
  const entryId = addToOutbox(path, payload, 'PATCH', opId, dependsOn);
  if (!entryId) return { success: false, pending: false };
  const ok = await tryPutRemote(path, payload, 'PATCH', 6, false, opId);
  if (ok === true) {
    removeFromOutbox(entryId);
    return { success: true, pending: false };
  }
  return { success: true, pending: true };
}

export async function flushOutbox(onSuccess?: (count: number) => void): Promise<{ sent: number; remaining: number }> {
  const list = loadOutbox();
  if (list.length === 0) return { sent: 0, remaining: 0 };
  
  let sentCount = 0;
  const processedThisFlush = new Set<string>();
  const failedThisFlush = new Set<string>();

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (entry.status === 'failed' || entry.error) continue; // Skip permanently failed operations

    // 1. Explicit Dependency Check (e.g. debt payment depends on debt creation)
    if (entry.dependsOn) {
      const parentEntry = list.find(e => (e.id === entry.dependsOn || e.opId === entry.dependsOn) && e.id !== entry.id);
      if (parentEntry && !processedThisFlush.has(parentEntry.id) && !(parentEntry.opId && processedThisFlush.has(parentEntry.opId))) {
        if (parentEntry.status === 'failed' || failedThisFlush.has(parentEntry.id)) {
          // Parent failed permanently
          updateOutboxEntry(entry.id, { status: 'failed', error: 'parent_failed', reason: 'parent_failed' });
          failedThisFlush.add(entry.id);
          continue;
        }
        // Parent is still pending/in-flight; hold dependent entry for this round
        continue;
      }
    }

    // 2. Resource-level Sequential Dependency:
    // If entry is a mutation on a path and an earlier pending PUT exists for that same path
    const earlierPendingPut = list.slice(0, i).find(e => 
      e.path === entry.path && 
      e.method === 'PUT' && 
      e.id !== entry.id && 
      e.status !== 'failed' && 
      !processedThisFlush.has(e.id)
    );
    if (earlierPendingPut) {
      // Must wait for document creation to succeed first
      continue;
    }

    const res = await tryPutRemote(entry.path, entry.payload, entry.method || 'PUT', 3, false, entry.opId);
    if (res === true) {
      removeFromOutbox(entry.id);
      processedThisFlush.add(entry.id);
      if (entry.opId) processedThisFlush.add(entry.opId);
      sentCount++;
    } else if (typeof res === 'object' && res !== null && 'error' in res) {
      if (res.error === 'not_found' || res.error.startsWith('insufficient')) {
        console.error('Outbox operation failed permanently:', entry, res.error);
        updateOutboxEntry(entry.id, { status: 'failed', error: res.error, reason: res.error });
        failedThisFlush.add(entry.id);
      }
    }
  }

  if (sentCount > 0 && onSuccess) {
    onSuccess(sentCount);
  }
  const remaining = loadOutbox().length;
  notifyOutboxChange();
  return { sent: sentCount, remaining };
}

// ---- Durable Pending Sales (Crash Recovery State Machine) ----
export function loadPendingSales(): PendingSale[] {
  try {
    const raw = localStorage.getItem(PENDING_SALES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function savePendingSale(sale: PendingSale): boolean {
  try {
    const list = loadPendingSales();
    const idx = list.findIndex(s => s.transactionId === sale.transactionId);
    if (idx >= 0) {
      list[idx] = sale;
    } else {
      list.push(sale);
    }
    const serialized = JSON.stringify(list);
    localStorage.setItem(PENDING_SALES_KEY, serialized);

    // Read back and verify persistence succeeded (BUG-4B-03 prevention)
    const readBack = localStorage.getItem(PENDING_SALES_KEY);
    if (!readBack) return false;
    const parsed: PendingSale[] = JSON.parse(readBack);
    const verified = parsed.some(s => s.transactionId === sale.transactionId && s.status === sale.status);
    return verified;
  } catch (e) {
    console.error('Failed to save durable pending sale:', e);
    return false;
  }
}

export function loadPendingDebtPayments(): import('./types').PendingDebtPayment[] {
  try {
    const raw = localStorage.getItem(PENDING_DEBT_PAYMENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function savePendingDebtPayment(payment: import('./types').PendingDebtPayment): boolean {
  try {
    const list = loadPendingDebtPayments();
    const idx = list.findIndex(p => p.id === payment.id);
    if (idx >= 0) {
      list[idx] = payment;
    } else {
      list.push(payment);
    }
    const serialized = JSON.stringify(list);
    localStorage.setItem(PENDING_DEBT_PAYMENTS_KEY, serialized);

    const readBack = localStorage.getItem(PENDING_DEBT_PAYMENTS_KEY);
    if (!readBack) return false;
    const parsed = JSON.parse(readBack);
    const verified = parsed.some((p: any) => p.id === payment.id && p.status === payment.status);
    return verified;
  } catch (e) {
    console.error('Failed to save durable pending debt payment:', e);
    return false;
  }
}

export function removePendingDebtPayment(id: string): boolean {
  try {
    const list = loadPendingDebtPayments().filter(p => p.id !== id);
    localStorage.setItem(PENDING_DEBT_PAYMENTS_KEY, JSON.stringify(list));
    
    const readBack = localStorage.getItem(PENDING_DEBT_PAYMENTS_KEY);
    if (!readBack) return true;
    const parsed = JSON.parse(readBack);
    const stillExists = parsed.some((p: any) => p.id === id);
    return !stillExists;
  } catch (e) {
    console.error('Failed to remove durable pending debt payment:', e);
    return false;
  }
}

export function removePendingSale(transactionId: string): boolean {
  try {
    const list = loadPendingSales().filter(s => s.transactionId !== transactionId);
    localStorage.setItem(PENDING_SALES_KEY, JSON.stringify(list));
    
    // Verify deletion
    const readBack = localStorage.getItem(PENDING_SALES_KEY);
    if (!readBack) return true; // If somehow entirely empty, it's deleted.
    const parsed: PendingSale[] = JSON.parse(readBack);
    const stillExists = parsed.some(s => s.transactionId === transactionId);
    return !stillExists;
  } catch (e) {
    console.error('Failed to remove durable pending sale:', e);
    return false;
  }
}


export function loadPendingDeleteDebts(): import('./types').PendingDeleteDebt[] {
  try {
    const raw = localStorage.getItem(PENDING_DELETE_DEBTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

export function savePendingDeleteDebt(deletion: import('./types').PendingDeleteDebt): boolean {
  try {
    const list = loadPendingDeleteDebts();
    const idx = list.findIndex(d => d.id === deletion.id);
    if (idx >= 0) {
      list[idx] = deletion;
    } else {
      list.push(deletion);
    }
    const serialized = JSON.stringify(list);
    localStorage.setItem(PENDING_DELETE_DEBTS_KEY, serialized);

    const readBack = localStorage.getItem(PENDING_DELETE_DEBTS_KEY);
    if (!readBack) return false;
    const parsed = JSON.parse(readBack);
    return parsed.some((d: any) => d.id === deletion.id && d.status === deletion.status);
  } catch (e) {
    console.error('Failed to save durable pending delete debt:', e);
    return false;
  }
}

export function removePendingDeleteDebt(id: string): boolean {
  try {
    const list = loadPendingDeleteDebts().filter(d => d.id !== id);
    localStorage.setItem(PENDING_DELETE_DEBTS_KEY, JSON.stringify(list));
    
    const readBack = localStorage.getItem(PENDING_DELETE_DEBTS_KEY);
    if (!readBack) return true;
    const parsed = JSON.parse(readBack);
    return !parsed.some((d: any) => d.id === id);
  } catch (e) {
    console.error('Failed to remove durable pending delete debt:', e);
    return false;
  }
}


const PENDING_DELETE_HISTORY_SALE_KEY = 'yosri_pending_delete_history_sale_v1';

export const loadPendingDeleteHistorySales = (): PendingDeleteHistorySale[] => {
  try {
    const raw = localStorage.getItem(PENDING_DELETE_HISTORY_SALE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Error loading pending delete history sales:', e);
    return [];
  }
};

export const savePendingDeleteHistorySale = (sale: PendingDeleteHistorySale): boolean => {
  try {
    const list = loadPendingDeleteHistorySales();
    const existingIdx = list.findIndex(s => s.id === sale.id);
    if (existingIdx >= 0) {
      list[existingIdx] = sale;
    } else {
      list.push(sale);
    }
    const serialized = JSON.stringify(list);
    localStorage.setItem(PENDING_DELETE_HISTORY_SALE_KEY, serialized);
    const readBack = localStorage.getItem(PENDING_DELETE_HISTORY_SALE_KEY);
    return readBack === serialized;
  } catch (e) {
    console.error('Error saving pending delete history sale:', e);
    return false;
  }
};

export const removePendingDeleteHistorySale = (id: string): boolean => {
  try {
    const list = loadPendingDeleteHistorySales();
    const filtered = list.filter(s => s.id !== id);
    localStorage.setItem(PENDING_DELETE_HISTORY_SALE_KEY, JSON.stringify(filtered));
    const readBack = localStorage.getItem(PENDING_DELETE_HISTORY_SALE_KEY);
    if (!readBack) return true;
    const parsed = JSON.parse(readBack);
    return !parsed.some((s: any) => s.id === id);
  } catch (e) {
    console.error('Error removing pending delete history sale:', e);
    return false;
  }
};
