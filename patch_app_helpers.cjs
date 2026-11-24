const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const helpers = `
  const trySavePendingDeleteDebt = (del: PendingDeleteDebt, newStatus: PendingDeleteDebtStatus): boolean => {
    const prevStatus = del.status;
    del.status = newStatus;
    const ok = savePendingDeleteDebt(del);
    if (!ok) {
      del.status = prevStatus;
    }
    return ok;
  };

  const resumePendingDeleteDebts = async () => {
    const pendings = loadPendingDeleteDebts();
    for (const pending of pendings) {
      try {
        if (pending.status === 'created' || pending.status === 'stock_rollback_in_progress') {
          if (!trySavePendingDeleteDebt(pending, 'stock_rollback_in_progress')) continue;
          
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
            }
            
            if (res && res.success && !res.pending) {
              step.status = 'completed';
              savePendingDeleteDebt(pending);
            } else {
              allStockCompleted = false;
            }
          }
          
          if (allStockCompleted) {
            if (!trySavePendingDeleteDebt(pending, 'stock_rollback_completed')) continue;
          } else {
            continue; // Wait for network
          }
        }

        if (pending.status === 'stock_rollback_completed' || pending.status === 'income_delete_in_progress') {
          if (!trySavePendingDeleteDebt(pending, 'income_delete_in_progress')) continue;
          
          let allIncomeDeleted = true;
          for (const incomeId of pending.incomeIdsToDelete) {
             const res = await putWithOutbox(\`/otherIncome/\${incomeId}.json\`, null);
             if (!res.success || res.pending) {
                allIncomeDeleted = false;
             }
          }
          if (allIncomeDeleted) {
            if (!trySavePendingDeleteDebt(pending, 'debt_delete_in_progress')) continue;
          } else {
            continue; // wait for network
          }
        }
        
        if (pending.status === 'debt_delete_in_progress') {
          const res = await putWithOutbox(\`/debts/\${pending.debtId}.json\`, null);
          if (res.success && !res.pending) {
            if (trySavePendingDeleteDebt(pending, 'completed')) {
              removePendingDeleteDebt(pending.id);
            }
          }
        }
      } catch (err) {
        console.error('Error recovering pending delete debt:', pending, err);
      }
    }
  };
`;

if (!code.includes('resumePendingDeleteDebts')) {
  code = code.replace("const resumePendingDebtPayments = async () => {", helpers + "\n  const resumePendingDebtPayments = async () => {");
}

if (code.includes('await resumePendingDebtPayments();')) {
  if (!code.includes('await resumePendingDeleteDebts();')) {
    code = code.replace("await resumePendingDebtPayments();", "await resumePendingDeleteDebts();\n      await resumePendingDebtPayments();");
  }
}

if (code.includes('resumePendingDebtPayments();')) {
  if (!code.includes('resumePendingDeleteDebts();')) {
    code = code.replace("resumePendingDebtPayments();", "resumePendingDeleteDebts();\n      resumePendingDebtPayments();");
  }
}

fs.writeFileSync('src/App.tsx', code);
console.log('App.tsx helpers patched');
