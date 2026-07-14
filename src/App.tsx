import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, Plus, Minus, Search, Trash2, ShieldAlert, CreditCard, 
  History, Settings as SettingsIcon, Package, Phone, FileText, Check, 
  Camera, ShoppingBag, Radio, Wifi, LogOut, CheckCircle, RefreshCw, X,
  Pencil
} from 'lucide-react';
import { 
  Item, Sale, OtherIncome, Debt, CardStockEntry, Expense, 
  ForfaitPlan, ForfaitBalance, AuditLogEntry, AppTab, AppRole 
} from './types';
import {
  ensureAuth, signInManager, resumeManagerSession, logoutManager,
  fetchJsonWithRetry, safeDecrementItemQty, safeIncrementItemQty,
  putWithOutbox, flushOutbox, dbUrl, verifyManagerPinViaAuth,
  updateManagerPinViaAuth
} from './firebase';
import { SvgChart } from './components/SvgChart';
import { InvoiceModal, InvoiceData } from './components/InvoiceModal';
import { BarcodeScannerPopup } from './components/BarcodeScannerPopup';
import { LoginOverlay } from './components/LoginOverlay';

// Helper to normalize Arabic
function normalizeArabic(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u064B-\u0652]/g, '')
    .trim();
}

// SHA-256 local helper
async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper to parse Firebase Realtime Database objects into arrays with exact IDs
function parseRawWithKeys<T>(rawObj: any): T[] {
  if (!rawObj) return [];
  return Object.entries(rawObj).map(([key, val]: [string, any]) => {
    return {
      ...(val as any),
      id: key
    };
  });
}

