const fs = require('fs');
let types = fs.readFileSync('src/types.ts', 'utf8');

const newTypes = `
export type PendingDeleteDebtStatus =
  | 'created'
  | 'stock_rollback_in_progress'
  | 'stock_rollback_completed'
  | 'income_delete_in_progress'
  | 'debt_delete_in_progress'
  | 'completed';

export interface PendingDeleteDebt {
  id: string; // The opId for the deletion
  createdAt: number;
  debtId: string;
  stockSteps: PendingStockStep[];
  incomeIdsToDelete: string[];
  status: PendingDeleteDebtStatus;
}
`;

if (!types.includes('PendingDeleteDebtStatus')) {
  types = types.replace('export interface PendingDebtPayment {', newTypes + '\nexport interface PendingDebtPayment {');
  fs.writeFileSync('src/types.ts', types);
  console.log('Types patched');
}
