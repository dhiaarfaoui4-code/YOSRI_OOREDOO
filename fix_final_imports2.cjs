const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(
  "PendingDebtPaymentStatus\n} from './types';", 
  "PendingDebtPaymentStatus, PendingDeleteDebt, PendingDeleteDebtStatus\n} from './types';"
);

code = code.replace(
  "removePendingDebtPayment\n} from './firebase';", 
  "removePendingDebtPayment, loadPendingDeleteDebts, savePendingDeleteDebt, removePendingDeleteDebt\n} from './firebase';"
);

fs.writeFileSync('src/App.tsx', code);