export default function App() {
  // ---- Core States ----
  const [items, setItems] = useState<Item[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [otherIncome, setOtherIncome] = useState<OtherIncome[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [cardStock, setCardStock] = useState<CardStockEntry[]>([]);
  const [cashRegister, setCashRegister] = useState<number>(0);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [forfaitPlans, setForfaitPlans] = useState<ForfaitPlan[]>([]);
  const [forfaitBalance, setForfaitBalance] = useState<ForfaitBalance>({ Ooredoo: 0, Orange: 0, 'Tunisie Telecom': 0 });
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [managerPin, setManagerPin] = useState<string>(''); // SHA256 string
  const [currentRole, setCurrentRole] = useState<AppRole | null>(null);
  const [costVisible, setCostVisible] = useState<boolean>(false);
  const [currentTab, setCurrentTab] = useState<AppTab>('stock');
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [outboxCount, setOutboxCount] = useState<number>(0);

  // ---- Modals & Overlays ----
  const [lastInvoice, setLastInvoice] = useState<InvoiceData | null>(null);
  const [scannerContext, setScannerContext] = useState<string | null>(null); // 'stock' | 'sell' | 'manage-<itemId>'
  const [toastMsg, setToastMsg] = useState<string>('');
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
    onCancel?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  // ---- Form Inputs ----
  const [newItem, setNewItem] = useState({ name: '', barcode: '', buy: '', sell: '', qty: '' });
  const [cardOperator, setCardOperator] = useState('Ooredoo');
  const [cardValue, setCardValue] = useState('1');
  const [cardQty, setCardQty] = useState('');
  const [addBalanceOperator, setAddBalanceOperator] = useState('Ooredoo');
  const [addBalanceAmount, setAddBalanceAmount] = useState('');
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanValidity, setNewPlanValidity] = useState('');
  const [newPlanPrice, setNewPlanPrice] = useState('');
  const [manualDebt, setManualDebt] = useState({ name: '', phone: '', amount: '', note: '' });
  const [expenseInput, setExpenseInput] = useState({ desc: '', amount: '' });

  // Income Line Form State
  const [incomeType, setIncomeType] = useState<'item' | 'recharge' | 'forfait' | 'photo' | 'service'>('item');
  const [sellSearch, setSellSearch] = useState('');
  const [sellItemId, setSellItemId] = useState('');
  const [sellQty, setSellQty] = useState('1');
  const [sellPriceOverride, setSellPriceOverride] = useState('');
  const [rechargeOp, setRechargeOp] = useState('Ooredoo');
  const [rechargeValOpt, setRechargeValOpt] = useState('1|1.3|0.3'); // face|sellPrice|commission
  const [rechargeQty, setRechargeQty] = useState('1');
  const [rechargePriceOverride, setRechargePriceOverride] = useState('');
  const [forfaitOp, setForfaitOp] = useState('Ooredoo');
  const [forfaitPlanId, setForfaitPlanId] = useState('');
  const [forfaitPriceOverride, setForfaitPriceOverride] = useState('');
  const [forfaitCustomerPhone, setForfaitCustomerPhone] = useState('');
  const [photoDesc, setPhotoDesc] = useState('');
  const [photoQty, setPhotoQty] = useState('1');
  const [photoAmount, setPhotoAmount] = useState('');
  const [serviceType, setServiceType] = useState('Cache');
  const [serviceCustomDesc, setServiceCustomDesc] = useState('');
  const [serviceAmount, setServiceAmount] = useState('');

  // Finalize invoice form
  const [invoiceCustomerName, setInvoiceCustomerName] = useState('');
  const [invoiceCustomerPhone, setInvoiceCustomerPhone] = useState('');
  const [invoiceIsDebt, setInvoiceIsDebt] = useState(false);

  // Searches
  const [stockSearch, setStockSearch] = useState('');
  const [debtSearch, setDebtSearch] = useState('');
  const [auditLogSearch, setAuditLogSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyCategory, setHistoryCategory] = useState<'all' | 'item' | 'recharge' | 'forfait' | 'photo' | 'service'>('all');
  const [historyDateFilter, setHistoryDateFilter] = useState<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all');

  // Cart
  interface CartLine {
    id: string;
    type: 'item' | 'recharge' | 'forfait' | 'photo' | 'service';
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
  const [cart, setCart] = useState<CartLine[]>([]);
  const [chartDayOffset, setChartDayOffset] = useState<number>(0);

  // Loaders
  const [historyLimit, setHistoryLimit] = useState(20);
  const [expensesLimit, setExpensesLimit] = useState(20);
  const [auditLimit, setAuditLimit] = useState(20);

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 2200);
  };

  // Log Audit trail to server (fire and forget)
  const logAudit = async (action: string, label: string) => {
    const entry: AuditLogEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      action,
      label,
      user: currentRole === 'manager' ? '🔑 مدير' : '🧑‍💼 بائع',
      date: new Date().toISOString()
    };
    setAuditLog(prev => [entry, ...prev]);
    try {
      fetch(dbUrl(`/auditLog/${entry.id}.json`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
    } catch (e) {}
  };

  // First initialization load
  useEffect(() => {
    let active = true;
    async function init() {
      setConnectionStatus('checking');
      const authOk = await ensureAuth();
      if (!authOk && active) {
        triggerToast('⚠️ فشل الاتصال بخادم الهوية');
      }

      // Try flushing outbox immediately
      await flushOutbox((sent) => {
        if (active) triggerToast(`✅ تم إرسال ${sent} عملية معلقة من وضع عدم الاتصال`);
      });

      // Load all data
      await loadAllData();

      // Resume manager session if saved
      const sessionRole = sessionStorage.getItem('yosri_role_v2') as AppRole | null;
      if (sessionRole === 'seller') {
        setCurrentRole('seller');
        setCurrentTab('stock');
      } else if (sessionRole === 'manager') {
        const resumed = await resumeManagerSession();
        if (resumed) {
          setCurrentRole('manager');
          setCurrentTab('dashboard');
        } else {
          sessionStorage.removeItem('yosri_role_v2');
          setCurrentRole(null);
        }
      }
    }
    init();

    // Setup periodic sync
    const interval = setInterval(() => {
      loadAllData();
      flushOutbox();
    }, 15000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentRole]);

  const loadAllData = async () => {
    try {
      const results = await Promise.all([
        fetchJsonWithRetry('/items.json').catch(() => null),
        fetchJsonWithRetry('/sales.json').catch(() => null),
        fetchJsonWithRetry('/otherIncome.json').catch(() => null),
        fetchJsonWithRetry('/debts.json').catch(() => null),
        fetchJsonWithRetry('/cardStock.json').catch(() => null),
        fetchJsonWithRetry('/cashRegister.json').catch(() => 0),
        fetchJsonWithRetry('/expenses.json').catch(() => null),
        fetchJsonWithRetry('/forfaitPlans.json').catch(() => null),
        fetchJsonWithRetry('/forfaitBalance.json').catch(() => null),
        fetchJsonWithRetry('/auditLog.json').catch(() => null),
        fetchJsonWithRetry('/pin.json').catch(() => '1234')
      ]);

      const [
        itemsRaw, salesRaw, otherIncomeRaw, debtsRaw, cardStockRaw,
        cashRegisterRaw, expensesRaw, plansRaw, balanceRaw, auditRaw, pinRaw
      ] = results;

      setItems(parseRawWithKeys<Item>(itemsRaw));
      setSales(parseRawWithKeys<Sale>(salesRaw));
      setOtherIncome(parseRawWithKeys<OtherIncome>(otherIncomeRaw));
      setDebts(parseRawWithKeys<Debt>(debtsRaw));
      setCardStock(parseRawWithKeys<CardStockEntry>(cardStockRaw));
      setCashRegister(typeof cashRegisterRaw === 'number' ? cashRegisterRaw : 0);
      setExpenses(parseRawWithKeys<Expense>(expensesRaw));
      setAuditLog(parseRawWithKeys<AuditLogEntry>(auditRaw).reverse());

      // If forfait plans are empty, generate default ones
      if (!plansRaw) {
        const defaultPlans = [
          { id: 'p1', name: '220 Mo', validity: '4 jours', price: 1.0 },
          { id: 'p2', name: '1.25 Go', validity: '30 jours', price: 5.0 },
          { id: 'p3', name: '25 Go', validity: '30 jours', price: 30.0 },
          { id: 'p4', name: '55 Go', validity: '55 jours', price: 55.0 }
        ];
        setForfaitPlans(defaultPlans);
        // Save back
        defaultPlans.forEach(p => {
          fetch(dbUrl(`/forfaitPlans/${p.id}.json`), { method: 'PUT', body: JSON.stringify(p) });
        });
      } else {
        setForfaitPlans(parseRawWithKeys<ForfaitPlan>(plansRaw));
      }

      setForfaitBalance(balanceRaw ? { Ooredoo: 0, Orange: 0, 'Tunisie Telecom': 0, ...balanceRaw } : { Ooredoo: 0, Orange: 0, 'Tunisie Telecom': 0 });

      // Handle legacy raw PIN hashing
      const finalPin = typeof pinRaw === 'object' ? (pinRaw.owner || '1234') : pinRaw;
      if (finalPin.length === 64) {
        setManagerPin(finalPin);
      } else {
        const hash = await sha256Hex(finalPin);
        setManagerPin(hash);
      }

      setConnectionStatus('connected');
    } catch (e) {
      setConnectionStatus('offline');
    }
  };

  // Handle logout
  const handleLogout = async () => {
    await logoutManager();
    setCurrentRole(null);
    sessionStorage.removeItem('yosri_role_v2');
  };

  // Verify PIN helper for dangerous manager actions
  const promptAndVerifyPin = async (message = 'أدخل الرمز السري للمدير للتأكيد:'): Promise<boolean> => {
    const code = prompt(message);
    if (!code) return false;
    
    // First try secure server-side verification via Firebase Auth
    const isOk = await verifyManagerPinViaAuth(code);
    if (isOk) return true;
    
    // Fallback to local SHA-256 comparison for offline support or legacy fallback
    const hashed = await sha256Hex(code);
    if (hashed === managerPin) return true;
    
    triggerToast('❌ الرمز السري غير صحيح');
    return false;
  };

  // ---- 1. Stock / Items Actions ----
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const { name, barcode, buy, sell, qty } = newItem;
    if (!name) return triggerToast('❌ الرجاء إدخال اسم السلعة');
    
    const buyVal = parseFloat(buy) || 0;
    const sellVal = parseFloat(sell) || 0;
    const qtyVal = parseInt(qty) || 0;

    // Split barcode input by comma and clean whitespace
    const barcodeArray = barcode
      ? barcode.split(',').map(b => b.trim()).filter(b => b.length > 0)
      : [];

    // Verify all barcodes to ensure they are not registered to another item (different name)
    for (const b of barcodeArray) {
      const duplicateItem = items.find(i => i.barcodes?.includes(b) && normalizeArabic(i.name) !== normalizeArabic(name));
      if (duplicateItem) {
        return triggerToast(`❌ الباركود ${b} مستخدم بالفعل مع سلعة أخرى: "${duplicateItem.name}"`);
      }
    }

    // Check duplicate name
    const existing = items.find(i => normalizeArabic(i.name) === normalizeArabic(name));
    if (existing) {
      setConfirmDialog({
        isOpen: true,
        title: 'السلعة موجودة بالفعل',
        message: `السلعة "${existing.name}" موجودة بالفعل في المخازن. هل ترغب بزيادة الكمية الجديدة فوق المخزون السابق؟`,
        confirmText: 'نعم، زيادة الكمية ➕',
        cancelText: 'إلغاء ❌',
        isDanger: false,
        onConfirm: async () => {
          const mergedBarcodes = Array.from(new Set([
            ...(existing.barcodes || []),
            ...barcodeArray
          ]));

          const updated = {
            ...existing,
            qty: existing.qty + qtyVal,
            buy: buyVal > 0 ? buyVal : existing.buy,
            sell: sellVal > 0 ? sellVal : existing.sell,
            barcodes: mergedBarcodes
          };
          const ok = await putWithOutbox(`/items/${existing.id}.json`, updated);
          if (ok) {
            triggerToast('✅ تم تحديث كمية السلعة بنجاح');
            logAudit('edit', `تحديث ستوك سلعة مكررة: ${name} (+${qtyVal})`);
            loadAllData();
          }
          setNewItem({ name: '', barcode: '', buy: '', sell: '', qty: '' });
        }
      });
      return;
    }

    const item: Item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      buy: buyVal,
      sell: sellVal,
      qty: qtyVal,
      barcodes: barcodeArray
    };

    const ok = await putWithOutbox(`/items/${item.id}.json`, item);
    if (ok) {
      triggerToast('✅ تم إضافة السلعة الجديدة للمخزن');
      logAudit('edit', `إضافة سلعة جديدة: ${name} (${qtyVal} قطعة)`);
      setNewItem({ name: '', barcode: '', buy: '', sell: '', qty: '' });
      loadAllData();
    }
  };

  const handleAdjustQty = async (itemId: string, delta: number) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (delta < 0 && item.qty <= 0) return triggerToast('❌ المخزن فارغ بالفعل');

    const result = delta > 0 
      ? await safeIncrementItemQty(itemId, delta)
      : await safeDecrementItemQty(itemId, Math.abs(delta));

    if (result.success) {
      triggerToast('✅ تم تحديث الكمية');
      logAudit('edit', `تعديل كمية "${item.name}" يدوياً: ${delta > 0 ? '+' : ''}${delta}`);
      loadAllData();
    } else {
      triggerToast('❌ فشل تعديل الكمية، الرجاء المحاولة مجدداً');
    }
  };

  const handleEditQtyExact = async (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const input = prompt(`أدخل الكمية الدقيقة لـ "${item.name}":`, String(item.qty));
    if (input === null) return;
    const val = parseInt(input, 10);
    if (isNaN(val) || val < 0) return triggerToast('❌ قيمة غير صالحة');

    const delta = val - item.qty;
    if (delta === 0) return;

    const result = delta > 0 
      ? await safeIncrementItemQty(itemId, delta)
      : await safeDecrementItemQty(itemId, Math.abs(delta));

    if (result.success) {
      triggerToast('✅ تم تعديل الكمية الدقيقة');
      logAudit('edit', `تعديل كمية "${item.name}" للقيمة المحددة: ${val}`);
      loadAllData();
    } else {
      triggerToast('❌ فشل التعديل، حاول مرة أخرى');
    }
  };

  const handleEditItemName = async (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const newName = prompt(`أدخل الاسم الجديد للسلعة "${item.name}":`, item.name);
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) return triggerToast('❌ لا يمكن أن يكون اسم السلعة فارغاً');

    const updated = { ...item, name: trimmed };
    const ok = await putWithOutbox(`/items/${itemId}.json`, updated);
    if (ok) {
      triggerToast('✅ تم تعديل اسم السلعة بنجاح');
      logAudit('edit', `تعديل اسم سلعة: "${item.name}" إلى "${trimmed}"`);
      loadAllData();
    } else {
      triggerToast('❌ فشل تعديل الاسم، حاول لاحقاً');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (!await promptAndVerifyPin(`هل أنت متأكد من مسح السلعة "${item.name}" نهائياً من السيستم؟`)) return;

    try {
      const res = await fetch(dbUrl(`/items/${itemId}.json`), { method: 'DELETE' });
      if (res.ok) {
        triggerToast('✅ تم مسح السلعة بنجاح');
        logAudit('delete', `حذف سلعة نهائياً: ${item.name}`);
        loadAllData();
      }
    } catch (e) {
      triggerToast('❌ فشل حذف السلعة، تأكد من الاتصال');
    }
  };

  // ---- 2. Card Stock Actions ----
  const handleAddCardStock = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyVal = parseInt(cardQty) || 0;
    if (qtyVal <= 0) return triggerToast('❌ الرجاء إدخال كمية صحيحة');

    const existing = cardStock.find(c => c.operator === cardOperator && c.value === cardValue);
    if (existing) {
      const updated = { ...existing, qty: existing.qty + qtyVal };
      await putWithOutbox(`/cardStock/${existing.id}.json`, updated);
    } else {
      const newCard: CardStockEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        kind: 'recharge',
        operator: cardOperator,
        value: cardValue,
        qty: qtyVal
      };
      await putWithOutbox(`/cardStock/${newCard.id}.json`, newCard);
    }
    triggerToast('✅ تم تحديث مخزن بطاقات الشحن');
    logAudit('edit', `إضافة بطاقات شحن لـ ${cardOperator} فئة ${cardValue}: +${qtyVal}`);
    setCardQty('');
    loadAllData();
  };

  const handleEditCardQty = async (id: string) => {
    const card = cardStock.find(c => c.id === id);
    if (!card) return;
    const input = prompt(`أدخل الكمية الجديدة لبطاقات ${card.operator} (${card.value} د.ت):`, String(card.qty));
    if (input === null) return;
    const val = parseInt(input, 10);
    if (isNaN(val) || val < 0) return triggerToast('❌ رقم غير صالح');

    const updated = { ...card, qty: val };
    const ok = await putWithOutbox(`/cardStock/${card.id}.json`, updated);
    if (ok) {
      triggerToast('✅ تم تحديث كمية البطاقات');
      logAudit('edit', `تعديل يدوي لستوك بطاقات ${card.operator} فئة ${card.value}: ${card.qty} ← ${val}`);
      loadAllData();
    }
  };

  const handleDeleteCardStock = async (id: string) => {
    const card = cardStock.find(c => c.id === id);
    if (!card) return;
    if (!await promptAndVerifyPin(`حذف بطاقات الشحن لـ ${card.operator} (${card.value} د.ت)؟`)) return;

    try {
      await fetch(dbUrl(`/cardStock/${id}.json`), { method: 'DELETE' });
      triggerToast('✅ تم حذف كارت الشحن من المخزن');
      logAudit('delete', `حذف ستوك كروت شحن: ${card.operator} فئة ${card.value}`);
      loadAllData();
    } catch (e) {}
  };

  // ---- 3. Forfait plans & balance ----
  const handleAddForfaitBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(addBalanceAmount) || 0;
    if (amt <= 0) return triggerToast('❌ أدخل قيمة شحن صحيحة');

    const updated = {
      ...forfaitBalance,
      [addBalanceOperator]: (forfaitBalance[addBalanceOperator] || 0) + amt
    };
    const ok = await putWithOutbox('/forfaitBalance.json', updated);
    if (ok) {
      triggerToast('✅ تم إضافة الرصيد بنجاح');
      logAudit('edit', `شحن رصيد فورفاي لـ ${addBalanceOperator}: +${amt} د.ت`);
      setAddBalanceAmount('');
      loadAllData();
    }
  };

  const handleEditForfaitBalanceExact = async (op: string) => {
    const current = forfaitBalance[op] || 0;
    const input = prompt(`أدخل الرصيد الدقيق لـ ${op} بالدينار:`, String(current));
    if (input === null) return;
    const val = parseFloat(input);
    if (isNaN(val) || val < 0) return triggerToast('❌ رقم غير صالح');

    const updated = { ...forfaitBalance, [op]: val };
    const ok = await putWithOutbox('/forfaitBalance.json', updated);
    if (ok) {
      triggerToast('✅ تم تعديل الرصيد');
      logAudit('edit', `تعديل رصيد فورفاي لـ ${op}: ${current} ← ${val} د.ت`);
      loadAllData();
    }
  };

  const handleAddForfaitPlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlanName) return triggerToast('❌ أدخل اسم الباقة');
    const priceVal = parseFloat(newPlanPrice) || 0;
    if (priceVal <= 0) return triggerToast('❌ أدخل سعراً صحيحاً');

    const newPlan: ForfaitPlan = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: newPlanName,
      validity: newPlanValidity || '30 jours',
      price: priceVal
    };

    const ok = await putWithOutbox(`/forfaitPlans/${newPlan.id}.json`, newPlan);
    if (ok) {
      triggerToast('✅ تم إضافة الباقة للكتالوغ');
      setNewPlanName('');
      setNewPlanValidity('');
      setNewPlanPrice('');
      loadAllData();
    }
  };

  const handleDeletePlan = async (id: string) => {
    if (!await promptAndVerifyPin('حذف هذه الباقة نهائياً من الكتالوغ؟')) return;
    try {
      await fetch(dbUrl(`/forfaitPlans/${id}.json`), { method: 'DELETE' });
      triggerToast('✅ تم حذف الباقة');
      loadAllData();
    } catch (e) {}
  };

  // ---- 4. Expense Actions ----
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const { desc, amount } = expenseInput;
    if (!desc) return triggerToast('❌ الرجاء إدخال وصف المصروف');
    const amtVal = parseFloat(amount) || 0;
    if (amtVal <= 0) return triggerToast('❌ الرجاء إدخال مبلغ صحيح');

    const exp: Expense = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      desc,
      amount: amtVal,
      date: new Date().toISOString()
    };

    const ok = await putWithOutbox(`/expenses/${exp.id}.json`, exp);
    if (ok) {
      triggerToast('✅ تم تسجيل المصروف الجديد');
      logAudit('edit', `تسجيل مصروف يومي: ${desc} (${amtVal} د.ت)`);
      setExpenseInput({ desc: '', amount: '' });
      loadAllData();
    }
  };

  const handleDeleteExpense = async (id: string) => {
    const exp = expenses.find(e => e.id === id);
    if (!exp) return;
    if (!await promptAndVerifyPin(`هل ترغب بمسح المصروف "${exp.desc}"؟`)) return;

    try {
      await fetch(dbUrl(`/expenses/${id}.json`), { method: 'DELETE' });
      triggerToast('✅ تم مسح المصروف');
      logAudit('delete', `حذف مصروف يومي: ${exp.desc} (${exp.amount} د.ت)`);
      loadAllData();
    } catch (e) {}
  };

  // ---- 5. Debt Actions ----
  const handleAddManualDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    const { name, phone, amount, note } = manualDebt;
    if (!name) return triggerToast('❌ أدخل اسم الحريف');
    const amtVal = parseFloat(amount) || 0;
    if (amtVal <= 0) return triggerToast('❌ أدخل مبلغاً صحيحاً');

    const debt: Debt = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      customerName: name,
      customerPhone: phone || undefined,
      note: note || 'دين يدوي',
      amount: amtVal,
      paid: 0,
      date: new Date().toISOString(),
      status: 'open'
    };

    const ok = await putWithOutbox(`/debts/${debt.id}.json`, debt);
    if (ok) {
      triggerToast('✅ تم تسجيل الدين اليدوي بنجاح');
      logAudit('sale', `تسجيل دين يدوي على ${name}: ${amtVal} د.ت`);
      setManualDebt({ name: '', phone: '', amount: '', note: '' });
      loadAllData();
    }
  };

  const handlePayDebt = async (debtId: string, fullPayment: boolean) => {
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return;
    const remaining = debt.amount - debt.paid;
    let payAmount = remaining;

    if (!fullPayment) {
      const input = prompt(`قداش دفع الحريف؟ (المتبقي: ${remaining.toFixed(3)} د.ت)`, remaining.toFixed(3));
      if (input === null) return;
      payAmount = parseFloat(input);
      if (isNaN(payAmount) || payAmount <= 0) return triggerToast('❌ رقم غير صالح');
      if (payAmount > remaining) payAmount = remaining;
    }

    // Fix 3: Linking payment record to debt details
    const incomeEntry: OtherIncome = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      category: 'debt_payment',
      label: `خلاص دين - ${debt.customerName} (${debt.note})`,
      amount: payAmount,
      commission: payAmount,
      date: new Date().toISOString(),
      debtId: debt.id // Fixed unlinked payment issue
    };

    const updatedDebt: Debt = {
      ...debt,
      paid: debt.paid + payAmount,
      status: (debt.paid + payAmount >= debt.amount - 0.001) ? 'paid' : 'open'
    };

    const ok1 = await putWithOutbox(`/debts/${debt.id}.json`, updatedDebt);
    const ok2 = await putWithOutbox(`/otherIncome/${incomeEntry.id}.json`, incomeEntry);

    if (ok1 && ok2) {
      triggerToast(updatedDebt.status === 'paid' ? '🎉 تم سداد الدين بالكامل!' : `✅ تم تسجيل دفعة بقيمة ${payAmount.toFixed(3)} د.ت`);
      logAudit('sale', `تسديد جزئي/كلي لدين ${debt.customerName}: ${payAmount} د.ت`);
      loadAllData();
    }
  };

  const handleDeleteDebt = async (id: string) => {
    const debt = debts.find(d => d.id === id);
    if (!debt) return;
    if (!await promptAndVerifyPin(`هل ترغب بحذف ملف دين الحريف "${debt.customerName}" نهائياً؟`)) return;

    // Rollback items to inventory
    if (debt.lines) {
      for (const line of debt.lines) {
        if (line.type === 'item' && line.itemId) {
          await safeIncrementItemQty(line.itemId, line.qty);
        }
      }
    }

    try {
      await fetch(dbUrl(`/debts/${id}.json`), { method: 'DELETE' });
      triggerToast('✅ تم حذف الدين ورجعت السلع للمستودع');
      logAudit('delete', `حذف ملف دين بالكامل: ${debt.customerName}`);
      loadAllData();
    } catch (e) {}
  };

  // ---- 6. Unified Billing Cart Logic ----
  const handleAddToCart = () => {
    if (incomeType === 'item') {
      const selected = items.find(i => i.id === sellItemId);
      if (!selected) return triggerToast('❌ الرجاء اختيار سلعة');
      const qtyVal = parseInt(sellQty) || 0;
      if (qtyVal <= 0) return triggerToast('❌ كمية غير صالحة');
      
      const cartAlready = cart.filter(c => c.type === 'item' && c.itemId === selected.id).reduce((s, c) => s + c.qty, 0);
      if (qtyVal + cartAlready > selected.qty) {
        return triggerToast(`❌ المخزن غير كافي! المتوفر حالياً: ${selected.qty - cartAlready}`);
      }

      const override = parseFloat(sellPriceOverride);
      const finalPrice = !isNaN(override) && override >= 0 ? override : selected.sell;

      const newLine: CartLine = {
        id: Math.random().toString(36).slice(2, 9),
        type: 'item',
        itemId: selected.id,
        label: selected.name,
        qty: qtyVal,
        unitPrice: finalPrice,
        unitBuy: selected.buy,
        total: qtyVal * finalPrice
      };
      setCart(prev => [...prev, newLine]);
      setSellQty('1');
      setSellPriceOverride('');
      triggerToast('✅ تمت إضافة السلعة للفاتورة الحالية');
    }

    else if (incomeType === 'recharge') {
      const [face, price, margin] = rechargeValOpt.split('|').map(Number);
      const qtyVal = parseInt(rechargeQty) || 1;
      if (qtyVal <= 0) return;

      const override = parseFloat(rechargePriceOverride);
      const finalPrice = !isNaN(override) && override >= 0 ? override : price;
      const finalTotal = finalPrice * qtyVal;
      const finalCommission = (finalPrice - face) * qtyVal;

      const newLine: CartLine = {
        id: Math.random().toString(36).slice(2, 9),
        type: 'recharge',
        label: `شحن بطاقة ${rechargeOp} فئة ${face} د.ت`,
        qty: qtyVal,
        unitPrice: finalPrice,
        total: finalTotal,
        commission: finalCommission,
        cardOperator: rechargeOp,
        cardValue: String(face)
      };
      setCart(prev => [...prev, newLine]);
      setRechargeQty('1');
      setRechargePriceOverride('');
      triggerToast('✅ تم إضافة الكارت للفاتورة');
    }

    else if (incomeType === 'forfait') {
      const plan = forfaitPlans.find(p => p.id === forfaitPlanId);
      if (!plan) return triggerToast('❌ الرجاء اختيار باقة فورفاي');
      const override = parseFloat(forfaitPriceOverride);
      const finalPrice = !isNaN(override) && override >= 0 ? override : plan.price;

      const label = `فورفاي ${forfaitOp} — ${plan.name}${plan.validity ? ' ('+plan.validity+')' : ''}${forfaitCustomerPhone ? ' للأرقام: '+forfaitCustomerPhone : ''}`;
      
      const newLine: CartLine = {
        id: Math.random().toString(36).slice(2, 9),
        type: 'forfait',
        label,
        qty: 1,
        unitPrice: finalPrice,
        total: finalPrice,
        commission: finalPrice, // Commission is the full price from operator balance depletion
        cardOperator: forfaitOp,
        customerPhone: forfaitCustomerPhone
      };
      setCart(prev => [...prev, newLine]);
      setForfaitCustomerPhone('');
      setForfaitPriceOverride('');
      triggerToast('✅ تم إضافة شحن الفورفاي للفاتورة');
    }

    else if (incomeType === 'photo') {
      const desc = photoDesc.trim() || 'صور شمسية';
      const qtyVal = parseInt(photoQty) || 1;
      const amtVal = parseFloat(photoAmount) || 0;
      if (amtVal <= 0) return triggerToast('❌ أدخل مبلغ الخدمة');

      const newLine: CartLine = {
        id: Math.random().toString(36).slice(2, 9),
        type: 'photo',
        label: `${desc} × ${qtyVal}`,
        qty: 1,
        unitPrice: amtVal,
        total: amtVal,
        commission: amtVal
      };
      setCart(prev => [...prev, newLine]);
      setPhotoDesc('');
      setPhotoQty('1');
      setPhotoAmount('');
      triggerToast('✅ تم إضافة خدمة الصور للفاتورة');
    }

    else if (incomeType === 'service') {
      const desc = serviceType === 'other' ? serviceCustomDesc.trim() : serviceType;
      if (!desc) return triggerToast('❌ حدد نوع الخدمة');
      const amtVal = parseFloat(serviceAmount) || 0;
      if (amtVal <= 0) return triggerToast('❌ أدخل مبلغ الخدمة');

      const newLine: CartLine = {
        id: Math.random().toString(36).slice(2, 9),
        type: 'service',
        label: `خدمة صيانة: ${desc}`,
        qty: 1,
        unitPrice: amtVal,
        total: amtVal,
        commission: amtVal
      };
      setCart(prev => [...prev, newLine]);
      setServiceCustomDesc('');
      setServiceAmount('');
      triggerToast('✅ تم إضافة خدمة الصيانة للفاتورة');
    }
  };

  const handleRemoveFromCart = (id: string) => {
    setCart(prev => prev.filter(c => c.id !== id));
  };

  const handleFinalizeInvoice = async (showInvoice: boolean) => {
    if (cart.length === 0) return triggerToast('❌ الفاتورة فارغة لتوة');
    if (invoiceIsDebt && !invoiceCustomerName) return triggerToast('❌ يرجى كتابة اسم الحريف لتسجيل الدين');

    // Optimistic stock decrement checking first
    const itemsToDecrement = cart.filter(c => c.type === 'item' && c.itemId);
    const successList: { itemId: string; amt: number }[] = [];
    let stockError = '';

    for (const line of itemsToDecrement) {
      const res = await safeDecrementItemQty(line.itemId!, line.qty);
      if (res.success) {
        successList.push({ itemId: line.itemId!, amt: line.qty });
      } else {
        stockError = res.reason === 'insufficient' 
          ? `❌ السلعة "${line.label}" لم تعد كافية بالمخزن! المتبقي: ${res.available}`
          : `❌ فشل تحديث المخزن للسلعة "${line.label}" بسبب تداخل بالشبكة`;
        break;
      }
    }

    // Rollback if any error occurred
    if (stockError) {
      for (const item of successList) {
        await safeIncrementItemQty(item.itemId, item.amt);
      }
      return triggerToast(stockError);
    }

    // Process other balances (deplete card stock & forfait balance)
    for (const line of cart) {
      if (line.type === 'recharge' && line.cardOperator && line.cardValue) {
        const entry = cardStock.find(c => c.operator === line.cardOperator && c.value === line.cardValue);
        if (entry) {
          await putWithOutbox(`/cardStock/${entry.id}.json`, {
            ...entry,
            qty: Math.max(0, entry.qty - line.qty)
          });
        }
      }
      if (line.type === 'forfait' && line.cardOperator) {
        const curBal = forfaitBalance[line.cardOperator] || 0;
        await putWithOutbox('/forfaitBalance.json', {
          ...forfaitBalance,
          [line.cardOperator]: Math.max(0, curBal - line.unitPrice)
        });
      }
    }

    const date = new Date().toISOString();
    const grandTotal = cart.reduce((s, c) => s + c.total, 0);

    if (invoiceIsDebt) {
      const debtLines = cart.map(c => ({
        type: c.type,
        itemId: c.itemId || null,
        itemName: c.type === 'item' ? c.label : null,
        qty: c.qty,
        cardOperator: c.cardOperator || null,
        cardValue: c.cardValue || null,
        total: c.total
      }));

      const newDebt: Debt = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        customerName: invoiceCustomerName,
        customerPhone: invoiceCustomerPhone || undefined,
        note: cart.map(c => c.label).join(' + '),
        lines: debtLines,
        amount: grandTotal,
        paid: 0,
        date,
        status: 'open'
      };

      await putWithOutbox(`/debts/${newDebt.id}.json`, newDebt);
      logAudit('sale', `فاتورة مبيعات بالدين للحريف ${invoiceCustomerName}: ${grandTotal} د.ت`);
      triggerToast(`🧾 تم حفظ الفاتورة بالكامل بالدين على ${invoiceCustomerName}`);
    } else {
      // Create Sale records for items or OtherIncome records for other services
      for (const line of cart) {
        const rId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.floor(Math.random() * 100);
        if (line.type === 'item') {
          const sale: Sale = {
            id: rId,
            itemId: line.itemId || null,
            itemName: line.label,
            qty: line.qty,
            unitPrice: line.unitPrice,
            unitBuy: line.unitBuy || 0,
            total: line.total,
            date
          };
          await putWithOutbox(`/sales/${sale.id}.json`, sale);
        } else {
          const income: OtherIncome = {
            id: rId,
            category: line.type,
            label: line.label,
            amount: line.total,
            commission: line.commission || 0,
            date,
            cardOperator: line.cardOperator || null,
            cardValue: line.cardValue || null,
            qty: line.qty || null
          };
          await putWithOutbox(`/otherIncome/${income.id}.json`, income);
        }
      }
      logAudit('sale', `فاتورة بيع نقدية جديدة: ${grandTotal} د.ت`);
      triggerToast('✅ تم تسجيل المبيعات النقدية وتحديث الخزينة');
    }

    if (showInvoice) {
      // Set preview invoice modal
      setLastInvoice({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5).toUpperCase(),
        lines: cart.map(c => ({
          name: c.label,
          qty: c.qty,
          unitPrice: c.unitPrice,
          total: c.total
        })),
        grandTotal,
        date,
        isDebt: invoiceIsDebt,
        customerName: invoiceCustomerName || undefined
      });
    } else {
      setLastInvoice(null);
    }

    // Reset Form
    setCart([]);
    setInvoiceCustomerName('');
    setInvoiceCustomerPhone('');
    setInvoiceIsDebt(false);
    loadAllData();
  };

  const handleDeleteHistorySale = async (id: string, isSaleRecord: boolean) => {
    if (!id) {
      triggerToast('❌ خطأ: لم يتم العثور على معرف العملية للحذف');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: 'إلغاء العملية وحذفها',
      message: 'هل تريد إلغاء ومسح هذا المدخول وإرجاع الستوك للمخازن؟',
      confirmText: 'تأكيد الحذف 🗑️',
      cancelText: 'إلغاء ❌',
      isDanger: true,
      onConfirm: async () => {
        if (isSaleRecord) {
          const record = sales.find(s => s.id === id);
          if (record) {
            if (record.itemId) {
              await safeIncrementItemQty(record.itemId, record.qty);
            }
          }
          try {
            const res = await fetch(dbUrl(`/sales/${id}.json`), { method: 'DELETE' });
            if (res.ok) {
              triggerToast('✅ تم إلغاء البيع وإعادة الستوك');
              logAudit('delete', `إلغاء بيع سلع: ${record?.itemName || 'غير معروف'}`);
              loadAllData();
            } else {
              triggerToast('❌ فشل حذف العملية من الخادم السحابي');
            }
          } catch (e) {
            triggerToast('❌ فشل الاتصال بالإنترنت لحذف العملية');
          }
        } else {
          const record = otherIncome.find(o => o.id === id);
          if (record) {
            // Rollback recharge
            if (record.category === 'recharge' && record.cardOperator && record.cardValue) {
              const card = cardStock.find(c => c.operator === record.cardOperator && c.value === record.cardValue);
              if (card) {
                await putWithOutbox(`/cardStock/${card.id}.json`, { ...card, qty: card.qty + (record.qty || 1) });
              }
            }
            // Rollback forfait balance
            if (record.category === 'forfait' && record.cardOperator) {
              const curBal = forfaitBalance[record.cardOperator] || 0;
              await putWithOutbox('/forfaitBalance.json', { ...forfaitBalance, [record.cardOperator]: curBal + record.amount });
            }
          }
          try {
            const res = await fetch(dbUrl(`/otherIncome/${id}.json`), { method: 'DELETE' });
            if (res.ok) {
              triggerToast('✅ تم إلغاء وحذف المدخول بنجاح');
              logAudit('delete', `إلغاء مدخول: ${record?.label || 'غير معروف'}`);
              loadAllData();
            } else {
              triggerToast('❌ فشل حذف العملية من الخادم السحابي');
            }
          } catch (e) {
            triggerToast('❌ فشل الاتصال بالإنترنت لحذف العملية');
          }
        }
      }
    });
  };

  // ---- 7. General Admin resets / utilities ----
  const handleSaveStartingCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!await promptAndVerifyPin('أدخل الرمز السري لتسجيل فلوس الكاسة الحالية:')) return;
    const inputVal = parseFloat((document.getElementById('starting-cash-inp') as HTMLInputElement)?.value) || 0;
    
    const ok = await putWithOutbox('/cashRegister.json', inputVal);
    if (ok) {
      setCashRegister(inputVal);
      triggerToast('✅ تم تحديث كاش الكاسة الأساسي');
      logAudit('pin', `تعديل رصيد بداية الكاسة: ${inputVal} د.ت`);
      loadAllData();
    }
  };

  const handleMergeDuplicates = async () => {
    const map: Record<string, Item[]> = {};
    items.forEach(i => {
      const norm = normalizeArabic(i.name);
      if (!map[norm]) map[norm] = [];
      map[norm].push(i);
    });

    const duplicates = Object.values(map).filter(arr => arr.length > 1);
    if (duplicates.length === 0) return triggerToast('✅ لا توجد أي سلع مكررة حالياً');

    if (!await promptAndVerifyPin('هل ترغب بدمج السلع المكررة وتجميع كمياتها تلقائياً؟')) return;

    for (const group of duplicates) {
      const keep = group[0];
      const totalQty = group.reduce((s, i) => s + i.qty, 0);
      const mergedBarcodes = Array.from(new Set(group.flatMap(i => i.barcodes || [])));

      await putWithOutbox(`/items/${keep.id}.json`, {
        ...keep,
        qty: totalQty,
        barcodes: mergedBarcodes
      });

      // Delete other duplicate instances
      for (let x = 1; x < group.length; x++) {
        await fetch(dbUrl(`/items/${group[x].id}.json`), { method: 'DELETE' });
      }
    }

    triggerToast('🧹 تم تجميع ودمج السلع المكررة بنجاح!');
    logAudit('merge', `دمج السلع المتشابهة بالاسم وتجميع الستوك`);
    loadAllData();
  };

  const handleResetIncomeHistory = async (days: number) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const salesToRemove = sales.filter(s => new Date(s.date).getTime() >= cutoff);
    const otherToRemove = otherIncome.filter(o => new Date(o.date).getTime() >= cutoff);

    if (salesToRemove.length === 0 && otherToRemove.length === 0) {
      return triggerToast('❌ لا توجد أي مبيعات مسجلة في هذه الفترة المحددة');
    }

    if (!await promptAndVerifyPin(`⚠️ هل أنت متأكد من مسح ${salesToRemove.length} مبيعة و ${otherToRemove.length} مدخول آخر لآخر ${days} أيام؟`)) return;

    for (const s of salesToRemove) {
      await fetch(dbUrl(`/sales/${s.id}.json`), { method: 'DELETE' });
    }
    for (const o of otherToRemove) {
      await fetch(dbUrl(`/otherIncome/${o.id}.json`), { method: 'DELETE' });
    }

    triggerToast('🧹 تم تصفير المدخول للفترة المحددة');
    logAudit('reset', `تصفير المداخيل لآخر ${days} أيام`);
    loadAllData();
  };

  // Change security pin
  const handleChangePin = async () => {
    const current = prompt('أدخل رمز المدير الحالي:');
    if (!current) return;
    
    const isCurrentOk = await verifyManagerPinViaAuth(current);
    const currentH = await sha256Hex(current);
    
    if (!isCurrentOk && currentH !== managerPin) {
      return triggerToast('❌ الرمز الحالي غير صحيح');
    }

    const next = prompt('أدخل رمز المدير الجديد:');
    if (!next || next.trim().length < 4) return triggerToast('❌ يجب أن يتكون الرمز من 4 أرقام على الأقل');

    const nextTrimmed = next.trim();
    
    // Try to update on Firebase Auth first
    const updateAuthSuccess = await updateManagerPinViaAuth(nextTrimmed);
    
    // Also save hash to RTDB /pin.json as backup/offline verification
    const nextH = await sha256Hex(nextTrimmed);
    const res = await fetch(dbUrl('/pin.json'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextH)
    });

    if (updateAuthSuccess || res.ok) {
      setManagerPin(nextH);
      triggerToast('✅ تم تغيير رمز المدير السري بنجاح');
      logAudit('pin', 'تحديث وتغيير رمز المرور السري للمدير');
    } else {
      triggerToast('❌ فشل تغيير الرمز السري، تأكد من الاتصال بالإنترنت');
    }
  };

  // Backup downloader
  const handleDownloadBackup = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      items, sales, otherIncome, debts, cardStock, expenses, cashRegister, forfaitPlans, forfaitBalance
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Yosri_GSM_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    triggerToast('✅ تم تحميل النسخة الاحتياطية بنجاح');
  };

  // ---- 8. Barcode Scanning Handling ----
  const handleBarcodeScanned = async (code: string) => {
    setScannerContext(null); // Close camera popup
    const trimmed = code.trim();
    if (!trimmed) return;

    // Split barcode input by comma and clean whitespace
    const codes = trimmed.split(',').map(c => c.trim()).filter(Boolean);
    if (codes.length === 0) return;

    if (scannerContext === 'stock') {
      const newBarcodesToAdd: string[] = [];
      for (const singleCode of codes) {
        const match = items.find(i => i.barcodes?.includes(singleCode));
        if (match) {
          const amtStr = prompt(`السلعة "${match.name}" موجودة بالستوك بالباركود (${singleCode}). أدخل الكمية الإضافية لزيادتها:`, '1');
          if (amtStr) {
            const amt = parseInt(amtStr, 10);
            if (amt > 0) {
              const result = await safeIncrementItemQty(match.id, amt);
              if (result.success) {
                triggerToast(`✅ تم تحديث كمية السلعة "${match.name}" بنجاح`);
                logAudit('edit', `تحديث ستوك عبر الباركود: ${match.name} (+${amt})`);
                loadAllData();
              }
            }
          }
        } else {
          newBarcodesToAdd.push(singleCode);
        }
      }
      
      if (newBarcodesToAdd.length > 0) {
        setNewItem(prev => {
          const currentBarcode = prev.barcode ? prev.barcode.trim() : '';
          const existingList = currentBarcode.split(',').map(x => x.trim()).filter(Boolean);
          
          const filteredNew = newBarcodesToAdd.filter(b => !existingList.includes(b));
          if (filteredNew.length === 0) {
            triggerToast('⚠️ الأكواد مضافة بالفعل في الخانة');
            return prev;
          }
          
          const updatedList = [...existingList, ...filteredNew];
          const finalBarcode = updatedList.join(', ');
          return { ...prev, barcode: finalBarcode };
        });
        triggerToast(`🆕 تم إضافة ${newBarcodesToAdd.length} كود جديد لخانة الباركود`);
      }
    }

    else if (scannerContext === 'sell') {
      let addedCount = 0;
      let missingCount = 0;
      
      const newLines: CartLine[] = [];
      for (const singleCode of codes) {
        const match = items.find(i => i.barcodes?.includes(singleCode));
        if (!match) {
          missingCount++;
          continue;
        }
        if (match.qty <= 0) {
          triggerToast(`❌ السلعة "${match.name}" منتهية من المستودع`);
          continue;
        }

        const cartAlready = [...cart, ...newLines]
          .filter(c => c.type === 'item' && c.itemId === match.id)
          .reduce((s, c) => s + c.qty, 0);

        if (cartAlready >= match.qty) {
          triggerToast(`❌ تجاوزت الستوك المتوفر للسلعة "${match.name}"`);
          continue;
        }

        newLines.push({
          id: Math.random().toString(36).slice(2, 9),
          type: 'item',
          itemId: match.id,
          label: match.name,
          qty: 1,
          unitPrice: match.sell,
          unitBuy: match.buy,
          total: match.sell
        });
        addedCount++;
      }

      if (newLines.length > 0) {
        setCart(prev => [...prev, ...newLines]);
      }

      if (addedCount > 0) {
        triggerToast(`🛍️ تم إضافة ${addedCount} سلعة إلى الفاتورة`);
      }
      if (missingCount > 0) {
        triggerToast(`❌ لم يتم العثور على ${missingCount} من الأكواد الممسوحة`);
      }
    }

    else if (scannerContext?.startsWith('manage-')) {
      const itemId = scannerContext.replace('manage-', '');
      const match = items.find(i => i.id === itemId);
      if (!match) return;

      const currentBarcodes = match.barcodes || [];
      const updatedBarcodes = [...currentBarcodes];
      let addedAny = false;
      
      for (const singleCode of codes) {
        const isTaken = items.find(i => i.barcodes?.includes(singleCode) && i.id !== itemId);
        if (isTaken) {
          triggerToast(`❌ الباركود ${singleCode} مستخدم بالفعل مع سلعة أخرى: "${isTaken.name}"`);
          continue;
        }
        
        if (updatedBarcodes.includes(singleCode)) {
          triggerToast(`⚠️ الباركود ${singleCode} مسجل مسبقاً لهذه السلعة`);
          continue;
        }
        
        updatedBarcodes.push(singleCode);
        addedAny = true;
      }
      
      if (addedAny) {
        const updated = {
          ...match,
          barcodes: updatedBarcodes
        };
        const ok = await putWithOutbox(`/items/${match.id}.json`, updated);
        if (ok) {
          triggerToast(`✅ تم ربط الباركود الإضافي لـ "${match.name}"`);
          loadAllData();
        }
      }
    }
  };

  // ---- 9. Dashboard Financial Calculations ----
  const totalSales = sales.reduce((s, c) => s + c.total, 0);
  const totalOther = otherIncome.reduce((s, c) => s + c.amount, 0);
  const totalExpenses = expenses.reduce((s, c) => s + c.amount, 0);
  const totalOwed = debts.filter(d => d.status === 'open').reduce((s, d) => s + (d.amount - d.paid), 0);

  // Profit calculations
  const totalBuyCostOfSales = sales.reduce((s, c) => s + ((c.unitBuy || 0) * c.qty), 0);
  const totalItemProfits = totalSales - totalBuyCostOfSales;
  const totalOtherProfits = otherIncome.reduce((s, c) => s + (c.commission || 0), 0);
  const netProfit = totalItemProfits + totalOtherProfits - totalExpenses;

  // Expected Cash register cash
  const expectedCashInHand = cashRegister + totalSales + totalOther - totalExpenses;

  // Render variables
  const openDebts = debts.filter(d => d.status === 'open' && (!debtSearch || normalizeArabic(d.customerName).includes(normalizeArabic(debtSearch))));
  const paidDebts = debts.filter(d => d.status === 'paid').slice(-8).reverse();
  const lowStockItems = items.filter(i => i.qty <= 3);

  const filteredItems = items.filter(i => !stockSearch || normalizeArabic(i.name).includes(normalizeArabic(stockSearch)));
  const sellFilteredItems = items.filter(i => !sellSearch || normalizeArabic(i.name).includes(normalizeArabic(sellSearch)));

  // Filtered History for Manager
  const filteredHistory = useMemo(() => {
    const rawSales = sales.map(s => ({
      id: s.id,
      itemId: s.itemId,
      itemName: s.itemName,
      qty: s.qty,
      unitPrice: s.unitPrice,
      unitBuy: s.unitBuy,
      total: s.total,
      date: s.date,
      isSale: true,
      category: 'item',
      label: `${s.itemName} × ${s.qty}`,
      icon: '🛍️'
    }));

    const rawOther = otherIncome.map(o => ({
      id: o.id,
      category: o.category,
      label: o.label,
      amount: o.amount,
      commission: o.commission,
      date: o.date,
      isSale: false,
      total: o.amount,
      icon: o.category === 'recharge' ? '📶' : o.category === 'forfait' ? '🌐' : o.category === 'photo' ? '🪪' : '🔧'
    }));

    let combined = [...rawSales, ...rawOther];

    // 1. Search Filter
    if (historySearch.trim()) {
      const q = normalizeArabic(historySearch.trim());
      combined = combined.filter(item => normalizeArabic(item.label || '').includes(q));
    }

    // 2. Category Filter
    if (historyCategory !== 'all') {
      combined = combined.filter(item => item.category === historyCategory);
    }

    // 3. Date Filter
    if (historyDateFilter !== 'all') {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
      const startOf7Days = startOfToday - 7 * 24 * 60 * 60 * 1000;
      const startOf30Days = startOfToday - 30 * 24 * 60 * 60 * 1000;

      combined = combined.filter(item => {
        const itemTime = new Date(item.date).getTime();
        if (historyDateFilter === 'today') {
          return itemTime >= startOfToday;
        } else if (historyDateFilter === 'yesterday') {
          return itemTime >= startOfYesterday && itemTime < startOfToday;
        } else if (historyDateFilter === '7days') {
          return itemTime >= startOf7Days;
        } else if (historyDateFilter === '30days') {
          return itemTime >= startOf30Days;
        }
        return true;
      });
    }

    return combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [sales, otherIncome, historySearch, historyCategory, historyDateFilter]);

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col font-sans" dir="rtl">
      {/* Toast Notifications */}
      {toastMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-900 text-white px-5 py-3 rounded-full text-xs font-bold shadow-2xl z-50 animate-fade-in flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
          {toastMsg}
        </div>
      )}

      {/* Header */}
      <header className="bg-stone-900 text-stone-100 py-6 px-5 relative border-b-2 border-red-700/40 select-none shadow-xl">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-center sm:text-right">
            <h1 className="text-2xl font-black tracking-tight flex items-center justify-center sm:justify-start gap-2.5 text-white">
              <span className="p-1.5 bg-red-700/10 text-red-500 rounded-xl border border-red-500/20">📱</span>
              Yosri GSM
            </h1>
            <p className="text-[11px] text-stone-400 mt-1.5 font-medium">تسيير مبيعات وستوك المحل — مزامنة سحابية فائقة السرعة</p>
          </div>
          <div className="flex items-center gap-3.5">
            <div className="flex flex-col items-center sm:items-end gap-1.5">
              <span className={`text-[10px] px-3 py-1 rounded-full font-extrabold flex items-center gap-1.5 border ${
                connectionStatus === 'connected' 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  connectionStatus === 'connected' ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'
                }`} />
                {connectionStatus === 'connected' ? 'مزامنة نشطة' : 'جاري الاتصال...'}
              </span>
              {currentRole && (
                <button 
                  onClick={handleLogout}
                  className="text-stone-400 hover:text-red-400 text-[11px] font-bold transition-colors flex items-center gap-1.5 mt-0.5 cursor-pointer hover:underline"
                >
                  <LogOut size={12} />
                  تبديل الواجهة
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Tab Navigation */}
      {currentRole && (
        <nav className="bg-white/90 backdrop-blur-md border-b border-stone-200 sticky top-0 z-30 shadow-sm px-4 py-2.5">
          <div className="max-w-4xl mx-auto flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
            {currentRole === 'manager' && (
              <button 
                onClick={() => setCurrentTab('dashboard')}
                className={`flex-1 min-w-[95px] py-2 px-3 text-xs font-black text-center rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 select-none ${
                  currentTab === 'dashboard' 
                    ? 'bg-red-700 text-white shadow-md shadow-red-700/15 scale-[1.03]' 
                    : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-800'
                }`}
              >
                <span>📊</span>
                <span>لوحة التحكم</span>
              </button>
            )}
            <button 
              onClick={() => setCurrentTab('stock')}
              className={`flex-1 min-w-[110px] py-2 px-3 text-xs font-black text-center rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 select-none ${
                currentTab === 'stock' 
                  ? 'bg-red-700 text-white shadow-md shadow-red-700/15 scale-[1.03]' 
                  : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-800'
              }`}
            >
              <span>📦</span>
              <span>المخازن والأسعار</span>
            </button>
            <button 
              onClick={() => setCurrentTab('income')}
              className={`flex-1 min-w-[110px] py-2 px-3 text-xs font-black text-center rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 select-none ${
                currentTab === 'income' 
                  ? 'bg-red-700 text-white shadow-md shadow-red-700/15 scale-[1.03]' 
                  : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-800'
              }`}
            >
              <span>💵</span>
              <span>الكاسة والمبيعات</span>
            </button>
            <button 
              onClick={() => setCurrentTab('debts')}
              className={`flex-1 min-w-[80px] py-2 px-3 text-xs font-black text-center rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 select-none ${
                currentTab === 'debts' 
                  ? 'bg-red-700 text-white shadow-md shadow-red-700/15 scale-[1.03]' 
                  : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-800'
              }`}
            >
              <span>💳</span>
              <span>الديون</span>
            </button>
            {currentRole === 'manager' && (
              <>
                <button 
                  onClick={() => setCurrentTab('history')}
                  className={`flex-1 min-w-[130px] py-2 px-3 text-xs font-black text-center rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 select-none ${
                    currentTab === 'history' 
                      ? 'bg-red-700 text-white shadow-md shadow-red-700/15 scale-[1.03]' 
                      : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-800'
                  }`}
                >
                  <span>📝</span>
                  <span>سجل البيع والعمليات</span>
                </button>
                <button 
                  onClick={() => setCurrentTab('settings')}
                  className={`p-2 rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center select-none ${
                    currentTab === 'settings' 
                      ? 'bg-red-700 text-white shadow-md shadow-red-700/15 scale-[1.03]' 
                      : 'text-stone-500 hover:bg-stone-100/80 hover:text-stone-800'
                  }`}
                  title="الإعدادات"
                >
                  <SettingsIcon size={15} />
                </button>
              </>
            )}
          </div>
        </nav>
      )}

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 pb-20">
        
        {/* Authenticated Application */}
        {currentRole ? (
          <div>
            
            {/* TAB 1: DASHBOARD (Manager Only) */}
            {currentTab === 'dashboard' && currentRole === 'manager' && (
              <div className="space-y-4">
                {/* Expected cash starting card */}
                <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-base flex items-center gap-2">
                    💵 رصيد صندوق الكاسة الأساسي
                  </h3>
                  <p className="text-stone-500 text-[11px] mt-1">يُرجى إدخال الرصيد الافتتاحي للدرج لبدء حسابات اليوم بدقة:</p>
                  
                  <form onSubmit={handleSaveStartingCash} className="flex gap-2 mt-3">
                    <input 
                      id="starting-cash-inp"
                      type="number" 
                      step="0.001"
                      placeholder="0.000"
                      className="flex-1 bg-white border border-stone-200 px-3 py-2 rounded-xl text-stone-800 font-mono text-sm"
                    />
                    <button type="submit" className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-4 rounded-xl text-xs cursor-pointer">
                      سجل كاش البداية
                    </button>
                  </form>
                  
                  <div className="mt-4 flex justify-between items-center bg-white/70 border border-amber-200 rounded-xl p-3">
                    <span className="text-stone-600 text-xs">كاش البداية المسجل:</span>
                    <span className="font-mono font-bold text-red-800 text-lg">{cashRegister.toFixed(3)} د.ت</span>
                  </div>
                </div>

                {/* Dashboard Stats Panel */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs text-center">
                    <span className="text-xs text-stone-400">إجمالي السلع</span>
                    <div className="font-mono text-xl font-black text-stone-800 mt-1">{items.length}</div>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs text-center">
                    <span className="text-xs text-stone-400">مخزون القطع</span>
                    <div className="font-mono text-xl font-black text-stone-800 mt-1">
                      {items.reduce((s, i) => s + i.qty, 0)}
                    </div>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs text-center">
                    <span className="text-xs text-stone-400">مبيعات السلع</span>
                    <div className="font-mono text-xl font-black text-emerald-700 mt-1">{totalSales.toFixed(2)} د.ت</div>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs text-center">
                    <span className="text-xs text-stone-400">شحن وخدمات</span>
                    <div className="font-mono text-xl font-black text-amber-700 mt-1">{totalOther.toFixed(2)} د.ت</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-amber-500/10 border border-amber-300 p-4 rounded-2xl text-center">
                    <span className="text-xs text-amber-800 font-bold">الربح الصافي الإجمالي</span>
                    <div className="font-mono text-2xl font-black text-amber-700 mt-1">{netProfit.toFixed(3)} د.ت</div>
                  </div>
                  <div className="bg-rose-500/10 border border-rose-300 p-4 rounded-2xl text-center">
                    <span className="text-xs text-rose-800 font-bold">المصاريف الكلية</span>
                    <div className="font-mono text-2xl font-black text-rose-700 mt-1">{totalExpenses.toFixed(3)} د.ت</div>
                  </div>
                  <div className="bg-stone-800 text-stone-100 p-4 rounded-2xl text-center col-span-1 md:col-span-1">
                    <span className="text-xs text-stone-400">الكاش المتوقع بالصندوق</span>
                    <div className="font-mono text-2xl font-black text-amber-400 mt-1">{expectedCashInHand.toFixed(3)} د.ت</div>
                  </div>
                </div>

                {/* Svg Chart */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-extrabold text-stone-800 text-xs flex items-center gap-1.5">
                      <TrendingUp size={16} className="text-red-700" />
                      إحصائيات المبيعات والأرباح
                    </h3>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setChartDayOffset(prev => prev - 1)} className="p-1 hover:bg-stone-100 rounded-lg text-xs font-bold text-stone-600">◀</button>
                      <span className="text-[10px] text-stone-500 font-bold px-1">اليوم: {chartDayOffset}</span>
                      <button onClick={() => setChartDayOffset(prev => Math.min(0, prev + 1))} className="p-1 hover:bg-stone-100 rounded-lg text-xs font-bold text-stone-600">▶</button>
                    </div>
                  </div>
                  <SvgChart 
                    sales={sales} 
                    otherIncome={otherIncome} 
                    expenses={expenses} 
                    chartDayOffset={chartDayOffset} 
                  />
                </div>

                {/* Daily Expenses Section */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-sm mb-3 text-red-800">💸 تسجيل المصاريف اليومية</h3>
                  <form onSubmit={handleAddExpense} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input 
                      type="text" 
                      placeholder="وصف المصروف"
                      value={expenseInput.desc}
                      onChange={e => setExpenseInput(prev => ({ ...prev, desc: e.target.value }))}
                      className="bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                    />
                    <input 
                      type="number" 
                      step="0.001"
                      placeholder="المبلغ د.ت"
                      value={expenseInput.amount}
                      onChange={e => setExpenseInput(prev => ({ ...prev, amount: e.target.value }))}
                      className="bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                    />
                    <button type="submit" className="bg-red-700 hover:bg-red-800 text-white font-bold rounded-xl text-xs py-2 cursor-pointer flex items-center justify-center gap-1">
                      <Plus size={14} /> سجل المصروف
                    </button>
                  </form>

                  {/* List of expenses */}
                  <div className="mt-4 space-y-1.5 max-h-60 overflow-y-auto pr-1">
                    {expenses.length === 0 ? (
                      <p className="text-center text-stone-400 py-4 text-xs">لا توجد مصاريف مسجلة</p>
                    ) : (
                      expenses.slice(0, expensesLimit).map((e, idx) => (
                        <div key={idx} className="flex justify-between items-center text-xs p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                          <div>
                            <span className="font-bold text-stone-800">{e.desc}</span>
                            <span className="text-[10px] text-stone-400 mr-2">{new Date(e.date).toLocaleDateString('fr-TN')}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-red-700 font-bold">{e.amount.toFixed(3)} د.ت</span>
                            <button onClick={() => handleDeleteExpense(e.id)} className="text-stone-400 hover:text-red-700 cursor-pointer">
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {expenses.length > expensesLimit && (
                    <div className="mt-3 flex gap-2 justify-center">
                      <button 
                        type="button"
                        onClick={() => setExpensesLimit(prev => prev + 50)}
                        className="bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold px-3 py-1.5 rounded-lg text-[10px] cursor-pointer"
                      >
                        عرض المزيد من المصاريف (+50) 🔄
                      </button>
                      <button 
                        type="button"
                        onClick={() => setExpensesLimit(expenses.length)}
                        className="bg-stone-800 text-white font-bold px-3 py-1.5 rounded-lg text-[10px] cursor-pointer"
                      >
                        عرض جميع المصاريف ({expenses.length})
                      </button>
                    </div>
                  )}
                </div>

                {/* Low Stock Alerts */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs text-rose-800 mb-3">⚠️ سلع في طريق النفاذ من الستوك (3 قطع أو أقل)</h3>
                  {lowStockItems.length === 0 ? (
                    <p className="text-stone-400 text-center py-4 text-xs">جميع السلع متوفرة بشكل ممتاز بالمستودع ✅</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {lowStockItems.map((i, idx) => (
                        <div key={idx} className="flex justify-between items-center p-2.5 bg-rose-50/50 border border-rose-100 rounded-xl">
                          <span className="text-xs font-bold text-stone-800">{i.name}</span>
                          <span className="bg-rose-100 text-rose-800 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold">باقي {i.qty} قطع</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: STOCK / ITEMS & PRICING */}
            {currentTab === 'stock' && (
              <div className="space-y-4">
                
                {/* Section A: Add new items (Manager & Seller) */}
                {currentRole && (
                  <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                    <h3 className="font-extrabold text-stone-800 text-sm mb-3">
                      {currentRole === 'manager' ? '📦 تسجيل وإضافة سلع جديدة للمخزن' : '📦 تسجيل وزيادة كميات السلع بالمخزن'}
                    </h3>
                    <form onSubmit={handleAddItem} className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-stone-500 mb-1">اسم السلعة بالتفصيل</label>
                          <input 
                            type="text" 
                            placeholder="مثال: غلاف آيفون 14 شفاف"
                            value={newItem.name}
                            onChange={e => setNewItem(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full bg-stone-50 border border-stone-200 px-3 py-2.5 rounded-xl text-xs text-stone-800"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-stone-500 mb-1">الباركود (اختياري)</label>
                          <div className="flex gap-1.5">
                            <input 
                              type="text" 
                              placeholder="امسح أو اكتب الباركود"
                              value={newItem.barcode}
                              onChange={e => setNewItem(prev => ({ ...prev, barcode: e.target.value }))}
                              className="flex-1 bg-stone-50 border border-stone-200 px-3 py-2.5 rounded-xl text-xs text-stone-800 font-mono"
                            />
                            <button 
                              type="button" 
                              onClick={() => setScannerContext('stock')}
                              className="bg-stone-800 text-white p-2.5 rounded-xl cursor-pointer"
                            >
                              <Camera size={16} />
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className={currentRole === 'manager' ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3"}>
                        {currentRole === 'manager' && (
                          <div>
                            <label className="block text-[11px] text-stone-500 mb-1">سعر الشراء (د.ت)</label>
                            <input 
                              type="number" 
                              step="0.001"
                              placeholder="0.000"
                              value={newItem.buy}
                              onChange={e => setNewItem(prev => ({ ...prev, buy: e.target.value }))}
                              className="w-full bg-stone-50 border border-stone-200 px-3 py-2.5 rounded-xl text-xs text-stone-800 font-mono"
                            />
                          </div>
                        )}
                        <div>
                          <label className="block text-[11px] text-stone-500 mb-1">سعر البيع (د.ت)</label>
                          <input 
                            type="number" 
                            step="0.001"
                            placeholder="0.000"
                            value={newItem.sell}
                            onChange={e => setNewItem(prev => ({ ...prev, sell: e.target.value }))}
                            className="w-full bg-stone-50 border border-stone-200 px-3 py-2.5 rounded-xl text-xs text-stone-800 font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-stone-500 mb-1">كمية الستوك</label>
                          <input 
                            type="number" 
                            placeholder="0"
                            value={newItem.qty}
                            onChange={e => setNewItem(prev => ({ ...prev, qty: e.target.value }))}
                            className="w-full bg-stone-50 border border-stone-200 px-3 py-2.5 rounded-xl text-xs text-stone-800 font-mono"
                          />
                        </div>
                      </div>

                      <button type="submit" className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-3 rounded-xl text-xs cursor-pointer shadow-md shadow-red-700/10 transition-all">
                        ➕ أضف السلعة للمخزن
                      </button>
                    </form>
                  </div>
                )}

                {/* Section B: Recharge card stock management */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentRole === 'manager' && (
                    <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                      <h3 className="font-extrabold text-stone-800 text-xs mb-3">📶 تسجيل وتعديل مخزن بطاقات الشحن</h3>
                      <form onSubmit={handleAddCardStock} className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-1">المشغل</label>
                            <select value={cardOperator} onChange={e => setCardOperator(e.target.value)} className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800">
                              <option value="Ooredoo">Ooredoo</option>
                              <option value="Orange">Orange</option>
                              <option value="Tunisie Telecom">Tunisie Telecom</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-1">فئة الكارت</label>
                            <select value={cardValue} onChange={e => setCardValue(e.target.value)} className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono">
                              <option value="1">1 د.ت</option>
                              <option value="5">5 د.ت</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] text-stone-500 mb-1">كمية الكروت التي جُلبت</label>
                          <input 
                            type="number" 
                            placeholder="0"
                            value={cardQty}
                            onChange={e => setCardQty(e.target.value)}
                            className="w-full bg-stone-50 border border-stone-200 px-3 py-2.5 rounded-xl text-xs text-stone-800 font-mono"
                          />
                        </div>
                        <button type="submit" className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 rounded-xl text-xs cursor-pointer">
                          زيد للمخزن
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Display Card stock */}
                  <div className={`bg-white rounded-2xl border border-stone-200 p-5 shadow-xs ${currentRole !== 'manager' ? 'col-span-1 md:col-span-2' : ''}`}>
                    <h3 className="font-extrabold text-stone-800 text-xs mb-3">📊 كميات بطاقات الشحن الحالية</h3>
                    {cardStock.length === 0 ? (
                      <p className="text-stone-400 text-center py-6 text-xs">لا يوجد أي مخزون مسجل للبطاقات</p>
                    ) : (
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {cardStock.map((c, idx) => (
                          <div key={idx} className="flex justify-between items-center text-xs p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                            <span className="font-bold text-stone-800">📶 {c.operator} — {c.value} د.ت</span>
                            <div className="flex items-center gap-2">
                              {currentRole === 'manager' ? (
                                <button 
                                  onClick={() => handleEditCardQty(c.id)}
                                  className={`px-3 py-1 rounded-full font-bold font-mono text-[11px] ${
                                    c.qty <= 3 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                  }`}
                                >
                                  {c.qty} قطع
                                </button>
                              ) : (
                                <span 
                                  className={`px-3 py-1 rounded-full font-bold font-mono text-[11px] ${
                                    c.qty <= 3 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                  }`}
                                >
                                  {c.qty} قطع
                                </span>
                              )}
                              {currentRole === 'manager' && (
                                <button onClick={() => handleDeleteCardStock(c.id)} className="text-stone-400 hover:text-red-700 cursor-pointer p-1">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Section C: Forfait Balance management */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentRole === 'manager' && (
                    <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                      <h3 className="font-extrabold text-stone-800 text-xs mb-3">🌐 تعبئة رصيد المشغلين لشحن الفورفاي</h3>
                      <form onSubmit={handleAddForfaitBalance} className="space-y-3">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-1">المشغل</label>
                            <select value={addBalanceOperator} onChange={e => setAddBalanceOperator(e.target.value)} className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800">
                              <option value="Ooredoo">Ooredoo</option>
                              <option value="Orange">Orange</option>
                              <option value="Tunisie Telecom">Tunisie Telecom</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-1">المبلغ (د.ت)</label>
                            <input 
                              type="number" 
                              step="0.001"
                              placeholder="مثال: 90"
                              value={addBalanceAmount}
                              onChange={e => setAddBalanceAmount(e.target.value)}
                              className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                            />
                          </div>
                        </div>
                        <button type="submit" className="w-full bg-stone-800 hover:bg-stone-900 text-white font-bold py-2 rounded-xl text-xs cursor-pointer">
                          أضف الرصيد لشحن باقات الأنترنت
                        </button>
                      </form>
                    </div>
                  )}

                  <div className={`bg-white rounded-2xl border border-stone-200 p-5 shadow-xs ${currentRole !== 'manager' ? 'col-span-1 md:col-span-2' : ''}`}>
                    <h3 className="font-extrabold text-stone-800 text-xs mb-3">📊 رصيد المشغلين الحالي بالفورفاي</h3>
                    <div className="space-y-2">
                      {['Ooredoo', 'Orange', 'Tunisie Telecom'].map((op, idx) => {
                        const bal = forfaitBalance[op] || 0;
                        return (
                          <div key={idx} className="flex justify-between items-center text-xs p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                            <span className="font-bold text-stone-800">🌐 رصيد {op}</span>
                            {currentRole === 'manager' ? (
                              <button 
                                onClick={() => handleEditForfaitBalanceExact(op)}
                                className={`px-3 py-1 rounded-full font-bold font-mono text-[11px] ${
                                  bal <= 5 ? 'bg-rose-100 text-rose-800' : 'bg-stone-100 text-stone-800'
                                }`}
                              >
                                {bal.toFixed(3)} د.ت
                              </button>
                            ) : (
                              <span 
                                className={`px-3 py-1 rounded-full font-bold font-mono text-[11px] ${
                                  bal <= 5 ? 'bg-rose-100 text-rose-800' : 'bg-stone-100 text-stone-800'
                                }`}
                              >
                                {bal.toFixed(3)} د.ت
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Section D: Forfait plan Catalog list */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-3">📋 كتالوغ باقات الأنترنت (نفس الأسعار للكل)</h3>
                  
                  {currentRole === 'manager' && (
                    <form onSubmit={handleAddForfaitPlan} className="grid grid-cols-1 sm:grid-cols-4 gap-2 border-b border-stone-100 pb-4 mb-4">
                      <input 
                        type="text" 
                        placeholder="اسم الباقة (مثل: 25 Go)"
                        value={newPlanName}
                        onChange={e => setNewPlanName(e.target.value)}
                        className="bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                      />
                      <input 
                        type="text" 
                        placeholder="الصلاحية (مثل: 30 jours)"
                        value={newPlanValidity}
                        onChange={e => setNewPlanValidity(e.target.value)}
                        className="bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                      />
                      <input 
                        type="number" 
                        step="0.001"
                        placeholder="السعر د.ت"
                        value={newPlanPrice}
                        onChange={e => setNewPlanPrice(e.target.value)}
                        className="bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                      />
                      <button type="submit" className="bg-red-700 hover:bg-red-800 text-white font-bold py-2 rounded-xl text-xs cursor-pointer">
                        زيد الباقة
                      </button>
                    </form>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {forfaitPlans.map((p, idx) => (
                      <div key={idx} className="flex justify-between items-center p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                        <div>
                          <div className="font-bold text-xs text-stone-800">{p.name}</div>
                          <div className="text-[10px] text-stone-400">{p.validity}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-xs font-bold text-red-700">{p.price.toFixed(3)} د.ت</span>
                          {currentRole === 'manager' && (
                            <button onClick={() => handleDeletePlan(p.id)} className="text-stone-400 hover:text-red-700 cursor-pointer">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section E: Item inventory search and table */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                    <h3 className="font-extrabold text-stone-800 text-sm">📋 قائمة سلع المحل بالمستودع</h3>
                    {currentRole === 'manager' && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setCostVisible(!costVisible)}
                          className="text-stone-500 hover:text-stone-700 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-stone-200 cursor-pointer flex items-center gap-1.5"
                        >
                          {costVisible ? '🔒 إخفاء سعر الشراء' : '🔓 عرض سعر الشراء'}
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="relative mb-3">
                    <input 
                      type="text" 
                      placeholder="🔍 فتش على سلعة..."
                      value={stockSearch}
                      onChange={e => setStockSearch(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 pl-10 pr-3 py-2.5 rounded-xl text-xs text-stone-800"
                    />
                    <Search className="absolute left-3 top-3.5 text-stone-400" size={14} />
                  </div>

                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {filteredItems.length === 0 ? (
                      <p className="text-stone-400 text-center py-8 text-xs">لا توجد سلع مطابقة لفتشك</p>
                    ) : (
                      filteredItems.map((i, idx) => (
                        <div key={idx} className="p-3 bg-stone-50 hover:bg-stone-100/50 border border-stone-100 rounded-xl transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-bold text-stone-800 text-xs">{i.name}</h4>
                              <button 
                                onClick={() => handleEditItemName(i.id)} 
                                className="p-1 text-stone-400 hover:text-stone-700 transition-colors cursor-pointer"
                                title="تعديل اسم السلعة"
                              >
                                <Pencil size={11} />
                              </button>
                            </div>
                            <div className="text-[10px] text-stone-400 flex flex-wrap gap-x-2">
                              {costVisible && currentRole === 'manager' && (
                                <span className="font-mono text-rose-700">شراء: {i.buy.toFixed(3)} د.ت</span>
                              )}
                              <span className="font-mono text-emerald-700">بيع: {i.sell.toFixed(3)} د.ت</span>
                              {i.barcodes && i.barcodes.length > 0 && (
                                <span className="text-stone-500 font-mono">🏷️ {i.barcodes.join(', ')}</span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 justify-end">
                            {currentRole === 'manager' && (
                              <button onClick={() => handleAdjustQty(i.id, -1)} className="p-1.5 bg-stone-200 hover:bg-stone-300 text-stone-700 rounded-lg cursor-pointer">
                                <Minus size={14} />
                              </button>
                            )}
                            <button 
                              onClick={() => currentRole === 'manager' ? handleEditQtyExact(i.id) : undefined}
                              disabled={currentRole !== 'manager'}
                              className={`px-3 py-1 font-mono text-xs font-black rounded-lg ${
                                i.qty <= 3 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                              } ${currentRole === 'manager' ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
                            >
                              {i.qty} {currentRole === 'manager' ? 'قطع' : 'قطع متوفرة'}
                            </button>
                            {currentRole === 'manager' && (
                              <button onClick={() => handleAdjustQty(i.id, 1)} className="p-1.5 bg-stone-200 hover:bg-stone-300 text-stone-700 rounded-lg cursor-pointer">
                                <Plus size={14} />
                              </button>
                            )}
                            <button 
                              onClick={() => setScannerContext(`manage-${i.id}`)}
                              className="p-1.5 bg-stone-800 text-stone-100 hover:bg-stone-900 rounded-lg cursor-pointer"
                              title="ربط باركود إضافي"
                            >
                              <Camera size={14} />
                            </button>
                            {currentRole === 'manager' && (
                              <button onClick={() => handleDeleteItem(i.id)} className="p-1.5 text-stone-400 hover:text-red-700 cursor-pointer">
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* TAB 3: COIN REGISTRY & SALES (Fatoora) */}
            {currentTab === 'income' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Form column (width 2) */}
                <div className="md:col-span-2 space-y-4">
                  <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                    <h3 className="font-extrabold text-stone-800 text-sm mb-3">🛍️ إضافة خدمات أو سلع للفاتورة</h3>
                    
                    <div className="mb-4">
                      <label className="block text-[11px] text-stone-500 mb-1">نوع المبيعات</label>
                      <select 
                        value={incomeType} 
                        onChange={e => {
                          setIncomeType(e.target.value as any);
                          // Select first forfait plan by default if switching to forfait
                          if (e.target.value === 'forfait' && forfaitPlans.length > 0) {
                            setForfaitPlanId(forfaitPlans[0].id);
                          }
                          // Select first inventory item if switching to items
                          if (e.target.value === 'item' && items.length > 0) {
                            setSellItemId(items[0].id);
                          }
                        }} 
                        className="w-full bg-stone-50 border border-stone-200 px-3 py-2.5 rounded-xl text-xs text-stone-800 font-bold"
                      >
                        <option value="item">🛍️ بيع سلعة من المخزن</option>
                        <option value="recharge">📶 بطاقة شحن رصيد</option>
                        <option value="forfait">🌐 شحن رصيد فورفاي / أنترنات</option>
                        <option value="photo">🪪 صور شمسية فوتوغرافية</option>
                        <option value="service">🔧 صيانة جوال / خدمات أخرى</option>
                      </select>
                    </div>

                    {/* Dynamic Form Content */}
                    <div className="space-y-3 bg-stone-50/50 p-4 rounded-xl border border-stone-100">
                      
                      {/* Sub-form: Items */}
                      {incomeType === 'item' && (
                        <div className="space-y-3">
                          <button 
                            onClick={() => setScannerContext('sell')}
                            className="w-full bg-stone-800 hover:bg-stone-900 text-white font-bold py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <Camera size={14} /> امسح باركود السلعة بالكاميرا
                          </button>
                          
                          <div className="relative">
                            <input 
                              type="text" 
                              placeholder="🔍 فتش بالاسم لتسريع البحث..."
                              value={sellSearch}
                              onChange={e => setSellSearch(e.target.value)}
                              className="w-full bg-white border border-stone-200 pl-10 pr-3 py-2 rounded-xl text-xs text-stone-800"
                            />
                            <Search className="absolute left-3 top-3 text-stone-400" size={12} />
                          </div>

                          <div>
                            <label className="block text-[10px] text-stone-500 mb-0.5">اختر السلعة المطلوبة</label>
                            <select 
                              value={sellItemId} 
                              onChange={e => setSellItemId(e.target.value)} 
                              className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                            >
                              <option value="">-- اختر السلعة --</option>
                              {sellFilteredItems.map((i, idx) => (
                                <option key={idx} value={i.id}>
                                  {i.name} (المتوفر: {i.qty} قطع) — {i.sell.toFixed(3)} د.ت
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">الكمية المطلوبة</label>
                              <input 
                                type="number" 
                                min="1"
                                value={sellQty}
                                onChange={e => setSellQty(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">تعديل سعر البيع (اختياري)</label>
                              <input 
                                type="number" 
                                step="0.001"
                                placeholder="السعر الافتراضي"
                                value={sellPriceOverride}
                                onChange={e => setSellPriceOverride(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sub-form: Recharge cards */}
                      {incomeType === 'recharge' && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">المشغل</label>
                              <select value={rechargeOp} onChange={e => setRechargeOp(e.target.value)} className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800">
                                <option value="Ooredoo">Ooredoo</option>
                                <option value="Orange">Orange</option>
                                <option value="Tunisie Telecom">Tunisie Telecom</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">الفئة والقيمة</label>
                              <select value={rechargeValOpt} onChange={e => setRechargeValOpt(e.target.value)} className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800">
                                <option value="1|1.3|0.3">1 د.ت (سعر البيع: 1.300 د.ت)</option>
                                <option value="5|5.8|0.8">5 د.ت (سعر البيع: 5.800 د.ت)</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">الكمية المباعة</label>
                              <input 
                                type="number" 
                                min="1"
                                value={rechargeQty}
                                onChange={e => setRechargeQty(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">تعديل سعر الكارت (اختياري)</label>
                              <input 
                                type="number" 
                                step="0.001"
                                placeholder="السعر الافتراضي"
                                value={rechargePriceOverride}
                                onChange={e => setRechargePriceOverride(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sub-form: Forfait */}
                      {incomeType === 'forfait' && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">المشغل</label>
                              <select 
                                value={forfaitOp} 
                                onChange={e => setForfaitOp(e.target.value)} 
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                              >
                                <option value="Ooredoo">Ooredoo</option>
                                <option value="Orange">Orange</option>
                                <option value="Tunisie Telecom">Tunisie Telecom</option>
                              </select>
                              <span className="text-[9px] text-stone-400 block mt-1">الرصيد المتوفر: {(forfaitBalance[forfaitOp] || 0).toFixed(3)} د.ت</span>
                            </div>
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">اختر الباقة</label>
                              <select 
                                value={forfaitPlanId} 
                                onChange={e => setForfaitPlanId(e.target.value)} 
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                              >
                                <option value="">-- اختر الباقة --</option>
                                {forfaitPlans.map((p, idx) => (
                                  <option key={idx} value={p.id}>
                                    {p.name} ({p.validity}) — {p.price.toFixed(3)} د.ت
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">رقم تليفون الحريف</label>
                              <input 
                                type="text" 
                                placeholder="مثال: 98123456"
                                value={forfaitCustomerPhone}
                                onChange={e => setForfaitCustomerPhone(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">تعديل السعر د.ت (اختياري)</label>
                              <input 
                                type="number" 
                                step="0.001"
                                placeholder="السعر الافتراضي"
                                value={forfaitPriceOverride}
                                onChange={e => setForfaitPriceOverride(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sub-form: Photo */}
                      {incomeType === 'photo' && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="col-span-1">
                            <label className="block text-[10px] text-stone-500 mb-0.5">نوع الصور</label>
                            <input 
                              type="text" 
                              placeholder="صور بطاقة تعريف..."
                              value={photoDesc}
                              onChange={e => setPhotoDesc(e.target.value)}
                              className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-0.5">عدد الحرفاء</label>
                            <input 
                              type="number" 
                              value={photoQty}
                              onChange={e => setPhotoQty(e.target.value)}
                              className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-0.5">المبلغ المطلوب</label>
                            <input 
                              type="number" 
                              step="0.001"
                              placeholder="0.000"
                              value={photoAmount}
                              onChange={e => setPhotoAmount(e.target.value)}
                              className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                            />
                          </div>
                        </div>
                      )}

                      {/* Sub-form: Service */}
                      {incomeType === 'service' && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">نوع صيانة قطع الغيار</label>
                              <select 
                                value={serviceType} 
                                onChange={e => setServiceType(e.target.value)} 
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                              >
                                <option value="Cache">Cache (ظهر الهاتف)</option>
                                <option value="Glass">Glass (بلورة الشاشة)</option>
                                <option value="Afficheur">Afficheur (الشاشة كاملة)</option>
                                <option value="Connecteur">Connecteur (منفذ الشحن)</option>
                                <option value="Copie">Copie (طباعة ونسخ أوراق)</option>
                                <option value="other">صيانة وخدمات أخرى...</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">المبلغ المطلوب (د.ت)</label>
                              <input 
                                type="number" 
                                step="0.001"
                                placeholder="0.000"
                                value={serviceAmount}
                                onChange={e => setServiceAmount(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                              />
                            </div>
                          </div>

                          {serviceType === 'other' && (
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">اكتب نوع الخدمة بالتفصيل</label>
                              <input 
                                type="text" 
                                placeholder="صيانة ميكروفون، تبديل كاميرا..."
                                value={serviceCustomDesc}
                                onChange={e => setServiceCustomDesc(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                              />
                            </div>
                          )}
                        </div>
                      )}

                    </div>

                    <button 
                      onClick={handleAddToCart}
                      className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-2.5 rounded-xl text-xs mt-3 cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <Plus size={14} /> إضافة سطر للفاتورة الحالية
                    </button>
                  </div>
                </div>

                {/* Billing / Invoice cart list sidebar (width 1) */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs flex flex-col h-full min-h-[400px]">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-3 text-red-800 flex items-center gap-1.5 border-b border-stone-100 pb-2">
                    <ShoppingBag size={14} /> الفاتورة الحالية لعميلك
                  </h3>

                  <div className="flex-1 space-y-2 overflow-y-auto max-h-72">
                    {cart.length === 0 ? (
                      <div className="flex flex-col items-center justify-center text-stone-400 py-12 text-[11px] text-center">
                        <span>سجل المشتريات فارغ لتوة.</span>
                        <span>أضف سلعاً من العمود الأيمن.</span>
                      </div>
                    ) : (
                      cart.map((line, idx) => (
                        <div key={idx} className="flex justify-between items-start gap-2 p-2 bg-stone-50 rounded-xl border border-stone-100 text-[11px]">
                          <div className="flex-1">
                            <div className="font-bold text-stone-800">{line.label}</div>
                            <div className="text-[10px] text-stone-400">
                              {line.qty} × {line.unitPrice.toFixed(3)} د.ت
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-stone-900">
                              {line.total.toFixed(3)}
                            </span>
                            <button 
                              onClick={() => handleRemoveFromCart(line.id)}
                              className="text-stone-400 hover:text-red-700 p-0.5 cursor-pointer"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {cart.length > 0 && (
                    <div className="pt-3 border-t border-stone-100 space-y-3 mt-auto">
                      <div className="flex justify-between items-center text-xs font-bold text-stone-800">
                        <span>المجموع الكلي للفاتورة:</span>
                        <span className="font-mono text-red-700 text-sm">
                          {cart.reduce((s, c) => s + c.total, 0).toFixed(3)} د.ت
                        </span>
                      </div>

                      {/* Invoice options */}
                      <div className="space-y-2 bg-stone-50 p-2.5 rounded-xl border border-stone-100 text-[10px]">
                        <div>
                          <label className="block text-[10px] text-stone-500 mb-0.5">اسم الحريف (اختياري/مهم للدين)</label>
                          <input 
                            type="text" 
                            placeholder="اسم الحريف"
                            value={invoiceCustomerName}
                            onChange={e => setInvoiceCustomerName(e.target.value)}
                            className="w-full bg-white border border-stone-200 px-2 py-1.5 rounded-lg text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] text-stone-500 mb-0.5">رقم تليفون الحريف (اختياري)</label>
                          <input 
                            type="text" 
                            placeholder="رقم الهاتف"
                            value={invoiceCustomerPhone}
                            onChange={e => setInvoiceCustomerPhone(e.target.value)}
                            className="w-full bg-white border border-stone-200 px-2 py-1.5 rounded-lg text-xs font-mono"
                          />
                        </div>
                        <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={invoiceIsDebt}
                            onChange={e => setInvoiceIsDebt(e.target.checked)}
                            className="w-4 h-4 text-red-700 focus:ring-red-700"
                          />
                          <span className="font-bold text-stone-700 text-[10px]">🧾 بيع بالكامل بالدين (الحريف ما خلصش)</span>
                        </label>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={() => handleFinalizeInvoice(false)}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2.5 px-2 rounded-xl text-[11px] cursor-pointer shadow-md shadow-emerald-600/10 transition-colors flex items-center justify-center gap-1"
                        >
                          ⚡ بيع سريع
                        </button>
                        <button 
                          onClick={() => handleFinalizeInvoice(true)}
                          className="bg-stone-800 hover:bg-stone-950 text-white font-extrabold py-2.5 px-2 rounded-xl text-[11px] cursor-pointer transition-colors flex items-center justify-center gap-1"
                        >
                          🖨️ تسجيل وطباعة
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

                {/* RECENT SALES TODAY CARD - BOTH MANAGER & SELLER VIEW */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-3">
                    <h3 className="font-extrabold text-stone-800 text-xs flex items-center gap-1.5 text-red-800">
                      📝 آخر العمليات والمبيعات المسجلة اليوم
                    </h3>
                    <span className="text-[10px] text-stone-400 font-semibold">تحديث تلقائي</span>
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto font-sans">
                    {(() => {
                      const merged = [
                        ...sales.map(s => ({ ...s, isSale: true, label: `${s.itemName} × ${s.qty}`, icon: '🛍️' })),
                        ...otherIncome.map(o => ({ ...o, isSale: false, label: o.label, icon: o.category === 'recharge' ? '📶' : o.category === 'forfait' ? '🌐' : o.category === 'photo' ? '🪪' : '🔧' }))
                      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                      if (merged.length === 0) {
                        return <p className="text-stone-400 text-center py-6 text-xs">لا توجد عمليات مسجلة لتوة</p>;
                      }

                      return merged.slice(0, 10).map((entry, idx) => (
                        <div key={idx} className="flex justify-between items-center p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                          <div>
                            <div className="font-bold text-stone-800 text-xs">{entry.icon} {entry.label}</div>
                            <div className="text-[10px] text-stone-400">{new Date(entry.date).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-emerald-700 font-bold text-xs">
                              {(entry.total !== undefined ? entry.total : entry.amount).toFixed(3)} د.ت
                            </span>
                            {currentRole === 'manager' && (
                              <button 
                                onClick={() => handleDeleteHistorySale(entry.id, entry.isSale)} 
                                className="text-stone-400 hover:text-red-700 cursor-pointer p-1 transition-colors"
                                title="إلغاء المبيعة"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

              </div>
            )}

            {/* TAB 4: DEBTS */}
            {currentTab === 'debts' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                
                {/* Add debt form */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs h-fit">
                  <h3 className="font-extrabold text-stone-800 text-xs text-rose-800 mb-3 flex items-center gap-1.5">
                    <Plus size={16} /> تسجيل دين يدوي خارجي
                  </h3>
                  <form onSubmit={handleAddManualDebt} className="space-y-3">
                    <div>
                      <label className="block text-[10px] text-stone-500 mb-0.5">اسم الحريف بالكامل</label>
                      <input 
                        type="text" 
                        placeholder="اسم الحريف"
                        value={manualDebt.name}
                        onChange={e => setManualDebt(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-stone-500 mb-0.5">رقم هاتف الحريف</label>
                      <input 
                        type="text" 
                        placeholder="رقم الهاتف"
                        value={manualDebt.phone}
                        onChange={e => setManualDebt(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-stone-500 mb-0.5">المبلغ د.ت</label>
                      <input 
                        type="number" 
                        step="0.001"
                        placeholder="0.000"
                        value={manualDebt.amount}
                        onChange={e => setManualDebt(prev => ({ ...prev, amount: e.target.value }))}
                        className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-stone-500 mb-0.5">تفاصيل وملاحظة الدين</label>
                      <input 
                        type="text" 
                        placeholder="سلفة كاش، شاحن، بطاقة..."
                        value={manualDebt.note}
                        onChange={e => setManualDebt(prev => ({ ...prev, note: e.target.value }))}
                        className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                      />
                    </div>
                    <button type="submit" className="w-full bg-rose-700 hover:bg-rose-800 text-white font-bold py-2 rounded-xl text-xs cursor-pointer">
                      سجل الدين بالدفتر 💳
                    </button>
                  </form>
                </div>

                {/* Debts listing columns (width 2) */}
                <div className="md:col-span-2 space-y-4">
                  <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h3 className="font-extrabold text-stone-800 text-xs">📋 الديون المفتوحة (غير المكتملة)</h3>
                      <div className="bg-rose-100 text-rose-800 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold">
                        إجمالي المستحقات المتبقية: {totalOwed.toFixed(3)} د.ت
                      </div>
                    </div>

                    <div className="relative mb-3">
                      <input 
                        type="text" 
                        placeholder="🔍 فتش باسم الحريف..."
                        value={debtSearch}
                        onChange={e => setDebtSearch(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 pl-10 pr-3 py-2 rounded-xl text-xs text-stone-800"
                      />
                      <Search className="absolute left-3 top-3 text-stone-400" size={13} />
                    </div>

                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {openDebts.length === 0 ? (
                        <p className="text-stone-400 text-center py-8 text-xs">لا يوجد أي ديون مفتوحة حالياً 🎉</p>
                      ) : (
                        openDebts.map((d, idx) => {
                          const remaining = d.amount - d.paid;
                          return (
                            <div key={idx} className="p-3 bg-stone-50 hover:bg-stone-100/50 border border-stone-100 rounded-xl transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                              <div>
                                <div className="font-bold text-stone-900">{d.customerName}</div>
                                {d.customerPhone && <div className="text-[10px] text-stone-400 font-mono">📞 {d.customerPhone}</div>}
                                <div className="text-[10px] text-stone-500 mt-0.5">📝 التفاصيل: {d.note}</div>
                                <div className="text-[10px] text-stone-400">التاريخ: {new Date(d.date).toLocaleDateString('fr-TN')}</div>
                              </div>
                              <div className="flex flex-col items-end gap-1.5">
                                <div className="font-bold font-mono">
                                  <span className="text-stone-400">المجموع: {d.amount.toFixed(3)}</span>{' '}
                                  <span className="text-rose-700">المتبقي: {remaining.toFixed(3)} د.ت</span>
                                </div>
                                <div className="flex gap-1.5">
                                  <button onClick={() => handlePayDebt(d.id, true)} className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-2 py-1 rounded-lg text-[10px] cursor-pointer">
                                    ✅ سداد كامل
                                  </button>
                                  <button onClick={() => handlePayDebt(d.id, false)} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2 py-1 rounded-lg text-[10px] cursor-pointer">
                                    💵 جزء
                                  </button>
                                  {currentRole === 'manager' && (
                                    <button onClick={() => handleDeleteDebt(d.id)} className="text-stone-400 hover:text-red-700 cursor-pointer p-1">
                                      <Trash2 size={13} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Recently paid debts */}
                  <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs text-xs">
                    <h3 className="font-extrabold text-stone-800 text-xs mb-3 text-emerald-800">✅ ديون مخلصة مؤخراً</h3>
                    {paidDebts.length === 0 ? (
                      <p className="text-stone-400 text-center py-6">لا توجد ديون مخلصة مسجلة</p>
                    ) : (
                      <div className="space-y-1.5">
                        {paidDebts.map((d, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2.5 bg-emerald-50/45 rounded-xl border border-emerald-100">
                            <div>
                              <span className="font-bold text-stone-800">{d.customerName}</span>
                              <span className="text-[10px] text-stone-400 mr-2">{d.note}</span>
                            </div>
                            <span className="font-mono text-emerald-700 font-bold">{d.amount.toFixed(3)} د.ت</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* TAB 5: SALES HISTORY & AUDIT LOGS (Manager Only) */}
            {currentTab === 'history' && currentRole === 'manager' && (
              <div className="space-y-4 text-xs">
                
                {/* Coin profits summary table */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-3 text-red-800">📊 كشف المرابيح الشاملة</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                    <div className="bg-stone-50 p-3 rounded-xl">
                      <span className="text-stone-400">إجمالي المبيعات والخدمات</span>
                      <div className="font-mono font-bold text-stone-800 mt-1">{(totalSales + totalOther).toFixed(3)} د.ت</div>
                    </div>
                    <div className="bg-stone-50 p-3 rounded-xl">
                      <span className="text-stone-400">تكلفة شراء السلع المبيعة</span>
                      <div className="font-mono font-bold text-stone-800 mt-1">{totalBuyCostOfSales.toFixed(3)} د.ت</div>
                    </div>
                    <div className="bg-stone-50 p-3 rounded-xl">
                      <span className="text-stone-400">صافي الربح الإجمالي</span>
                      <div className="font-mono font-bold text-emerald-700 mt-1">{netProfit.toFixed(3)} د.ت</div>
                    </div>
                    <div className="bg-stone-50 p-3 rounded-xl">
                      <span className="text-stone-400">مجموع المصاريف اليومية</span>
                      <div className="font-mono font-bold text-rose-700 mt-1">{totalExpenses.toFixed(3)} د.ت</div>
                    </div>
                  </div>
                </div>

                {/* Reset income registry days */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs text-rose-800 mb-1">🧹 تصفير وحذف سجلات المبيعات مؤقتاً</h3>
                  <p className="text-stone-400 text-[10px] mb-3">يمسح سجلات مبيعات الأيام السابقة دون لمس سلع المستودع أو كروت الشحن:</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleResetIncomeHistory(1)} className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-3 py-2 rounded-xl text-[11px] border border-rose-200 cursor-pointer">مسح اليوم فقط</button>
                    <button onClick={() => handleResetIncomeHistory(2)} className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-3 py-2 rounded-xl text-[11px] border border-rose-200 cursor-pointer">مسح يومين</button>
                    <button onClick={() => handleResetIncomeHistory(3)} className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-3 py-2 rounded-xl text-[11px] border border-rose-200 cursor-pointer">مسح 3 أيام</button>
                    <button onClick={() => handleResetIncomeHistory(4)} className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-3 py-2 rounded-xl text-[11px] border border-rose-200 cursor-pointer">مسح 4 أيام</button>
                  </div>
                </div>

                {/* Sales list */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-3 text-red-800 flex items-center gap-2">
                    🛍️ سجل مبيعات ومداخيل المحل الحالية ({filteredHistory.length} مبيعة/مدخول)
                  </h3>

                  {/* Filter controls */}
                  <div className="space-y-2.5 mb-4 border-b border-stone-100 pb-4">
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="🔍 ابحث باسم السلعة أو الخدمة أو العملية..."
                        value={historySearch}
                        onChange={e => setHistorySearch(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 pl-10 pr-3 py-2 rounded-xl text-xs text-stone-800 focus:ring-1 focus:ring-red-700 focus:bg-white"
                      />
                      <Search className="absolute left-3 top-3 text-stone-400" size={13} />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-stone-400 mb-1 font-bold">نوع العملية:</label>
                        <select
                          value={historyCategory}
                          onChange={e => setHistoryCategory(e.target.value as any)}
                          className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-[11px] text-stone-700"
                        >
                          <option value="all">كل المداخيل والعمليات 📋</option>
                          <option value="item">🛍️ مبيعات السلع والقطع بالمخزن</option>
                          <option value="recharge">📶 شحن الكروت والبطاقات</option>
                          <option value="forfait">🌐 باقات الأنترنت (Forfaits)</option>
                          <option value="photo">🪪 خدمات تصوير فوتوغرافي</option>
                          <option value="service">🔧 صيانة الأجهزة والخدمات الأخرى</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] text-stone-400 mb-1 font-bold">الفترة الزمنية:</label>
                        <select
                          value={historyDateFilter}
                          onChange={e => setHistoryDateFilter(e.target.value as any)}
                          className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-[11px] text-stone-700"
                        >
                          <option value="all">كل التواريخ والأوقات 📅</option>
                          <option value="today">اليوم فقط (Aujourd'hui)</option>
                          <option value="yesterday">أمس (Hier)</option>
                          <option value="7days">آخر 7 أيام (Semaine)</option>
                          <option value="30days">آخر 30 يوم (Mois)</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  
                  {filteredHistory.length === 0 ? (
                    <div className="text-center py-10 text-stone-400 text-xs">
                      ⚠️ لم يتم العثور على أي عمليات تطابق البحث والفلاتر المحددة.
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                        {filteredHistory
                         .slice(0, historyLimit)
                         .map((entry, idx) => (
                          <div key={idx} className="flex justify-between items-center p-2.5 bg-stone-50 hover:bg-stone-100/50 rounded-xl border border-stone-100 transition-colors">
                            <div className="flex items-center gap-2.5">
                              <span className="text-base">{entry.icon}</span>
                              <div>
                                <div className="font-bold text-stone-800 text-xs">{entry.label}</div>
                                <div className="text-[10px] text-stone-400">{new Date(entry.date).toLocaleString('fr-TN')}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-emerald-700 font-bold text-xs">
                                {entry.total.toFixed(3)} د.ت
                              </span>
                              <button 
                                onClick={() => handleDeleteHistorySale(entry.id, entry.isSale)} 
                                className="text-stone-400 hover:text-red-700 cursor-pointer p-1 transition-colors rounded-lg hover:bg-red-50"
                                title="إلغاء وحذف العملية"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Pagination metadata and buttons */}
                      <div className="mt-4 pt-3 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-stone-500">
                        <span>عرض {Math.min(filteredHistory.length, historyLimit)} من أصل {filteredHistory.length} عملية تاريخية</span>
                        
                        <div className="flex gap-2 w-full sm:w-auto">
                          {filteredHistory.length > historyLimit && (
                            <>
                              <button 
                                onClick={() => setHistoryLimit(prev => prev + 50)}
                                className="flex-1 sm:flex-none bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold px-3 py-1.5 rounded-xl transition-colors cursor-pointer text-center"
                              >
                                عرض المزيد (+50) 🔄
                              </button>
                              <button 
                                onClick={() => setHistoryLimit(filteredHistory.length)}
                                className="flex-1 sm:flex-none bg-red-700 hover:bg-red-800 text-white font-bold px-3 py-1.5 rounded-xl transition-colors cursor-pointer text-center shadow-xs"
                              >
                                عرض الكل كاملاً 📊
                              </button>
                            </>
                          )}
                          {historyLimit > 20 && (
                            <button 
                              onClick={() => setHistoryLimit(20)}
                              className="bg-stone-800 hover:bg-stone-900 text-stone-100 font-bold px-3 py-1.5 rounded-xl transition-colors cursor-pointer text-center"
                            >
                              تقليص العرض ↩️
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Audit Logs list */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-3">📋 سجل العمليات الحساسة والأمان (Audit Log)</h3>
                  
                  <div className="relative mb-3">
                    <input 
                      type="text" 
                      placeholder="🔍 ابحث في سجل العمليات..."
                      value={auditLogSearch}
                      onChange={e => setAuditLogSearch(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 pl-10 pr-3 py-2 rounded-xl text-xs"
                    />
                    <Search className="absolute left-3 top-3 text-stone-400" size={13} />
                  </div>

                  {(() => {
                    const filteredAudit = auditLog.filter(a => !auditLogSearch || normalizeArabic(a.label + ' ' + a.user).includes(normalizeArabic(auditLogSearch)));
                    return (
                      <>
                        <div className="space-y-2 max-h-72 overflow-y-auto">
                          {filteredAudit.slice(0, auditLimit).map((log, idx) => (
                            <div key={idx} className="p-2.5 bg-stone-50 rounded-xl border border-stone-100 flex justify-between items-start text-[10px]">
                              <div>
                                <span className="font-bold text-stone-800">{log.label}</span>
                                <div className="text-stone-400 mt-0.5">منفذ العملية: {log.user}</div>
                              </div>
                              <span className="text-stone-400 font-mono">{new Date(log.date).toLocaleString('fr-TN')}</span>
                            </div>
                          ))}
                        </div>
                        {filteredAudit.length > auditLimit && (
                          <div className="mt-3 flex gap-2 justify-center">
                            <button 
                              onClick={() => setAuditLimit(prev => prev + 50)}
                              className="bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold px-3 py-1.5 rounded-lg text-[10px] cursor-pointer"
                            >
                              عرض المزيد (+50 عملية أمنية) 🔄
                            </button>
                            <button 
                              onClick={() => setAuditLimit(filteredAudit.length)}
                              className="bg-stone-800 text-white font-bold px-3 py-1.5 rounded-lg text-[10px] cursor-pointer"
                            >
                              عرض الكل ({filteredAudit.length})
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>

              </div>
            )}

            {/* TAB 6: SETTINGS (Manager Only) */}
            {currentTab === 'settings' && currentRole === 'manager' && (
              <div className="space-y-4">
                
                {/* Change Pin Card */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-1">🔑 تغيير الرمز السري للمدير (Yosri)</h3>
                  <p className="text-stone-400 text-[11px] mb-3">الرمز الافتراضي هو 1234. يرجى تبديله فوراً لمنع دخول الصبية والباعة للتقارير والأرباح:</p>
                  <button onClick={handleChangePin} className="bg-stone-800 hover:bg-stone-900 text-white font-bold py-2.5 px-4 rounded-xl text-xs cursor-pointer">
                    تعديل رمز المدير السري ✏️
                  </button>
                </div>

                {/* Merge Duplicate Items Utility */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-1">🧹 أداة تجميع ودمج السلع المكررة</h3>
                  <p className="text-stone-400 text-[11px] mb-3">في حال قمت بتسجيل سلعة مرتين متتاليتين بالخطأ، تقوم هذه الأداة بدمج الستوك بنقرة واحدة:</p>
                  <button onClick={handleMergeDuplicates} className="bg-red-700 hover:bg-red-800 text-white font-bold py-2.5 px-4 rounded-xl text-xs cursor-pointer flex items-center gap-1.5">
                    بدء الفحص والدمج التلقائي 🧹
                  </button>
                </div>

                {/* Backups & Restore File */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-1">💾 أخذ نسخة احتياطية إضافية للأمان</h3>
                  <p className="text-stone-400 text-[11px] mb-3">جميع العمليات يتم حفظها ومزامنتها سحابياً تلقائياً، ولكن يمكنك تحميل نسخة احتياطية للاحتفاظ بها في هاتفك:</p>
                  <button onClick={handleDownloadBackup} className="bg-amber-600 hover:bg-amber-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs cursor-pointer flex items-center gap-1.5">
                    تحميل نسخة احتياطية كاملة (.json) 💾
                  </button>
                </div>

              </div>
            )}

          </div>
        ) : (
          /* Authentication Screen Overlay UI */
          <LoginOverlay 
            onChooseSeller={() => {
              setCurrentRole('seller');
              setCurrentTab('stock');
              sessionStorage.setItem('yosri_role_v2', 'seller');
            }}
            onAttemptManagerLogin={async (pin) => {
              const success = await signInManager(pin);
              if (success) {
                setCurrentRole('manager');
                setCurrentTab('dashboard');
                sessionStorage.setItem('yosri_role_v2', 'manager');
                logAudit('pin', 'تسجيل دخول المدير العام بنجاح');
                return true;
              }
              return false;
            }}
          />
        )}

      </main>

      {/* Popups & Modals */}
      <InvoiceModal 
        invoice={lastInvoice} 
        onClose={() => setLastInvoice(null)} 
      />

      {scannerContext && (
        <BarcodeScannerPopup 
          onScan={handleBarcodeScanned} 
          onClose={() => setScannerContext(null)} 
        />
      )}

      {/* Custom Confirmation Modal Dialog */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in font-sans" dir="rtl">
          <div className="bg-white rounded-3xl border border-stone-200 p-6 w-full max-w-sm shadow-2xl animate-scale-up text-right">
            <h3 className="font-extrabold text-stone-900 text-sm mb-2 flex items-center gap-2">
              ⚠️ {confirmDialog.title}
            </h3>
            <p className="text-stone-600 text-xs leading-relaxed mb-6">
              {confirmDialog.message}
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => {
                  setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                  confirmDialog.onConfirm();
                }}
                className={`text-white font-black py-2.5 rounded-xl text-xs cursor-pointer shadow-md transition-colors ${
                  confirmDialog.isDanger 
                    ? 'bg-red-700 hover:bg-red-800 shadow-red-700/10' 
                    : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/10'
                }`}
              >
                {confirmDialog.confirmText || 'تأكيد'}
              </button>
              <button
                onClick={() => {
                  setConfirmDialog(prev => ({ ...prev, isOpen: false }));
                  if (confirmDialog.onCancel) confirmDialog.onCancel();
                }}
                className="bg-stone-100 hover:bg-stone-200 text-stone-700 font-extrabold py-2.5 rounded-xl text-xs cursor-pointer transition-colors"
              >
                {confirmDialog.cancelText || 'إلغاء'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection Indicator footer status line */}
      {currentRole && (
        <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 py-2 px-4 shadow-md text-[10px] text-stone-400 text-center select-none z-30">
          📍 العنوان: نبر، الكاف | هاتف: 41 444 355 | متصل بالخادم السحابي لـ Yosri GSM
        </footer>
      )}
    </div>
  );
}
