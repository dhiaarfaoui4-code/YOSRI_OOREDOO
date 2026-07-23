import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  TrendingUp, Plus, Minus, Search, Trash2, ShieldAlert, CreditCard, 
  History, Settings as SettingsIcon, Package, Phone, FileText, Check, 
  Camera, ShoppingBag, Radio, Wifi, LogOut, CheckCircle, RefreshCw, X,
  Pencil, Image as ImageIcon, Sparkles, Zap, CornerDownLeft
} from 'lucide-react';
import { 
  Item, Sale, OtherIncome, Debt, CardStockEntry, Expense, 
  ForfaitPlan, ForfaitBalance, AuditLogEntry, AppTab, AppRole, SparePart 
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
import { VisualProductRecognitionModal } from './components/VisualProductRecognitionModal';

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

// Smart multilingual search normalization
function smartNormalize(str: string): string {
  if (!str) return '';
  let s = str.toLowerCase();
  s = s.replace(/[أإآا]/g, 'ا')
       .replace(/[ىي]/g, 'ي')
       .replace(/ة/g, 'ه')
       .replace(/ؤ/g, 'و')
       .replace(/ئ/g, 'ي')
       .replace(/ڨ/g, 'ق')
       .replace(/[\u064B-\u0652]/g, '');
  
  s = s.replace(/[-_./\\(),+]/g, ' ');
  return s.trim();
}

// Phonetic and multilingual synonym groups (Arabic, French, English, Tech Terms)
const SYNONYM_GROUPS: string[][] = [
  ['سامسونج', 'سامسونغ', 'samsung', 'سمسونج', 'غالكسي', 'galaxy'],
  ['ايفون', 'ايقون', 'iphone', 'آيفون', 'ابل', 'apple'],
  ['شاحن', 'شارجور', 'شارجر', 'charger', 'chargeur', 'شحن', 'charge'],
  ['سماعة', 'سماعات', 'ecouteur', 'ecouteurs', 'headphone', 'earphone', 'airpods', 'اربودز'],
  ['بلوتوث', 'bluetooth', 'bt', 'sans fil'],
  ['كابل', 'كابلات', 'cable', 'cordon', 'سلك'],
  ['بطارية', 'بطاريات', 'battery', 'pille', 'باتري'],
  ['غطاء', 'كاش', 'كفر', 'pochette', 'case', 'cover', 'غلاف'],
  ['بلندور', 'حماية', 'incassable', 'glass', 'protector', 'شاشة', 'انكماش', 'انكاسابل'],
  ['سبيكر', 'مكبر', 'baffle', 'speaker', 'hautparleur', 'صوت'],
  ['واط', 'w', 'watt', 'وات'],
  ['سعة', 'mah', 'ميليامبير'],
];

function getExpandedTokens(input: string): string[] {
  const normalized = smartNormalize(input);
  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  const expanded: Set<string> = new Set(rawTokens);

  for (const tok of rawTokens) {
    for (const group of SYNONYM_GROUPS) {
      if (group.some(syn => {
        const normSyn = smartNormalize(syn);
        return normSyn === tok || normSyn.includes(tok) || tok.includes(normSyn);
      })) {
        group.forEach(syn => expanded.add(smartNormalize(syn)));
      }
    }
  }

  return Array.from(expanded);
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function calculateSmartMatchScore(
  item: Item,
  searchQuery: string,
  salesCountMap: Record<string, number>
): number {
  if (!searchQuery.trim()) {
    const salesCount = salesCountMap[item.id] || 0;
    return salesCount * 5 + (item.qty > 0 ? 10 : 0);
  }

  const queryNorm = smartNormalize(searchQuery);
  const queryTokens = queryNorm.split(/\s+/).filter(Boolean);
  const nameNorm = smartNormalize(item.name);
  const categoryNorm = smartNormalize(item.category || '');
  const barcodesNorm = (item.barcodes || [item.barcode || '']).map(b => smartNormalize(b));

  let score = 0;

  // 1. Barcode Exact Match
  if (barcodesNorm.some(b => b && (b === queryNorm || b.includes(queryNorm)))) {
    score += 1000;
  }

  // 2. Exact Name Match or Prefix
  if (nameNorm === queryNorm) {
    score += 500;
  } else if (nameNorm.startsWith(queryNorm)) {
    score += 300;
  } else if (nameNorm.includes(queryNorm)) {
    score += 200;
  }

  // 3. Token-by-token matching
  let matchedTokensCount = 0;

  for (const qTok of queryTokens) {
    const expandedQToks = getExpandedTokens(qTok);
    let tokMatched = false;

    for (const exTok of expandedQToks) {
      if (nameNorm.includes(exTok)) {
        score += 80;
        tokMatched = true;
        break;
      }
      if (categoryNorm.includes(exTok)) {
        score += 40;
        tokMatched = true;
        break;
      }
    }

    if (!tokMatched) {
      const nameWords = nameNorm.split(/\s+/);
      for (const word of nameWords) {
        if (word.length >= 3 && qTok.length >= 3) {
          const dist = levenshteinDistance(qTok, word);
          if (dist <= 1) {
            score += 50;
            tokMatched = true;
            break;
          } else if (dist <= 2 && (qTok.length >= 5 || word.length >= 5)) {
            score += 30;
            tokMatched = true;
            break;
          }
        }
      }
    }

    if (tokMatched) {
      matchedTokensCount++;
    }
  }

  if (queryTokens.length > 0 && matchedTokensCount === queryTokens.length) {
    score += 150;
  }

  if (matchedTokensCount === 0 && score < 200) {
    return 0;
  }

  // Popularity / Sales Velocity boost
  const salesPopularity = salesCountMap[item.id] || 0;
  score += Math.min(salesPopularity * 10, 100);

  if (item.qty > 0) {
    score += 20;
  } else {
    score -= 50;
  }

  return score;
}

// SHA-256 local helper
async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export const CATEGORY_MAP: Record<string, { label: string, icon: string }> = {
  phone: { label: 'هواتف', icon: '📱' },
  battery: { label: 'بطاريات', icon: '🔋' },
  speaker: { label: 'سبيكرات', icon: '🔊' },
  bluetooth: { label: 'سماعات بلوتوث', icon: '🎧' },
  accessory: { label: 'أكسسوارات أخرى', icon: '🔌' }
};

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
  const [newItem, setNewItem] = useState({ name: '', barcode: '', buy: '', sell: '', qty: '', category: 'accessory', imageUrl: '' });
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
  const [whatsappConfig, setWhatsappConfig] = useState<{ enabled: boolean; phone: string; apiKey: string }>({
    enabled: false,
    phone: '+21641444355',
    apiKey: ''
  });
  const [telegramConfig, setTelegramConfig] = useState<{ enabled: boolean; botToken: string; chatId: string }>({
    enabled: false,
    botToken: '',
    chatId: ''
  });

  // Spare Parts States
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [newSparePart, setNewSparePart] = useState({ name: '', supplierName: '', qty: '1', unitCost: '', notes: '' });
  const [sparePartSearch, setSparePartSearch] = useState('');
  const [sparePartSupplierFilter, setSparePartSupplierFilter] = useState('all');
  const [sparePartStatusFilter, setSparePartStatusFilter] = useState<'all' | 'unpaid' | 'paid'>('all');
  const [sparePartsLimit, setSparePartsLimit] = useState(20);

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
  const [invoiceInitialPayment, setInvoiceInitialPayment] = useState('');

  // Searches
  const sellSearchInputRef = useRef<HTMLInputElement>(null);
  const [searchSelectedIndex, setSearchSelectedIndex] = useState<number>(-1);
  const [showVisualRecognitionModal, setShowVisualRecognitionModal] = useState<boolean>(false);
  const [visualRecognitionMode, setVisualRecognitionMode] = useState<'sell' | 'stock'>('sell');
  const [targetItemToCapturePhoto, setTargetItemToCapturePhoto] = useState<Item | null>(null);

  const [stockSearch, setStockSearch] = useState('');
  const [selectedStockCategory, setSelectedStockCategory] = useState<string>('all');
  const [selectedSellCategory, setSelectedSellCategory] = useState<string>('all');
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
  const [isFinalizing, setIsFinalizing] = useState(false);
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
        fetchJsonWithRetry('/pin.json').catch(() => '1234'),
        fetchJsonWithRetry('/whatsappConfig.json').catch(() => null),
        fetchJsonWithRetry('/spareParts.json').catch(() => null),
        fetchJsonWithRetry('/telegramConfig.json').catch(() => null)
      ]);

      const [
        itemsRaw, salesRaw, otherIncomeRaw, debtsRaw, cardStockRaw,
        cashRegisterRaw, expensesRaw, plansRaw, balanceRaw, auditRaw, pinRaw, whatsappConfigRaw,
        sparePartsRaw, telegramConfigRaw
      ] = results;

      setItems(parseRawWithKeys<Item>(itemsRaw));
      setSales(parseRawWithKeys<Sale>(salesRaw));
      setOtherIncome(parseRawWithKeys<OtherIncome>(otherIncomeRaw));
      setDebts(parseRawWithKeys<Debt>(debtsRaw));
      setCardStock(parseRawWithKeys<CardStockEntry>(cardStockRaw));
      setCashRegister(typeof cashRegisterRaw === 'number' ? cashRegisterRaw : 0);
      setExpenses(parseRawWithKeys<Expense>(expensesRaw));
      setSpareParts(parseRawWithKeys<SparePart>(sparePartsRaw));
      if (whatsappConfigRaw) {
        setWhatsappConfig({
          enabled: whatsappConfigRaw.enabled !== false,
          phone: whatsappConfigRaw.phone || '+21641444355',
          apiKey: whatsappConfigRaw.apiKey || ''
        });
      }
      if (telegramConfigRaw) {
        setTelegramConfig({
          enabled: telegramConfigRaw.enabled !== false,
          botToken: telegramConfigRaw.botToken || '',
          chatId: telegramConfigRaw.chatId || ''
        });
      }
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
    const { name, barcode, buy, sell, qty, category } = newItem;
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
            barcodes: mergedBarcodes,
            category: category || existing.category || 'accessory'
          };
          const ok = await putWithOutbox(`/items/${existing.id}.json`, updated);
          if (ok) {
            triggerToast('✅ تم تحديث كمية السلعة بنجاح');
            logAudit('edit', `تحديث ستوك سلعة مكررة: ${name} (+${qtyVal})`);
            loadAllData();
          }
          setNewItem({ name: '', barcode: '', buy: '', sell: '', qty: '', category: 'accessory', imageUrl: '' });
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
      barcodes: barcodeArray,
      category: category || 'accessory',
      imageUrl: newItem.imageUrl || undefined
    };

    const ok = await putWithOutbox(`/items/${item.id}.json`, item);
    if (ok) {
      triggerToast('✅ تم إضافة السلعة الجديدة للمخزن');
      logAudit('edit', `إضافة سلعة جديدة: ${name} (${qtyVal} قطعة)`);
      setNewItem({ name: '', barcode: '', buy: '', sell: '', qty: '', category: 'accessory', imageUrl: '' });
      loadAllData();
    }
  };

  const handleUpdateItemImage = async (itemId: string, imageUrl: string) => {
    const target = items.find(i => i.id === itemId);
    if (!target) return;
    const updated: Item = { ...target, imageUrl };
    setItems(prev => prev.map(i => i.id === itemId ? updated : i));
    const ok = await putWithOutbox(`/items/${itemId}.json`, updated);
    if (ok) {
      triggerToast('✅ تم حفظ صورة المنتج بنجاح');
      logAudit('edit', `تحديث صورة السلعة: ${target.name}`);
    }
  };

  const handleAddNewItemWithImage = async (
    name: string,
    sellPrice: number,
    buyPrice: number,
    qty: number,
    category: string,
    imageUrl: string
  ) => {
    const newItemObj: Item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      sell: sellPrice,
      buy: buyPrice,
      qty,
      category,
      imageUrl,
      barcodes: []
    };

    setItems(prev => [newItemObj, ...prev]);
    const ok = await putWithOutbox(`/items/${newItemObj.id}.json`, newItemObj);
    if (ok) {
      triggerToast(`✨ تم تسجيل "${name}" بالستوك وإرفاق صورتها فوراً!`);
      logAudit('edit', `تسجيل سلعة جديدة بالصورة: ${name}`);
      handleQuickAddItemToCart(newItemObj, 1);
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

  const handleEditItemCategory = async (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const currentCat = item.category || 'accessory';
    const choice = prompt(
      `اختر فئة جديدة لـ "${item.name}":\n1 - هواتف 📱\n2 - بطاريات 🔋\n3 - سبيكرات 🔊\n4 - سماعات بلوتوث 🎧\n5 - أكسسوارات أخرى 🔌`, 
      currentCat === 'phone' ? '1' : currentCat === 'battery' ? '2' : currentCat === 'speaker' ? '3' : currentCat === 'bluetooth' ? '4' : '5'
    );
    if (choice === null) return;
    let newCat = 'accessory';
    if (choice === '1') newCat = 'phone';
    else if (choice === '2') newCat = 'battery';
    else if (choice === '3') newCat = 'speaker';
    else if (choice === '4') newCat = 'bluetooth';
    else if (choice === '5') newCat = 'accessory';
    else {
      return triggerToast('❌ اختيار غير صحيح');
    }

    if (newCat === currentCat) return;

    const updated = { ...item, category: newCat };
    const ok = await putWithOutbox(`/items/${itemId}.json`, updated);
    if (ok) {
      triggerToast('✅ تم تعديل الفئة بنجاح');
      logAudit('edit', `تعديل فئة سلعة "${item.name}" إلى ${CATEGORY_MAP[newCat].label}`);
      loadAllData();
    } else {
      triggerToast('❌ فشل تعديل الفئة، حاول لاحقاً');
    }
  };

  const handleEditItemPrice = async (itemId: string, type: 'sell' | 'buy') => {
    if (currentRole !== 'manager') {
      return triggerToast('❌ تعديل أسعار الستوك متاح للمدير فقط');
    }
    const item = items.find(i => i.id === itemId);
    if (!item) return;

    const currentVal = type === 'sell' ? item.sell : item.buy;
    const label = type === 'sell' ? 'سعر البيع' : 'سعر الشراء (التكلفة)';
    const input = prompt(`تعديل ${label} للسلعة "${item.name}":`, currentVal.toString());
    if (input === null) return;

    const val = parseFloat(input);
    if (isNaN(val) || val < 0) {
      return triggerToast('❌ سعر غير صالح');
    }

    const updated = {
      ...item,
      [type]: val
    };

    const ok = await putWithOutbox(`/items/${itemId}.json`, updated);
    if (ok) {
      triggerToast(`✅ تم تعديل ${label} بنجاح إلى ${val.toFixed(3)} د.ت`);
      logAudit('edit', `تعديل ${label} لسلعة "${item.name}": ${currentVal} ➔ ${val}`);
      loadAllData();
    } else {
      triggerToast('❌ فشل حفظ السعر الجديد، حاول لاحقاً');
    }
  };

  const sendTelegramMessageDirectly = async (botToken: string, chatId: string, message: string, parseMode: string) => {
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: parseMode
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        return { success: true, data };
      }
      return { success: false, error: data.description || 'فشل إرسال الرسالة المباشرة عبر تلغرام' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'خطأ في الشبكة أثناء الاتصال المباشر بتلغرام' };
    }
  };

  const sendTelegramMessage = async (botToken: string, chatId: string, message: string, parseMode: string = 'HTML') => {
    const cleanBotToken = (botToken || '').replace(/\s+/g, '');
    const cleanChatId = (chatId || '').replace(/\s+/g, '');
    
    try {
      const response = await fetch('/api/send-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: cleanBotToken,
          chatId: cleanChatId,
          message,
          parseMode
        })
      });
      
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return { success: true, data };
      }
      
      if (response.status === 404) {
        console.warn('Backend proxy not found (404), falling back to direct client fetch to Telegram API...');
        return await sendTelegramMessageDirectly(cleanBotToken, cleanChatId, message, parseMode);
      }
      
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error || `خطأ من الخادم: ${response.status}` };
    } catch (err: any) {
      console.warn('Network error calling backend proxy, falling back to direct client fetch to Telegram API...', err);
      return await sendTelegramMessageDirectly(cleanBotToken, cleanChatId, message, parseMode);
    }
  };

  const sendWhatsAppMessageDirectly = async (phone: string, apiKey: string, message: string): Promise<{ success: boolean; data?: any; error?: string; details?: string }> => {
    try {
      const cleanedPhoneNoPlus = (phone || '').replace('+', '').replace(/\s+/g, '');
      const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(
        cleanedPhoneNoPlus
      )}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apiKey)}`;
      
      await fetch(url, { mode: 'no-cors' });
      return { success: true, details: 'تم إرسال الطلب المباشر بنجاح' };
    } catch (err: any) {
      return { success: false, error: err?.message || 'خطأ أثناء الاتصال المباشر بواتساب' };
    }
  };

  const sendWhatsAppMessage = async (phone: string, apiKey: string, message: string): Promise<{ success: boolean; data?: any; error?: string; details?: string }> => {
    const cleanPhone = (phone || '').replace(/\s+/g, '');
    const cleanApiKey = (apiKey || '').replace(/\s+/g, '');
    
    try {
      const response = await fetch('/api/send-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          apiKey: cleanApiKey,
          message
        })
      });
      
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        return { success: true, data };
      }
      
      if (response.status === 404) {
        console.warn('Backend proxy not found (404), falling back to direct client fetch to CallMeBot API...');
        return await sendWhatsAppMessageDirectly(cleanPhone, cleanApiKey, message);
      }
      
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error || `خطأ من الخادم: ${response.status}` };
    } catch (err: any) {
      console.warn('Network error calling backend proxy, falling back to direct client fetch to CallMeBot API...', err);
      return await sendWhatsAppMessageDirectly(cleanPhone, cleanApiKey, message);
    }
  };

  const triggerWhatsAppNotification = async (
    invoiceCart: CartLine[],
    totalAmount: number,
    isDebt: boolean,
    customer: string
  ) => {
    try {
      if (whatsappConfig.enabled === false || !whatsappConfig.apiKey) {
        console.log('WhatsApp notification skipped');
        return;
      }

      const formattedDate = new Date().toLocaleString('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      let msg = `🛍️ *عملية بيع جديدة!*\n`;
      msg += `📅 *الوقت:* ${formattedDate}\n`;
      msg += `💰 *المجموع:* ${totalAmount.toFixed(3)} د.ت\n`;
      msg += `💳 *النوع:* ${isDebt ? `دين على [${customer}]` : 'نقدي كاش'}\n\n`;
      msg += `📦 *السلع والخدمات:*\n`;

      invoiceCart.forEach(c => {
        msg += `• ${c.label} × ${c.qty} (${c.unitPrice.toFixed(3)} د.ت)\n`;
      });

      const result = await sendWhatsAppMessage(whatsappConfig.phone, whatsappConfig.apiKey, msg);
      if (result.success) {
        console.log('WhatsApp notification sent successfully');
      } else {
        console.error('WhatsApp notification failed:', result.error);
        logAudit('warning', `فشل إرسال إشعار واتساب للمبيعات: ${result.error || 'خطأ غير معروف'}`);
      }
    } catch (err: any) {
      console.error('Error in triggerWhatsAppNotification:', err);
      logAudit('warning', `خطأ في إرسال إشعار واتساب للمبيعات: ${err?.message || 'خطأ فني'}`);
    }
  };

  const handleSaveWhatsAppConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = (whatsappConfig.phone || '').replace(/\s+/g, '');
    const cleanApiKey = (whatsappConfig.apiKey || '').replace(/\s+/g, '');
    const cleanedConfig = {
      ...whatsappConfig,
      phone: cleanPhone,
      apiKey: cleanApiKey
    };
    setWhatsappConfig(cleanedConfig);
    const ok = await putWithOutbox('/whatsappConfig.json', cleanedConfig);
    if (ok) {
      triggerToast('✅ تم حفظ إعدادات واتساب بنجاح');
      logAudit('edit', `تعديل إعدادات إشعارات واتساب: ${cleanedConfig.enabled ? 'مفعلة' : 'معطلة'} للرقم ${cleanedConfig.phone}`);
    } else {
      triggerToast('❌ فشل الحفظ، يرجى التحقق من الاتصال بالإنترنت');
    }
  };

  const escapeHTML = (text: string) => {
    return (text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

  const triggerTelegramDebtNotification = async (
    customerName: string,
    amount: number,
    note: string,
    phone?: string
  ) => {
    try {
      if (telegramConfig.enabled === false || !telegramConfig.botToken || !telegramConfig.chatId) {
        console.log('Telegram debt notification skipped: Telegram is disabled or config is missing');
        return;
      }

      const formattedDate = new Date().toLocaleString('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const cleanName = escapeHTML(customerName);
      const cleanNote = escapeHTML(note);
      const cleanPhone = phone ? escapeHTML(phone) : '';

      let msg = `<b>⚠️ تسجيل دين جديد! ⚠️</b>\n\n`;
      msg += `<b>👤 الحريف:</b> ${cleanName}\n`;
      if (cleanPhone) {
        msg += `<b>📞 الهاتف:</b> <code>${cleanPhone}</code>\n`;
      }
      msg += `<b>💰 قيمة الدين:</b> <code>${amount.toFixed(3)}</code> د.ت\n`;
      msg += `<b>📝 ملاحظة:</b> ${cleanNote}\n`;
      msg += `<b>📅 التاريخ:</b> ${formattedDate}\n`;

      const result = await sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, msg, 'HTML');
      if (result.success) {
        console.log('Telegram debt notification sent successfully');
      } else {
        console.error('Telegram debt notification failed:', result.error);
        logAudit('warning', `فشل إرسال إشعار تلغرام للديون: ${result.error || 'خطأ غير معروف'}`);
      }
    } catch (err: any) {
      console.error('Error in triggerTelegramDebtNotification:', err);
      logAudit('warning', `خطأ في إرسال إشعار تلغرام للديون: ${err?.message || 'خطأ فني'}`);
    }
  };

  const sendTelegramPDF = async (pdfBase64: string, filename: string, caption: string) => {
    if (!telegramConfig.botToken || !telegramConfig.chatId) {
      console.warn('Telegram botToken or chatId is not configured for PDF');
      return { success: false, error: 'Telegram credentials missing' };
    }
    
    try {
      const response = await fetch('/api/send-telegram-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          botToken: telegramConfig.botToken.replace(/\s+/g, ''),
          chatId: telegramConfig.chatId.replace(/\s+/g, ''),
          pdfBase64,
          filename,
          caption
        })
      });
      
      if (response.ok) {
        const data = await response.json();
        return { success: true, data };
      }
      
      const errData = await response.json().catch(() => ({}));
      return { success: false, error: errData.error || `خطأ من الخادم: ${response.status}` };
    } catch (err: any) {
      console.error('Network error calling Telegram PDF API:', err);
      return { success: false, error: err?.message || 'خطأ في الشبكة' };
    }
  };

  const generateResetReportPDF = async (salesToRemove: Sale[], otherToRemove: OtherIncome[], days: number) => {
    try {
      // Create offscreen canvas for rendering
      const canvas = document.createElement('canvas');
      canvas.width = 1240;
      canvas.height = 1754;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('Could not get 2D canvas context');
        return null;
      }

      // White background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 1240, 1754);

      // Accent color bar
      ctx.fillStyle = '#991B1B'; // Burgundy/Red-800
      ctx.fillRect(0, 0, 1240, 25);

      // Title
      ctx.fillStyle = '#1C1917'; // stone-900
      ctx.font = 'bold 34px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillText('📋 تقرير تصفير سجل المبيعات والمداخيل', 1140, 95);

      // Subtitle
      ctx.fillStyle = '#78716C'; // stone-500
      ctx.font = '18px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillText('نظام إدارة مبيعات Yosri GSM - متصل بالخادم السحابي', 1140, 135);

      // Horizontal line
      ctx.strokeStyle = '#E7E5E4'; // stone-200
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(100, 165);
      ctx.lineTo(1140, 165);
      ctx.stroke();

      // Report Metadata (RTL)
      ctx.fillStyle = '#44403C'; // stone-700
      ctx.font = 'bold 16px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`📅 تاريخ التصفير: ${new Date().toLocaleString('ar-TN')}`, 1140, 205);
      ctx.fillText(`🧹 الفترة الممسوحة: آخر ${days} أيام`, 1140, 240);

      ctx.textAlign = 'left';
      ctx.fillText(`👤 المسؤول: مدير النظام`, 100, 205);
      const reportId = `RST-${Date.now().toString(36).toUpperCase()}`;
      ctx.fillText(`🔑 معرّف التقرير: #${reportId}`, 100, 240);

      // Horizontal line
      ctx.strokeStyle = '#E7E5E4'; // stone-200
      ctx.beginPath();
      ctx.moveTo(100, 275);
      ctx.lineTo(1140, 275);
      ctx.stroke();

      // Calculations
      const totalSalesVal = salesToRemove.reduce((s, x) => s + x.total, 0);
      const totalOtherVal = otherToRemove.reduce((s, x) => s + x.amount, 0);
      const totalRevenue = totalSalesVal + totalOtherVal;
      const totalCost = salesToRemove.reduce((s, x) => s + (x.unitBuy * (x.qty || 1)), 0);
      const profit = totalRevenue - totalCost;

      // Draw 3 statistic cards
      const drawCard = (cx: number, cy: number, cw: number, ch: number, title: string, value: string, color: string) => {
        ctx.fillStyle = '#FAFAF9'; // stone-50
        ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeStyle = '#E7E5E4'; // stone-200
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx, cy, cw, ch);
        
        ctx.fillStyle = color;
        ctx.fillRect(cx, cy, cw, 6);
        
        ctx.fillStyle = '#78716C'; // stone-500
        ctx.font = 'bold 15px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.fillText(title, cx + cw / 2, cy + 40);
        
        ctx.fillStyle = '#1C1917'; // stone-900
        ctx.font = 'bold 24px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.fillText(value, cx + cw / 2, cy + 85);
      };

      drawCard(800, 310, 340, 120, '💵 إجمالي المداخيل الممسوحة', `${totalRevenue.toFixed(3)} د.ت`, '#991B1B');
      drawCard(450, 310, 340, 120, '📦 تكلفة شراء السلع المبيعة', `${totalCost.toFixed(3)} د.ت`, '#78716C');
      drawCard(100, 310, 340, 120, '📈 صافي أرباح الفترة ممسوحة', `${profit.toFixed(3)} د.ت`, '#047857');

      // Table Header title
      ctx.fillStyle = '#1C1917'; // stone-900
      ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillText('📋 كشف تفصيلي بالعمليات ممسوحة (آخر 25 عملية):', 1140, 485);

      // Draw table header
      const tableY = 515;
      ctx.fillStyle = '#1C1917'; // stone-900
      ctx.fillRect(100, tableY, 1040, 40);
      
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 15px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      
      ctx.fillText('م', 1115, tableY + 25);
      ctx.fillText('التاريخ والوقت', 990, tableY + 25);
      ctx.fillText('البيان / تفاصيل العملية', 670, tableY + 25);
      ctx.fillText('الكمية', 410, tableY + 25);
      ctx.fillText('السعر', 310, tableY + 25);
      ctx.fillText('الإجمالي', 175, tableY + 25);

      // Prepare rows
      const allRows = [
        ...salesToRemove.map(s => ({
          date: s.date,
          label: s.itemName,
          qty: s.qty,
          price: s.unitPrice,
          total: s.total
        })),
        ...otherToRemove.map(o => ({
          date: o.date,
          label: `${o.category === 'forfait_replenish' ? 'شحن رصيد فورفي' : o.category === 'card' ? 'بيع كارت شحن' : 'خدمة أخرى'}: ${o.label}`,
          qty: o.qty || 1,
          price: o.amount / (o.qty || 1),
          total: o.amount
        }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      let currentY = tableY + 40;
      const rowsToShow = allRows.slice(0, 25);

      rowsToShow.forEach((row, idx) => {
        // bg
        ctx.fillStyle = idx % 2 === 0 ? '#FAFAF9' : '#FFFFFF';
        ctx.fillRect(100, currentY, 1040, 38);
        
        // border
        ctx.strokeStyle = '#F5F5F4'; // stone-100
        ctx.lineWidth = 1;
        ctx.strokeRect(100, currentY, 1040, 38);
        
        // row text
        ctx.fillStyle = '#44403C'; // stone-700
        ctx.font = '14px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        
        // Index
        ctx.fillText(String(idx + 1), 1115, currentY + 24);
        
        // Date
        const rowDateStr = new Date(row.date).toLocaleString('fr-FR', {
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        ctx.fillText(rowDateStr, 990, currentY + 24);
        
        // Label
        ctx.textAlign = 'right';
        let lbl = row.label || '';
        if (lbl.length > 42) lbl = lbl.slice(0, 39) + '...';
        ctx.fillText(lbl, 870, currentY + 24);
        
        // Qty
        ctx.textAlign = 'center';
        ctx.fillText(String(row.qty), 410, currentY + 24);
        
        // Price
        ctx.fillText(row.price.toFixed(3), 310, currentY + 24);
        
        // Total
        ctx.fillStyle = '#1C1917'; // stone-900
        ctx.font = 'bold 14px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.fillText(row.total.toFixed(3), 175, currentY + 24);
        
        currentY += 38;
      });

      // Extra text if remaining
      if (allRows.length > 25) {
        ctx.fillStyle = '#78716C'; // stone-500
        ctx.font = 'italic 14px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.fillText(`💡 ولقد تم تصفير ومسح ${allRows.length - 25} عملية إضافية أخرى لم يتسع الجدول لعرضها تفصيلياً.`, 620, currentY + 30);
      }

      // Footer Box
      ctx.strokeStyle = '#E7E5E4'; // stone-200
      ctx.lineWidth = 1;
      ctx.strokeRect(100, 1630, 1040, 60);
      
      ctx.fillStyle = '#78716C'; // stone-500
      ctx.font = '13px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.fillText('🛡️ تم تصفير هذا السجل وتوليد هذا التقرير القانوني تلقائياً لحفظ الحقوق والأرشيف.', 620, 1655);
      ctx.fillText('متجر Yosri GSM - العنوان: تبر، الكاف | هاتف: 41 444 355 | متصل بالخادم السحابي لـ Yosri GSM', 620, 1675);

      // Convert canvas to image and initialize jsPDF
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);

      // Trigger local browser download
      const filename = `report_reset_${new Date().toISOString().split('T')[0]}_${reportId}.pdf`;
      pdf.save(filename);

      // If Telegram is enabled, send it!
      if (telegramConfig.enabled && telegramConfig.botToken && telegramConfig.chatId) {
        const pdfBase64 = pdf.output('datauristring');
        const caption = `🧹 <b>تقرير تصفير سجل المبيعات والمداخيل</b>\n\n• <b>رقم التقرير:</b> <code>#${reportId}</code>\n• <b>الفترة ممسوحة:</b> آخر ${days} أيام\n• <b>إجمالي المداخيل ممسوحة:</b> ${totalRevenue.toFixed(3)} د.ت\n• <b>صافي الربح الممسوح:</b> ${profit.toFixed(3)} د.ت\n• <b>عدد العمليات الكلي:</b> ${allRows.length}\n\n<i>تم تصفير السجل بنجاح وإرسال التقرير تلقائياً للأرشيف.</i>`;
        
        triggerToast('📤 جاري إرسال تقرير PDF لتلغرام...');
        const result = await sendTelegramPDF(pdfBase64, filename, caption);
        if (result.success) {
          triggerToast('✅ تم إرسال تقرير PDF بنجاح لتلغرام');
        } else {
          console.error('Failed to send PDF to Telegram:', result.error);
          triggerToast(`❌ فشل إرسال PDF لتلغرام: ${result.error}`);
        }
      }

      return pdf;
    } catch (err: any) {
      console.error('Error generating PDF report:', err);
      triggerToast('❌ خطأ أثناء توليد تقرير PDF');
      return null;
    }
  };

  const triggerTelegramNotification = async (
    invoiceCart: CartLine[],
    totalAmount: number,
    isDebt: boolean,
    customer: string
  ) => {
    try {
      if (telegramConfig.enabled === false || !telegramConfig.botToken || !telegramConfig.chatId) {
        console.log('Telegram notification skipped');
        return;
      }

      const formattedDate = new Date().toLocaleString('fr-FR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      const cleanCustomer = escapeHTML(customer);
      let msg = `<b>🛍️ عملية بيع جديدة!</b>\n`;
      msg += `<b>📅 الوقت:</b> ${formattedDate}\n`;
      msg += `<b>💰 المجموع:</b> ${totalAmount.toFixed(3)} د.ت\n`;
      msg += `<b>💳 النوع:</b> ${isDebt ? `دين على [${cleanCustomer}]` : 'نقدي كاش'}\n\n`;
      msg += `<b>📦 السلع والخدمات:</b>\n`;

      invoiceCart.forEach(c => {
        const cleanLabel = escapeHTML(c.label);
        msg += `• ${cleanLabel} × ${c.qty} (${c.unitPrice.toFixed(3)} د.ت)\n`;
      });

      const result = await sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, msg, 'HTML');
      if (result.success) {
        console.log('Telegram notification sent successfully');
      } else {
        console.error('Telegram notification failed:', result.error);
        logAudit('warning', `فشل إرسال إشعار تلغرام للمبيعات: ${result.error || 'خطأ غير معروف'}`);
      }
    } catch (err: any) {
      console.error('Error in triggerTelegramNotification:', err);
      logAudit('warning', `خطأ في إرسال إشعار تلغرام للمبيعات: ${err?.message || 'خطأ فني'}`);
    }
  };

  const handleTestTelegram = async () => {
    if (!telegramConfig.botToken || !telegramConfig.chatId) {
      triggerToast('⚠️ يرجى إدخال رمز البوت ومعرف المحادثة أولاً');
      return;
    }
    triggerToast('⚡ جاري إرسال رسالة تجريبية...');
    const msg = `🔔 <b>إشعار تجريبي ناجح!</b>\n\nلقد تم ربط نظام المتجر ببوت التلغرام الخاص بك بنجاح ⚡\nجاهز الآن لتلقي الإشعارات الفورية!`;
    const result = await sendTelegramMessage(telegramConfig.botToken, telegramConfig.chatId, msg, 'HTML');
    if (result.success) {
      triggerToast('✅ تمت عملية الفحص بنجاح! تحقق من حسابك على تلغرام');
      logAudit('edit', 'إرسال رسالة تجريبية ناجحة عبر تلغرام');
    } else {
      let errMsg = result.error || 'رمز غير صحيح أو لم تقم بتفعيل البوت أو لم تبدأ المحادثة';
      if (errMsg.includes('Unauthorized') || errMsg.includes('401')) {
        errMsg = 'رمز البوت (Bot Token) غير صحيح، يرجى إعادة نسخه والتأكد منه';
      } else if (errMsg.includes('chat not found') || errMsg.includes('400')) {
        errMsg = 'معرف المحادثة (Chat ID) غير صحيح، أو لم تقم ببدء المحادثة مع البوت بالضغط على Start';
      }
      triggerToast(`❌ فشل الاتصال: ${errMsg}`);
    }
  };

  const handleTestWhatsApp = async () => {
    if (!whatsappConfig.phone || !whatsappConfig.apiKey) {
      triggerToast('⚠️ يرجى إدخال رقم الهاتف ورمز الـ API أولاً');
      return;
    }
    triggerToast('⚡ جاري إرسال رسالة تجريبية...');
    const msg = `🔔 إشعار تجريبي ناجح! لقد تم ربط نظام المتجر بالواتساب بنجاح 🟢`;
    const result = await sendWhatsAppMessage(whatsappConfig.phone, whatsappConfig.apiKey, msg);
    if (result.success) {
      triggerToast('✅ تمت عملية الفحص بنجاح! تحقق من هاتفك على واتساب');
      logAudit('edit', 'إرسال رسالة تجريبية ناجحة عبر واتساب');
    } else {
      triggerToast(`❌ فشل الاتصال: ${result.error || 'يرجى التأكد من الرقم والرمز السري وتفعيل البوت'}`);
    }
  };

  const handleSaveTelegramConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanBotToken = (telegramConfig.botToken || '').replace(/\s+/g, '');
    const cleanChatId = (telegramConfig.chatId || '').replace(/\s+/g, '');
    const cleanedConfig = {
      ...telegramConfig,
      botToken: cleanBotToken,
      chatId: cleanChatId
    };
    setTelegramConfig(cleanedConfig);
    const ok = await putWithOutbox('/telegramConfig.json', cleanedConfig);
    if (ok) {
      triggerToast('✅ تم حفظ إعدادات تلغرام بنجاح');
      logAudit('edit', `تعديل إعدادات إشعارات تلغرام: ${cleanedConfig.enabled ? 'مفعلة' : 'معطلة'}`);
    } else {
      triggerToast('❌ فشل الحفظ، يرجى التحقق من الاتصال بالإنترنت');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (!await promptAndVerifyPin(`هل أنت متأكد من مسح السلعة "${item.name}" نهائياً من السيستم؟`)) return;

    const ok = await putWithOutbox(`/items/${itemId}.json`, null);
    if (ok) {
      triggerToast('✅ تم مسح السلعة بنجاح');
      logAudit('delete', `حذف سلعة نهائياً: ${item.name}`);
      loadAllData();
    } else {
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

  const handleAdjustCardQty = async (id: string, delta: number) => {
    const card = cardStock.find(c => c.id === id);
    if (!card) return;
    if (delta < 0 && card.qty <= 0) return triggerToast('❌ المخزن فارغ بالفعل');

    const newVal = card.qty + delta;
    const updated = { ...card, qty: newVal };
    const ok = await putWithOutbox(`/cardStock/${card.id}.json`, updated);
    if (ok) {
      triggerToast('✅ تم تحديث كمية البطاقات');
      logAudit('edit', `تعديل سريع لستوك بطاقات ${card.operator} فئة ${card.value}: ${card.qty} ← ${newVal} (${delta > 0 ? '+' : ''}${delta})`);
      loadAllData();
    } else {
      triggerToast('❌ فشل تعديل الكمية، الرجاء المحاولة مجدداً');
    }
  };

  const handleDeleteCardStock = async (id: string) => {
    const card = cardStock.find(c => c.id === id);
    if (!card) return;
    if (!await promptAndVerifyPin(`حذف بطاقات الشحن لـ ${card.operator} (${card.value} د.ت)؟`)) return;

    const ok = await putWithOutbox(`/cardStock/${id}.json`, null);
    if (ok) {
      triggerToast('✅ تم حذف كارت الشحن من المخزن');
      logAudit('delete', `حذف ستوك كروت شحن: ${card.operator} فئة ${card.value}`);
      loadAllData();
    } else {
      triggerToast('❌ فشل الحذف، تأكد من الاتصال');
    }
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
    const ok = await putWithOutbox(`/forfaitPlans/${id}.json`, null);
    if (ok) {
      triggerToast('✅ تم حذف الباقة');
      loadAllData();
    } else {
      triggerToast('❌ فشل الحذف، تأكد من الاتصال');
    }
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

    const ok = await putWithOutbox(`/expenses/${id}.json`, null);
    if (ok) {
      triggerToast('✅ تم مسح المصروف');
      logAudit('delete', `حذف مصروف يومي: ${exp.desc} (${exp.amount} د.ت)`);
      loadAllData();
    } else {
      triggerToast('❌ فشل الحذف، تأكد من الاتصال');
    }
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
      
      // Trigger Telegram Notification for manual debt
      triggerTelegramDebtNotification(name, amtVal, note || 'دين يدوي', phone || undefined);

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

    // Rollback items, recharge cards, and forfait balances to inventory/balances
    if (debt.lines) {
      const itemIncrements: Record<string, number> = {};
      const cardIncrements: Record<string, { entry: CardStockEntry; totalQty: number }> = {};
      const forfaitIncrements: Record<string, number> = {};

      for (const line of debt.lines) {
        if (line.type === 'item' && line.itemId) {
          itemIncrements[line.itemId] = (itemIncrements[line.itemId] || 0) + line.qty;
        }
        if (line.type === 'recharge' && line.cardOperator && line.cardValue) {
          const card = cardStock.find(c => c.operator === line.cardOperator && c.value === line.cardValue);
          if (card) {
            if (!cardIncrements[card.id]) {
              cardIncrements[card.id] = { entry: card, totalQty: 0 };
            }
            cardIncrements[card.id].totalQty += line.qty;
          }
        }
        if (line.type === 'forfait' && line.cardOperator) {
          forfaitIncrements[line.cardOperator] = (forfaitIncrements[line.cardOperator] || 0) + (line.total || 0);
        }
      }

      // 1. Rollback items
      for (const itemId of Object.keys(itemIncrements)) {
        await safeIncrementItemQty(itemId, itemIncrements[itemId]);
      }

      // 2. Rollback recharge cards
      for (const cardId of Object.keys(cardIncrements)) {
        const { entry, totalQty } = cardIncrements[cardId];
        await putWithOutbox(`/cardStock/${cardId}.json`, {
          ...entry,
          qty: entry.qty + totalQty
        });
      }

      // 3. Rollback forfait balance
      if (Object.keys(forfaitIncrements).length > 0) {
        const updatedBalance = { ...forfaitBalance };
        for (const op of Object.keys(forfaitIncrements)) {
          const curBal = updatedBalance[op] || 0;
          updatedBalance[op] = curBal + forfaitIncrements[op];
        }
        await putWithOutbox('/forfaitBalance.json', updatedBalance);
      }
    }

    const ok = await putWithOutbox(`/debts/${id}.json`, null);
    if (ok) {
      triggerToast('✅ تم حذف الدين ورجعت كافة السلع والأرصدة للمستودع');
      logAudit('delete', `حذف ملف دين بالكامل: ${debt.customerName}`);
      loadAllData();
    } else {
      triggerToast('❌ فشل حذف الدين، تأكد من الاتصال');
    }
  };

  // ---- Spare Parts Actions ----
  const handleAddSparePart = async (e: React.FormEvent) => {
    e.preventDefault();
    const { name, supplierName, qty, unitCost, notes } = newSparePart;
    if (!name.trim()) return triggerToast('❌ الرجاء إدخال اسم القطعة (مثال: شاشة، بطارية...)');
    if (!supplierName.trim()) return triggerToast('❌ الرجاء إدخال اسم المزوّد (الفورنيسور)');
    const qtyVal = parseInt(qty, 10) || 1;
    const costVal = parseFloat(unitCost) || 0;
    if (qtyVal <= 0) return triggerToast('❌ الكمية يجب أن تكون أكبر من 0');
    if (costVal < 0) return triggerToast('❌ سعر التكلفة غير صالح');

    const sp: SparePart = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name.trim(),
      supplierName: supplierName.trim(),
      qty: qtyVal,
      unitCost: costVal,
      totalCost: qtyVal * costVal,
      status: 'unpaid',
      date: new Date().toISOString(),
      notes: notes.trim() || undefined
    };

    const ok = await putWithOutbox(`/spareParts/${sp.id}.json`, sp);
    if (ok) {
      triggerToast('✅ تم تسجيل قطعة الغيار بنجاح');
      logAudit('edit', `إضافة قطعة غيار من المزوّد ${supplierName}: ${name} عدد ${qtyVal} بتكلفة ${sp.totalCost.toFixed(3)} د.ت`);
      setNewSparePart({ name: '', supplierName: '', qty: '1', unitCost: '', notes: '' });
      loadAllData();
    } else {
      triggerToast('❌ فشل تسجيل قطعة الغيار، الرجاء المحاولة مجدداً');
    }
  };

  const handleToggleSparePartPayment = async (id: string) => {
    const sp = spareParts.find(s => s.id === id);
    if (!sp) return;

    const newStatus = sp.status === 'paid' ? 'unpaid' : 'paid';
    const updated = { ...sp, status: newStatus };
    const ok = await putWithOutbox(`/spareParts/${sp.id}.json`, updated);
    if (ok) {
      triggerToast(newStatus === 'paid' ? '✅ تم تمييز القطعة كخالصة (خُلصت)' : '⏳ تم إرجاع القطعة كغير خالصة (لم تُدفع بعد)');
      logAudit('edit', `تعديل حالة دفع قطعة الغيار "${sp.name}" من المزوّد ${sp.supplierName} إلى ${newStatus === 'paid' ? 'خالصة' : 'غير خالصة'}`);
      loadAllData();
    }
  };

  const handleDeleteSparePart = async (id: string) => {
    const sp = spareParts.find(s => s.id === id);
    if (!sp) return;
    if (!await promptAndVerifyPin(`هل ترغب فعلاً بحذف قطعة الغيار "${sp.name}" من المزوّد ${sp.supplierName}؟`)) return;

    const ok = await putWithOutbox(`/spareParts/${id}.json`, null);
    if (ok) {
      triggerToast('✅ تم حذف قطعة الغيار من القائمة');
      logAudit('delete', `حذف قطعة غيار من المزوّد ${sp.supplierName}: ${sp.name} بتكلفة ${sp.totalCost.toFixed(3)} د.ت`);
      loadAllData();
    } else {
      triggerToast('❌ فشل الحذف، الرجاء المحاولة مجدداً');
    }
  };

  const handleAdjustSparePartQty = async (id: string, delta: number) => {
    const sp = spareParts.find(s => s.id === id);
    if (!sp) return;
    if (delta < 0 && sp.qty <= 1) return triggerToast('❌ لا يمكن للكمية أن تكون أقل من 1، يمكنك حذف السطر إن أردت');

    const newVal = sp.qty + delta;
    const updated = { ...sp, qty: newVal, totalCost: newVal * sp.unitCost };
    const ok = await putWithOutbox(`/spareParts/${sp.id}.json`, updated);
    if (ok) {
      triggerToast('✅ تم تعديل الكمية');
      logAudit('edit', `تعديل سريع لكمية قطعة الغيار "${sp.name}": ${sp.qty} ← ${newVal}`);
      loadAllData();
    }
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

  const handleEditCartLinePrice = (lineId: string) => {
    const line = cart.find(c => c.id === lineId);
    if (!line) return;
    const input = prompt(`تعديل سعر البيع للسلعة "${line.label}" في الفاتورة:`, line.unitPrice.toString());
    if (input === null) return;

    const val = parseFloat(input);
    if (isNaN(val) || val < 0) {
      return triggerToast('❌ سعر غير صالح');
    }

    setCart(prev => prev.map(c => {
      if (c.id === lineId) {
        return {
          ...c,
          unitPrice: val,
          total: val * c.qty
        };
      }
      return c;
    }));
    triggerToast(`⚡ تم تعديل سعر "${line.label}" للفاتورة إلى ${val.toFixed(3)} د.ت`);
  };

  const handleAdjustCartLineQty = (lineId: string, delta: number) => {
    const line = cart.find(c => c.id === lineId);
    if (!line) return;

    const newQty = line.qty + delta;
    if (newQty <= 0) {
      handleRemoveFromCart(lineId);
      return;
    }

    if (line.type === 'item' && line.itemId) {
      const item = items.find(i => i.id === line.itemId);
      if (item) {
        const otherCartQty = cart
          .filter(c => c.type === 'item' && c.itemId === line.itemId && c.id !== lineId)
          .reduce((s, c) => s + c.qty, 0);
        if (newQty + otherCartQty > item.qty) {
          return triggerToast(`❌ الستوك المتوفر فقط: ${item.qty - otherCartQty}`);
        }
      }
    }

    setCart(prev => prev.map(c => {
      if (c.id === lineId) {
        return {
          ...c,
          qty: newQty,
          total: c.unitPrice * newQty
        };
      }
      return c;
    }));
  };

  const handleFinalizeInvoice = async (showInvoice: boolean) => {
    if (cart.length === 0) return triggerToast('❌ الفاتورة فارغة لتوة');
    if (invoiceIsDebt && !invoiceCustomerName) return triggerToast('❌ يرجى كتابة اسم الحريف لتسجيل الدين');
    if (isFinalizing) return;

    setIsFinalizing(true);
    try {
      // Optimistic stock decrement checking first (grouped by itemId to prevent duplicate hits and race conditions)
      const itemQtyMap: Record<string, { itemId: string; qty: number; label: string }> = {};
      for (const line of cart) {
        if (line.type === 'item' && line.itemId) {
          if (!itemQtyMap[line.itemId]) {
            itemQtyMap[line.itemId] = { itemId: line.itemId, qty: 0, label: line.label };
          }
          itemQtyMap[line.itemId].qty += line.qty;
        }
      }

      const uniqueItemsToDecrement = Object.values(itemQtyMap);
      const successList: { itemId: string; amt: number }[] = [];
      let stockError = '';

      for (const group of uniqueItemsToDecrement) {
        const res = await safeDecrementItemQty(group.itemId, group.qty);
        if (res.success) {
          successList.push({ itemId: group.itemId, amt: group.qty });
        } else {
          stockError = res.reason === 'insufficient' 
            ? `❌ السلعة "${group.label}" لم تعد كافية بالمخزن! المتبقي: ${res.available}`
            : `❌ فشل تحديث المخزن للسلعة "${group.label}" بسبب تداخل بالشبكة`;
          break;
        }
      }

      // Rollback if any error occurred
      if (stockError) {
        for (const item of successList) {
          await safeIncrementItemQty(item.itemId, item.amt);
        }
        setIsFinalizing(false);
        return triggerToast(stockError);
      }

      // Group card stock depletions by cardStock entry ID
      const cardStockDepletions: Record<string, { entry: CardStockEntry; totalQty: number }> = {};
      for (const line of cart) {
        if (line.type === 'recharge' && line.cardOperator && line.cardValue) {
          const entry = cardStock.find(c => c.operator === line.cardOperator && c.value === line.cardValue);
          if (entry) {
            if (!cardStockDepletions[entry.id]) {
              cardStockDepletions[entry.id] = { entry, totalQty: 0 };
            }
            cardStockDepletions[entry.id].totalQty += line.qty;
          }
        }
      }

      // Apply card stock depletions
      for (const entryId of Object.keys(cardStockDepletions)) {
        const { entry, totalQty } = cardStockDepletions[entryId];
        await putWithOutbox(`/cardStock/${entry.id}.json`, {
          ...entry,
          qty: Math.max(0, entry.qty - totalQty)
        });
      }

      // Group forfait depletions by operator
      const forfaitDepletions: Record<string, number> = {};
      for (const line of cart) {
        if (line.type === 'forfait' && line.cardOperator) {
          const op = line.cardOperator;
          if (!forfaitDepletions[op]) {
            forfaitDepletions[op] = 0;
          }
          forfaitDepletions[op] += line.unitPrice * (line.qty || 1);
        }
      }

      // Apply forfait depletions to the forfaitBalance object and write once
      if (Object.keys(forfaitDepletions).length > 0) {
        const updatedBalance = { ...forfaitBalance };
        for (const op of Object.keys(forfaitDepletions)) {
          const curBal = updatedBalance[op] || 0;
          updatedBalance[op] = Math.max(0, curBal - forfaitDepletions[op]);
        }
        await putWithOutbox('/forfaitBalance.json', updatedBalance);
      }

      const date = new Date().toISOString();
      const grandTotal = cart.reduce((s, c) => s + c.total, 0);

      if (invoiceIsDebt) {
        const initialPayVal = Math.min(grandTotal, Math.max(0, parseFloat(invoiceInitialPayment) || 0));
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
          paid: initialPayVal,
          date,
          status: (initialPayVal >= grandTotal - 0.001) ? 'paid' : 'open'
        };

        await putWithOutbox(`/debts/${newDebt.id}.json`, newDebt);

        // Record upfront down payment into income/cash register if present
        if (initialPayVal > 0) {
          const downPaymentIncome: OtherIncome = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            category: 'debt_payment',
            label: `دفعة أولى / تسبيق دين - ${invoiceCustomerName} (${cart.map(c => c.label).join(' + ')})`,
            amount: initialPayVal,
            commission: initialPayVal,
            date,
            debtId: newDebt.id
          };
          await putWithOutbox(`/otherIncome/${downPaymentIncome.id}.json`, downPaymentIncome);
        }

        const remainingDebt = Math.max(0, grandTotal - initialPayVal);
        logAudit('sale', `فاتورة مبيعات بالدين للحريف ${invoiceCustomerName}: المجموع ${grandTotal} د.ت (تسبيق: ${initialPayVal} د.ت - المتبقي: ${remainingDebt} د.ت)`);
        triggerToast(`🧾 تم حفظ الدين على ${invoiceCustomerName} (تسبيق: ${initialPayVal.toFixed(3)} د.ت | متبقي: ${remainingDebt.toFixed(3)} د.ت)`);
        
        // Trigger Telegram Notification for debt
        triggerTelegramDebtNotification(invoiceCustomerName, remainingDebt, `تسبيق: ${initialPayVal.toFixed(3)} د.ت | ${cart.map(c => c.label).join(' + ')}`, invoiceCustomerPhone || undefined);
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
        const initialPayVal = invoiceIsDebt ? Math.min(grandTotal, Math.max(0, parseFloat(invoiceInitialPayment) || 0)) : 0;
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
          customerName: invoiceCustomerName || undefined,
          downPayment: initialPayVal
        });
      } else {
        setLastInvoice(null);
      }

      // Trigger WhatsApp & Telegram notifications for the sale
      triggerWhatsAppNotification(cart, grandTotal, invoiceIsDebt, invoiceCustomerName);
      triggerTelegramNotification(cart, grandTotal, invoiceIsDebt, invoiceCustomerName);

      // Reset Form
      setCart([]);
      setInvoiceCustomerName('');
      setInvoiceCustomerPhone('');
      setInvoiceInitialPayment('');
      setInvoiceIsDebt(false);
      loadAllData();
    } catch (err) {
      console.error('Error in handleFinalizeInvoice:', err);
      triggerToast('❌ حدث خطأ أثناء معالجة الفاتورة');
    } finally {
      setIsFinalizing(false);
    }
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
          const ok = await putWithOutbox(`/sales/${id}.json`, null);
          if (ok) {
            triggerToast('✅ تم إلغاء البيع وإعادة الستوك');
            logAudit('delete', `إلغاء بيع سلع: ${record?.itemName || 'غير معروف'}`);
            loadAllData();
          } else {
            triggerToast('❌ فشل حذف العملية من الخادم السحابي');
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
          const ok = await putWithOutbox(`/otherIncome/${id}.json`, null);
          if (ok) {
            triggerToast('✅ تم إلغاء وحذف المدخول بنجاح');
            logAudit('delete', `إلغاء مدخول: ${record?.label || 'غير معروف'}`);
            loadAllData();
          } else {
            triggerToast('❌ فشل حذف العملية من الخادم السحابي');
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
        await putWithOutbox(`/items/${group[x].id}.json`, null);
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

    // Generate and save/send PDF report before deleting records
    triggerToast('📊 جاري توليد تقرير PDF التصفير...');
    await generateResetReportPDF(salesToRemove, otherToRemove, days);

    for (const s of salesToRemove) {
      await putWithOutbox(`/sales/${s.id}.json`, null);
    }
    for (const o of otherToRemove) {
      await putWithOutbox(`/otherIncome/${o.id}.json`, null);
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
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
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

  // Grouped counters for each category
  const categoryTotals = useMemo(() => {
    const totals = {
      phone: { count: 0, qty: 0 },
      battery: { count: 0, qty: 0 },
      speaker: { count: 0, qty: 0 },
      bluetooth: { count: 0, qty: 0 },
      accessory: { count: 0, qty: 0 }
    };
    items.forEach(i => {
      const cat = (i.category || 'accessory') as keyof typeof totals;
      if (totals[cat]) {
        totals[cat].count += 1;
        totals[cat].qty += i.qty;
      } else {
        totals.accessory.count += 1;
        totals.accessory.qty += i.qty;
      }
    });
    return totals;
  }, [items]);

  const filteredItems = items.filter(i => {
    const matchesSearch = !stockSearch || normalizeArabic(i.name).includes(normalizeArabic(stockSearch));
    const cat = i.category || 'accessory';
    const matchesCategory = selectedStockCategory === 'all' || cat === selectedStockCategory;
    return matchesSearch && matchesCategory;
  });

  // Calculate popularity map based on sales history
  const salesCountMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sales) {
      if (s.itemId) {
        map[s.itemId] = (map[s.itemId] || 0) + (s.qty || 1);
      }
    }
    return map;
  }, [sales]);

  // Smart Multilingual & Popularity Ranked Items Search for Selling
  const smartFilteredSellItems = useMemo(() => {
    if (!sellSearch.trim() && selectedSellCategory === 'all') {
      return [...items].sort((a, b) => {
        const popA = salesCountMap[a.id] || 0;
        const popB = salesCountMap[b.id] || 0;
        if (popB !== popA) return popB - popA;
        return b.qty - a.qty;
      });
    }

    return items
      .map(item => {
        const cat = item.category || 'accessory';
        if (selectedSellCategory !== 'all' && cat !== selectedSellCategory) {
          return { item, score: 0 };
        }
        const score = calculateSmartMatchScore(item, sellSearch, salesCountMap);
        return { item, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item);
  }, [items, sellSearch, selectedSellCategory, salesCountMap]);

  const sellFilteredItems = smartFilteredSellItems;

  // Quick Add Item to Cart & Auto-focus for continuous keyboard workflow
  const handleQuickAddItemToCart = (item: Item, customQty?: number) => {
    if (!item) return;
    const qtyVal = customQty || parseInt(sellQty) || 1;
    if (qtyVal <= 0) return triggerToast('❌ كمية غير صالحة');

    const cartAlready = cart.filter(c => c.type === 'item' && c.itemId === item.id).reduce((s, c) => s + c.qty, 0);
    if (qtyVal + cartAlready > item.qty) {
      return triggerToast(`❌ المخزن غير كافي! المتوفر حالياً: ${item.qty - cartAlready}`);
    }

    const override = parseFloat(sellPriceOverride);
    const finalPrice = !isNaN(override) && override >= 0 ? override : item.sell;

    const newLine: CartLine = {
      id: Math.random().toString(36).slice(2, 9),
      type: 'item',
      itemId: item.id,
      label: item.name,
      qty: qtyVal,
      unitPrice: finalPrice,
      unitBuy: item.buy,
      total: qtyVal * finalPrice
    };

    setCart(prev => [...prev, newLine]);
    setSellQty('1');
    setSellPriceOverride('');
    setSellSearch('');
    setSearchSelectedIndex(-1);
    setSellItemId(item.id);
    triggerToast(`⚡ تم إضافة "${item.name}" للفاتورة`);

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  // Keyboard navigation on search input
  const handleSellSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (smartFilteredSellItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchSelectedIndex(prev => Math.min(prev + 1, smartFilteredSellItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      let targetItem: Item | null = null;

      if (searchSelectedIndex >= 0 && searchSelectedIndex < smartFilteredSellItems.length) {
        targetItem = smartFilteredSellItems[searchSelectedIndex];
      } else if (smartFilteredSellItems.length === 1) {
        targetItem = smartFilteredSellItems[0];
      } else if (smartFilteredSellItems.length > 0) {
        targetItem = smartFilteredSellItems[0];
      }

      if (targetItem) {
        handleQuickAddItemToCart(targetItem);
      }
    } else if (e.key === 'Escape') {
      setSellSearch('');
      setSearchSelectedIndex(-1);
    }
  };

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
                  onClick={() => setCurrentTab('spare_parts')}
                  className={`flex-1 min-w-[130px] py-2 px-3 text-xs font-black text-center rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 select-none ${
                    currentTab === 'spare_parts' 
                      ? 'bg-red-700 text-white shadow-md shadow-red-700/15 scale-[1.03]' 
                      : 'text-stone-600 hover:bg-stone-100/80 hover:text-stone-800'
                  }`}
                >
                  <span>🔧</span>
                  <span>قطع الغيار (الفورنيسور)</span>
                </button>
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
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                          <label className="block text-[11px] text-stone-500 mb-1">الفئة</label>
                          <select 
                            value={newItem.category}
                            onChange={e => setNewItem(prev => ({ ...prev, category: e.target.value }))}
                            className="w-full bg-stone-50 border border-stone-200 px-3 py-2.5 rounded-xl text-xs text-stone-800 font-bold"
                          >
                            <option value="phone">📱 هواتف</option>
                            <option value="battery">🔋 بطاريات</option>
                            <option value="speaker">🔊 سبيكرات</option>
                            <option value="bluetooth">🎧 سماعات بلوتوث</option>
                            <option value="accessory">🔌 أكسسوارات أخرى</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-stone-500 mb-1">الباركود والصورة (اختياري)</label>
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
                              title="مسح باركود بالكاميرا"
                            >
                              <Camera size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVisualRecognitionMode('stock');
                                setTargetItemToCapturePhoto(null);
                                setShowVisualRecognitionModal(true);
                              }}
                              className="bg-amber-600 hover:bg-amber-700 text-white p-2.5 rounded-xl cursor-pointer font-bold text-xs flex items-center gap-1 shrink-0"
                              title="التقاط صورة للسلعة الجديدة"
                            >
                              <Sparkles size={14} />
                              <span className="hidden sm:inline">صورة</span>
                            </button>
                          </div>
                          {newItem.imageUrl && (
                            <div className="mt-1 flex items-center gap-2 bg-amber-50 p-1.5 rounded-lg border border-amber-200 text-[10px] text-amber-900 font-bold">
                              <img src={newItem.imageUrl} alt="" className="w-6 h-6 rounded object-cover" />
                              <span className="truncate">تم إرفاق صورة للسلعة!</span>
                              <button
                                type="button"
                                onClick={() => setNewItem(prev => ({ ...prev, imageUrl: '' }))}
                                className="mr-auto text-red-600 hover:text-red-800 font-bold"
                              >
                                إزالة
                              </button>
                            </div>
                          )}
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
                                <div className="flex items-center gap-1">
                                  <button 
                                    onClick={() => handleAdjustCardQty(c.id, -1)}
                                    className="w-6 h-6 rounded-full bg-stone-100 border border-stone-200 text-stone-700 hover:bg-stone-200 flex items-center justify-center font-bold font-mono text-xs cursor-pointer select-none"
                                    title="إنقاص 1"
                                  >
                                    -
                                  </button>
                                  <button 
                                    onClick={() => handleEditCardQty(c.id)}
                                    className={`px-2.5 py-1 rounded-lg font-bold font-mono text-[11px] cursor-pointer ${
                                      c.qty <= 3 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                    }`}
                                    title="تعديل الكمية الدقيقة"
                                  >
                                    {c.qty} قطع
                                  </button>
                                  <button 
                                    onClick={() => handleAdjustCardQty(c.id, 1)}
                                    className="w-6 h-6 rounded-full bg-stone-100 border border-stone-200 text-stone-700 hover:bg-stone-200 flex items-center justify-center font-bold font-mono text-xs cursor-pointer select-none"
                                    title="زيادة 1"
                                  >
                                    +
                                  </button>
                                </div>
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

                  <div className="mb-4 bg-amber-50/70 border border-amber-200/60 rounded-xl p-3 text-amber-900 text-xs flex items-start gap-2">
                    <span className="text-sm">💡</span>
                    <div>
                      <p className="font-bold text-amber-950">ملاحظة لتصنيف السلع المسجلة سابقاً:</p>
                      <p className="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                        جميع السلع التي قمت بتسجيلها مسبقاً تقع حالياً تحت تصنيف <strong>"أكسسوارات أخرى" 🔌</strong>. يمكنك تصنيفها وترتيبها بسهولة في أي وقت بالضغط مباشرةً على رمز الفئة بجانب اسم السلعة في القائمة أدناه!
                      </p>
                    </div>
                  </div>

                  {/* Category Aggregated Counters */}
                  <div className="mb-5 bg-stone-50/50 rounded-2xl border border-stone-100 p-4">
                    <h4 className="font-bold text-stone-700 text-[11px] mb-2.5 flex items-center gap-1">
                      📊 إحصائيات المخزون الإجمالي بالفئات
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                      <div className="bg-blue-50/60 border border-blue-100 p-2.5 rounded-xl text-center">
                        <span className="text-base">📱</span>
                        <div className="text-[10px] text-stone-500 font-bold mt-0.5">الهواتف</div>
                        <div className="font-mono text-xs font-black text-blue-900 mt-0.5">
                          {categoryTotals.phone.qty} <span className="text-[8px] font-bold">قطعة</span>
                        </div>
                        <div className="text-[8px] text-stone-400">({categoryTotals.phone.count} أنواع)</div>
                      </div>
                      <div className="bg-emerald-50/60 border border-emerald-100 p-2.5 rounded-xl text-center">
                        <span className="text-base">🔋</span>
                        <div className="text-[10px] text-stone-500 font-bold mt-0.5">البطاريات</div>
                        <div className="font-mono text-xs font-black text-emerald-900 mt-0.5">
                          {categoryTotals.battery.qty} <span className="text-[8px] font-bold">قطعة</span>
                        </div>
                        <div className="text-[8px] text-stone-400">({categoryTotals.battery.count} أنواع)</div>
                      </div>
                      <div className="bg-indigo-50/60 border border-indigo-100 p-2.5 rounded-xl text-center">
                        <span className="text-base">🔊</span>
                        <div className="text-[10px] text-stone-500 font-bold mt-0.5">السبيكرات</div>
                        <div className="font-mono text-xs font-black text-indigo-900 mt-0.5">
                          {categoryTotals.speaker.qty} <span className="text-[8px] font-bold">قطعة</span>
                        </div>
                        <div className="text-[8px] text-stone-400">({categoryTotals.speaker.count} أنواع)</div>
                      </div>
                      <div className="bg-purple-50/60 border border-purple-100 p-2.5 rounded-xl text-center">
                        <span className="text-base">🎧</span>
                        <div className="text-[10px] text-stone-500 font-bold mt-0.5">سماعات بلوتوث</div>
                        <div className="font-mono text-xs font-black text-purple-900 mt-0.5">
                          {categoryTotals.bluetooth.qty} <span className="text-[8px] font-bold">قطعة</span>
                        </div>
                        <div className="text-[8px] text-stone-400">({categoryTotals.bluetooth.count} أنواع)</div>
                      </div>
                      <div className="bg-stone-50 border border-stone-200 p-2.5 rounded-xl text-center col-span-2 sm:col-span-1">
                        <span className="text-base">🔌</span>
                        <div className="text-[10px] text-stone-500 font-bold mt-0.5">أكسسوارات أخرى</div>
                        <div className="font-mono text-xs font-black text-stone-800 mt-0.5">
                          {categoryTotals.accessory.qty} <span className="text-[8px] font-bold">قطعة</span>
                        </div>
                        <div className="text-[8px] text-stone-400">({categoryTotals.accessory.count} أنواع)</div>
                      </div>
                    </div>
                  </div>

                  {/* Category Filter Tabs */}
                  <div className="flex gap-1 overflow-x-auto scrollbar-none pb-2 mb-2">
                    {[
                      { id: 'all', label: 'الكل', icon: '📦' },
                      { id: 'phone', label: 'هواتف', icon: '📱' },
                      { id: 'battery', label: 'بطاريات', icon: '🔋' },
                      { id: 'speaker', label: 'سبيكرات', icon: '🔊' },
                      { id: 'bluetooth', label: 'سماعات بلوتوث', icon: '🎧' },
                      { id: 'accessory', label: 'أكسسوارات أخرى', icon: '🔌' }
                    ].map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setSelectedStockCategory(tab.id)}
                        className={`px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap cursor-pointer transition-all ${
                          selectedStockCategory === tab.id
                            ? 'bg-stone-900 text-white'
                            : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                        }`}
                      >
                        <span>{tab.icon}</span>
                        <span>{tab.label}</span>
                      </button>
                    ))}
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
                          <div className="flex items-center gap-2.5 overflow-hidden">
                            {/* Product Image or Fallback Camera Add Button */}
                            {i.imageUrl ? (
                              <div className="relative group shrink-0">
                                <img 
                                  src={i.imageUrl} 
                                  alt={i.name} 
                                  className="w-11 h-11 rounded-xl object-cover border border-stone-200 shadow-2xs" 
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setVisualRecognitionMode('stock');
                                    setTargetItemToCapturePhoto(i);
                                    setShowVisualRecognitionModal(true);
                                  }}
                                  className="absolute inset-0 bg-black/50 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-xl transition-opacity cursor-pointer"
                                  title="تغيير صورة المنتج"
                                >
                                  <Camera size={14} />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setVisualRecognitionMode('stock');
                                  setTargetItemToCapturePhoto(i);
                                  setShowVisualRecognitionModal(true);
                                }}
                                className="bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300/80 px-2.5 py-2 rounded-xl text-[10px] font-extrabold flex flex-col items-center justify-center gap-0.5 cursor-pointer shrink-0 transition-all shadow-2xs"
                                title="التقاط صورة للمنتج وإضافته للنظام البصري"
                              >
                                <Camera size={14} className="text-amber-700" />
                                <span>📸 أضف صورة</span>
                              </button>
                            )}

                            <div className="space-y-0.5 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <h4 className="font-bold text-stone-800 text-xs truncate">{i.name}</h4>
                                <button 
                                  onClick={() => handleEditItemName(i.id)} 
                                  className="p-1 text-stone-400 hover:text-stone-700 transition-colors cursor-pointer mr-0.5"
                                  title="تعديل اسم السلعة"
                                >
                                  <Pencil size={11} />
                                </button>
                                {(() => {
                                  const cat = i.category || 'accessory';
                                  const catInfo = CATEGORY_MAP[cat] || CATEGORY_MAP.accessory;
                                  return (
                                    <span 
                                      onClick={() => handleEditItemCategory(i.id)}
                                      className="text-[10px] px-2 py-0.5 rounded-md font-bold flex items-center gap-1 border border-stone-200 bg-white cursor-pointer hover:bg-stone-100 text-stone-600 transition-colors"
                                      title="تغيير الفئة"
                                    >
                                      <span>{catInfo.icon}</span>
                                      <span>{catInfo.label}</span>
                                    </span>
                                  );
                                })()}
                              </div>
                              <div className="text-[10px] text-stone-600 flex flex-wrap items-center gap-1.5 mt-1">
                                {costVisible && currentRole === 'manager' && (
                                  <button
                                    type="button"
                                    onClick={() => handleEditItemPrice(i.id, 'buy')}
                                    className="font-mono text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200/80 px-2 py-0.5 rounded-md font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                    title="تعديل سعر الشراء"
                                  >
                                    <span>شراء: {i.buy.toFixed(3)} د.ت</span>
                                    <Pencil size={9} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => currentRole === 'manager' ? handleEditItemPrice(i.id, 'sell') : undefined}
                                  className={`font-mono text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 px-2 py-0.5 rounded-md font-bold flex items-center gap-1 transition-colors ${
                                    currentRole === 'manager' ? 'cursor-pointer' : 'cursor-default'
                                  }`}
                                  title={currentRole === 'manager' ? 'تعديل سعر البيع' : undefined}
                                >
                                  <span>بيع: {i.sell.toFixed(3)} د.ت</span>
                                  {currentRole === 'manager' && <Pencil size={9} />}
                                </button>
                                {i.barcodes && i.barcodes.length > 0 && (
                                  <span className="text-stone-500 font-mono text-[9px] bg-stone-100 px-1.5 py-0.5 rounded">🏷️ {i.barcodes.join(', ')}</span>
                                )}
                              </div>
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
                          <div className="grid grid-cols-2 gap-2">
                            <button 
                              type="button"
                              onClick={() => setScannerContext('sell')}
                              className="bg-stone-800 hover:bg-stone-900 text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all"
                            >
                              <Camera size={14} /> مسح الباركود
                            </button>
                            <button 
                              type="button"
                              onClick={() => {
                                setVisualRecognitionMode('sell');
                                setTargetItemToCapturePhoto(null);
                                setShowVisualRecognitionModal(true);
                              }}
                              className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-all"
                            >
                              <Sparkles size={14} /> 📸 التعرف بالصورة للبيع
                            </button>
                          </div>
                          
                          {/* Smart Instant Keyboard Search */}
                          <div className="relative">
                            <label className="block text-[10px] font-extrabold text-stone-700 mb-1 flex items-center justify-between">
                              <span>⚡ البحث الفوري والسريع (Smart Search)</span>
                              <span className="text-[9px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded font-mono">يدعم ⌨️ الأسهم + Enter</span>
                            </label>
                            <div className="relative">
                              <input 
                                ref={sellSearchInputRef}
                                type="text" 
                                placeholder="🔍 اكتب أي جزء من اسم السلعة، الماركة، أو المواصفة..."
                                value={sellSearch}
                                onChange={e => {
                                  setSellSearch(e.target.value);
                                  setSearchSelectedIndex(-1);
                                }}
                                onKeyDown={handleSellSearchKeyDown}
                                className="w-full bg-white border-2 border-stone-200 focus:border-stone-800 pl-9 pr-8 py-2.5 rounded-xl text-xs text-stone-900 font-bold shadow-xs outline-none transition-all"
                              />
                              <Search className="absolute left-3 top-3 text-stone-400" size={14} />
                              {sellSearch && (
                                <button 
                                  type="button"
                                  onClick={() => { setSellSearch(''); setSearchSelectedIndex(-1); }}
                                  className="absolute right-3 top-3 text-stone-400 hover:text-stone-700"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>

                            {/* Smart Auto-Suggest & Live Search Popup */}
                            {sellSearch.trim().length > 0 && (
                              <div className="absolute z-30 right-0 left-0 mt-1 bg-white border-2 border-stone-800 rounded-2xl shadow-2xl overflow-hidden max-h-72 overflow-y-auto divide-y divide-stone-100 animate-scale-up">
                                <div className="bg-stone-900 px-3 py-1.5 flex items-center justify-between text-[10px] font-bold text-white">
                                  <span className="flex items-center gap-1">
                                    <Zap size={12} className="text-amber-400 fill-amber-400" />
                                    نتائج البحث ذكياً ({smartFilteredSellItems.length})
                                  </span>
                                  <span className="text-[9px] text-stone-300 font-mono">
                                    اضغط ⬆️ ⬇️ و Enter للإضافة الفورية ⚡
                                  </span>
                                </div>

                                {smartFilteredSellItems.length === 0 ? (
                                  <div className="p-4 text-center text-xs text-stone-400">
                                    لا توجد سلع تطابق بحثك "{sellSearch}"
                                  </div>
                                ) : (
                                  smartFilteredSellItems.slice(0, 10).map((item, idx) => {
                                    const isSelected = idx === searchSelectedIndex;
                                    const cat = item.category || 'accessory';
                                    const catInfo = CATEGORY_MAP[cat] || CATEGORY_MAP.accessory;
                                    const salesCount = salesCountMap[item.id] || 0;

                                    return (
                                      <div
                                        key={item.id}
                                        onClick={() => handleQuickAddItemToCart(item)}
                                        onMouseEnter={() => setSearchSelectedIndex(idx)}
                                        className={`p-2.5 flex items-center justify-between gap-2 cursor-pointer transition-colors ${
                                          isSelected ? 'bg-red-50 border-r-4 border-red-600' : 'hover:bg-stone-50'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 overflow-hidden">
                                          {item.imageUrl ? (
                                            <img src={item.imageUrl} alt="" className="w-8 h-8 rounded-lg object-cover border border-stone-200 shrink-0" />
                                          ) : (
                                            <span className="text-base shrink-0">{catInfo.icon}</span>
                                          )}
                                          <div className="truncate">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                              <span className="font-bold text-xs text-stone-900 truncate">{item.name}</span>
                                              {!item.imageUrl && (
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setVisualRecognitionMode('stock');
                                                    setTargetItemToCapturePhoto(item);
                                                    setShowVisualRecognitionModal(true);
                                                  }}
                                                  className="text-[9px] bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 transition-colors cursor-pointer"
                                                  title="التقاط صورة لهذه السلعة"
                                                >
                                                  <Camera size={10} /> 📸 أضف صورة
                                                </button>
                                              )}
                                              {salesCount > 2 && (
                                                <span className="text-[9px] bg-amber-100 text-amber-800 font-extrabold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                                  🔥 الأكثر بيعاً ({salesCount})
                                                </span>
                                              )}
                                            </div>
                                            <div className="text-[10px] text-stone-500 flex items-center gap-2 mt-0.5">
                                              <span>المتوفر: <strong className={item.qty > 0 ? 'text-emerald-600' : 'text-red-600'}>{item.qty} قطعة</strong></span>
                                              {item.barcode && <span className="font-mono text-[9px] bg-stone-100 px-1 rounded">{item.barcode}</span>}
                                            </div>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                          <span className="font-mono font-extrabold text-xs text-red-700 bg-red-100/50 px-2 py-1 rounded-lg">
                                            {item.sell.toFixed(3)} <span className="text-[9px]">د.ت</span>
                                          </span>
                                          {isSelected ? (
                                            <span className="bg-stone-900 text-white font-extrabold text-[10px] px-2 py-1 rounded-lg shadow flex items-center gap-1 animate-pulse">
                                              <CornerDownLeft size={10} /> Enter
                                            </span>
                                          ) : (
                                            <span className="text-stone-400 hover:text-stone-900 p-1">
                                              <Plus size={14} />
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            )}
                          </div>

                           {/* Category filter tabs for selling */}
                          <div className="space-y-1">
                            <label className="block text-[10px] text-stone-500">تصفية حسب فئة السلعة</label>
                            <div className="flex gap-1 overflow-x-auto scrollbar-none pb-1.5">
                              {[
                                { id: 'all', label: 'الكل', icon: '📦' },
                                { id: 'phone', label: 'هواتف', icon: '📱' },
                                { id: 'battery', label: 'بطاريات', icon: '🔋' },
                                { id: 'speaker', label: 'سبيكرات', icon: '🔊' },
                                { id: 'bluetooth', label: 'سماعات بلوتوث', icon: '🎧' },
                                { id: 'accessory', label: 'أكسسوارات أخرى', icon: '🔌' }
                              ].map(tab => (
                                <button
                                  key={tab.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedSellCategory(tab.id);
                                    // Reset selected item so we don't have mismatch or keep it as is
                                    setSellItemId('');
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 whitespace-nowrap cursor-pointer transition-all ${
                                    selectedSellCategory === tab.id
                                      ? 'bg-stone-800 text-white'
                                      : 'bg-stone-200/60 text-stone-600 hover:bg-stone-200'
                                  }`}
                                >
                                  <span>{tab.icon}</span>
                                  <span>{tab.label}</span>
                                </button>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="block text-[10px] text-stone-500 mb-0.5">اختر السلعة المطلوبة</label>
                            <select 
                              value={sellItemId} 
                              onChange={e => setSellItemId(e.target.value)} 
                              className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                            >
                              <option value="">-- اختر السلعة --</option>
                              {sellFilteredItems.map((i, idx) => {
                                const cat = i.category || 'accessory';
                                const catInfo = CATEGORY_MAP[cat] || CATEGORY_MAP.accessory;
                                return (
                                  <option key={idx} value={i.id}>
                                    {catInfo.icon} [{catInfo.label}] {i.name} (المتوفر: {i.qty} قطع) — {i.sell.toFixed(3)} د.ت
                                  </option>
                                );
                              })}
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
                        <div key={idx} className="flex justify-between items-center gap-2 p-2.5 bg-stone-50 hover:bg-stone-100/60 rounded-xl border border-stone-200/80 text-[11px] transition-all">
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-stone-900 truncate">{line.label}</div>
                            <div className="text-[10px] text-stone-500 flex items-center gap-1.5 mt-0.5">
                              <span>سعر الوحدة:</span>
                              <button
                                type="button"
                                onClick={() => handleEditCartLinePrice(line.id)}
                                className="font-mono font-black text-amber-900 bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded border border-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
                                title="انقر لتعديل سعر هذا المنتج في الفاتورة الحالية"
                              >
                                <span>{line.unitPrice.toFixed(3)} د.ت</span>
                                <Pencil size={9} className="text-amber-800" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center gap-1 bg-white border border-stone-200 rounded-lg p-0.5 shadow-2xs">
                              <button
                                type="button"
                                onClick={() => handleAdjustCartLineQty(line.id, -1)}
                                className="w-5 h-5 flex items-center justify-center text-stone-700 font-extrabold hover:bg-stone-100 rounded cursor-pointer transition-colors"
                                title="إنقاص الكمية"
                              >
                                -
                              </button>
                              <span className="font-mono font-bold px-1 text-xs text-stone-900">{line.qty}</span>
                              <button
                                type="button"
                                onClick={() => handleAdjustCartLineQty(line.id, 1)}
                                className="w-5 h-5 flex items-center justify-center text-stone-700 font-extrabold hover:bg-stone-100 rounded cursor-pointer transition-colors"
                                title="زيادة الكمية"
                              >
                                +
                              </button>
                            </div>

                            <span className="font-mono font-black text-stone-900 text-xs min-w-[55px] text-left">
                              {line.total.toFixed(3)}
                            </span>

                            <button 
                              type="button"
                              onClick={() => handleRemoveFromCart(line.id)}
                              className="text-stone-400 hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer transition-colors"
                              title="حذف من الفاتورة"
                            >
                              <X size={14} />
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
                        <label className="flex items-center gap-2 mt-1.5 cursor-pointer select-none">
                          <input 
                            type="checkbox" 
                            checked={invoiceIsDebt}
                            onChange={e => {
                              setInvoiceIsDebt(e.target.checked);
                              if (!e.target.checked) setInvoiceInitialPayment('');
                            }}
                            className="w-4 h-4 text-red-700 focus:ring-red-700 rounded"
                          />
                          <span className="font-bold text-stone-800 text-[11px]">🧾 تسجيل الفاتورة بالدين (مع إمكانية تسبيق)</span>
                        </label>

                        {invoiceIsDebt && (
                          <div className="mt-2 pt-2 border-t border-amber-200/80 bg-amber-50/60 p-2 rounded-lg space-y-1.5 animate-fade-in">
                            <label className="block text-[10px] font-bold text-amber-900">
                              💵 الدفعة الأولى / التسبيق النقدي (إن وجد)
                            </label>
                            <div className="relative">
                              <input 
                                type="number" 
                                step="0.1"
                                min="0"
                                max={cart.reduce((s, c) => s + c.total, 0)}
                                placeholder="0.000 (دفعة نقدية أولى)"
                                value={invoiceInitialPayment}
                                onChange={e => setInvoiceInitialPayment(e.target.value)}
                                className="w-full bg-white border border-amber-300 text-amber-950 font-mono font-bold px-2 py-1.5 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                              />
                              <span className="absolute left-2 top-1.5 text-[10px] text-amber-800 font-bold">د.ت</span>
                            </div>

                            {(() => {
                              const grandTotal = cart.reduce((s, c) => s + c.total, 0);
                              const down = Math.min(grandTotal, Math.max(0, parseFloat(invoiceInitialPayment) || 0));
                              const remaining = Math.max(0, grandTotal - down);
                              return (
                                <div className="flex justify-between items-center text-[10px] pt-1 px-1 font-bold">
                                  <span className="text-emerald-700">مدفوع كاش: {down.toFixed(3)} د.ت</span>
                                  <span className="text-red-700">المتبقي دين: {remaining.toFixed(3)} د.ت</span>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={() => handleFinalizeInvoice(false)}
                          disabled={isFinalizing}
                          className={`bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2.5 px-2 rounded-xl text-[11px] cursor-pointer shadow-md shadow-emerald-600/10 transition-colors flex items-center justify-center gap-1 ${isFinalizing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {isFinalizing ? 'جاري التسجيل...' : '⚡ بيع سريع'}
                        </button>
                        <button 
                          onClick={() => handleFinalizeInvoice(true)}
                          disabled={isFinalizing}
                          className={`bg-stone-800 hover:bg-stone-950 text-white font-extrabold py-2.5 px-2 rounded-xl text-[11px] cursor-pointer transition-colors flex items-center justify-center gap-1 ${isFinalizing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          {isFinalizing ? 'جاري التسجيل...' : '🖨️ تسجيل وطباعة'}
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

                {/* Unified Notifications Config Card */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-1 flex items-center gap-1.5 text-stone-900">
                    <span>📱 إعدادات الإشعارات الفورية للهاتف (واتساب وتلغرام)</span>
                  </h3>
                  <p className="text-stone-400 text-[11px] mb-4">احصل على تفاصيل المبيعات، المدخول اليومي، والدق على هاتفك بشكل فوري عند إتمام أي عملية بيع:</p>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    
                    {/* WhatsApp Column */}
                    <div className="border border-stone-100 rounded-2xl p-4 bg-stone-50/50 space-y-3">
                      <h4 className="font-extrabold text-xs text-emerald-800 flex items-center gap-1">
                        <span>🟢 الخيار الأول: إشعارات واتساب (WhatsApp)</span>
                      </h4>
                      <p className="text-stone-500 text-[10px] leading-relaxed">
                        يستخدم خدمة CallMeBot المجانية لإرسال رسائل واتساب. <span className="text-red-700 font-bold">بسبب ضغط السيرفرات والقيود، قد يتوقف الرقم أحياناً عن الرد أو إرسال كود التفعيل.</span>
                      </p>

                      <form onSubmit={handleSaveWhatsAppConfig} className="space-y-3">
                        <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-stone-100">
                          <input 
                            type="checkbox" 
                            id="whatsapp-enabled"
                            checked={whatsappConfig.enabled}
                            onChange={e => setWhatsappConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                            className="w-3.5 h-3.5 text-emerald-600 focus:ring-emerald-500 border-stone-300 rounded cursor-pointer"
                          />
                          <label htmlFor="whatsapp-enabled" className="text-[11px] font-bold text-stone-700 cursor-pointer select-none">
                            تفعيل إشعارات واتساب الفورية
                          </label>
                        </div>

                        <div className="space-y-2">
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-0.5">رقم هاتف الواتساب (بالرمز الدولي)</label>
                            <input 
                              type="text" 
                              placeholder="+21641444355"
                              value={whatsappConfig.phone}
                              onChange={e => setWhatsappConfig(prev => ({ ...prev, phone: e.target.value.replace(/\s+/g, '') }))}
                              className="w-full bg-white border border-stone-200 px-3 py-1.5 rounded-xl text-xs text-stone-800 font-mono text-left"
                              dir="ltr"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-0.5">رمز API الخاص بـ CallMeBot</label>
                            <input 
                              type="text" 
                              placeholder="أدخل الرمز السري للـ API..."
                              value={whatsappConfig.apiKey}
                              onChange={e => setWhatsappConfig(prev => ({ ...prev, apiKey: e.target.value.replace(/\s+/g, '') }))}
                              className="w-full bg-white border border-stone-200 px-3 py-1.5 rounded-xl text-xs text-stone-800 font-mono text-left"
                              dir="ltr"
                            />
                          </div>
                        </div>

                        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-2.5 text-emerald-900 text-[10px] leading-relaxed space-y-1">
                          <p className="font-bold text-emerald-950">💡 كيفية الحصول على كود الواتساب:</p>
                          <ol className="list-decimal list-inside space-y-0.5 text-emerald-800">
                            <li>احفظ الرقم في جهات اتصال هاتفك أولاً كشرط أساسي: <strong className="font-mono text-emerald-950">+34 644 32 66 12</strong></li>
                            <li>أرسل له رسالة دقيقة: <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono text-emerald-950">I allow callmebot to send me messages</code></li>
                            <li>بمجرد تفعيله، سيرسل لك البوت الـ API Key فوراً مجاناً لتقوم بنسخه ووضعه هنا.</li>
                          </ol>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <button type="submit" className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold py-2 px-3 rounded-xl text-[11px] cursor-pointer transition-colors">
                            حفظ إعدادات واتساب 💾
                          </button>
                          <button 
                            type="button" 
                            onClick={handleTestWhatsApp}
                            className="bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold py-2 px-3 rounded-xl text-[11px] cursor-pointer transition-colors"
                          >
                            تجربة الإرسال ⚡
                          </button>
                        </div>
                      </form>
                    </div>

                    {/* Telegram Column */}
                    <div className="border border-stone-100 rounded-2xl p-4 bg-stone-50/50 space-y-3">
                      <h4 className="font-extrabold text-xs text-blue-800 flex items-center gap-1">
                        <span>🔵 الخيار الثاني (البديل الأقوى والأسرع): إشعارات تلغرام (Telegram)</span>
                        <span className="bg-blue-100 text-blue-800 text-[9px] px-1.5 py-0.2 rounded-full font-normal">مستقر ومضمون 100% ⚡</span>
                      </h4>
                      <p className="text-stone-500 text-[10px] leading-relaxed">
                        يرسل الإشعارات مباشرة إلى حسابك الخاص على تطبيق تلغرام عبر بوت خاص بك. <span className="text-blue-900 font-bold">مجاني بالكامل، سريع للغاية (أقل من ثانية واحدة)، ومستقر 100% بدون أي تجميد أو عدم رد.</span>
                      </p>

                      <form onSubmit={handleSaveTelegramConfig} className="space-y-3">
                        <div className="flex items-center gap-2 bg-white p-2 rounded-xl border border-stone-100">
                          <input 
                            type="checkbox" 
                            id="telegram-enabled"
                            checked={telegramConfig.enabled}
                            onChange={e => setTelegramConfig(prev => ({ ...prev, enabled: e.target.checked }))}
                            className="w-3.5 h-3.5 text-blue-600 focus:ring-blue-500 border-stone-300 rounded cursor-pointer"
                          />
                          <label htmlFor="telegram-enabled" className="text-[11px] font-bold text-stone-700 cursor-pointer select-none">
                            تفعيل إشعارات تلغرام الفورية
                          </label>
                        </div>

                        <div className="space-y-2">
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-0.5">رمز توكن البوت (Bot Token)</label>
                            <input 
                              type="text" 
                              placeholder="مثال: 123456789:ABCdefGhIJK..."
                              value={telegramConfig.botToken}
                              onChange={e => setTelegramConfig(prev => ({ ...prev, botToken: e.target.value.replace(/\s+/g, '') }))}
                              className="w-full bg-white border border-stone-200 px-3 py-1.5 rounded-xl text-xs text-stone-800 font-mono text-left"
                              dir="ltr"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-stone-500 mb-0.5">معرف المحادثة الخاص بك (Chat ID)</label>
                            <input 
                              type="text" 
                              placeholder="مثال: 987654321"
                              value={telegramConfig.chatId}
                              onChange={e => setTelegramConfig(prev => ({ ...prev, chatId: e.target.value.replace(/\s+/g, '') }))}
                              className="w-full bg-white border border-stone-200 px-3 py-1.5 rounded-xl text-xs text-stone-800 font-mono text-left"
                              dir="ltr"
                            />
                          </div>
                        </div>

                        <div className="bg-blue-50 border border-blue-100 rounded-xl p-2.5 text-blue-900 text-[10px] leading-relaxed space-y-1">
                          <p className="font-bold text-blue-950">💡 طريقة إعداد بوت تلغرام مجاني في 10 ثوانٍ:</p>
                          <ol className="list-decimal list-inside space-y-0.5 text-blue-800">
                            <li>افتح تطبيق تلغرام وابحث عن البوت الرسمي الشهير: <strong className="text-blue-950">@BotFather</strong></li>
                            <li>أرسل له الأمر <code className="bg-blue-100 px-1 rounded font-mono text-blue-950">/newbot</code> ثم اكتب أي اسم للبوت، ثم اسم مستخدم ينتهي بكلمة <code className="font-mono text-blue-950">bot</code>. سينشئ لك البوت فوراً ويرسل لك رمز <strong className="font-bold">Bot Token</strong> طويل لتقوم بنسخه ووضعه في الخانة الأولى أعلاه.</li>
                            <li>الآن للحصول على الـ <strong className="font-bold">Chat ID</strong> الخاص بك، ابحث عن بوت المعرفات: <strong className="text-blue-950">@userinfobot</strong> وأرسل له أي رسالة، سيجيبك فوراً برقم معرفك (مثال: <code className="font-mono text-blue-950">54829342</code>). انسخه وضعه في الخانة الثانية.</li>
                            <li><strong className="text-blue-950 font-bold">خطوة هامة:</strong> افتح البوت الذي أنشأته أنت واضغط على زر <strong className="font-bold text-blue-950">Start / ابدأ</strong> لكي تسمح له بإرسال الإشعارات لك.</li>
                          </ol>
                        </div>

                        <div className="flex gap-2 pt-1">
                          <button type="submit" className="flex-1 bg-blue-700 hover:bg-blue-800 text-white font-bold py-2 px-3 rounded-xl text-[11px] cursor-pointer transition-colors">
                            حفظ إعدادات تلغرام 💾
                          </button>
                          <button 
                            type="button" 
                            onClick={handleTestTelegram}
                            className="bg-blue-100 hover:bg-blue-200 text-blue-800 font-bold py-2 px-3 rounded-xl text-[11px] cursor-pointer transition-colors"
                          >
                            تجربة الإرسال ⚡
                          </button>
                        </div>
                      </form>
                    </div>

                  </div>
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

            {/* TAB: SPARE PARTS (Manager Only) */}
            {currentTab === 'spare_parts' && currentRole === 'manager' && (
              <div className="space-y-4 animate-fade-in">
                
                {/* Add Spare Part Card */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs text-right">
                  <h3 className="font-extrabold text-stone-800 text-sm mb-3 text-red-800 flex items-center gap-1.5">
                    <span>🔧 تسجيل قطع غيار مقتناة من المزوّد (الفورنيسور)</span>
                  </h3>
                  <p className="text-stone-400 text-[11px] mb-4">
                    يمكنك هنا تسجيل الشاشات، البطاريات، أو أي قطع غيار اشتريتها لكي لا تنساها عند مقابلته كل مدة وسدادها إياه.
                  </p>
                  
                  <form onSubmit={handleAddSparePart} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3.5">
                    <div className="md:col-span-1">
                      <label className="block text-[10px] text-stone-500 mb-1 font-bold">اسم القطعة (مثال: شاشة آيفون 11)</label>
                      <input 
                        type="text" 
                        placeholder="شاشة iPhone 11"
                        value={newSparePart.name}
                        onChange={e => setNewSparePart(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-850 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-stone-500 mb-1 font-bold">اسم الفورنيسور (المزوّد)</label>
                      <input 
                        type="text" 
                        placeholder="مثال: أحمد للأكسسوارات"
                        value={newSparePart.supplierName}
                        onChange={e => setNewSparePart(prev => ({ ...prev, supplierName: e.target.value }))}
                        className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-850 font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-stone-500 mb-1 font-bold">الكمية</label>
                      <input 
                        type="number" 
                        min="1"
                        value={newSparePart.qty}
                        onChange={e => setNewSparePart(prev => ({ ...prev, qty: e.target.value }))}
                        className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-stone-500 mb-1 font-bold">سعر تكلفة القطعة الواحدة (د.ت)</label>
                      <input 
                        type="number" 
                        step="0.001"
                        placeholder="0.000"
                        value={newSparePart.unitCost}
                        onChange={e => setNewSparePart(prev => ({ ...prev, unitCost: e.target.value }))}
                        className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono font-bold"
                      />
                    </div>
                    <div className="md:col-span-1 flex items-end">
                      <button type="submit" className="w-full bg-red-700 hover:bg-red-800 text-white font-extrabold rounded-xl text-xs py-2.5 cursor-pointer flex items-center justify-center gap-1 transition-colors select-none">
                        <Plus size={14} /> سجل قطعة الغيار 🔧
                      </button>
                    </div>
                  </form>
                </div>

                {/* Search & Filters */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs text-right">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-3 mb-4">
                    <h3 className="font-extrabold text-stone-800 text-xs self-start md:self-auto flex items-center gap-1.5">
                      <span>📦 أرشيف ودفتر حساب قطع الغيار</span>
                    </h3>
                    
                    <div className="flex flex-wrap gap-2 w-full md:w-auto">
                      <select 
                        value={sparePartStatusFilter} 
                        onChange={e => setSparePartStatusFilter(e.target.value as any)}
                        className="bg-stone-50 border border-stone-200 px-3 py-1.5 rounded-xl text-[11px] text-stone-700 font-bold"
                      >
                        <option value="all">كل قطع الغيار (الكل)</option>
                        <option value="unpaid">⏳ غير خالصة (ديون للمزوّد)</option>
                        <option value="paid">✅ خالصة (تم السداد)</option>
                      </select>

                      <select 
                        value={sparePartSupplierFilter} 
                        onChange={e => setSparePartSupplierFilter(e.target.value)}
                        className="bg-stone-50 border border-stone-200 px-3 py-1.5 rounded-xl text-[11px] text-stone-700 font-bold"
                      >
                        <option value="all">كل المزوّدين (الفورنيسور)</option>
                        {Array.from(new Set(spareParts.map(s => s.supplierName))).map((sup, idx) => (
                          <option key={idx} value={sup}>{sup}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="relative mb-4">
                    <input 
                      type="text" 
                      placeholder="🔍 ابحث باسم القطعة أو اسم الفورنيسور..."
                      value={sparePartSearch}
                      onChange={e => setSparePartSearch(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 pl-10 pr-3 py-2.5 rounded-xl text-xs text-stone-850"
                    />
                    <Search className="absolute left-3 top-3 text-stone-400" size={14} />
                  </div>

                  {/* Calculations summary card inside list */}
                  {(() => {
                    const filtered = spareParts.filter(s => {
                      const matchesSearch = !sparePartSearch || normalizeArabic(s.name + ' ' + s.supplierName).includes(normalizeArabic(sparePartSearch));
                      const matchesSupplier = sparePartSupplierFilter === 'all' || s.supplierName === sparePartSupplierFilter;
                      const matchesStatus = sparePartStatusFilter === 'all' || s.status === sparePartStatusFilter;
                      return matchesSearch && matchesSupplier && matchesStatus;
                    });

                    const totalSum = filtered.reduce((acc, curr) => acc + curr.totalCost, 0);
                    const unpaidSum = filtered.filter(f => f.status === 'unpaid').reduce((acc, curr) => acc + curr.totalCost, 0);
                    const paidSum = filtered.filter(f => f.status === 'paid').reduce((acc, curr) => acc + curr.totalCost, 0);

                    return (
                      <>
                        <div className="grid grid-cols-3 gap-3 mb-4 bg-stone-50 p-3 rounded-2xl border border-stone-100">
                          <div className="text-center p-2">
                            <span className="text-[10px] text-stone-400 block font-bold">المجموع الكلي للقطع</span>
                            <span className="font-mono text-xs font-black text-stone-800">{totalSum.toFixed(3)} د.ت</span>
                          </div>
                          <div className="text-center p-2 border-r border-stone-200/60">
                            <span className="text-[10px] text-stone-400 block font-bold text-red-700">⏳ غير خالص (مطلوب)</span>
                            <span className="font-mono text-xs font-black text-red-700">{unpaidSum.toFixed(3)} د.ت</span>
                          </div>
                          <div className="text-center p-2 border-r border-stone-200/60">
                            <span className="text-[10px] text-stone-400 block font-bold text-emerald-700">✅ خالص ومدفوع</span>
                            <span className="font-mono text-xs font-black text-emerald-700">{paidSum.toFixed(3)} د.ت</span>
                          </div>
                        </div>

                        {filtered.length === 0 ? (
                          <div className="text-center py-10 text-stone-400 text-xs">
                            لا توجد أي قطع غيار مسجلة تطابق خيارات البحث الحالية.
                          </div>
                        ) : (
                          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                            {filtered.slice(0, sparePartsLimit).map((sp) => (
                              <div key={sp.id} className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 bg-stone-50 hover:bg-stone-100/50 rounded-xl border border-stone-100 transition-colors gap-2 text-right">
                                <div className="space-y-1">
                                  <div className="flex items-center flex-wrap gap-2">
                                    <span className="font-bold text-stone-900 text-sm">{sp.name}</span>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100 font-bold">
                                      👤 المزوّد: {sp.supplierName}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-stone-400 flex flex-wrap gap-x-3 gap-y-1">
                                    <span>📅 التاريخ: {new Date(sp.date).toLocaleString('fr-TN')}</span>
                                    {sp.notes && <span className="text-amber-700 font-medium">📝 ملاحظات: {sp.notes}</span>}
                                  </div>
                                </div>
                                
                                <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-stone-200/60">
                                  <div className="flex items-center gap-1 ml-2">
                                    <button 
                                      onClick={() => handleAdjustSparePartQty(sp.id, -1)}
                                      className="w-6 h-6 rounded-lg bg-stone-200 border border-stone-300 text-stone-800 hover:bg-stone-300 flex items-center justify-center font-bold font-mono text-xs cursor-pointer select-none"
                                      title="إنقاص الكمية بـ 1"
                                    >
                                      -
                                    </button>
                                    <span className="text-xs font-bold text-stone-800 font-mono px-1">{sp.qty}</span>
                                    <button 
                                      onClick={() => handleAdjustSparePartQty(sp.id, 1)}
                                      className="w-6 h-6 rounded-lg bg-stone-200 border border-stone-300 text-stone-800 hover:bg-stone-300 flex items-center justify-center font-bold font-mono text-xs cursor-pointer select-none"
                                      title="زيادة الكمية بـ 1"
                                    >
                                      +
                                    </button>
                                  </div>

                                  <div className="text-left font-mono text-xs font-bold text-stone-800 min-w-[75px]">
                                    <div>{sp.totalCost.toFixed(3)} د.ت</div>
                                    <div className="text-[9px] text-stone-400 font-medium">({sp.unitCost.toFixed(3)} للقطعة)</div>
                                  </div>

                                  <div className="flex items-center gap-1">
                                    <button 
                                      onClick={() => handleToggleSparePartPayment(sp.id)}
                                      className={`px-3 py-1 rounded-xl text-[10px] font-black cursor-pointer transition-colors shadow-xs ${
                                        sp.status === 'paid' 
                                          ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' 
                                          : 'bg-rose-100 text-rose-800 hover:bg-rose-200'
                                      }`}
                                      title="تبديل حالة السداد"
                                    >
                                      {sp.status === 'paid' ? '✅ خالص' : '⏳ غير خالص'}
                                    </button>

                                    <button 
                                      onClick={() => handleDeleteSparePart(sp.id)} 
                                      className="text-stone-400 hover:text-red-700 cursor-pointer p-1.5 transition-colors rounded-xl hover:bg-red-50"
                                      title="حذف القطعة"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {filtered.length > sparePartsLimit && (
                          <div className="mt-4 pt-3 border-t border-stone-100 flex gap-2 justify-center">
                            <button 
                              onClick={() => setSparePartsLimit(prev => prev + 50)}
                              className="bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold px-4 py-1.5 rounded-xl text-xs cursor-pointer"
                            >
                              عرض المزيد من قطع الغيار (+50) 🔄
                            </button>
                            <button 
                              onClick={() => setSparePartsLimit(filtered.length)}
                              className="bg-stone-800 text-white font-bold px-4 py-1.5 rounded-xl text-xs cursor-pointer"
                            >
                              عرض الكل ({filtered.length})
                            </button>
                          </div>
                        )}
                      </>
                    );
                  })()}
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

      <VisualProductRecognitionModal 
        items={items}
        isOpen={showVisualRecognitionModal}
        onClose={() => {
          setShowVisualRecognitionModal(false);
          setTargetItemToCapturePhoto(null);
        }}
        onSelectProduct={(item) => handleQuickAddItemToCart(item)}
        onUpdateItemImage={handleUpdateItemImage}
        onAddNewItemWithImage={handleAddNewItemWithImage}
        targetItemToUpdate={targetItemToCapturePhoto}
        mode={visualRecognitionMode}
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
