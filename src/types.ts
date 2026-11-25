export interface Item {
  id: string;
  name: string;
  buy: number;
  sell: number;
  qty: number;
  barcodes?: string[];
  barcode?: string; // Legacy fallback
  category?: string; // e.g., 'phone', 'battery', 'speaker', 'bluetooth', 'accessory'
  imageUrl?: string; // Product photo for visual recognition
}

export interface Sale {
  id: string;
  itemId: string | null;
  itemName: string;
  qty: number;
  unitPrice: number;
  unitBuy: number;
  total: number;
  date: string;
}

export interface OtherIncome {
  id: string;
  category: string; // 'recharge' | 'forfait' | 'photo' | 'service' | 'debt_payment'
  label: string;
  amount: number;
  commission: number;
  date: string;
  cardOperator?: string | null;
  cardValue?: string | null;
  qty?: number | null;
  debtId?: string | null; // Fix 3: Linking payment back to debt
  destination?: 'drawer' | 'manager'; // 'drawer' = الكاسة (included in cash register & shift), 'manager' = جيب المدير (excluded from cash register & sales)
}

export interface DebtLine {
  type: string;
  itemId?: string | null;
  itemName?: string | null;
  qty: number;
  unitBuy?: number;
  unitPrice?: number;
  cardOperator?: string | null;
  cardValue?: string | null;
  total: number;
}

export interface Debt {
  id: string;
  customerName: string;
  customerPhone?: string;
  note: string;
  lines?: DebtLine[];
  amount: number;
  paid: number;
  date: string;
  status: 'open' | 'paid';
}

export interface CardStockEntry {
  id: string;
  kind: 'recharge';
  operator: string;
  value: string;
  qty: number;
}

export interface Expense {
  id: string;
  desc: string;
  amount: number;
  date: string;
}

export interface ForfaitPlan {
  id: string;
  name: string;
  validity: string;
  price: number;
}

export interface AuditLogEntry {
  id: string;
  action: string; // 'delete' | 'sale' | 'pin' | 'reset' | 'merge' | 'edit'
  label: string;
  user: string;
  date: string;
}

export interface ForfaitBalance {
  Ooredoo?: number;
  Ooredoo_1005?: number;
  Ooredoo_1006?: number;
  Orange: number;
  'Tunisie Telecom': number;
  [key: string]: number | undefined;
}

export interface SparePart {
  id: string;
  name: string;          // e.g. شاشة آيفون 11، Plaque charge، بطارية A51
  supplierName: string;  // اسم الفورنيسور (المزوّد)
  qty: number;           // الكمية
  unitCost: number;      // تكلفة القطعة الواحدة
  totalCost: number;     // التكلفة الإجمالية (qty * unitCost)
  status: 'unpaid' | 'paid'; // حالة السداد (خالصة / غير خالصة)
  date: string;          // تاريخ الشراء
  notes?: string;        // ملاحظات إضافية
}

export interface ShiftLog {
  id: string;
  timestamp: string;
  sellerName?: string;
  salesTotal: number;
  otherIncomeTotal: number;
  expensesTotal: number;
  expectedCashInDrawer: number;
  actualCashInDrawer: number;
  cashWithdrawn: number;
  newStartingCash: number;
  difference: number;
  notes?: string;
}

export type AppTab = 'dashboard' | 'stock' | 'income' | 'debts' | 'history' | 'settings';
export type AppRole = 'manager' | 'seller';

export interface PendingSaleLine {
  id: string;
  type: 'item' | 'recharge' | 'forfait' | 'photo' | 'service' | 'bill';
  itemId?: string;
  label: string;
  qty: number;
  unitPrice: number;
  unitBuy?: number;
  total: number;
  commission?: number;
  cardOperator?: string;
  cardValue?: string;
  customerPhone?: string;
}

export type PendingSaleStatus = 
  | 'created'
  | 'started'
  | 'stock_in_progress'
  | 'stock_decremented'
  | 'stock_completed'
  | 'records_in_progress'
  | 'completed'
  | 'rollback_in_progress'
  | 'rolled_back';

export interface PendingStockStep {
  kind: 'item' | 'card' | 'forfait' | 'photo' | 'debt_pay';
  targetId: string;
  qty: number;
  label?: string;
  opId: string;
  revertOpId: string;
  status: 'pending' | 'completed' | 'failed' | 'rolled_back';
  payload?: Record<string, number>;
}

export type PendingDebtPaymentStatus = 
  | 'created'
  | 'debt_in_progress'
  | 'debt_completed'
  | 'income_in_progress'
  | 'completed';



export type PendingDeleteHistorySaleStatus =
  | 'created'
  | 'stock_restore_in_progress'
  | 'stock_restore_completed'
  | 'sale_delete_in_progress'
  | 'completed';

export interface PendingDeleteHistorySale {
  id: string; // The opId for the deletion
  createdAt: number;
  saleId: string;
  isSaleRecord: boolean;
  stockSteps: PendingStockStep[];
  status: PendingDeleteHistorySaleStatus;
}

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

export interface PendingDebtPayment {
  id: string; // The opId for the payment
  createdAt: number;
  debtId: string;
  payAmount: number;
  incomeId: string;
  incomeEntry: OtherIncome;
  updatedDebtStatus: string; // 'open' or 'paid'
  status: PendingDebtPaymentStatus;
}

export interface PendingSale {
  transactionId: string;
  createdAt: number;
  date: string;
  cart: PendingSaleLine[];
  grandTotal: number;
  isDebt: boolean;
  customerName?: string;
  customerPhone?: string;
  initialPayment?: string;
  status: PendingSaleStatus;
  stockSteps?: PendingStockStep[];
}
