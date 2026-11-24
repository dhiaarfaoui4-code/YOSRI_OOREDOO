const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const resumeCode = `
  const resumePendingDebtPayments = async () => {
    const pendings = loadPendingDebtPayments();
    for (const pending of pendings) {
      try {
        if (pending.status === 'created' || pending.status === 'debt_in_progress') {
          if (!trySavePendingDebtPayment(pending, 'debt_in_progress')) continue;
          
          const res1 = await safeIncrementDebtPaid(pending.debtId, pending.payAmount, 6, pending.id, pending.debtId);
          if (res1.reason === 'not_found') {
            // Debt was deleted, we can't pay it
            if (!trySavePendingDebtPayment(pending, 'completed')) continue;
            removePendingDebtPayment(pending.id);
            continue;
          }
          if (res1.success && !res1.pending) {
            if (!trySavePendingDebtPayment(pending, 'debt_completed')) continue;
          } else {
            continue; // Wait for network
          }
        }

        if (pending.status === 'debt_completed' || pending.status === 'income_in_progress') {
          if (!trySavePendingDebtPayment(pending, 'income_in_progress')) continue;
          
          await patchWithOutbox(\`/debts/\${pending.debtId}.json\`, { status: pending.updatedDebtStatus }, undefined, pending.debtId);
          const ok2 = await putWithOutbox(\`/otherIncome/\${pending.incomeId}.json\`, pending.incomeEntry, pending.incomeId, pending.debtId);
          
          if (ok2.success && !ok2.pending) {
            if (!trySavePendingDebtPayment(pending, 'completed')) continue;
            removePendingDebtPayment(pending.id);
          }
        }
      } catch (err) {
        console.error('Error recovering pending debt payment:', pending, err);
      }
    }
  };

  const resumePendingSales = `;

code = code.replace(/const resumePendingSales = /g, resumeCode);
fs.writeFileSync('src/App.tsx', code);
