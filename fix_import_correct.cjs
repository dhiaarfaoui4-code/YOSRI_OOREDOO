const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetImport = "  PendingSale, PendingSaleLine, PendingStockStep\n} from './types';";
if (code.includes(targetImport)) {
  code = code.replace(
    targetImport,
    "  PendingSale, PendingSaleLine, PendingStockStep, PendingDebtPayment, PendingDebtPaymentStatus\n} from './types';"
  );
  fs.writeFileSync('src/App.tsx', code);
}
