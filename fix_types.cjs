const fs = require('fs');
let app = fs.readFileSync('src/App.tsx', 'utf8');
app = app.replace(
  "import { CustomerDebtGroup, ShiftLog, Item, Sale, OtherIncome, Expense, Debt, ForfaitBalance, PhotoPaperStockEntry, CardStockEntry, PrintJob, PaymentMethod, Notification, AuditLog, PendingSale, PendingSaleStatus, PendingSaleLine } from './types';",
  "import { CustomerDebtGroup, ShiftLog, Item, Sale, OtherIncome, Expense, Debt, ForfaitBalance, PhotoPaperStockEntry, CardStockEntry, PrintJob, PaymentMethod, Notification, AuditLog, PendingSale, PendingSaleStatus, PendingSaleLine, PendingDebtPayment, PendingDebtPaymentStatus } from './types';"
);
fs.writeFileSync('src/App.tsx', app);

let types = fs.readFileSync('src/types.ts', 'utf8');
if (!types.includes('createdAt: number;\n  date: string;\n  cart: PendingSaleLine[];')) {
  // Let's add createdAt to PendingSale if it's missing
  types = types.replace(
    "export interface PendingSale {\n  transactionId: string;\n  date: string;",
    "export interface PendingSale {\n  transactionId: string;\n  createdAt: number;\n  date: string;"
  );
  fs.writeFileSync('src/types.ts', types);
}
