const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  "import { CustomerDebtGroup, ShiftLog, Item, Sale, OtherIncome, Expense, Debt, ForfaitBalance, PhotoPaperStockEntry, CardStockEntry, PrintJob, PaymentMethod, Notification, AuditLog, PendingSale, PendingSaleStatus, PendingSaleLine } from './types';",
  "import { CustomerDebtGroup, ShiftLog, Item, Sale, OtherIncome, Expense, Debt, ForfaitBalance, PhotoPaperStockEntry, CardStockEntry, PrintJob, PaymentMethod, Notification, AuditLog, PendingSale, PendingSaleStatus, PendingSaleLine, PendingDebtPayment, PendingDebtPaymentStatus } from './types';"
);
// In case the import is split or structured differently:
if (!code.includes('PendingDebtPaymentStatus')) {
   // Let's just find "from './types';" and replace it
   code = code.replace("from './types';", ", PendingDebtPayment, PendingDebtPaymentStatus } from './types';");
   code = code.replace("} ,", ",");
}
fs.writeFileSync('src/App.tsx', code);
