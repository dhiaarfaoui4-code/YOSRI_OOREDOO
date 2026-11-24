const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const importRegex = /loadPendingSales,\s*savePendingSale,\s*removePendingSale/g;
code = code.replace(importRegex, 'loadPendingSales, savePendingSale, removePendingSale, loadPendingDebtPayments, savePendingDebtPayment, removePendingDebtPayment');

const trySaveRegex = /const trySavePendingSale = /g;
const helperCode = `
  const trySavePendingDebtPayment = (payment: PendingDebtPayment, newStatus: PendingDebtPaymentStatus): boolean => {
    const prevStatus = payment.status;
    payment.status = newStatus;
    const ok = savePendingDebtPayment(payment);
    if (!ok) {
      payment.status = prevStatus;
    }
    return ok;
  };

  const trySavePendingSale = `;
code = code.replace(trySaveRegex, helperCode);

fs.writeFileSync('src/App.tsx', code);
