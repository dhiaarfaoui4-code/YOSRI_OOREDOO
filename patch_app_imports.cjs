const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const tImportOld = "PendingDebtPaymentStatus, PendingDeleteDebt, PendingDeleteDebtStatus } from './types';";
const tImportNew = "PendingDebtPaymentStatus, PendingDeleteDebt, PendingDeleteDebtStatus, PendingDeleteHistorySale, PendingDeleteHistorySaleStatus } from './types';";
code = code.replace(tImportOld, tImportNew);

const fImportOld = "removePendingDebtPayment, loadPendingDeleteDebts, savePendingDeleteDebt, removePendingDeleteDebt } from './firebase';";
const fImportNew = "removePendingDebtPayment, loadPendingDeleteDebts, savePendingDeleteDebt, removePendingDeleteDebt, loadPendingDeleteHistorySales, savePendingDeleteHistorySale, removePendingDeleteHistorySale } from './firebase';";
code = code.replace(fImportOld, fImportNew);

const helpers = `
  const trySavePendingDeleteHistorySale = (del: PendingDeleteHistorySale, newStatus: PendingDeleteHistorySaleStatus): boolean => {
    const prev = del.status;
    del.status = newStatus;
    if (!savePendingDeleteHistorySale(del)) {
      del.status = prev;
      return false;
    }
    return true;
  };

  const resumePendingDeleteHistorySales = async () => {
    const pendings = loadPendingDeleteHistorySales();
    for (const pending of pendings) {
      try {
        if (pending.status === 'created' || pending.status === 'stock_restore_in_progress') {
          if (!trySavePendingDeleteHistorySale(pending, 'stock_restore_in_progress')) continue;
          
          let allStockCompleted = true;
          for (const step of pending.stockSteps) {
            if (step.status === 'completed') continue;
            let res;
            if (step.kind === 'item') {
              res = await safeIncrementItemQty(step.targetId, step.qty, undefined, 6, step.opId);
            } else if (step.kind === 'card') {
              res = await safeIncrementCardQty(step.targetId, step.qty, undefined, 6, step.opId);
            } else if (step.kind === 'forfait') {
              res = await safeIncrementForfait({ [step.targetId]: step.qty }, 6, step.opId);
            } else if (step.kind === 'photo') {
              res = await safeIncrementPhotoStock(step.qty, undefined, 6, step.opId);
            } else if (step.kind === 'debt_pay') {
              // TargetId is debtId. qty is amount
              // We pass amount as negative, safeIncrementDebtPaid takes amount. We should just pass it.
              // Wait, safeIncrementDebtPaid takes \`amount\` (delta). In step.qty we will put -record.amount.
              res = await safeIncrementDebtPaid(step.targetId, step.qty, 6, step.opId);
            }
            if (res && res.success && !res.pending) {
              step.status = 'completed';
              savePendingDeleteHistorySale(pending);
            } else {
              allStockCompleted = false;
            }
          }
          if (allStockCompleted) {
            if (!trySavePendingDeleteHistorySale(pending, 'stock_restore_completed')) continue;
          } else {
            continue; // Wait for network
          }
        }
        
        if (pending.status === 'stock_restore_completed' || pending.status === 'sale_delete_in_progress') {
          if (!trySavePendingDeleteHistorySale(pending, 'sale_delete_in_progress')) continue;
          
          const path = pending.isSaleRecord ? \`/sales/\${pending.saleId}.json\` : \`/otherIncome/\${pending.saleId}.json\`;
          const ok = await putWithOutbox(path, null);
          
          if (ok.success && !ok.pending) {
            if (trySavePendingDeleteHistorySale(pending, 'completed')) {
              removePendingDeleteHistorySale(pending.id);
            }
          }
        }
      } catch (err) {
        console.error('Error resuming delete history sale', err);
      }
    }
  };
`;

code = code.replace("const resumePendingDeleteDebts = async () => {", helpers + "\n  const resumePendingDeleteDebts = async () => {");
code = code.replace("await resumePendingDeleteDebts();", "await resumePendingDeleteHistorySales();\n      await resumePendingDeleteDebts();");
code = code.replace("resumePendingDeleteDebts();", "resumePendingDeleteHistorySales();\n      resumePendingDeleteDebts();");

fs.writeFileSync('src/App.tsx', code);
console.log('patched app imports and helpers');
