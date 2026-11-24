const fs = require('fs');
let code = fs.readFileSync('src/firebase.ts', 'utf8');

const imports = "import { PendingSale, PendingDebtPayment, PendingDeleteDebt, PendingDeleteHistorySale } from './types';";
code = code.replace("import { PendingSale, PendingDebtPayment, PendingDeleteDebt } from './types';", imports);

const funcs = `
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

export const removePendingDeleteHistorySale = (id: string) => {
  try {
    const list = loadPendingDeleteHistorySales();
    const filtered = list.filter(s => s.id !== id);
    localStorage.setItem(PENDING_DELETE_HISTORY_SALE_KEY, JSON.stringify(filtered));
  } catch (e) {
    console.error('Error removing pending delete history sale:', e);
  }
};
`;

code = code + '\n' + funcs;
fs.writeFileSync('src/firebase.ts', code);
console.log('patched firebase');
