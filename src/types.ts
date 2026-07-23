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
}

export interface DebtLine {
  type: string;
  itemId?: string | null;
  itemName?: string | null;
  qty: number;
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
  Ooredoo: number;
  Orange: number;
  'Tunisie Telecom': number;
  [key: string]: number;
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

export type AppTab = 'dashboard' | 'stock' | 'income' | 'debts' | 'history' | 'settings' | 'spare_parts';
export type AppRole = 'manager' | 'seller';
