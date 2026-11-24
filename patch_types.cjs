const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf8');

const regex = /kind: 'item' \| 'card' \| 'forfait' \| 'photo';/;
code = code.replace(regex, "kind: 'item' | 'card' | 'forfait' | 'photo' | 'debt_pay';");

const newTypes = `
export type PendingDeleteHistorySaleStatus =
  | 'created'
  | 'stock_restore_in_progress'
  | 'stock_restore_completed'
  | 'sale_delete_in_progress'
  | 'completed';

export interface PendingDeleteHistorySale {
  id: string; // The opId for the deletion
  createdAt: number;
  saleId: string;
  isSaleRecord: boolean;
  stockSteps: PendingStockStep[];
  status: PendingDeleteHistorySaleStatus;
}
`;

code = code.replace("export type PendingDeleteDebtStatus", newTypes + "\nexport type PendingDeleteDebtStatus");

fs.writeFileSync('src/types.ts', code);
console.log('patched types');
