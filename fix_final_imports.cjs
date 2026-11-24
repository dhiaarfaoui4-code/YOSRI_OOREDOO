const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "PendingDebtPaymentStatus} from './types';", 
  "PendingDebtPaymentStatus, PendingDeleteDebt, PendingDeleteDebtStatus } from './types';"
);

code = code.replace(
  "removePendingDebtPayment} from './firebase';", 
  "removePendingDebtPayment, loadPendingDeleteDebts, savePendingDeleteDebt, removePendingDeleteDebt } from './firebase';"
);

fs.writeFileSync('src/App.tsx', code);
