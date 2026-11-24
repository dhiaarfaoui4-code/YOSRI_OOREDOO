const fs = require('fs');
const content = fs.readFileSync('src/firebase.ts', 'utf8');

const regex = /\/\/ ---- Optimistic Concurrency Control with Offline Outbox Fallback ----[\s\S]*?(?=\/\/ ---- Offline Outbox Queue ----)/;
const replacement = `// ---- Optimistic Concurrency Control with Offline Outbox Fallback ----

async function safeAtomicUpdate(
  path: string,
  amount: number,
  method: 'INCREMENT' | 'DECREMENT',
  fallbackCurrentQty?: number,
  maxRetries = 6,
  allowNegative = false
): Promise<{ success: boolean; newQty?: number; reason?: string; available?: number; pending?: boolean }> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let currentQty: any, etag: string | null = null;
    try {
      const getRes = await fetch(dbUrl(path), {
        headers: { 'X-Firebase-ETag': 'true' }
      });
      if (getRes.ok) {
        etag = getRes.headers.get('ETag');
        currentQty = await getRes.json();
      } else {
        throw new Error('HTTP ' + getRes.status);
      }
    } catch (e) {
      if (typeof fallbackCurrentQty === 'number') {
        if (method === 'DECREMENT' && !allowNegative && fallbackCurrentQty < amount) {
          return { success: false, reason: 'insufficient', available: fallbackCurrentQty };
        }
        const newQty = method === 'INCREMENT' ? fallbackCurrentQty + amount : fallbackCurrentQty - amount;
        addToOutbox(path, amount, method);
        return { success: true, newQty, pending: true };
      }
      return { success: false, reason: 'network' };
    }

    if (typeof currentQty !== 'number') {
      currentQty = 0;
    }

    if (method === 'DECREMENT' && !allowNegative && currentQty < amount) {
      return { success: false, reason: 'insufficient', available: currentQty };
    }

    const newQty = method === 'INCREMENT' ? currentQty + amount : currentQty - amount;
    
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (etag) headers['if-match'] = etag;
      
      const putRes = await fetch(dbUrl(path), {
        method: 'PUT',
        headers,
        body: JSON.stringify(newQty)
      });
      
      if (putRes.status === 200) {
        return { success: true, newQty };
      }
    } catch (e) {
      addToOutbox(path, amount, method);
      return { success: true, newQty, pending: true };
    }
  }

  if (typeof fallbackCurrentQty === 'number') {
    if (method === 'DECREMENT' && !allowNegative && fallbackCurrentQty < amount) {
      return { success: false, reason: 'insufficient', available: fallbackCurrentQty };
    }
    const newQty = method === 'INCREMENT' ? fallbackCurrentQty + amount : fallbackCurrentQty - amount;
    addToOutbox(path, amount, method);
    return { success: true, newQty, pending: true };
  }
  return { success: false, reason: 'conflict' };
}

export async function safeDecrementItemQty(itemId: string, amount: number, fallbackCurrentQty?: number, maxRetries = 6) {
  return safeAtomicUpdate(\`/items/\${itemId}/qty.json\`, amount, 'DECREMENT', fallbackCurrentQty, maxRetries, false);
}

export async function safeIncrementItemQty(itemId: string, amount: number, fallbackCurrentQty?: number, maxRetries = 6) {
  return safeAtomicUpdate(\`/items/\${itemId}/qty.json\`, amount, 'INCREMENT', fallbackCurrentQty, maxRetries, true);
}

export async function safeDecrementCardQty(cardId: string, amount: number, fallbackCurrentQty?: number, maxRetries = 6) {
  return safeAtomicUpdate(\`/cardStock/\${cardId}/qty.json\`, amount, 'DECREMENT', fallbackCurrentQty, maxRetries, false);
}

export async function safeIncrementCardQty(cardId: string, amount: number, fallbackCurrentQty?: number, maxRetries = 6) {
  return safeAtomicUpdate(\`/cardStock/\${cardId}/qty.json\`, amount, 'INCREMENT', fallbackCurrentQty, maxRetries, true);
}

export async function safeDecrementPhotoStock(amount: number, fallbackCurrentQty?: number, maxRetries = 6) {
  return safeAtomicUpdate(\`/photoPaperStock.json\`, amount, 'DECREMENT', fallbackCurrentQty, maxRetries, false);
}

export async function safeIncrementPhotoStock(amount: number, fallbackCurrentQty?: number, maxRetries = 6) {
  return safeAtomicUpdate(\`/photoPaperStock.json\`, amount, 'INCREMENT', fallbackCurrentQty, maxRetries, true);
}

`;

fs.writeFileSync('src/firebase.ts', content.replace(regex, replacement));
