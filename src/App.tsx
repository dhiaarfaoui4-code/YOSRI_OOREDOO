import React, { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue } from 'react';
import { 
  TrendingUp, Plus, Minus, Search, Trash2, ShieldAlert, CreditCard, 
  History, Settings as SettingsIcon, Package, Phone, FileText, Check, 
  Camera, ShoppingBag, Radio, Wifi, LogOut, CheckCircle, RefreshCw, X,
  Pencil, Image as ImageIcon, Sparkles, Zap, CornerDownLeft,
  Moon, Sun, Laptop, Users, UserCheck, Merge, ChevronDown, ChevronUp,
  AlertCircle, HelpCircle, Layers, ArrowDownRight, UserPlus, PhoneCall,
  MessageCircle, Link2, Briefcase, Building2
} from 'lucide-react';
import { 
  Item, Sale, OtherIncome, Debt, DebtLine, CardStockEntry, Expense, 
  ForfaitPlan, ForfaitBalance, AuditLogEntry, AppTab, AppRole, SparePart,
  PendingSale, PendingSaleLine, PendingStockStep, PendingDebtPayment, PendingDebtPaymentStatus, PendingDeleteDebt, PendingDeleteDebtStatus, PendingDeleteHistorySale, PendingDeleteHistorySaleStatus
} from './types';
import {
  ensureAuth, signInManager, resumeManagerSession, logoutManager,
  fetchJsonWithRetry, safeDecrementItemQty, safeIncrementItemQty,
  safeDecrementForfait, safeIncrementForfait,
  safeIncrementSparePartQty, safeDecrementSparePartQty, safeIncrementDebtPaid,
  safeDecrementCardQty, safeIncrementCardQty,
  safeDecrementPhotoStock, safeIncrementPhotoStock,
  putWithOutbox, patchWithOutbox, flushOutbox, dbUrl, verifyManagerPinViaAuth,
  updateManagerPinViaAuth, subscribeOutboxChange, loadOutbox, clearOutboxForPaths, saveOutboxList,
  loadPendingSales, savePendingSale, removePendingSale, loadPendingDebtPayments, savePendingDebtPayment, removePendingDebtPayment, loadPendingDeleteDebts, savePendingDeleteDebt, removePendingDeleteDebt, loadPendingDeleteHistorySales, savePendingDeleteHistorySale, removePendingDeleteHistorySale
} from './firebase';
import { SvgChart } from './components/SvgChart';
import { InvoiceModal, InvoiceData } from './components/InvoiceModal';
import { BarcodeScannerPopup } from './components/BarcodeScannerPopup';
import { LoginOverlay } from './components/LoginOverlay';
import { VisualProductRecognitionModal } from './components/VisualProductRecognitionModal';
import { DuplicateProductModal } from './components/DuplicateProductModal';
import { ShiftHandoverModal } from './components/ShiftHandoverModal';
import { PayDebtModal, PayDebtModalTarget } from './components/PayDebtModal';
import { DebtsTab } from './components/DebtsTab';
import { findSimilarProducts, recordLearningDecision, SimilarityResult } from './utils/productSimilarity';
import { 
  groupDebtsByCustomer, findCustomerSuggestionsFromGroups, assessCustomerSimilarity,
  CustomerDebtGroup, CustomerSuggestion
} from './utils/customerDebtMatcher';

const APP_NORM_ARABIC_CACHE = new Map<string, string>();

// Helper to normalize Arabic (memoized)
function normalizeArabic(str: string): string {
  if (!str) return '';
  const cached = APP_NORM_ARABIC_CACHE.get(str);
  if (cached !== undefined) return cached;

  const res = str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[\u064B-\u0652]/g, '')
    .trim();

  if (APP_NORM_ARABIC_CACHE.size >= 3000) {
    APP_NORM_ARABIC_CACHE.clear();
  }
  APP_NORM_ARABIC_CACHE.set(str, res);
  return res;
}

// Smart multilingual search normalization
function smartNormalize(str: string): string {
  if (!str) return '';
  let s = str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase();
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

export const normalizeOpName = (op?: string | null): string => {
  const t = (op || '').trim();
  if (/ooredoo/i.test(t)) return 'Ooredoo';
  if (/orange/i.test(t)) return 'Orange';
  if (/telecom|اتصالات/i.test(t)) return 'Tunisie Telecom';
  return t || 'Ooredoo';
};

export const roundTND = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

const OOREDOO_NKALMEK_PLANS: ForfaitPlan[] = [
  { id: 'ooredoo_nkalmek_30', name: 'Offre Nkalmek 30 DT', validity: '', price: 30.0 },
  { id: 'ooredoo_nkalmek_37', name: 'Offre Nkalmek 37 DT', validity: '', price: 37.0 },
  { id: 'ooredoo_nkalmek_50', name: 'Offre Nkalmek 50 DT', validity: '', price: 50.0 }
];

export default function App() {
  // ---- Core States ----
  const [items, setItems] = useState<Item[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [otherIncome, setOtherIncome] = useState<OtherIncome[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [cardStock, setCardStock] = useState<CardStockEntry[]>([]);
  const [cashRegister, setCashRegister] = useState<number>(0);
  const [startingCashInput, setStartingCashInput] = useState<string>('');
  const [lastCashResetTimestamp, setLastCashResetTimestamp] = useState<string | null>(null);
  const [showShiftHandoverModal, setShowShiftHandoverModal] = useState<boolean>(false);
  const [dashboardDateFilter, setDashboardDateFilter] = useState<'shift' | 'today' | 'yesterday' | '7days' | '30days' | 'all'>('shift');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [forfaitPlans, setForfaitPlans] = useState<ForfaitPlan[]>([]);
  const [forfaitBalance, setForfaitBalance] = useState<ForfaitBalance>({ Ooredoo: 0, Orange: 0, 'Tunisie Telecom': 0 });
  const [photoPaperStock, setPhotoPaperStock] = useState<number>(0);
  const [photoStockInput, setPhotoStockInput] = useState<string>('');
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [managerPin, setManagerPin] = useState<string>(''); // SHA256 string
  const [currentRole, setCurrentRole] = useState<AppRole | null>(null);
  const [costVisible, setCostVisible] = useState<boolean>(false);
  const [currentTab, setCurrentTab] = useState<AppTab>('income');
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [outboxCount, setOutboxCount] = useState<number>(0);
  const [payDebtTarget, setPayDebtTarget] = useState<PayDebtModalTarget | null>(null);

  // ---- Dark Mode / Theme State (Default: System / Device Preference) ----
  type ThemeMode = 'system' | 'dark' | 'light';
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('yosri_gsm_theme') as ThemeMode;
      if (saved === 'dark' || saved === 'light' || saved === 'system') return saved;
    } catch (e) {
      // ignore
    }
    return 'system'; // Auto detect by default
  });

  const [isDarkEffective, setIsDarkEffective] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const saved = localStorage.getItem('yosri_gsm_theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false;
    } catch (e) {
      return false;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateTheme = () => {
      let isDark = false;
      if (themeMode === 'dark') {
        isDark = true;
      } else if (themeMode === 'light') {
        isDark = false;
      } else {
        // System preference
        isDark = mediaQuery.matches;
      }
      setIsDarkEffective(isDark);
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    updateTheme();
    try {
      localStorage.setItem('yosri_gsm_theme', themeMode);
    } catch (e) {
      // ignore
    }

    const handleChange = (e: MediaQueryListEvent) => {
      if (themeMode === 'system') {
        setIsDarkEffective(e.matches);
        if (e.matches) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      }
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else if (mediaQuery.addListener) {
      // legacy support
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, [themeMode]);

  // ---- Modals & Overlays ----
  const [lastInvoice, setLastInvoice] = useState<InvoiceData | null>(null);
  const [scannerContext, setScannerContext] = useState<string | null>(null); // 'stock' | 'sell' | 'manage-<itemId>'
  const [toastMsg, setToastMsg] = useState<string>('');
  const [showForfaitBreakdownModal, setShowForfaitBreakdownModal] = useState<boolean>(false);
  const [forfaitFilterOp, setForfaitFilterOp] = useState<string>('all');
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

  const [inputDialog, setInputDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    inputType: 'text' | 'number' | 'password' | 'select';
    value: string;
    placeholder?: string;
    step?: string;
    min?: string;
    options?: { value: string; label: string; icon?: string }[];
  }>({
    isOpen: false,
    title: '',
    message: '',
    inputType: 'text',
    value: ''
  });
  const inputResolverRef = useRef<((val: string | null) => void) | null>(null);

  const openInputDialog = useCallback((opts: {
    title: string;
    message: string;
    inputType?: 'text' | 'number' | 'password' | 'select';
    defaultValue?: string;
    placeholder?: string;
    step?: string;
    min?: string;
    options?: { value: string; label: string; icon?: string }[];
  }): Promise<string | null> => {
    if (inputResolverRef.current) {
      inputResolverRef.current(null);
      inputResolverRef.current = null;
    }
    return new Promise((resolve) => {
      inputResolverRef.current = resolve;
      setInputDialog({
        isOpen: true,
        title: opts.title,
        message: opts.message,
        inputType: opts.inputType || 'text',
        value: opts.defaultValue ?? '',
        placeholder: opts.placeholder,
        step: opts.step,
        min: opts.min,
        options: opts.options
      });
    });
  }, []);

  const resolveInputDialog = useCallback((result: string | null) => {
    const resolver = inputResolverRef.current;
    inputResolverRef.current = null;
    setInputDialog(prev => ({ ...prev, isOpen: false }));
    if (resolver) resolver(result);
  }, []);

  const isSyncingRef = useRef<boolean>(false);
  const isMergingCardsRef = useRef<boolean>(false);

  // ---- Form Inputs ----
  const [newItem, setNewItem] = useState({ name: '', barcode: '', buy: '', sell: '', qty: '', category: 'accessory', imageUrl: '' });
  const [duplicateCandidates, setDuplicateCandidates] = useState<SimilarityResult[]>([]);
  const [showDuplicateModal, setShowDuplicateModal] = useState<boolean>(false);
  const [cardOperator, setCardOperator] = useState('Ooredoo');
  const [cardValue, setCardValue] = useState('1');
  const [cardQty, setCardQty] = useState('');
  const [addBalanceOperator, setAddBalanceOperator] = useState('Ooredoo_1005');
  const [addBalanceAmount, setAddBalanceAmount] = useState('');
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanValidity, setNewPlanValidity] = useState('');
  const [newPlanPrice, setNewPlanPrice] = useState('');
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
  const [incomeType, setIncomeType] = useState<'item' | 'recharge' | 'forfait' | 'photo' | 'service' | 'bill'>('item');
  const [sellSearch, setSellSearch] = useState('');
  const [sellItemId, setSellItemId] = useState('');
  const [sellQty, setSellQty] = useState('1');
  const [sellPriceOverride, setSellPriceOverride] = useState('');
  const [rechargeOp, setRechargeOp] = useState('Ooredoo');
  const [rechargeValOpt, setRechargeValOpt] = useState('1|1.3|0.3'); // face|sellPrice|commission
  const [rechargeQty, setRechargeQty] = useState('1');
  const [rechargePriceOverride, setRechargePriceOverride] = useState('');
  const [forfaitOp, setForfaitOp] = useState('Ooredoo 1005');
  const [forfaitPlanId, setForfaitPlanId] = useState('');
  const [forfaitPriceOverride, setForfaitPriceOverride] = useState('');
  const [forfaitCustomerPhone, setForfaitCustomerPhone] = useState('');
  const [photoDesc, setPhotoDesc] = useState('');
  const [photoQty, setPhotoQty] = useState('1');
  const [photoAmount, setPhotoAmount] = useState('');
  const [serviceType, setServiceType] = useState('Cache');
  const [serviceCustomDesc, setServiceCustomDesc] = useState('');
  const [serviceAmount, setServiceAmount] = useState('');
  const [billType, setBillType] = useState('STEG (كهرباء وغاز)');
  const [billCustomDesc, setBillCustomDesc] = useState('');
  const [billReference, setBillReference] = useState('');
  const [billAmount, setBillAmount] = useState('');

  const availableForfaitPlans = useMemo(() => {
    const isOoredooOp = forfaitOp === 'Ooredoo 1005' || forfaitOp === 'Ooredoo 1006';
    const list = [...forfaitPlans];
    if (isOoredooOp) {
      for (const np of OOREDOO_NKALMEK_PLANS) {
        const exists = list.some(
          p => p.id === np.id || (p.name.toLowerCase().includes('nkalmek') && Math.abs(p.price - np.price) < 0.01)
        );
        if (!exists) list.push(np);
      }
    }
    return list.sort((a, b) => a.price - b.price);
  }, [forfaitPlans, forfaitOp]);

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
  const itemDirectFileInputRef = useRef<HTMLInputElement>(null);

  const [stockSearch, setStockSearch] = useState('');
  const [selectedStockCategory, setSelectedStockCategory] = useState<string>('all');
  const [selectedSellCategory, setSelectedSellCategory] = useState<string>('all');
  const [auditLogSearch, setAuditLogSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyCategory, setHistoryCategory] = useState<'all' | 'item' | 'recharge' | 'forfait' | 'photo' | 'service' | 'bill'>('all');
  const [historyDateFilter, setHistoryDateFilter] = useState<'all' | 'today' | 'yesterday' | '7days' | '30days'>('all');

  // Cart
  interface CartLine {
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
  const [cart, setCart] = useState<CartLine[]>([]);
  const [editingCartLineId, setEditingCartLineId] = useState<string | null>(null);
  const [editingCartPriceVal, setEditingCartPriceVal] = useState<string>('');
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

  // Log Audit trail (no-op since Audit Log tab is disabled)
  const logAudit = async (_action: string, _label: string) => {
    // Disabled to save Firebase database storage
  };

  // Helper to execute and verify rollbacks safely (BUG-4B-02)
  
  
  const trySavePendingDebtPayment = (payment: PendingDebtPayment, newStatus: PendingDebtPaymentStatus): boolean => {
    const prevStatus = payment.status;
    payment.status = newStatus;
    const ok = savePendingDebtPayment(payment);
    if (!ok) {
      payment.status = prevStatus;
    }
    return ok;
  };

  const trySavePendingSale = (pending: PendingSale, newStatus: PendingSale['status']): boolean => {
    const old = pending.status;
    pending.status = newStatus;
    if (savePendingSale(pending)) return true;
    pending.status = old;
    return false;
  };
  const trySavePendingSaleStep = (pending: PendingSale, step: any, newStatus: string): boolean => {
    const old = step.status;
    step.status = newStatus;
    if (savePendingSale(pending)) return true;
    step.status = old;
    return false;
  };

  const executeRollback = async (pending: PendingSale): Promise<boolean> => {
    if (!pending.stockSteps || pending.stockSteps.length === 0) {
      if (!trySavePendingSale(pending, 'rolled_back')) return false;
      const removed = removePendingSale(pending.transactionId);
      if (!removed) console.warn('Failed to remove rolled_back pending sale:', pending.transactionId);
      return true;
    }

    if (!trySavePendingSale(pending, 'rollback_in_progress')) return false;

    let allReversed = true;
    for (const step of pending.stockSteps) {
      if (step.status === 'completed') {
        let revertOk = false;
        try {
          if (step.kind === 'item') {
            const res = await safeIncrementItemQty(step.targetId, step.qty, undefined, 6, step.revertOpId);
            revertOk = res?.success === true && !res?.pending;
          } else if (step.kind === 'card') {
            const res = await safeIncrementCardQty(step.targetId, step.qty, undefined, 6, step.revertOpId);
            revertOk = res?.success === true && !res?.pending;
          } else if (step.kind === 'forfait' && step.payload) {
            const res = await safeIncrementForfait(step.payload, 6, step.revertOpId);
            revertOk = res?.success === true && !res?.pending;
          } else if (step.kind === 'photo') {
            const res = await safeIncrementPhotoStock(step.qty, undefined, 6, step.revertOpId);
            revertOk = res?.success === true && !res?.pending;
          }
        } catch (err) {
          console.error('Error executing step reversal:', step, err);
          revertOk = false;
        }

        if (revertOk) {
          if (!trySavePendingSaleStep(pending, step, 'rolled_back')) { allReversed = false; }
        } else {
          allReversed = false;
        }
      }
    }

    if (allReversed) {
      if (!trySavePendingSale(pending, 'rolled_back')) return false;
      const removed = removePendingSale(pending.transactionId);
      if (!removed) console.warn('Failed to remove rolled_back pending sale:', pending.transactionId);
      return true;
    }
    return false;
  };

  // Helper to resume / recover incomplete sales after browser crash / refresh (State Machine Recovery)
  
  
  const trySavePendingDeleteDebt = (del: PendingDeleteDebt, newStatus: PendingDeleteDebtStatus): boolean => {
    const prev = del.status;
    del.status = newStatus;
    if (!savePendingDeleteDebt(del)) {
      del.status = prev;
      return false;
    }
    return true;
  };

  
  const trySavePendingDeleteHistorySale = (del: PendingDeleteHistorySale, newStatus: PendingDeleteHistorySaleStatus): boolean => {
    const prev = del.status;
    del.status = newStatus;
    if (!savePendingDeleteHistorySale(del)) {
      del.status = prev;
      return false;
    }
    return true;
  };

  const resumePendingDeleteHistorySales = async () => {
    const pendings = loadPendingDeleteHistorySales();
    for (const pending of pendings) {
      try {
        if (pending.status === 'created' || pending.status === 'stock_restore_in_progress') {
          if (!trySavePendingDeleteHistorySale(pending, 'stock_restore_in_progress')) continue;
          
          let allStockCompleted = true;
          for (const step of pending.stockSteps) {
            if (step.status === 'completed') continue;
            let res;
            if (step.kind === 'item') {
              res = await safeIncrementItemQty(step.targetId, step.qty, undefined, 6, step.opId);
            } else if (step.kind === 'card') {
              res = await safeIncrementCardQty(step.targetId, step.qty, undefined, 6, step.opId);
            } else if (step.kind === 'forfait') {
              res = await safeIncrementForfait({ [step.targetId]: step.qty }, 6, step.opId);
            } else if (step.kind === 'photo') {
              res = await safeIncrementPhotoStock(step.qty, undefined, 6, step.opId);
            } else if (step.kind === 'debt_pay') {
              // TargetId is debtId. qty is amount
              // We pass amount as negative, safeIncrementDebtPaid takes amount. We should just pass it.
              // Wait, safeIncrementDebtPaid takes `amount` (delta). In step.qty we will put -record.amount.
              res = await safeIncrementDebtPaid(step.targetId, step.qty, 6, step.opId);
            }
            if (res && res.success && !res.pending) {
              step.status = 'completed';
              savePendingDeleteHistorySale(pending);
            } else {
              allStockCompleted = false;
            }
          }
          if (allStockCompleted) {
            if (!trySavePendingDeleteHistorySale(pending, 'stock_restore_completed')) continue;
          } else {
            continue; // Wait for network
          }
        }
        
        if (pending.status === 'stock_restore_completed' || pending.status === 'sale_delete_in_progress') {
          if (!trySavePendingDeleteHistorySale(pending, 'sale_delete_in_progress')) continue;
          
          const path = pending.isSaleRecord ? `/sales/${pending.saleId}.json` : `/otherIncome/${pending.saleId}.json`;
          const ok = await putWithOutbox(path, null);
          
          if (ok.success && !ok.pending) {
            if (trySavePendingDeleteHistorySale(pending, 'completed')) {
              removePendingDeleteHistorySale(pending.id);
            }
          }
        }
      } catch (err) {
        console.error('Error resuming delete history sale', err);
      }
    }
  };

  const resumePendingDeleteDebts = async () => {
    const pendings = loadPendingDeleteDebts();
    for (const pending of pendings) {
      try {
        if (pending.status === 'created' || pending.status === 'stock_rollback_in_progress') {
          if (!trySavePendingDeleteDebt(pending, 'stock_rollback_in_progress')) continue;
          
          let allStockCompleted = true;
          for (const step of pending.stockSteps) {
            if (step.status === 'completed') continue;
            let res;
            if (step.kind === 'item') {
              res = await safeIncrementItemQty(step.targetId, step.qty, undefined, 6, step.opId);
            } else if (step.kind === 'card') {
              res = await safeIncrementCardQty(step.targetId, step.qty, undefined, 6, step.opId);
            } else if (step.kind === 'forfait') {
              res = await safeIncrementForfait({ [step.targetId]: step.qty }, 6, step.opId);
            } else if (step.kind === 'photo') {
              res = await safeIncrementPhotoStock(step.qty, undefined, 6, step.opId);
            }
            if (res && res.success && !res.pending) {
              step.status = 'completed';
              savePendingDeleteDebt(pending);
            } else {
              allStockCompleted = false;
            }
          }
          if (allStockCompleted) {
            if (!trySavePendingDeleteDebt(pending, 'stock_rollback_completed')) continue;
          } else {
            continue; // Wait for network
          }
        }
        
        if (pending.status === 'stock_rollback_completed' || pending.status === 'income_delete_in_progress') {
          if (!trySavePendingDeleteDebt(pending, 'income_delete_in_progress')) continue;
          let allIncomeDeleted = true;
          for (const incId of pending.incomeIdsToDelete) {
             const res = await putWithOutbox(`/otherIncome/${incId}.json`, null);
             if (!res.success || res.pending) {
                allIncomeDeleted = false;
             }
          }
          if (allIncomeDeleted) {
            if (!trySavePendingDeleteDebt(pending, 'debt_delete_in_progress')) continue;
          } else {
            continue; // Wait for network
          }
        }
        
        if (pending.status === 'debt_delete_in_progress') {
           const ok = await putWithOutbox(`/debts/${pending.debtId}.json`, null);
           if (ok.success && !ok.pending) {
              if (trySavePendingDeleteDebt(pending, 'completed')) {
                 removePendingDeleteDebt(pending.id);
              }
           }
        }
      } catch (err) {
         console.error('Error resuming delete debt', err);
      }
    }
  };

  const resumePendingDebtPayments = async () => {
    const pendings = loadPendingDebtPayments();
    for (const pending of pendings) {
      try {
        if (pending.status === 'created' || pending.status === 'debt_in_progress') {
          if (!trySavePendingDebtPayment(pending, 'debt_in_progress')) continue;
          
          const res1 = await safeIncrementDebtPaid(pending.debtId, pending.payAmount, 6, pending.id, pending.debtId);
          if (res1.reason === 'not_found') {
            // Debt was deleted, we can't pay it
            if (!trySavePendingDebtPayment(pending, 'completed')) continue;
            removePendingDebtPayment(pending.id);
            continue;
          }
          if (res1.success && !res1.pending) {
            if (!trySavePendingDebtPayment(pending, 'debt_completed')) continue;
          } else {
            continue; // Wait for network
          }
        }

        if (pending.status === 'debt_completed' || pending.status === 'income_in_progress') {
          if (!trySavePendingDebtPayment(pending, 'income_in_progress')) continue;
          
          await patchWithOutbox(`/debts/${pending.debtId}.json`, { status: pending.updatedDebtStatus }, undefined, pending.debtId);
          const ok2 = await putWithOutbox(`/otherIncome/${pending.incomeId}.json`, pending.incomeEntry, pending.incomeId, pending.debtId);
          
          if (ok2.success && !ok2.pending) {
            if (!trySavePendingDebtPayment(pending, 'completed')) continue;
            removePendingDebtPayment(pending.id);
          }
        }
      } catch (err) {
        console.error('Error recovering pending debt payment:', pending, err);
      }
    }
  };

  const resumePendingSales = async () => {
    const pendingList = loadPendingSales();
    if (pendingList.length === 0) return;

    for (const pending of pendingList) {
      try {
        const { transactionId, date, cart: pendingCart, grandTotal, isDebt, customerName, customerPhone, initialPayment, status } = pending;
        
        // 1. If in rollback state, attempt completing the reversal
        if (status === 'rollback_in_progress') {
          await executeRollback(pending);
          continue;
        }

        // 2. Already finished or rolled back
        if (status === 'rolled_back' || status === 'completed') {
          const removed = removePendingSale(transactionId);
          if (!removed) console.warn('Failed to verify deletion of pending sale', transactionId);
          continue;
        }

        // 3. If in created / started / stock_in_progress, verify and execute remaining stock steps
        if (status === 'created' || status === 'started' || status === 'stock_in_progress') {
          let stockAllOk = true;
          if (pending.stockSteps && pending.stockSteps.length > 0) {
            for (const step of pending.stockSteps) {
              if (step.status === 'pending') {
                let stepRes: { success: boolean; pending?: boolean; reason?: string } = { success: false };
                if (step.kind === 'item') {
                  stepRes = await safeDecrementItemQty(step.targetId, step.qty, undefined, 6, step.opId);
                } else if (step.kind === 'card') {
                  stepRes = await safeDecrementCardQty(step.targetId, step.qty, undefined, 6, step.opId);
                } else if (step.kind === 'forfait' && step.payload) {
                  stepRes = await safeDecrementForfait(step.payload, 6, step.opId);
                } else if (step.kind === 'photo') {
                  stepRes = await safeDecrementPhotoStock(step.qty, undefined, 6, step.opId);
                }

                if (stepRes.success && !stepRes.pending) {
                  if (!trySavePendingSaleStep(pending, step, 'completed')) { stockAllOk = false; break; }
                } else if (!stepRes.success) {
                  step.status = 'failed';
                  stockAllOk = false;
                  if (stepRes.reason === 'insufficient') {
                    if (!trySavePendingSale(pending, 'rollback_in_progress')) return false;
                    await executeRollback(pending);
                    break;
                  }
                  break;
                } else {
                  // stepRes.success is true but pending is true (queued in outbox, not yet confirmed by Firebase)
                  // Keep step.status as 'pending', do not mark completed or rollback
                  stockAllOk = false;
                  break;
                }
              }
            }
          }

          const hasRemainingUncompleted = pending.stockSteps?.some(s => s.status === 'pending' || s.status === 'failed');
          if (hasRemainingUncompleted || !stockAllOk || pending.status === 'rollback_in_progress') {
            continue; // Stop recovery of this transaction until network is back or rollback completes
          }

          if (!trySavePendingSale(pending, 'stock_completed')) continue;
        }

        // 4. If stock is confirmed completed, proceed to write sales/debt records
        if (pending.status === 'stock_completed' || pending.status === 'stock_decremented' || pending.status === 'records_in_progress') {
          if (!trySavePendingSale(pending, 'records_in_progress')) continue;

          let recordsAllOk = true;

          if (isDebt) {
            const initialPayVal = Math.min(grandTotal, Math.max(0, parseFloat(initialPayment || '') || 0));
            const debtLines: DebtLine[] = pendingCart.map(c => {
              let lineBuy = 0;
              if (c.type === 'item') {
                lineBuy = typeof c.unitBuy === 'number' ? c.unitBuy : (c.itemId ? (items.find(i => i.id === c.itemId)?.buy || 0) : 0);
              }
              return {
                type: c.type,
                itemId: c.itemId || null,
                itemName: c.type === 'item' ? c.label : null,
                qty: c.qty,
                unitBuy: c.type === 'item' ? lineBuy : undefined,
                unitPrice: c.unitPrice,
                cardOperator: c.cardOperator || null,
                cardValue: c.cardValue || null,
                total: c.total
              };
            });

            const newDebt: Debt = {
              id: `${transactionId}_debt`,
              customerName: customerName || 'حريف بدون اسم',
              customerPhone: customerPhone || undefined,
              note: pendingCart.map(c => c.label).join(' + '),
              lines: debtLines,
              amount: grandTotal,
              paid: initialPayVal,
              date,
              status: (initialPayVal >= grandTotal - 0.001) ? 'paid' : 'open'
            };

            const resDebt = await putWithOutbox(`/debts/${newDebt.id}.json`, newDebt, newDebt.id);
            if (!resDebt.success || resDebt.pending) {
              recordsAllOk = false;
            }

            if (initialPayVal > 0) {
              const totalDebtCost = debtLines.reduce((s, line) => {
                if (line.type === 'item') {
                  return s + ((line.unitBuy || 0) * (line.qty || 1));
                }
                return s;
              }, 0);
              const profitRatio = grandTotal > 0 ? Math.max(0, (grandTotal - totalDebtCost) / grandTotal) : 1;
              const downPaymentCommission = initialPayVal * profitRatio;

              const downPaymentIncome: OtherIncome = {
                id: `${transactionId}_downpay`,
                category: 'debt_payment',
                label: `دفعة أولى / تسبيق دين - ${customerName || 'حريف'} (${pendingCart.map(c => c.label).join(' + ')})`,
                amount: initialPayVal,
                commission: downPaymentCommission,
                date,
                debtId: newDebt.id
              };
              const resDownpay = await putWithOutbox(`/otherIncome/${downPaymentIncome.id}.json`, downPaymentIncome, downPaymentIncome.id, newDebt.id);
              if (!resDownpay.success || resDownpay.pending) {
                recordsAllOk = false;
              }
            }
          } else {
            let lineIdx = 0;
            for (const line of pendingCart) {
              lineIdx++;
              if (line.type === 'item') {
                const sale: Sale = {
                  id: `${transactionId}_s_${lineIdx}`,
                  itemId: line.itemId || null,
                  itemName: line.label,
                  qty: line.qty,
                  unitPrice: line.unitPrice,
                  unitBuy: line.unitBuy || 0,
                  total: line.total,
                  date
                };
                const resSale = await putWithOutbox(`/sales/${sale.id}.json`, sale, sale.id);
                if (!resSale.success || resSale.pending) {
                  recordsAllOk = false;
                }
              } else {
                const income: OtherIncome = {
                  id: `${transactionId}_inc_${lineIdx}`,
                  category: line.type,
                  label: line.label,
                  amount: line.total,
                  commission: line.commission || 0,
                  date,
                  cardOperator: line.cardOperator || null,
                  cardValue: line.cardValue || null,
                  qty: line.qty || null
                };
                const resInc = await putWithOutbox(`/otherIncome/${income.id}.json`, income, income.id);
                if (!resInc.success || resInc.pending) {
                  recordsAllOk = false;
                }
              }
            }
          }

          if (recordsAllOk) {
            // Operation records are safely registered in Outbox/Firebase. Remove durable log entry!
            if (!trySavePendingSale(pending, 'completed')) continue;
            const removed = removePendingSale(transactionId);
        if (!removed) console.warn('Failed to verify deletion of pending sale', transactionId);
          } else {
            // Keep pending sale alive in 'records_in_progress' for future retry
          }
        }
      } catch (err) {
        console.error('Error recovering pending sale:', pending, err);
      }
    }
  };

  const syncHandlersRef = useRef({
    resumePendingDeleteHistorySales,
    resumePendingDeleteDebts,
    resumePendingDebtPayments,
    resumePendingSales,
    loadAllData: async () => {}
  });

  // First initialization load & periodic sync
  useEffect(() => {
    let active = true;
    const unsubOutbox = subscribeOutboxChange((count) => {
      if (active) setOutboxCount(count);
    });

    async function runRecoveryAndSync() {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      try {
        await syncHandlersRef.current.resumePendingDeleteHistorySales();
        await syncHandlersRef.current.resumePendingDeleteDebts();
        await syncHandlersRef.current.resumePendingDebtPayments();
        await syncHandlersRef.current.resumePendingSales();
        await flushOutbox((sent) => {
          if (active && sent > 0) triggerToast(`✅ تم إرسال ${sent} عملية معلقة من وضع عدم الاتصال`);
        });
        await syncHandlersRef.current.loadAllData();
      } finally {
        isSyncingRef.current = false;
      }
    }

    async function init() {
      setConnectionStatus('checking');

      // 1. Resume manager session if previously logged in
      const sessionRole = sessionStorage.getItem('yosri_role_v2') as AppRole | null;
      if (sessionRole === 'manager') {
        const resumed = await resumeManagerSession();
        if (resumed) {
          setCurrentRole('manager');
          setCurrentTab('income');
        } else {
          sessionStorage.removeItem('yosri_role_v2');
          setCurrentRole(null);
          await ensureAuth(2);
        }
      } else {
        if (sessionRole === 'seller') {
          setCurrentRole('seller');
          setCurrentTab('income');
        }
        await ensureAuth(2);
      }

      await runRecoveryAndSync();
    }
    init();

    // Setup periodic sync using live refs so state closures never go stale
    const interval = setInterval(() => {
      runRecoveryAndSync();
    }, 15000);

    return () => {
      active = false;
      unsubOutbox();
      clearInterval(interval);
    };
  }, []);

  const handleManualFlushOutbox = async () => {
    triggerToast('🔄 جاري محاولة إرسال العمليات المعلقة بالسحابة...');
    const res = await flushOutbox();
    if (res.sent > 0) {
      triggerToast(`✅ تم إرسال ${res.sent} عملية معلقة بنجاح!`);
      loadAllData();
    } else if (res.remaining > 0) {
      triggerToast(`⚠️ لم يتيسر الإرسال (باقي ${res.remaining} عملية). تحقق من الاتصال بالإنترنت.`);
    } else {
      triggerToast('✅ جميع العمليات محدثة ومزامنة بالسحابة.');
    }
  };

  const loadAllData = async () => {
    const safeFetch = async (path: string): Promise<{ ok: boolean; data: any }> => {
      try {
        const data = await fetchJsonWithRetry(path);
        return { ok: true, data };
      } catch {
        return { ok: false, data: null };
      }
    };

    try {
      const results = await Promise.all([
        safeFetch('/items.json'),
        safeFetch('/sales.json'),
        safeFetch('/otherIncome.json'),
        safeFetch('/debts.json'),
        safeFetch('/cardStock.json'),
        safeFetch('/cashRegister.json'),
        safeFetch('/expenses.json'),
        safeFetch('/forfaitPlans.json'),
        safeFetch('/forfaitBalance.json'),
        safeFetch('/photoPaperStock.json'),
        Promise.resolve({ ok: true, data: null }),
        safeFetch('/pin.json'),
        safeFetch('/whatsappConfig.json'),
        safeFetch('/spareParts.json'),
        safeFetch('/telegramConfig.json'),
        safeFetch('/lastCashResetTimestamp.json')
      ]);

      const [
        itemsRes, salesRes, otherIncomeRes, debtsRes, cardStockRes,
        cashRegisterRes, expensesRes, plansRes, balanceRes, photoPaperStockRes, auditRes, pinRes, whatsappConfigRes,
        sparePartsRes, telegramConfigRes, lastResetRes
      ] = results;

      const anyNetworkSuccess = [
        itemsRes, salesRes, otherIncomeRes, debtsRes, cardStockRes,
        cashRegisterRes, expensesRes, plansRes, balanceRes, photoPaperStockRes
      ].some(r => r.ok);

      if (!anyNetworkSuccess) {
        setConnectionStatus('offline');
        return;
      }

      if (lastResetRes.ok && typeof lastResetRes.data === 'string') {
        setLastCashResetTimestamp(lastResetRes.data);
      }

      if (itemsRes.ok) setItems(parseRawWithKeys<Item>(itemsRes.data));
      if (salesRes.ok) setSales(parseRawWithKeys<Sale>(salesRes.data));
      if (otherIncomeRes.ok) setOtherIncome(parseRawWithKeys<OtherIncome>(otherIncomeRes.data));
      if (debtsRes.ok) setDebts(parseRawWithKeys<Debt>(debtsRes.data));

      if (cardStockRes.ok) {
        const parsedCards = parseRawWithKeys<CardStockEntry>(cardStockRes.data);

        // Group card stock by normalized operator and face value
        const cardGroups: Record<string, CardStockEntry[]> = {};
        for (const card of parsedCards) {
          const normOp = normalizeOpName(card.operator);
          const normVal = String(card.value).trim();
          const groupKey = `${normOp}_${normVal}`;
          if (!cardGroups[groupKey]) {
            cardGroups[groupKey] = [];
          }
          cardGroups[groupKey].push(card);
        }

        const standardCardPairs = [
          { operator: 'Ooredoo', value: '1' },
          { operator: 'Ooredoo', value: '5' },
          { operator: 'Orange', value: '1' },
          { operator: 'Orange', value: '5' },
          { operator: 'Tunisie Telecom', value: '1' },
          { operator: 'Tunisie Telecom', value: '5' }
        ];

        for (const std of standardCardPairs) {
          const groupKey = `${std.operator}_${std.value}`;
          if (!cardGroups[groupKey]) {
            cardGroups[groupKey] = [];
          }
        }

        const consolidatedCards: CardStockEntry[] = [];
        for (const groupKey of Object.keys(cardGroups)) {
          const entries = cardGroups[groupKey];
          const [op, val] = groupKey.split('_');
          const canonicalId = `std_card_${op.replace(/\s+/g, '')}_${val}`;

          if (entries.length === 0) {
            consolidatedCards.push({
              id: canonicalId,
              kind: 'recharge',
              operator: op,
              value: val,
              qty: 0
            });
          } else if (entries.length === 1) {
            const single = entries[0];
            consolidatedCards.push({
              ...single,
              operator: op,
              value: val
            });
          } else {
            const totalSum = entries.reduce((s, c) => s + (c.qty || 0), 0);
            const canonicalEntry = entries.find(e => e.id === canonicalId) || entries[0];

            const updatedCanonical: CardStockEntry = {
              ...canonicalEntry,
              id: canonicalEntry.id,
              kind: 'recharge',
              operator: op,
              value: val,
              qty: totalSum
            };
            consolidatedCards.push(updatedCanonical);

            // Atomic stock merge to Firebase guarded against concurrent refreshes
            if (!isMergingCardsRef.current) {
              isMergingCardsRef.current = true;
              (async () => {
                try {
                  for (const dup of entries) {
                    if (dup.id !== canonicalEntry.id) {
                      if (dup.qty > 0) {
                        const incRes = await safeIncrementCardQty(canonicalEntry.id, dup.qty, canonicalEntry.qty);
                        if (incRes.success && !incRes.pending) {
                          await putWithOutbox(`/cardStock/${dup.id}.json`, null);
                        }
                      } else {
                        await putWithOutbox(`/cardStock/${dup.id}.json`, null);
                      }
                    }
                  }
                } finally {
                  isMergingCardsRef.current = false;
                }
              })();
            }
          }
        }
        setCardStock(consolidatedCards);
      }

      if (cashRegisterRes.ok) {
        setCashRegister(typeof cashRegisterRes.data === 'number' ? cashRegisterRes.data : 0);
      }
      if (expensesRes.ok) setExpenses(parseRawWithKeys<Expense>(expensesRes.data));
      if (sparePartsRes.ok) setSpareParts(parseRawWithKeys<SparePart>(sparePartsRes.data));

      if (whatsappConfigRes.ok && whatsappConfigRes.data) {
        setWhatsappConfig({
          enabled: whatsappConfigRes.data.enabled !== false,
          phone: whatsappConfigRes.data.phone || '+21641444355',
          apiKey: whatsappConfigRes.data.apiKey || ''
        });
      }
      if (telegramConfigRes.ok && telegramConfigRes.data) {
        setTelegramConfig({
          enabled: telegramConfigRes.data.enabled !== false,
          botToken: telegramConfigRes.data.botToken || '',
          chatId: telegramConfigRes.data.chatId || ''
        });
      }
      if (auditRes.ok) setAuditLog(parseRawWithKeys<AuditLogEntry>(auditRes.data).reverse());

      // If forfait plans are confirmed empty in Firebase, generate default ones
      if (plansRes.ok) {
        if (!plansRes.data) {
          const defaultPlans = [
            { id: 'p1', name: '220 Mo', validity: '4 jours', price: 1.0 },
            { id: 'p2', name: '1.25 Go', validity: '30 jours', price: 5.0 },
            { id: 'p3', name: '25 Go', validity: '30 jours', price: 30.0 },
            { id: 'p4', name: '55 Go', validity: '55 jours', price: 55.0 }
          ];
          setForfaitPlans(defaultPlans);
          defaultPlans.forEach(p => {
            putWithOutbox(`/forfaitPlans/${p.id}.json`, p);
          });
        } else {
          const loadedPlans = parseRawWithKeys<ForfaitPlan>(plansRes.data);
          loadedPlans.sort((a, b) => a.price - b.price);
          setForfaitPlans(loadedPlans);
        }
      }

      if (balanceRes.ok) {
        const balanceRaw = balanceRes.data;
        if (balanceRaw) {
          const raw1005 = balanceRaw.Ooredoo_1005 !== undefined ? balanceRaw.Ooredoo_1005 : (balanceRaw.Ooredoo || 0);
          const raw1006 = balanceRaw.Ooredoo_1006 !== undefined ? balanceRaw.Ooredoo_1006 : 0;
          const ooredooTotal = roundTND(raw1005 + raw1006);
          setForfaitBalance({
            ...balanceRaw,
            Ooredoo: ooredooTotal,
            Ooredoo_1005: raw1005,
            Ooredoo_1006: raw1006,
            Orange: balanceRaw.Orange || 0,
            'Tunisie Telecom': balanceRaw['Tunisie Telecom'] || 0
          });
        } else {
          setForfaitBalance({
            Ooredoo: 0,
            Ooredoo_1005: 0,
            Ooredoo_1006: 0,
            Orange: 0,
            'Tunisie Telecom': 0
          });
        }
      }

      if (photoPaperStockRes.ok) {
        const photoPaperStockRaw = photoPaperStockRes.data;
        let parsedPhotoStock = 0;
        if (typeof photoPaperStockRaw === 'number') {
          parsedPhotoStock = photoPaperStockRaw;
        } else if (photoPaperStockRaw && typeof photoPaperStockRaw === 'object' && typeof (photoPaperStockRaw as any).qty === 'number') {
          parsedPhotoStock = (photoPaperStockRaw as any).qty;
        }
        setPhotoPaperStock(parsedPhotoStock);
      }

      // Handle legacy raw PIN hashing safely (typeof null === 'object' guard)
      if (pinRes.ok) {
        const pinRaw = pinRes.data;
        const finalPin = (pinRaw && typeof pinRaw === 'object') ? (pinRaw.owner || '1234') : (pinRaw || '1234');
        if (typeof finalPin === 'string' && finalPin.length === 64) {
          setManagerPin(finalPin);
        } else {
          const hash = await sha256Hex(String(finalPin));
          setManagerPin(hash);
        }
      }

      setConnectionStatus('connected');
    } catch (e) {
      setConnectionStatus('offline');
    }
  };

  syncHandlersRef.current = {
    resumePendingDeleteHistorySales,
    resumePendingDeleteDebts,
    resumePendingDebtPayments,
    resumePendingSales,
    loadAllData
  };

  // Handle logout
  const handleLogout = async () => {
    await logoutManager();
    setCurrentRole(null);
    sessionStorage.removeItem('yosri_role_v2');
  };

  // Verify PIN helper for dangerous manager actions
  const promptAndVerifyPin = async (message = 'أدخل الرمز السري للمدير للتأكيد:'): Promise<boolean> => {
    const code = await openInputDialog({
      title: 'تأكيد صلاحية المدير',
      message,
      inputType: 'password',
      placeholder: 'أدخل الرمز السري...'
    });
    if (!code) return false;

    // First try server-side verification via Firebase Auth
    const isOk = await verifyManagerPinViaAuth(code);
    if (isOk) return true;

    // Fallback to local SHA-256 comparison for offline support
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
    
    const buyVal = parseFloat(buy || '0');
    const sellVal = parseFloat(sell || '0');
    const qtyVal = parseInt(qty || '0', 10);
    if (isNaN(buyVal) || buyVal < 0 || isNaN(sellVal) || sellVal < 0 || isNaN(qtyVal) || qtyVal < 0) {
      return triggerToast('❌ يرجى إدخال قيم صالحة غير سالبة للأسعار والكمية');
    }

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

    // Intelligent duplicate product detection across brand, model, specs, color, barcode, image & tokens
    const similarMatches = findSimilarProducts(
      {
        name,
        barcode: barcodeArray[0],
        barcodes: barcodeArray,
        imageUrl: newItem.imageUrl
      },
      items,
      55 // 55% similarity threshold
    );

    if (similarMatches.length > 0) {
      setDuplicateCandidates(similarMatches);
      setShowDuplicateModal(true);
      return;
    }

    // No duplicate found above threshold -> add new item directly
    await handleCreateNewProductDirectly();
  };

  const handleConfirmIncreaseQuantity = async (
    existingItem: Item,
    addedQty: number,
    buyVal: number,
    sellVal: number
  ) => {
    if (!Number.isFinite(addedQty) || addedQty <= 0) {
      return triggerToast('❌ الكمية المضافة يجب أن تكون أكبر من الصفر');
    }
    const { barcode } = newItem;
    const barcodeArray = barcode
      ? barcode.split(',').map(b => b.trim()).filter(b => b.length > 0)
      : [];

    const mergedBarcodes = Array.from(new Set([
      ...(existingItem.barcodes || []),
      ...barcodeArray
    ]));

    const patchData: Partial<Item> = {
      buy: buyVal > 0 ? buyVal : existingItem.buy,
      sell: sellVal > 0 ? sellVal : existingItem.sell,
      barcodes: mergedBarcodes,
      category: newItem.category || existingItem.category || 'accessory',
      imageUrl: existingItem.imageUrl || newItem.imageUrl || undefined
    };

    // Increment quantity atomically and verify before patching metadata
    const qtyRes = await safeIncrementItemQty(existingItem.id, addedQty, existingItem.qty);
    if (!qtyRes.success) {
      return triggerToast('❌ تعذر زيادة كمية السلعة، يرجى المحاولة مجدداً');
    }
    const ok = await patchWithOutbox(`/items/${existingItem.id}.json`, patchData);
    if (ok.success) {
      triggerToast(`✅ تم زيادة كمية "${existingItem.name}" بنجاح (+${addedQty} قطعة)`);
      logAudit('edit', `دمج وتحديث ستوك سلعة مشابهة: ${existingItem.name} (+${addedQty})`);
      recordLearningDecision(newItem.name, existingItem.name, true);
      loadAllData();
    }

    setNewItem({ name: '', barcode: '', buy: '', sell: '', qty: '', category: 'accessory', imageUrl: '' });
    setShowDuplicateModal(false);
  };

  const handleCreateNewProductDirectly = async () => {
    const { name, barcode, buy, sell, qty, category } = newItem;
    const buyVal = Math.max(0, parseFloat(buy || '0') || 0);
    const sellVal = Math.max(0, parseFloat(sell || '0') || 0);
    const qtyVal = Math.max(0, parseInt(qty || '0', 10) || 0);

    const barcodeArray = barcode
      ? barcode.split(',').map(b => b.trim()).filter(b => b.length > 0)
      : [];

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
    if (ok.success) {
      triggerToast('✅ تم إضافة السلعة الجديدة للمخزن');
      logAudit('edit', `إضافة سلعة جديدة: ${name} (${qtyVal} قطعة)`);
      if (duplicateCandidates.length > 0) {
        recordLearningDecision(name, duplicateCandidates[0].item.name, false);
      }
      setNewItem({ name: '', barcode: '', buy: '', sell: '', qty: '', category: 'accessory', imageUrl: '' });
      loadAllData();
    }

    setShowDuplicateModal(false);
  };

  const handleUpdateItemImage = async (itemId: string, imageUrl: string) => {
    const target = items.find(i => i.id === itemId);
    if (!target) return;
    const updated: Item = { ...target, imageUrl };
    setItems(prev => prev.map(i => i.id === itemId ? updated : i));
    const ok = await patchWithOutbox(`/items/${itemId}.json`, { imageUrl });
    if (ok.success) {
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
    imageUrl: string,
    barcode?: string
  ) => {
    const barcodeArray = barcode
      ? barcode.split(',').map(b => b.trim()).filter(b => b.length > 0)
      : [];

    const newItemObj: Item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      sell: sellPrice,
      buy: buyPrice,
      qty,
      category,
      imageUrl,
      barcodes: barcodeArray,
      barcode: barcodeArray[0]
    };

    setItems(prev => [newItemObj, ...prev]);
    const ok = await putWithOutbox(`/items/${newItemObj.id}.json`, newItemObj);
    if (ok.success) {
      triggerToast(`✨ تم تسجيل "${name}" بالستوك وإرفاق صورتها والباركود بنجاح!`);
      logAudit('edit', `تسجيل سلعة جديدة بالصورة والباركود: ${name}`);
      handleQuickAddItemToCart(newItemObj, 1);
    }
  };

  const handleDirectItemPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const maxDim = 720;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          setNewItem(prev => ({ ...prev, imageUrl: compressed }));
          triggerToast('📸 تم إرفاق صورة السلعة بنجاح!');
        } else {
          setNewItem(prev => ({ ...prev, imageUrl: dataUrl }));
          triggerToast('📸 تم إرفاق صورة السلعة بنجاح!');
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    // Reset file input so same file can be re-selected if needed
    e.target.value = '';
  };

  const handleAdjustQty = async (itemId: string, delta: number) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    if (delta < 0 && item.qty <= 0) return triggerToast('❌ المخزن فارغ بالفعل');

    const prevQty = item.qty;
    const nextQty = Math.max(0, prevQty + delta);

    // 1. Instant Optimistic State Update (0ms visual delay)
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, qty: nextQty } : i));
    triggerToast(delta > 0 ? `➕ ${item.name}: ${nextQty} قطعة` : `➖ ${item.name}: ${nextQty} قطعة`);

    // 2. Background Safe Sync (DELTA)
    const result = delta > 0 
      ? await safeIncrementItemQty(itemId, delta, prevQty)
      : await safeDecrementItemQty(itemId, Math.abs(delta), prevQty);

    if (result.success) {
      logAudit('edit', `تعديل كمية "${item.name}" يدوياً: ${delta > 0 ? '+' : ''}${delta} (${prevQty} ← ${nextQty})`);
    } else {
      // Revert if failed
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, qty: prevQty } : i));
      triggerToast('❌ فشل حفظ الكمية في السحابة، تم التراجع');
    }
  };

  const handleEditQtyExact = async (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const input = await openInputDialog({
      title: 'تعديل كمية السلعة',
      message: `أدخل الكمية الدقيقة لـ "${item.name}":`,
      inputType: 'number',
      defaultValue: String(item.qty),
      step: '1',
      min: '0'
    });
    if (input === null) return;
    const val = parseInt(input, 10);
    if (isNaN(val) || val < 0) return triggerToast('❌ قيمة غير صالحة');

    const delta = val - item.qty;
    if (delta === 0) return;

    const prevQty = item.qty;
    // 1. Instant Optimistic UI Update
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, qty: val } : i));
    triggerToast(`✅ ${item.name}: ${val} قطعة`);

    // 2. Safe Atomic Delta Sync (Prevents overwriting concurrent sales)
    const opId = `adj_exact_${itemId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let res: { success: boolean; reason?: string } = { success: false };
    if (delta > 0) {
      res = await safeIncrementItemQty(itemId, delta, prevQty, 6, opId);
    } else {
      res = await safeDecrementItemQty(itemId, Math.abs(delta), prevQty, 6, opId);
    }

    if (res.success) {
      logAudit('edit', `تعديل كمية "${item.name}" للقيمة المحددة: ${val} (الفرق: ${delta > 0 ? '+' : ''}${delta})`);
    } else {
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, qty: prevQty } : i));
      triggerToast(res.reason === 'insufficient' ? '❌ لا يمكن تقليص الكمية لأقل من الصفر (تم البيع بالتزامن)' : '❌ فشل حفظ التعديل، تم التراجع');
    }
  };

  const handleEditItemName = async (itemId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const newName = await openInputDialog({
      title: 'تعديل اسم السلعة',
      message: `أدخل الاسم الجديد للسلعة "${item.name}":`,
      inputType: 'text',
      defaultValue: item.name
    });
    if (newName === null) return;
    const trimmed = newName.trim();
    if (!trimmed) return triggerToast('❌ لا يمكن أن يكون اسم السلعة فارغاً');

    const ok = await patchWithOutbox(`/items/${itemId}.json`, { name: trimmed });
    if (ok.success) {
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
    const newCat = await openInputDialog({
      title: 'تعديل فئة السلعة',
      message: `اختر فئة جديدة لـ "${item.name}":`,
      inputType: 'select',
      defaultValue: currentCat,
      options: [
        { value: 'phone', label: '📱 هواتف' },
        { value: 'battery', label: '🔋 بطاريات' },
        { value: 'speaker', label: '🔊 سبيكرات' },
        { value: 'bluetooth', label: '🎧 سماعات بلوتوث' },
        { value: 'accessory', label: '🔌 أكسسوارات أخرى' }
      ]
    });
    if (newCat === null || !CATEGORY_MAP[newCat]) return;

    if (newCat === currentCat) return;

    const ok = await patchWithOutbox(`/items/${itemId}.json`, { category: newCat });
    if (ok.success) {
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
    const input = await openInputDialog({
      title: `تعديل ${label}`,
      message: `تعديل ${label} للسلعة "${item.name}":`,
      inputType: 'number',
      defaultValue: currentVal.toString(),
      step: '0.001',
      min: '0'
    });
    if (input === null) return;

    const val = parseFloat(input);
    if (isNaN(val) || val < 0) {
      return triggerToast('❌ سعر غير صالح');
    }

    const ok = await patchWithOutbox(`/items/${itemId}.json`, { [type]: val });
    if (ok.success) {
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
    if (ok.success) {
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
          label: `${o.category === 'forfait_replenish' ? 'شحن رصيد فورفي' : o.category === 'card' ? 'بيع كارت شحن' : o.category === 'bill' ? 'خلاص فاتورة' : 'خدمة أخرى'}: ${o.label}`,
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
      ctx.fillText('متجر Yosri GSM - العنوان: نبر، الكاف | هاتف: \u206641 444 355\u2069 | متصل بالخادم السحابي لـ Yosri GSM', 620, 1675);

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

  const generateShiftReportPDF = async (
    shiftData: {
      sellerName: string;
      startingCash: number;
      salesTotal: number;
      otherIncomeTotal: number;
      expensesTotal: number;
      expectedCash: number;
      actualCash: number;
      cashWithdrawn: number;
      newStartingCash: number;
      notes: string;
    },
    shiftSales: Sale[],
    shiftOtherIncome: OtherIncome[]
  ) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1240;
      canvas.height = 1754;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 1240, 1754);

      // Top bar
      ctx.fillStyle = '#D97706'; // Amber-600
      ctx.fillRect(0, 0, 1240, 25);

      // Header Title
      ctx.fillStyle = '#1C1917';
      ctx.font = 'bold 32px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillText('📋 تقرير تسليم الوردية وتصفير الكاسة', 1140, 95);

      ctx.fillStyle = '#78716C';
      ctx.font = '18px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.fillText('نظام إدارة مبيعات Yosri GSM - متصل بالخادم السحابي', 1140, 135);

      // Divider line
      ctx.strokeStyle = '#E7E5E4';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(100, 165);
      ctx.lineTo(1140, 165);
      ctx.stroke();

      // Metadata
      ctx.fillStyle = '#44403C';
      ctx.font = 'bold 16px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`📅 تاريخ التصفير: ${new Date().toLocaleString('ar-TN')}`, 1140, 205);
      ctx.fillText(`👤 الوردية / البائع: ${shiftData.sellerName || 'غير مسمى'}`, 1140, 240);

      ctx.textAlign = 'left';
      const reportId = `SHIFT-${Date.now().toString(36).toUpperCase()}`;
      ctx.fillText(`🔑 معرّف التقرير: #${reportId}`, 100, 205);

      ctx.beginPath();
      ctx.moveTo(100, 275);
      ctx.lineTo(1140, 275);
      ctx.stroke();

      // Cards
      const drawCard = (cx: number, cy: number, cw: number, ch: number, title: string, value: string, color: string) => {
        ctx.fillStyle = '#FAFAF9';
        ctx.fillRect(cx, cy, cw, ch);
        ctx.strokeStyle = '#E7E5E4';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx, cy, cw, ch);

        ctx.fillStyle = color;
        ctx.fillRect(cx, cy, cw, 6);

        ctx.fillStyle = '#78716C';
        ctx.font = 'bold 14px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.fillText(title, cx + cw / 2, cy + 35);

        ctx.fillStyle = '#1C1917';
        ctx.font = 'bold 22px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.fillText(value, cx + cw / 2, cy + 78);
      };

      const totalRevenue = shiftData.salesTotal + shiftData.otherIncomeTotal;
      const diff = shiftData.actualCash - shiftData.expectedCash;
      const diffStr = diff === 0 ? 'مطابقة (0.000)' : `${diff > 0 ? '+' : ''}${diff.toFixed(3)} د.ت`;

      drawCard(800, 310, 340, 110, '💵 مداخيل الوردية الكلية', `${totalRevenue.toFixed(3)} د.ت`, '#059669');
      drawCard(450, 310, 340, 110, '💸 مصاريف الوردية', `${shiftData.expensesTotal.toFixed(3)} د.ت`, '#DC2626');
      drawCard(100, 310, 340, 110, '🏦 الصافي المسحوب للخزنة', `${shiftData.cashWithdrawn.toFixed(3)} د.ت`, '#2563EB');

      drawCard(800, 435, 340, 110, '💰 الكاش المفترض بالدرج', `${shiftData.expectedCash.toFixed(3)} د.ت`, '#D97706');
      drawCard(450, 435, 340, 110, '💵 الكاش الفعلي المحسوب', `${shiftData.actualCash.toFixed(3)} د.ت`, '#1C1917');
      drawCard(100, 435, 340, 110, '⚖️ الفارق / المطابقة', diffStr, diff === 0 ? '#059669' : diff < 0 ? '#DC2626' : '#2563EB');

      // Table Header
      ctx.fillStyle = '#1C1917';
      ctx.font = 'bold 20px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
      ctx.fillText('📋 كشف عمليات الوردية الممسوحة من السحابة:', 1140, 580);

      const tableY = 605;
      ctx.fillStyle = '#1C1917';
      ctx.fillRect(100, tableY, 1040, 40);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 15px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';

      ctx.fillText('م', 1115, tableY + 25);
      ctx.fillText('الوقت', 990, tableY + 25);
      ctx.fillText('البيان / تفاصيل العملية', 670, tableY + 25);
      ctx.fillText('الكمية', 410, tableY + 25);
      ctx.fillText('السعر', 310, tableY + 25);
      ctx.fillText('الإجمالي', 175, tableY + 25);

      const allRows = [
        ...shiftSales.map(s => ({
          date: s.date,
          label: s.itemName,
          qty: s.qty,
          price: s.unitPrice,
          total: s.total
        })),
        ...shiftOtherIncome.map(o => ({
          date: o.date,
          label: `${o.category === 'forfait_replenish' ? 'شحن رصيد فورفي' : o.category === 'card' ? 'بيع كارت شحن' : o.category === 'bill' ? 'خلاص فاتورة' : 'خدمة أخرى'}: ${o.label}`,
          qty: o.qty || 1,
          price: o.amount / (o.qty || 1),
          total: o.amount
        }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      let currentY = tableY + 40;
      const rowsToShow = allRows.slice(0, 22);

      rowsToShow.forEach((row, idx) => {
        ctx.fillStyle = idx % 2 === 0 ? '#FAFAF9' : '#FFFFFF';
        ctx.fillRect(100, currentY, 1040, 36);

        ctx.strokeStyle = '#F5F5F4';
        ctx.lineWidth = 1;
        ctx.strokeRect(100, currentY, 1040, 36);

        ctx.fillStyle = '#44403C';
        ctx.font = '14px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';

        ctx.fillText(String(idx + 1), 1115, currentY + 23);

        const timeStr = new Date(row.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        ctx.fillText(timeStr, 990, currentY + 23);

        ctx.textAlign = 'right';
        let lbl = row.label || '';
        if (lbl.length > 42) lbl = lbl.slice(0, 39) + '...';
        ctx.fillText(lbl, 870, currentY + 23);

        ctx.textAlign = 'center';
        ctx.fillText(String(row.qty), 410, currentY + 23);
        ctx.fillText(row.price.toFixed(3), 310, currentY + 23);

        ctx.fillStyle = '#1C1917';
        ctx.font = 'bold 14px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.fillText(row.total.toFixed(3), 175, currentY + 23);

        currentY += 36;
      });

      if (allRows.length > 22) {
        ctx.fillStyle = '#78716C';
        ctx.font = 'italic 13px "Segoe UI", Tahoma, Arial, sans-serif';
        ctx.direction = 'rtl';
        ctx.textAlign = 'center';
        ctx.fillText(`💡 ولقد تم تصفير ومسح ${allRows.length - 22} عملية إضافية من السحابة وتوثيقها بهذا التقرير.`, 620, currentY + 25);
      }

      // Footer
      ctx.strokeStyle = '#E7E5E4';
      ctx.lineWidth = 1;
      ctx.strokeRect(100, 1630, 1040, 60);

      ctx.fillStyle = '#78716C';
      ctx.font = '13px "Segoe UI", Tahoma, Arial, sans-serif';
      ctx.direction = 'rtl';
      ctx.textAlign = 'center';
      ctx.fillText('🛡️ تم تصفير الكاسة وتوثيق حسابات الوردية بنجاح مع مسح السجلات من الفايربيز لتوفير المساحة المجانية.', 620, 1655);
      ctx.fillText('متجر Yosri GSM - العنوان: نبر، الكاف | هاتف: \u206641 444 355\u2069 | متصل بالخادم السحابي لـ Yosri GSM', 620, 1675);

      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const imgData = canvas.toDataURL('image/png');
      pdf.addImage(imgData, 'PNG', 0, 0, 210, 297);

      const filename = `shift_report_${new Date().toISOString().split('T')[0]}_${reportId}.pdf`;
      pdf.save(filename);

      if (telegramConfig.enabled && telegramConfig.botToken && telegramConfig.chatId) {
        const pdfBase64 = pdf.output('datauristring');
        const safeSeller = escapeHTML(shiftData.sellerName || 'غير مسمى');
        const caption = `📋 <b>تقرير تسليم الوردية وتصفير الكاسة (#${reportId})</b>\n\n` +
          `• <b>الوردية/البائع:</b> ${safeSeller}\n` +
          `• <b>مداخيل الوردية:</b> ${totalRevenue.toFixed(3)} د.ت\n` +
          `• <b>مصاريف الوردية:</b> ${shiftData.expensesTotal.toFixed(3)} د.ت\n` +
          `• <b>الكاش المفترض بالدرج:</b> ${shiftData.expectedCash.toFixed(3)} د.ت\n` +
          `• <b>الكاش الفعلي بالدرج:</b> ${shiftData.actualCash.toFixed(3)} د.ت\n` +
          `• <b>الفارق:</b> ${diffStr}\n` +
          `• <b>المسحوب للخزنة:</b> <code>${shiftData.cashWithdrawn.toFixed(3)}</code> د.ت\n` +
          `• <b>كاش بداية الوردية الجديدة:</b> ${shiftData.newStartingCash.toFixed(3)} د.ت\n\n` +
          `<i>تم مسح مبيعات الوردية من الفايربيز وإرسال التقرير لتلغرام بنجاح.</i>`;

        triggerToast('📤 جاري إرسال تقرير الوردية PDF لتلغرام...');
        const tgRes = await sendTelegramPDF(pdfBase64, filename, caption);
        if (!tgRes.success) {
          triggerToast(`⚠️ تم حفظ التقرير محلياً لكن تعذر إرساله لتلغرام: ${tgRes.error || ''}`);
        }
      }

      return pdf;
    } catch (err: any) {
      console.error('Error generating shift PDF report:', err);
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
    if (ok.success) {
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
    if (ok.success) {
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

    const normOp = normalizeOpName(cardOperator);
    const normVal = String(cardValue).trim();
    const existing = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);

    if (existing) {
      const res = await safeIncrementCardQty(existing.id, qtyVal, existing.qty);
      const newQty = res.newQty !== undefined ? res.newQty : existing.qty + qtyVal;
      setCardStock(prev => prev.map(c => c.id === existing.id ? { ...c, qty: newQty } : c));
    } else {
      const canonicalId = `std_card_${normOp.replace(/\s+/g, '')}_${normVal}`;
      const newCard: CardStockEntry = {
        id: canonicalId,
        kind: 'recharge',
        operator: normOp,
        value: normVal,
        qty: qtyVal
      };
      setCardStock(prev => [...prev, newCard]);
      await putWithOutbox(`/cardStock/${newCard.id}.json`, newCard);
    }
    triggerToast('✅ تم تحديث مخزن بطاقات الشحن');
    logAudit('edit', `إضافة بطاقات شحن لـ ${normOp} فئة ${normVal}: +${qtyVal}`);
    setCardQty('');
  };

  const handleEditCardQty = async (id: string) => {
    const card = cardStock.find(c => c.id === id);
    if (!card) return;
    const input = await openInputDialog({
      title: 'تعديل كمية البطاقات',
      message: `أدخل الكمية الجديدة لبطاقات ${card.operator} (${card.value} د.ت):`,
      inputType: 'number',
      defaultValue: String(card.qty),
      step: '1',
      min: '0'
    });
    if (input === null) return;
    const val = parseInt(input, 10);
    if (isNaN(val) || val < 0) return triggerToast('❌ رقم غير صالح');

    const prevQty = card.qty;
    const delta = val - prevQty;
    setCardStock(prev => prev.map(c => c.id === id ? { ...c, qty: val } : c));
    let ok = false;
    if (delta > 0) {
      const res = await safeIncrementCardQty(id, delta, prevQty);
      ok = res.success;
    } else if (delta < 0) {
      const res = await safeDecrementCardQty(id, Math.abs(delta), prevQty);
      ok = res.success;
    } else {
      ok = true; // no change
    }
    if (ok) {
      triggerToast('✅ تم تحديث كمية البطاقات');
      logAudit('edit', `تعديل يدوي لستوك بطاقات ${card.operator} فئة ${card.value}: ${prevQty} ← ${val}`);
    } else {
      setCardStock(prev => prev.map(c => c.id === id ? { ...c, qty: prevQty } : c));
      triggerToast('❌ فشل تحديث كمية البطاقات، تم التراجع');
    }
  };

  const handleAdjustCardQty = async (id: string, delta: number) => {
    const card = cardStock.find(c => c.id === id);
    if (!card) return;
    if (delta < 0 && card.qty <= 0) return triggerToast('❌ المخزن فارغ بالفعل');

    const prevQty = card.qty;
    const nextQty = Math.max(0, prevQty + delta);

    // 1. Instant Optimistic State Update (0ms visual delay)
    setCardStock(prev => prev.map(c => c.id === id ? { ...c, qty: nextQty } : c));
    triggerToast(delta > 0 ? `➕ ${card.operator} (${card.value} د.ت): ${nextQty}` : `➖ ${card.operator} (${card.value} د.ت): ${nextQty}`);

    // 2. Background Safe Sync
    if (delta > 0) {
      const res = await safeIncrementCardQty(card.id, delta, prevQty);
      if (!res.success) {
        setCardStock(prev => prev.map(c => c.id === id ? { ...c, qty: prevQty } : c));
        triggerToast('❌ فشل حفظ بطاقات الشحن في السحابة');
      } else {
        logAudit('edit', `تعديل سريع لستوك بطاقات ${card.operator} فئة ${card.value}: ${prevQty} ← ${nextQty} (+${delta})`);
      }
    } else {
      const absDelta = Math.abs(delta);
      const res = await safeDecrementCardQty(card.id, absDelta, prevQty);
      if (!res.success) {
        setCardStock(prev => prev.map(c => c.id === id ? { ...c, qty: prevQty } : c));
        triggerToast('❌ فشل حفظ بطاقات الشحن في السحابة');
      } else {
        logAudit('edit', `تعديل سريع لستوك بطاقات ${card.operator} فئة ${card.value}: ${prevQty} ← ${nextQty} (-${absDelta})`);
      }
    }
  };

  const handleDeleteCardStock = async (id: string) => {
    const card = cardStock.find(c => c.id === id);
    if (!card) return;
    if (!await promptAndVerifyPin(`حذف بطاقات الشحن لـ ${card.operator} (${card.value} د.ت)؟`)) return;

    const prevCards = cardStock;
    setCardStock(prev => prev.filter(c => c.id !== id));
    const ok = await putWithOutbox(`/cardStock/${id}.json`, null);
    if (ok.success) {
      triggerToast('✅ تم حذف كارت الشحن من المخزن');
      logAudit('delete', `حذف ستوك كروت شحن: ${card.operator} فئة ${card.value}`);
    } else {
      setCardStock(prevCards);
      triggerToast('❌ فشل الحذف، تأكد من الاتصال');
    }
  };

  // ---- 3. Forfait plans & balance ----
  const handleAddForfaitBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(addBalanceAmount) || 0;
    if (amt <= 0) return triggerToast('❌ أدخل قيمة شحن صحيحة');

    const updated: ForfaitBalance = {
      ...forfaitBalance,
      [addBalanceOperator]: roundTND((forfaitBalance[addBalanceOperator] || 0) + amt)
    };
    if (addBalanceOperator === 'Ooredoo_1005' || addBalanceOperator === 'Ooredoo_1006' || addBalanceOperator === 'Ooredoo') {
      updated.Ooredoo = roundTND((updated.Ooredoo_1005 || 0) + (updated.Ooredoo_1006 || 0));
    }

    // DELTA increment safe from overwrite
    const res = await safeIncrementForfait({ [addBalanceOperator]: amt });
    if (res.success) {
      const opName = addBalanceOperator === 'Ooredoo_1005'
        ? 'Ooredoo (حساب 1005)'
        : addBalanceOperator === 'Ooredoo_1006'
        ? 'Ooredoo (حساب 1006)'
        : addBalanceOperator;
      triggerToast(`✅ تم شحن رصيد ${opName} بمبلغ +${amt.toFixed(3)} د.ت`);
      logAudit('edit', `شحن رصيد فورفاي لـ ${opName}: +${amt} د.ت`);
      setAddBalanceAmount('');
      setForfaitBalance(updated);
      loadAllData();
    }
  };

  const handleEditForfaitBalanceExact = async (opKey: string, customLabel?: string) => {
    const label = customLabel || (
      opKey === 'Ooredoo_1005' ? 'Ooredoo (حساب 1005)' :
      opKey === 'Ooredoo_1006' ? 'Ooredoo (حساب 1006)' :
      opKey === 'Ooredoo' ? 'Ooredoo (الإجمالي)' :
      opKey
    );
    const current = forfaitBalance[opKey] || 0;
    const input = await openInputDialog({
      title: 'تعديل رصيد الفورفاي',
      message: `أدخل الرصيد الدقيق لـ ${label} بالدينار:`,
      inputType: 'number',
      defaultValue: String(current),
      step: '0.001',
      min: '0'
    });
    if (input === null) return;
    const val = parseFloat(input);
    if (isNaN(val) || val < 0) return triggerToast('❌ رقم غير صالح');

    const roundedVal = roundTND(val);
    const updated: ForfaitBalance = { ...forfaitBalance, [opKey]: roundedVal };
    if (opKey === 'Ooredoo_1005' || opKey === 'Ooredoo_1006') {
      updated.Ooredoo = roundTND((updated.Ooredoo_1005 || 0) + (updated.Ooredoo_1006 || 0));
    }
    const ok = await patchWithOutbox('/forfaitBalance.json', { [opKey]: roundedVal, ...(opKey.startsWith('Ooredoo_') ? { Ooredoo: updated.Ooredoo } : {}) });
    if (ok.success) {
      triggerToast(`✅ تم تعديل رصيد ${label}`);
      logAudit('edit', `تعديل رصيد فورفاي لـ ${label}: ${current} ← ${roundedVal} د.ت`);
      setForfaitBalance(updated);
      loadAllData();
    }
  };

  // ---- 3.5 Photo paper stock management ----
  const handleAddPhotoStock = async (e: React.FormEvent) => {
    e.preventDefault();
    const addVal = parseInt(photoStockInput) || 0;
    if (addVal <= 0) return triggerToast('❌ الرجاء إدخال كمية صحيحة');
    const res = await safeIncrementPhotoStock(addVal, photoPaperStock);
    if (!res.success) return triggerToast('❌ فشل تحديث مخزون ورق الصور في السحابة');
    const newQty = res.newQty !== undefined ? res.newQty : photoPaperStock + addVal;
    setPhotoPaperStock(newQty);
    setPhotoStockInput('');
    triggerToast('✅ تم تحديث مخزون ورق الصور الشمسية');
    logAudit('edit', `إضافة كمية لورق الصور الشمسية (رولو): +${addVal} صورة (المجموع الجديد: ${newQty})`);
  };

  const handleEditPhotoStock = async () => {
    const valStr = await openInputDialog({
      title: 'تعديل مخزون ورق الصور',
      message: 'أدخل العدد الكلي المتبقي لصور رولو ورق الصور:',
      inputType: 'number',
      defaultValue: photoPaperStock.toString(),
      step: '1',
      min: '0'
    });
    if (valStr === null) return;
    const newQty = parseInt(valStr, 10);
    if (isNaN(newQty) || newQty < 0) return triggerToast('❌ كمية غير صالحة');
    const prevQty = photoPaperStock;
    const delta = newQty - prevQty;
    if (delta === 0) return;

    const res = delta > 0
      ? await safeIncrementPhotoStock(delta, prevQty)
      : await safeDecrementPhotoStock(Math.abs(delta), prevQty);

    if (!res.success) {
      return triggerToast('❌ فشل تعديل مخزون ورق الصور في السحابة');
    }
    setPhotoPaperStock(newQty);
    triggerToast('✅ تم تعديل مخزون ورق الصور');
    logAudit('edit', `تعديل مخزون ورق الصور الشمسية الدقيق: ${prevQty} ← ${newQty} صورة`);
  };

  const handleQuickAdjustPhotoStock = async (delta: number) => {
    if (delta < 0 && photoPaperStock <= 0) return triggerToast('❌ المخزون فارغ بالفعل');
    const prevQty = photoPaperStock;
    const nextQty = Math.max(0, prevQty + delta);

    // 1. Instant Optimistic State Update (0ms delay)
    setPhotoPaperStock(nextQty);
    triggerToast(delta > 0 ? `➕ ورق الصور: ${nextQty}` : `➖ ورق الصور: ${nextQty}`);

    // 2. Background Safe Sync
    if (delta > 0) {
      const res = await safeIncrementPhotoStock(delta, prevQty);
      if (!res.success) {
        setPhotoPaperStock(prevQty);
        triggerToast('❌ فشل حفظ مخزون ورق الصور في السحابة');
      } else {
        logAudit('edit', `تعديل سريع لمخزون ورق الصور: ${prevQty} ← ${nextQty} (+${delta})`);
      }
    } else {
      const absDelta = Math.abs(delta);
      const res = await safeDecrementPhotoStock(absDelta, prevQty);
      if (!res.success) {
        setPhotoPaperStock(prevQty);
        triggerToast('❌ فشل حفظ مخزون ورق الصور في السحابة');
      } else {
        logAudit('edit', `تعديل سريع لمخزون ورق الصور: ${prevQty} ← ${nextQty} (-${absDelta})`);
      }
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
    if (ok.success) {
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
    if (ok.success) {
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
    if (ok.success) {
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
    if (ok.success) {
      triggerToast('✅ تم مسح المصروف');
      logAudit('delete', `حذف مصروف يومي: ${exp.desc} (${exp.amount} د.ت)`);
      loadAllData();
    } else {
      triggerToast('❌ فشل الحذف، تأكد من الاتصال');
    }
  };

  // ---- 5. Debt Actions ----
  const handleAddManualDebt = async (data: { name: string; phone: string; amount: string; note: string }): Promise<boolean> => {
    const { name, phone, amount, note } = data;
    if (!name) {
      triggerToast('❌ أدخل اسم الحريف');
      return false;
    }
    const amtVal = parseFloat(amount) || 0;
    if (amtVal <= 0) {
      triggerToast('❌ أدخل مبلغاً صحيحاً');
      return false;
    }

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
    if (ok.success) {
      triggerToast('✅ تم تسجيل الدين اليدوي بنجاح');
      logAudit('sale', `تسجيل دين يدوي على ${name}: ${amtVal} د.ت`);
      
      // Trigger Telegram Notification for manual debt
      triggerTelegramDebtNotification(name, amtVal, note || 'دين يدوي', phone || undefined);

      loadAllData();
      return true;
    }
    return false;
  };

  const handlePayDebt = (debtId: string, fullPayment: boolean) => {
    const debt = debts.find(d => d.id === debtId);
    if (!debt) return;
    const remaining = Math.max(0, debt.amount - debt.paid);
    setPayDebtTarget({
      type: 'single',
      debt,
      defaultAmount: fullPayment ? remaining : undefined
    });
  };

  const handlePayCustomerGroup = (group: CustomerDebtGroup, isFullPayment: boolean) => {
    if (group.totalRemaining <= 0.001) {
      return triggerToast('ℹ️ هذا الحريف ليس لديه أي ديون متبقية حالياً');
    }
    setPayDebtTarget({
      type: 'group',
      group,
      defaultAmount: isFullPayment ? group.totalRemaining : undefined
    });
  };

    const handleExecuteDebtPayment = async (params: {
    target: PayDebtModalTarget;
    amount: number;
    destination: 'drawer' | 'manager';
    notes?: string;
  }) => {
    const { target, amount: payAmount, destination } = params;
    if (payAmount <= 0) return;
    const isToManager = destination === 'manager';

    if (target.type === 'single' && target.debt) {
      const debt = debts.find(d => d.id === target.debt!.id) || target.debt;
      const remaining = Math.max(0, roundTND(debt.amount - debt.paid));
      const actualPayAmount = roundTND(Math.min(payAmount, remaining));
      if (actualPayAmount <= 0) return;

      // Calculate accurate profit portion for the payment based on historical debt line buy costs
      let totalDebtCost = 0;
      if (debt.lines) {
        for (const line of debt.lines) {
          if (line.type === 'item') {
            const historicalBuy = typeof line.unitBuy === 'number'
              ? line.unitBuy
              : (line.itemId ? (items.find(i => i.id === line.itemId)?.buy || 0) : 0);
            totalDebtCost += historicalBuy * (line.qty || 1);
          }
        }
      }
      const totalDebtAmount = debt.amount || 1;
      const profitMarginRatio = Math.max(0, (totalDebtAmount - totalDebtCost) / totalDebtAmount);
      const profitCommission = roundTND(actualPayAmount * profitMarginRatio);

      const incomeEntry: OtherIncome = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        category: 'debt_payment',
        label: `خلاص دين ${isToManager ? '(لجيب المدير)' : '(بالكاسة)'} - ${debt.customerName} (${debt.note || ''})`,
        amount: actualPayAmount,
        commission: profitCommission,
        date: new Date().toISOString(),
        debtId: debt.id,
        destination: destination
      };

      const nextPaid = roundTND(debt.paid + actualPayAmount);
      const updatedDebt: Debt = {
        ...debt,
        paid: nextPaid,
        status: (nextPaid >= debt.amount - 0.001) ? 'paid' : 'open'
      };

      const payOpId = `pay_${incomeEntry.id}`;
      const pendingPayment: PendingDebtPayment = {
        id: payOpId,
        createdAt: Date.now(),
        debtId: debt.id,
        payAmount: actualPayAmount,
        incomeId: incomeEntry.id,
        incomeEntry: incomeEntry,
        updatedDebtStatus: updatedDebt.status,
        status: 'created'
      };

      // Durable persistence MUST succeed BEFORE updating UI or mutating state
      const persistOk = savePendingDebtPayment(pendingPayment);
      if (!persistOk) {
        return triggerToast('❌ فشل حفظ قيد العملية محلياً، تم إيقاف الدفع');
      }

      if (!trySavePendingDebtPayment(pendingPayment, 'debt_in_progress')) return;

      // Optimistic local state update
      setDebts(prev => prev.map(d => d.id === debt.id ? updatedDebt : d));
      setOtherIncome(prev => [incomeEntry, ...prev]);

      const res1 = await safeIncrementDebtPaid(debt.id, actualPayAmount, 6, payOpId, debt.id);

      if (res1.reason === 'not_found') {
        setDebts(prev => prev.filter(d => d.id !== debt.id));
        setOtherIncome(prev => prev.filter(o => o.id !== incomeEntry.id));
        trySavePendingDebtPayment(pendingPayment, 'completed');
        removePendingDebtPayment(payOpId);
        triggerToast('❌ هذا الدين لم يعد موجوداً بالمخزن السحابي (قد تم حذفه مسبقاً)');
        loadAllData();
        return;
      }

      if (res1.pending) {
        triggerToast(`⏳ تم حفظ دفعة ${actualPayAmount.toFixed(3)} د.ت في قائمة الانتظار، ستُرفع عند توفر الشبكة`);
        return;
      }

      if (!res1.success) {
        return triggerToast('⚠️ تعذر تأكيد الدفع حالياً، سيعاد تلقائياً من سجل الاستعادة');
      }

      if (!trySavePendingDebtPayment(pendingPayment, 'debt_completed')) return;
      if (!trySavePendingDebtPayment(pendingPayment, 'income_in_progress')) return;

      await patchWithOutbox(`/debts/${debt.id}.json`, { status: updatedDebt.status }, undefined, debt.id);
      const ok2 = await putWithOutbox(`/otherIncome/${incomeEntry.id}.json`, incomeEntry, incomeEntry.id, debt.id);

      if (ok2.success && !ok2.pending) {
        if (trySavePendingDebtPayment(pendingPayment, 'completed')) {
          removePendingDebtPayment(payOpId);
        }
        triggerToast(
          isToManager
            ? `💼 تم سداد ${actualPayAmount.toFixed(3)} د.ت لجيب المدير (خارج كاسة الوردية)`
            : updatedDebt.status === 'paid' ? '🎉 تم سداد الدين بالكامل في الكاسة!' : `✅ تم تسجيل دفعة ${actualPayAmount.toFixed(3)} د.ت بالكاسة`
        );
        logAudit('sale', `تسديد دين ${debt.customerName}: ${actualPayAmount.toFixed(3)} د.ت [الوجهة: ${isToManager ? 'جيب المدير خارج الكاسة' : 'صندوق الكاسة'}]`);
        loadAllData();
      } else if (ok2.pending) {
        triggerToast(`⏳ تم تحديث الدين وحفظ الدفعة في قائمة الانتظار للمزامنة`);
      }
    } else if (target.type === 'group' && target.group) {
      const group = target.group;
      let remainingToDistribute = roundTND(payAmount);
      const updatedDebtsToSave: Debt[] = [];
      const incomeEntriesToSave: OtherIncome[] = [];

      // Sort open debts oldest first
      const sortedOpen = [...group.openDebts].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      for (const debt of sortedOpen) {
        if (remainingToDistribute <= 0.0001) break;

        const debtRemaining = Math.max(0, roundTND(debt.amount - debt.paid));
        const payForThisDebt = roundTND(Math.min(debtRemaining, remainingToDistribute));

        if (payForThisDebt > 0) {
          remainingToDistribute = roundTND(remainingToDistribute - payForThisDebt);

          // Calculate profit margin ratio using historical debt line unitBuy
          let totalDebtCost = 0;
          if (debt.lines) {
            for (const line of debt.lines) {
              if (line.type === 'item') {
                const historicalBuy = typeof line.unitBuy === 'number'
                  ? line.unitBuy
                  : (line.itemId ? (items.find(i => i.id === line.itemId)?.buy || 0) : 0);
                totalDebtCost += historicalBuy * (line.qty || 1);
              }
            }
          }
          const totalDebtAmount = debt.amount || 1;
          const profitMarginRatio = Math.max(0, (totalDebtAmount - totalDebtCost) / totalDebtAmount);
          const profitCommission = roundTND(payForThisDebt * profitMarginRatio);

          const incomeEntry: OtherIncome = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + Math.floor(Math.random() * 100),
            category: 'debt_payment',
            label: `خلاص دين ${isToManager ? '(لجيب المدير)' : '(بالكاسة)'} - ${group.canonicalName} (${debt.note || 'دين'})`,
            amount: payForThisDebt,
            commission: profitCommission,
            date: new Date().toISOString(),
            debtId: debt.id,
            destination: destination
          };

          const nextPaid = roundTND(debt.paid + payForThisDebt);
          const updatedDebt: Debt = {
            ...debt,
            paid: nextPaid,
            status: (nextPaid >= debt.amount - 0.001) ? 'paid' : 'open'
          };

          updatedDebtsToSave.push(updatedDebt);
          incomeEntriesToSave.push(incomeEntry);
        }
      }

      if (updatedDebtsToSave.length === 0) return;

      const pendingPayments: PendingDebtPayment[] = [];
      for (let i = 0; i < updatedDebtsToSave.length; i++) {
        const d = updatedDebtsToSave[i];
        const inc = incomeEntriesToSave[i];
        const originalDebt = debts.find(x => x.id === d.id);
        const originalPaid = originalDebt ? originalDebt.paid : 0;
        const payDelta = roundTND(d.paid - originalPaid);
        const payOpId = `pay_${inc.id}`;

        const pendingPayment: PendingDebtPayment = {
          id: payOpId,
          createdAt: Date.now(),
          debtId: d.id,
          payAmount: payDelta,
          incomeId: inc.id,
          incomeEntry: inc,
          updatedDebtStatus: d.status,
          status: 'created'
        };
        const ok = savePendingDebtPayment(pendingPayment);
        if (ok) {
          pendingPayments.push(pendingPayment);
        }
      }

      if (pendingPayments.length === 0) {
        return triggerToast('❌ فشل حفظ قيد العملية محلياً، تم إيقاف الدفع');
      }

      // Optimistically update debts and otherIncome for saved payments only
      const savedDebtIds = new Set(pendingPayments.map(p => p.debtId));
      const savedIncIds = new Set(pendingPayments.map(p => p.incomeId));
      setDebts(prev => {
        const map = new Map(updatedDebtsToSave.filter(d => savedDebtIds.has(d.id)).map(d => [d.id, d]));
        return prev.map(d => map.get(d.id) || d);
      });
      setOtherIncome(prev => [...incomeEntriesToSave.filter(inc => savedIncIds.has(inc.id)), ...prev]);

      let anyPending = false;
      for (const pendingPayment of pendingPayments) {
        if (!trySavePendingDebtPayment(pendingPayment, 'debt_in_progress')) {
          anyPending = true;
          continue;
        }

        const res = await safeIncrementDebtPaid(pendingPayment.debtId, pendingPayment.payAmount, 6, pendingPayment.id, pendingPayment.debtId);

        if (res.reason === 'not_found') {
          setDebts(prev => prev.filter(x => x.id !== pendingPayment.debtId));
          setOtherIncome(prev => prev.filter(o => o.id !== pendingPayment.incomeId));
          trySavePendingDebtPayment(pendingPayment, 'completed');
          removePendingDebtPayment(pendingPayment.id);
          continue;
        }

        if (res.pending || !res.success) {
          anyPending = true;
          continue;
        }

        if (!trySavePendingDebtPayment(pendingPayment, 'debt_completed')) {
          anyPending = true;
          continue;
        }

        if (!trySavePendingDebtPayment(pendingPayment, 'income_in_progress')) {
          anyPending = true;
          continue;
        }

        await patchWithOutbox(`/debts/${pendingPayment.debtId}.json`, { status: pendingPayment.updatedDebtStatus }, undefined, pendingPayment.debtId);
        const ok2 = await putWithOutbox(`/otherIncome/${pendingPayment.incomeId}.json`, pendingPayment.incomeEntry, pendingPayment.incomeId, pendingPayment.debtId);

        if (ok2.success && !ok2.pending) {
          if (trySavePendingDebtPayment(pendingPayment, 'completed')) {
            removePendingDebtPayment(pendingPayment.id);
          }
        } else {
          anyPending = true;
        }
      }

      if (anyPending) {
        triggerToast(`⏳ تم حفظ الدفعة الجماعية (${payAmount.toFixed(3)} د.ت) في قائمة الانتظار، ستُرفع عند توفر الشبكة`);
      } else {
        triggerToast(
          isToManager
            ? `💼 تم سداد ${payAmount.toFixed(3)} د.ت لجيب المدير وتوزيعها على ديون "${group.canonicalName}" (خارج الكاسة)`
            : `🎉 تم تسجيل دفعة ${payAmount.toFixed(3)} د.ت بالكاسة وتوزيعها على ديون "${group.canonicalName}" بنجاح!`
        );
        logAudit('sale', `تسديد جماعي لديون الحريف ${group.canonicalName}: ${payAmount.toFixed(3)} د.ت على ${updatedDebtsToSave.length} دين [الوجهة: ${isToManager ? 'جيب المدير خارج الكاسة' : 'صندوق الكاسة'}]`);
        loadAllData();
      }
    }
  };
  const handleDeleteDebt = async (id: string) => {
    const debt = debts.find(d => d.id === id);
    if (!debt) return;

    if (!await promptAndVerifyPin(`هل ترغب بحذف ملف دين الحريف "${debt.customerName}" نهائياً؟`)) return;

    const itemIncrements: Record<string, number> = {};
    const cardIncrements: Record<string, { entry: CardStockEntry; totalQty: number }> = {};
    const forfaitIncrements: Record<string, number> = {};
    let photoIncrement = 0;

    if (debt.lines) {
      for (const line of debt.lines) {
        if (line.type === 'item' && line.itemId) {
          itemIncrements[line.itemId] = (itemIncrements[line.itemId] || 0) + line.qty;
        }
        if (line.type === 'recharge' && line.cardOperator && line.cardValue) {
          const normOp = normalizeOpName(line.cardOperator);
          const normVal = String(line.cardValue).trim();
          let card = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
          if (!card) {
            card = {
              id: `std_card_${normOp.replace(/\s+/g, '')}_${normVal}`,
              kind: 'recharge',
              operator: normOp,
              value: normVal,
              qty: 0
            };
          }
          if (!cardIncrements[card.id]) {
            cardIncrements[card.id] = { entry: card, totalQty: 0 };
          }
          cardIncrements[card.id].totalQty += (line.qty || 1);
        }
        if (line.type === 'forfait' && line.cardOperator) {
          let opKey = line.cardOperator;
          if (opKey === 'Ooredoo 1005' || opKey === 'Ooredoo_1005') {
            opKey = 'Ooredoo_1005';
          } else if (opKey === 'Ooredoo 1006' || opKey === 'Ooredoo_1006') {
            opKey = 'Ooredoo_1006';
          } else if (opKey === 'Ooredoo') {
            opKey = 'Ooredoo_1005';
          }
          forfaitIncrements[opKey] = roundTND((forfaitIncrements[opKey] || 0) + (line.total || 0));
        }
        if (line.type === 'photo') {
          photoIncrement += (line.qty || 1);
        }
      }
    }

    const stockSteps: PendingStockStep[] = [];
    for (const itemId of Object.keys(itemIncrements)) {
      stockSteps.push({
        kind: 'item', targetId: itemId, qty: itemIncrements[itemId],
        opId: `revert_inv_item_${id}_${itemId}`, revertOpId: '', status: 'pending'
      });
    }
    for (const cardId of Object.keys(cardIncrements)) {
      stockSteps.push({
        kind: 'card', targetId: cardId, qty: cardIncrements[cardId].totalQty,
        opId: `revert_inv_card_${id}_${cardId}`, revertOpId: '', status: 'pending'
      });
    }
    for (const opKey of Object.keys(forfaitIncrements)) {
      stockSteps.push({
        kind: 'forfait', targetId: opKey, qty: forfaitIncrements[opKey],
        opId: `revert_inv_forfait_${id}_${opKey}`, revertOpId: '', status: 'pending'
      });
    }
    if (photoIncrement > 0) {
      stockSteps.push({
        kind: 'photo', targetId: 'photo', qty: photoIncrement,
        opId: `revert_inv_photo_${id}`, revertOpId: '', status: 'pending'
      });
    }

    const relatedIncomes = otherIncome.filter(o => o.debtId === id);
    const incomeIdsToDelete = relatedIncomes.map(inc => inc.id);

    const pendingDel: PendingDeleteDebt = {
      id: `del_debt_${id}`,
      createdAt: Date.now(),
      debtId: id,
      stockSteps,
      incomeIdsToDelete,
      status: 'created'
    };

    if (!savePendingDeleteDebt(pendingDel)) {
      triggerToast('❌ فشل حفظ قيد الحذف محلياً، تم إيقاف العملية');
      return;
    }

    if (!trySavePendingDeleteDebt(pendingDel, 'stock_rollback_in_progress')) return;

    // Optimistically update React state immediately
    setDebts(prev => prev.filter(d => d.id !== id));
    setOtherIncome(prev => prev.filter(o => o.debtId !== id));

    if (Object.keys(itemIncrements).length > 0) {
      setItems(prevItems => prevItems.map(item => {
        const inc = itemIncrements[item.id];
        return inc ? { ...item, qty: item.qty + inc } : item;
      }));
    }
    if (Object.keys(cardIncrements).length > 0) {
      setCardStock(prevCards => prevCards.map(card => {
        const inc = cardIncrements[card.id];
        return inc ? { ...card, qty: card.qty + inc.totalQty } : card;
      }));
    }
    if (Object.keys(forfaitIncrements).length > 0) {
      setForfaitBalance(prev => {
        const next = { ...prev };
        for (const opKey of Object.keys(forfaitIncrements)) {
          next[opKey] = roundTND((next[opKey] || 0) + forfaitIncrements[opKey]);
        }
        next.Ooredoo = roundTND((next.Ooredoo_1005 || 0) + (next.Ooredoo_1006 || 0));
        return next;
      });
    }
    if (photoIncrement > 0) {
      setPhotoPaperStock(prev => prev + photoIncrement);
    }

    let allStockCompleted = true;
    for (const step of pendingDel.stockSteps) {
      let res;
      if (step.kind === 'item') {
        res = await safeIncrementItemQty(step.targetId, step.qty, undefined, 6, step.opId);
      } else if (step.kind === 'card') {
        res = await safeIncrementCardQty(step.targetId, step.qty, undefined, 6, step.opId);
      } else if (step.kind === 'forfait') {
        res = await safeIncrementForfait({ [step.targetId]: step.qty }, 6, step.opId);
      } else if (step.kind === 'photo') {
        res = await safeIncrementPhotoStock(step.qty, undefined, 6, step.opId);
      }
      if (res && res.success && !res.pending) {
        step.status = 'completed';
        savePendingDeleteDebt(pendingDel);
      } else {
        allStockCompleted = false;
      }
    }

    if (!allStockCompleted) {
      triggerToast('⏳ تم حفظ عملية حذف الدين وإرجاع المخزون في قائمة الانتظار، ستُستكمل عند توفر الشبكة');
      return;
    }

    if (!trySavePendingDeleteDebt(pendingDel, 'stock_rollback_completed')) return;
    if (!trySavePendingDeleteDebt(pendingDel, 'income_delete_in_progress')) return;

    let allIncomeDeleted = true;
    for (const incId of pendingDel.incomeIdsToDelete) {
      const res = await putWithOutbox(`/otherIncome/${incId}.json`, null);
      if (!res.success || res.pending) {
        allIncomeDeleted = false;
      }
    }

    if (!allIncomeDeleted) {
      triggerToast('⏳ تم استرجاع المخزون، وسيُستكمل حذف دفعات الدين فور توفر الشبكة');
      return;
    }

    if (!trySavePendingDeleteDebt(pendingDel, 'debt_delete_in_progress')) return;

    const ok = await putWithOutbox(`/debts/${id}.json`, null);
    if (ok.success && !ok.pending) {
      if (trySavePendingDeleteDebt(pendingDel, 'completed')) {
        removePendingDeleteDebt(pendingDel.id);
      }
      triggerToast('✅ تم حذف الدين واسترجاع المشتريات للمخزن');
      logAudit('delete', `حذف دين الحريف ${debt.customerName} بقيمة ${debt.amount.toFixed(3)} د.ت واسترجاع المشتريات للمخزون`);
      loadAllData();
    } else {
      triggerToast('⏳ تم استرجاع المخزون وحفظ حذف الدين في قائمة الانتظار للمزامنة');
    }
  };

  // Edit / Standardize Customer Name & Phone across all debts in the group
  const handleEditCustomer = async (group: CustomerDebtGroup) => {
    if (currentRole !== 'manager') return;
    const standardName = await openInputDialog({
      title: 'تعديل وتوحيد اسم الحريف',
      message: `تعديل اسم الحريف لجميع الديون المسجلة (${group.debts.length} ديون مسجلة)${group.allNames.length > 1 ? ` — الأسماء الحالية: ${group.allNames.join(' ، ')}` : ''}:`,
      inputType: 'text',
      defaultValue: group.canonicalName
    });
    if (!standardName || !standardName.trim()) return;

    const trimmed = standardName.trim();
    const phonePrompt = await openInputDialog({
      title: 'تعديل رقم هاتف الحريف',
      message: `أدخل رقم هاتف الحريف "${trimmed}" (اختياري):`,
      inputType: 'text',
      defaultValue: group.phone || '',
      placeholder: 'رقم الهاتف'
    });
    const updatedPhone = phonePrompt !== null ? phonePrompt.trim() || undefined : group.phone;

    const updatedDebts = group.debts.map(d => ({
      ...d,
      customerName: trimmed,
      customerPhone: updatedPhone || d.customerPhone
    }));

    // Optimistic update
    setDebts(prev => {
      const map = new Map(updatedDebts.map(d => [d.id, d]));
      return prev.map(d => map.get(d.id) || d);
    });

    for (const d of updatedDebts) {
      await patchWithOutbox(`/debts/${d.id}.json`, {
        customerName: d.customerName,
        customerPhone: d.customerPhone
      });
    }

    triggerToast(`✅ تم تعديل اسم الحريف إلى "${trimmed}" في كافة ديونه (${group.debts.length})`);
    logAudit('edit', `تعديل اسم ديون الحريف ${group.canonicalName} إلى ${trimmed}`);
    loadAllData();
  };

  // ---- Spare Parts Actions ----
  const handleAddSparePart = async (e: React.FormEvent) => {
    e.preventDefault();
    const { name, supplierName, qty, unitCost, notes } = newSparePart;
    if (!name.trim()) return triggerToast('❌ الرجاء إدخال اسم القطعة (مثال: شاشة، بطارية...)');
    if (!supplierName.trim()) return triggerToast('❌ الرجاء إدخال اسم المزوّد (الفورنيسور)');
    const parsedQty = parseInt(qty, 10);
    const qtyVal = Number.isFinite(parsedQty) ? parsedQty : 0;
    const parsedCost = parseFloat(unitCost || '0');
    const costVal = Number.isFinite(parsedCost) ? parsedCost : -1;
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
    if (ok.success) {
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
    const ok = await patchWithOutbox(`/spareParts/${sp.id}.json`, { status: newStatus });
    if (ok.success) {
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
    if (ok.success) {
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

    const prevQty = sp.qty;
    const newVal = sp.qty + delta;
    const updated = { ...sp, qty: newVal, totalCost: newVal * sp.unitCost };
    // 1. Instant Optimistic State Update
    setSpareParts(prev => prev.map(s => s.id === id ? updated : s));
    triggerToast(delta > 0 ? `➕ ${sp.name}: ${newVal}` : `➖ ${sp.name}: ${newVal}`);
    // 2. Background Sync
    let ok = false;
    if (delta > 0) {
      const res = await safeIncrementSparePartQty(id, delta, sp.unitCost);
      ok = res.success;
    } else if (delta < 0) {
      const res = await safeDecrementSparePartQty(id, Math.abs(delta), sp.unitCost);
      ok = res.success;
    }
    if (ok) {
      logAudit('edit', `تعديل سريع لكمية قطعة الغيار "${sp.name}": ${prevQty} ← ${newVal}`);
    } else {
      setSpareParts(prev => prev.map(s => s.id === id ? sp : s));
      triggerToast('❌ فشل حفظ تعديل قطعة الغيار، تم التراجع');
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
      const [face, price] = rechargeValOpt.split('|').map(Number);
      const qtyVal = parseInt(rechargeQty) || 1;
      if (qtyVal <= 0) return triggerToast('❌ كمية غير صالحة');

      const normOp = normalizeOpName(rechargeOp);
      const normVal = String(face).trim();
      const cardEntry = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
      const availableStock = cardEntry ? cardEntry.qty : 0;
      const cartAlready = cart
        .filter(c => c.type === 'recharge' && normalizeOpName(c.cardOperator) === normOp && String(c.cardValue).trim() === normVal)
        .reduce((s, c) => s + c.qty, 0);

      if (qtyVal + cartAlready > availableStock) {
        return triggerToast(`❌ مخزون بطاقات ${normOp} (${normVal} د.ت) غير كافي! المتوفر بالمخزن: ${Math.max(0, availableStock - cartAlready)} كارت`);
      }

      const override = parseFloat(rechargePriceOverride);
      const finalPrice = !isNaN(override) && override >= 0 ? override : price;
      const finalTotal = finalPrice * qtyVal;
      const finalCommission = (finalPrice - face) * qtyVal;

      const newLine: CartLine = {
        id: Math.random().toString(36).slice(2, 9),
        type: 'recharge',
        label: `شحن بطاقة ${normOp} فئة ${normVal} د.ت`,
        qty: qtyVal,
        unitPrice: finalPrice,
        total: finalTotal,
        commission: finalCommission,
        cardOperator: normOp,
        cardValue: normVal
      };
      setCart(prev => [...prev, newLine]);
      setRechargeQty('1');
      setRechargePriceOverride('');
      triggerToast('✅ تم إضافة الكارت للفاتورة');
    }

    else if (incomeType === 'forfait') {
      const plan = availableForfaitPlans.find(p => p.id === forfaitPlanId);
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
      if (qtyVal <= 0) return triggerToast('❌ أدخل كمية صور صحيحة');
      const amtVal = parseFloat(photoAmount) || 0;
      if (amtVal <= 0) return triggerToast('❌ أدخل مبلغ الخدمة');

      const photoInCart = cart.filter(c => c.type === 'photo').reduce((s, c) => s + c.qty, 0);
      if (qtyVal + photoInCart > photoPaperStock) {
        return triggerToast(`❌ مخزون ورق الصور (الرولو) غير كافي! المتوفر بالمخزن: ${Math.max(0, photoPaperStock - photoInCart)} صورة`);
      }

      const unitP = amtVal / qtyVal;
      const newLine: CartLine = {
        id: Math.random().toString(36).slice(2, 9),
        type: 'photo',
        label: `${desc} (${qtyVal} صورة)`,
        qty: qtyVal,
        unitPrice: unitP,
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

    else if (incomeType === 'bill') {
      const desc = billType === 'other' ? billCustomDesc.trim() : billType;
      if (!desc) return triggerToast('❌ حدد نوع الفاتورة');
      const billAmt = roundTND(parseFloat(billAmount) || 0);
      if (!Number.isFinite(billAmt) || billAmt <= 0) return triggerToast('❌ أدخل قيمة الفاتورة الصحيحة');

      const refText = billReference.trim() ? ` (${billReference.trim()})` : '';
      const label = `خلاص فاتورة ${desc}${refText} — [izi الزيتونة]`;

      const newLine: CartLine = {
        id: Math.random().toString(36).slice(2, 9),
        type: 'bill',
        label,
        qty: 1,
        unitPrice: billAmt,
        unitBuy: billAmt,
        total: billAmt,
        commission: 0,
        cardOperator: 'izi',
        cardValue: billAmt.toFixed(3),
        customerPhone: billReference.trim() || undefined
      };
      setCart(prev => [...prev, newLine]);
      setBillCustomDesc('');
      setBillReference('');
      setBillAmount('');
      triggerToast('✅ تم إضافة خلاص الفاتورة (izi الزيتونة) للفاتورة');
    }
  };

  const handleRemoveFromCart = (id: string) => {
    setCart(prev => prev.filter(c => c.id !== id));
  };

  const handleSaveInlinePrice = (lineId: string) => {
    const line = cart.find(c => c.id === lineId);
    if (!line) return;
    const val = parseFloat(editingCartPriceVal);
    if (isNaN(val) || val < 0) {
      triggerToast('❌ سعر غير صالح');
      return;
    }

    setCart(prev => prev.map(c => {
      if (c.id === lineId) {
        const faceVal = parseFloat(c.cardValue || '0');
        const newCommission =
          c.type === 'recharge' && faceVal > 0
            ? roundTND((val - faceVal) * c.qty)
            : c.type === 'bill' && faceVal > 0
            ? Math.max(0, roundTND((val - faceVal) * c.qty))
            : c.commission;
        return {
          ...c,
          unitPrice: val,
          total: roundTND(val * c.qty),
          commission: newCommission
        };
      }
      return c;
    }));

    setEditingCartLineId(null);
    triggerToast(`⚡ تم تعديل سعر "${line.label}" للفاتورة إلى ${val.toFixed(3)} د.ت`);
  };

  const handleEditCartLinePrice = (lineId: string) => {
    const line = cart.find(c => c.id === lineId);
    if (!line) return;
    setEditingCartLineId(lineId);
    setEditingCartPriceVal(line.unitPrice.toString());
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
      const availableStock = item ? item.qty : 0;
      const otherCartQty = cart
        .filter(c => c.type === 'item' && c.itemId === line.itemId && c.id !== lineId)
        .reduce((s, c) => s + c.qty, 0);
      if (newQty + otherCartQty > availableStock) {
        return triggerToast(`❌ الستوك المتوفر فقط: ${Math.max(0, availableStock - otherCartQty)} قطعة`);
      }
    }

    if (line.type === 'recharge' && line.cardOperator && line.cardValue) {
      const normOp = normalizeOpName(line.cardOperator);
      const normVal = String(line.cardValue).trim();
      const cardEntry = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
      const availableStock = cardEntry ? cardEntry.qty : 0;
      const otherCartQty = cart
        .filter(c => c.type === 'recharge' && normalizeOpName(c.cardOperator) === normOp && String(c.cardValue).trim() === normVal && c.id !== lineId)
        .reduce((s, c) => s + c.qty, 0);
      if (newQty + otherCartQty > availableStock) {
        return triggerToast(`❌ مخزون بطاقات الشحن المتوفر فقط: ${Math.max(0, availableStock - otherCartQty)} كارت`);
      }
    }

    if (line.type === 'photo') {
      const otherCartQty = cart
        .filter(c => c.type === 'photo' && c.id !== lineId)
        .reduce((s, c) => s + c.qty, 0);
      if (newQty + otherCartQty > photoPaperStock) {
        return triggerToast(`❌ مخزون ورق الصور (الرولو) المتوفر فقط: ${Math.max(0, photoPaperStock - otherCartQty)} صورة`);
      }
    }

    setCart(prev => prev.map(c => {
      if (c.id === lineId) {
        const faceVal = parseFloat(c.cardValue || '0');
        const newCommission =
          c.type === 'recharge' && faceVal > 0
            ? roundTND((c.unitPrice - faceVal) * newQty)
            : c.type === 'bill' && faceVal > 0
            ? Math.max(0, roundTND((c.unitPrice - faceVal) * newQty))
            : c.commission;
        return {
          ...c,
          qty: newQty,
          total: roundTND(c.unitPrice * newQty),
          commission: newCommission
        };
      }
      return c;
    }));
  };

  const handleEditCartLineQtyExact = async (lineId: string) => {
    const line = cart.find(c => c.id === lineId);
    if (!line) return;
    const input = await openInputDialog({
      title: 'تعديل كمية الفاتورة',
      message: `تعديل الكمية لـ "${line.label}" في الفاتورة:`,
      inputType: 'number',
      defaultValue: line.qty.toString(),
      step: '1',
      min: '0'
    });
    if (input === null) return;
    const val = parseInt(input, 10);
    if (isNaN(val) || val <= 0) {
      if (val === 0) {
        handleRemoveFromCart(lineId);
      } else {
        triggerToast('❌ كمية غير صالحة');
      }
      return;
    }

    if (line.type === 'item' && line.itemId) {
      const item = items.find(i => i.id === line.itemId);
      const availableStock = item ? item.qty : 0;
      const otherCartQty = cart
        .filter(c => c.type === 'item' && c.itemId === line.itemId && c.id !== lineId)
        .reduce((s, c) => s + c.qty, 0);
      if (val + otherCartQty > availableStock) {
        return triggerToast(`❌ الستوك المتوفر فقط: ${Math.max(0, availableStock - otherCartQty)} قطعة`);
      }
    }

    if (line.type === 'recharge' && line.cardOperator && line.cardValue) {
      const normOp = normalizeOpName(line.cardOperator);
      const normVal = String(line.cardValue).trim();
      const cardEntry = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
      const availableStock = cardEntry ? cardEntry.qty : 0;
      const otherCartQty = cart
        .filter(c => c.type === 'recharge' && normalizeOpName(c.cardOperator) === normOp && String(c.cardValue).trim() === normVal && c.id !== lineId)
        .reduce((s, c) => s + c.qty, 0);
      if (val + otherCartQty > availableStock) {
        return triggerToast(`❌ مخزون بطاقات الشحن المتوفر فقط: ${Math.max(0, availableStock - otherCartQty)} كارت`);
      }
    }

    if (line.type === 'photo') {
      const otherCartQty = cart
        .filter(c => c.type === 'photo' && c.id !== lineId)
        .reduce((s, c) => s + c.qty, 0);
      if (val + otherCartQty > photoPaperStock) {
        return triggerToast(`❌ مخزون ورق الصور (الرولو) المتوفر فقط: ${Math.max(0, photoPaperStock - otherCartQty)} صورة`);
      }
    }

    setCart(prev => prev.map(c => {
      if (c.id === lineId) {
        const faceVal = parseFloat(c.cardValue || '0');
        const newCommission =
          c.type === 'recharge' && faceVal > 0
            ? roundTND((c.unitPrice - faceVal) * val)
            : c.type === 'bill' && faceVal > 0
            ? Math.max(0, roundTND((c.unitPrice - faceVal) * val))
            : c.commission;
        return {
          ...c,
          qty: val,
          total: roundTND(c.unitPrice * val),
          commission: newCommission
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
    const transactionId = 'sale_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const date = new Date().toISOString();
    const grandTotal = roundTND(cart.reduce((s, c) => s + c.total, 0));

    // 1. Plan and map all stock steps upfront with deterministic IDs
    const stockSteps: PendingStockStep[] = [];

    // Items
    const itemQtyMap: Record<string, { itemId: string; qty: number; label: string }> = {};
    for (const line of cart) {
      if (line.type === 'item' && line.itemId) {
        if (!itemQtyMap[line.itemId]) {
          itemQtyMap[line.itemId] = { itemId: line.itemId, qty: 0, label: line.label };
        }
        itemQtyMap[line.itemId].qty += line.qty;
      }
    }
    for (const group of Object.values(itemQtyMap)) {
      stockSteps.push({
        kind: 'item',
        targetId: group.itemId,
        qty: group.qty,
        label: group.label,
        opId: `${transactionId}_item_${group.itemId}`,
        revertOpId: `rollback_${transactionId}_item_${group.itemId}`,
        status: 'pending'
      });
    }

    // Cards
    const cardStockDepletions: Record<string, { entry: CardStockEntry; totalQty: number }> = {};
    for (const line of cart) {
      if (line.type === 'recharge' && line.cardOperator && line.cardValue) {
        const normOp = normalizeOpName(line.cardOperator);
        const normVal = String(line.cardValue).trim();
        let entry = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
        if (!entry) {
          entry = {
            id: `std_card_${normOp.replace(/\s+/g, '')}_${normVal}`,
            kind: 'recharge',
            operator: normOp,
            value: normVal,
            qty: 0
          };
        }
        if (!cardStockDepletions[entry.id]) {
          cardStockDepletions[entry.id] = { entry, totalQty: 0 };
        }
        cardStockDepletions[entry.id].totalQty += (line.qty || 1);
      }
    }
    for (const entryId of Object.keys(cardStockDepletions)) {
      const { entry, totalQty } = cardStockDepletions[entryId];
      stockSteps.push({
        kind: 'card',
        targetId: entry.id,
        qty: totalQty,
        label: entry.operator,
        opId: `${transactionId}_card_${entry.id}`,
        revertOpId: `rollback_${transactionId}_card_${entry.id}`,
        status: 'pending'
      });
    }

    // Forfait
    const forfaitDepletions: Record<string, number> = {};
    for (const line of cart) {
      if (line.type === 'forfait' && line.cardOperator) {
        const op = line.cardOperator;
        if (!forfaitDepletions[op]) {
          forfaitDepletions[op] = 0;
        }
        forfaitDepletions[op] = roundTND(forfaitDepletions[op] + line.unitPrice * (line.qty || 1));
      }
    }
    let safePayload: Record<string, number> | null = null;
    if (Object.keys(forfaitDepletions).length > 0) {
      const updatedBalance: ForfaitBalance = { ...forfaitBalance };
      safePayload = {};
      for (const op of Object.keys(forfaitDepletions)) {
        const amt = forfaitDepletions[op];
        if (op === 'Ooredoo 1005' || op === 'Ooredoo_1005') {
          const cur = updatedBalance.Ooredoo_1005 || 0;
          updatedBalance.Ooredoo_1005 = Math.max(0, roundTND(cur - amt));
          safePayload.Ooredoo_1005 = roundTND((safePayload.Ooredoo_1005 || 0) + amt);
        } else if (op === 'Ooredoo 1006' || op === 'Ooredoo_1006') {
          const cur = updatedBalance.Ooredoo_1006 || 0;
          updatedBalance.Ooredoo_1006 = Math.max(0, roundTND(cur - amt));
          safePayload.Ooredoo_1006 = roundTND((safePayload.Ooredoo_1006 || 0) + amt);
        } else if (op === 'Ooredoo') {
          let rem = amt;
          const cur1005 = updatedBalance.Ooredoo_1005 ?? 0;
          const cur1006 = updatedBalance.Ooredoo_1006 ?? 0;

          if (cur1005 >= rem) {
            updatedBalance.Ooredoo_1005 = roundTND(cur1005 - rem);
            safePayload.Ooredoo_1005 = roundTND((safePayload.Ooredoo_1005 || 0) + rem);
            rem = 0;
          } else {
            updatedBalance.Ooredoo_1005 = 0;
            safePayload.Ooredoo_1005 = roundTND((safePayload.Ooredoo_1005 || 0) + cur1005);
            rem = roundTND(rem - cur1005);
            updatedBalance.Ooredoo_1006 = Math.max(0, roundTND(cur1006 - rem));
            safePayload.Ooredoo_1006 = roundTND((safePayload.Ooredoo_1006 || 0) + rem);
          }
        } else {
          const curBal = updatedBalance[op] || 0;
          updatedBalance[op] = Math.max(0, roundTND(curBal - amt));
          safePayload[op] = roundTND((safePayload[op] || 0) + amt);
        }
      }
      stockSteps.push({
        kind: 'forfait',
        targetId: 'forfait',
        qty: roundTND(Object.values(forfaitDepletions).reduce((s, v) => s + v, 0)),
        opId: `${transactionId}_forfait`,
        revertOpId: `rollback_${transactionId}_forfait`,
        status: 'pending',
        payload: safePayload
      });
    }

    // Photo
    const totalPhotosInCart = cart.filter(c => c.type === 'photo').reduce((s, c) => s + (c.qty || 1), 0);
    if (totalPhotosInCart > 0) {
      stockSteps.push({
        kind: 'photo',
        targetId: 'photo',
        qty: totalPhotosInCart,
        opId: `${transactionId}_photo`,
        revertOpId: `rollback_${transactionId}_photo`,
        status: 'pending'
      });
    }

    // 2. Persist to durable storage BEFORE any stock decrements begin (BUG-4B-03)
    const durablePendingSale: PendingSale = {
      transactionId,
      date,
      cart: cart.map(c => ({
        id: c.id,
        type: c.type,
        itemId: c.itemId,
        label: c.label,
        qty: c.qty,
        unitPrice: c.unitPrice,
        unitBuy: c.unitBuy,
        total: c.total,
        commission: c.commission,
        cardOperator: c.cardOperator,
        cardValue: c.cardValue
      })),
      grandTotal,
      isDebt: invoiceIsDebt,
      customerName: invoiceCustomerName,
      customerPhone: invoiceCustomerPhone,
      initialPayment: invoiceInitialPayment,
      status: 'created',
      stockSteps,
      createdAt: Date.now()
    };

    const persistOk = savePendingSale(durablePendingSale);
    if (!persistOk) {
      setIsFinalizing(false);
      return triggerToast('❌ فشل حفظ قيد العملية في التخزين الدائم، تم إيقاف العملية لمنع تعليق المخزن');
    }

    if (!trySavePendingSale(durablePendingSale, 'stock_in_progress')) {
      setIsFinalizing(false);
      return triggerToast('❌ فشل حفظ الحالة (stock_in_progress) في التخزين الدائم');
    }

    try {
      // 3. Execute each stock step sequentially
      let anyStockPending = false;
      for (const step of durablePendingSale.stockSteps || []) {
        if (step.kind === 'item') {
          const localItem = items.find(i => i.id === step.targetId);
          const res = await safeDecrementItemQty(step.targetId, step.qty, localItem?.qty, 6, step.opId);
          if (res.success && !res.pending) {
            if (!trySavePendingSaleStep(durablePendingSale, step, 'completed')) {
              setIsFinalizing(false);
              return triggerToast('❌ فشل حفظ خطوة السلعة في التخزين الدائم');
            }
          } else if (!res.success) {
            step.status = 'failed';
            trySavePendingSale(durablePendingSale, 'rollback_in_progress');
            await executeRollback(durablePendingSale);
            setIsFinalizing(false);
            const err = res.reason === 'insufficient'
              ? `❌ السلعة "${step.label || 'المحددة'}" لم تعد كافية بالمخزن! المتبقي: ${res.available ?? 0}`
              : `❌ فشل تحديث المخزن للسلعة "${step.label || 'المحددة'}" بسبب تداخل بالشبكة`;
            return triggerToast(err);
          } else {
            // Pending in outbox: keep step pending and let recovery finish when online
            anyStockPending = true;
            break;
          }
        } else if (step.kind === 'card') {
          const entry = cardStock.find(c => c.id === step.targetId);
          const res = await safeDecrementCardQty(step.targetId, step.qty, entry?.qty, 6, step.opId);
          if (res.success && !res.pending) {
            if (!trySavePendingSaleStep(durablePendingSale, step, 'completed')) {
              setIsFinalizing(false);
              return triggerToast('❌ فشل حفظ خطوة السلعة في التخزين الدائم');
            }
          } else if (!res.success) {
            step.status = 'failed';
            trySavePendingSale(durablePendingSale, 'rollback_in_progress');
            await executeRollback(durablePendingSale);
            setIsFinalizing(false);
            const cardErr = res.reason === 'insufficient'
              ? `❌ مخزون بطاقات ${step.label || ''} غير كافي بالمخزن! المتوفر: ${res.available ?? 0}`
              : `❌ فشل تحديث مخزن بطاقات ${step.label || ''} بسبب تداخل بالشبكة`;
            return triggerToast(cardErr);
          } else {
            anyStockPending = true;
            break;
          }
        } else if (step.kind === 'forfait') {
          const resForfait = await safeDecrementForfait(step.payload || {}, 6, step.opId);
          if (resForfait.success && !resForfait.pending) {
            if (!trySavePendingSaleStep(durablePendingSale, step, 'completed')) {
              setIsFinalizing(false);
              return triggerToast('❌ فشل حفظ خطوة السلعة في التخزين الدائم');
            }
          } else if (!resForfait.success) {
            step.status = 'failed';
            trySavePendingSale(durablePendingSale, 'rollback_in_progress');
            await executeRollback(durablePendingSale);
            setIsFinalizing(false);
            const fErr = resForfait.reason === 'insufficient'
              ? '❌ رصيد الفورفاي غير كافي بالموزع!'
              : '❌ فشل تحديث رصيد الفورفاي بسبب تداخل بالشبكة';
            return triggerToast(fErr);
          } else {
            anyStockPending = true;
            break;
          }
        } else if (step.kind === 'photo') {
          const resPhoto = await safeDecrementPhotoStock(step.qty, photoPaperStock, 6, step.opId);
          if (resPhoto.success && !resPhoto.pending) {
            if (!trySavePendingSaleStep(durablePendingSale, step, 'completed')) {
              setIsFinalizing(false);
              return triggerToast('❌ فشل حفظ خطوة السلعة في التخزين الدائم');
            }
          } else if (!resPhoto.success) {
            step.status = 'failed';
            trySavePendingSale(durablePendingSale, 'rollback_in_progress');
            await executeRollback(durablePendingSale);
            setIsFinalizing(false);
            const pErr = resPhoto.reason === 'insufficient'
              ? `❌ مخزون ورق الصور (الرولو) غير كافي بالمخزن! المتوفر: ${resPhoto.available ?? 0} صورة`
              : `❌ فشل تحديث مخزون ورق الصور بسبب تداخل بالشبكة`;
            return triggerToast(pErr);
          } else {
            anyStockPending = true;
            break;
          }
        }
      }

      // Optimistically update quantities in local React state
      if (Object.keys(itemQtyMap).length > 0) {
        setItems(prevItems => prevItems.map(item => {
          const dec = itemQtyMap[item.id];
          return dec ? { ...item, qty: Math.max(0, item.qty - dec.qty) } : item;
        }));
      }
      if (Object.keys(cardStockDepletions).length > 0) {
        setCardStock(prevCards => prevCards.map(card => {
          const dec = cardStockDepletions[card.id];
          return dec ? { ...card, qty: Math.max(0, card.qty - dec.totalQty) } : card;
        }));
      }
      if (safePayload) {
        const updatedBalance: ForfaitBalance = { ...forfaitBalance };
        for (const k of Object.keys(safePayload)) {
          if (k === 'Ooredoo_1005') updatedBalance.Ooredoo_1005 = Math.max(0, roundTND((updatedBalance.Ooredoo_1005 || 0) - safePayload[k]));
          if (k === 'Ooredoo_1006') updatedBalance.Ooredoo_1006 = Math.max(0, roundTND((updatedBalance.Ooredoo_1006 || 0) - safePayload[k]));
          if (k !== 'Ooredoo_1005' && k !== 'Ooredoo_1006') updatedBalance[k] = Math.max(0, roundTND((updatedBalance[k] || 0) - safePayload[k]));
        }
        updatedBalance.Ooredoo = roundTND((updatedBalance.Ooredoo_1005 || 0) + (updatedBalance.Ooredoo_1006 || 0));
        setForfaitBalance(updatedBalance);
      }
      if (totalPhotosInCart > 0) {
        setPhotoPaperStock(prev => Math.max(0, prev - totalPhotosInCart));
      }

      if (anyStockPending) {
        if (showInvoice) {
          const initialPayVal = invoiceIsDebt ? roundTND(Math.min(grandTotal, Math.max(0, parseFloat(invoiceInitialPayment) || 0))) : 0;
          setLastInvoice({
            id: transactionId.toUpperCase(),
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
            customerPhone: invoiceCustomerPhone || undefined,
            downPayment: initialPayVal
          });
        }
        setCart([]);
        setInvoiceCustomerName('');
        setInvoiceCustomerPhone('');
        setInvoiceInitialPayment('');
        setInvoiceIsDebt(false);
        triggerToast('⏳ تم حفظ الفاتورة في قائمة الانتظار بسبب عدم توفر الشبكة، وستُرفع وتُسجّل تلقائياً');
        return;
      }

      // 4. Mark stock completed in durable storage before writing financial/sale records
      if (!trySavePendingSale(durablePendingSale, 'stock_completed')) {
        setIsFinalizing(false);
        return triggerToast('❌ فشل حفظ الحالة (stock_completed) في التخزين الدائم');
      }

      if (!trySavePendingSale(durablePendingSale, 'records_in_progress')) {
        setIsFinalizing(false);
        return triggerToast('❌ فشل حفظ الحالة (records_in_progress) في التخزين الدائم');
      }

      let recordsAllOk = true;

      if (invoiceIsDebt) {
        const initialPayVal = roundTND(Math.min(grandTotal, Math.max(0, parseFloat(invoiceInitialPayment) || 0)));
        const debtLines: DebtLine[] = cart.map(c => {
          let lineBuy = 0;
          if (c.type === 'item') {
            lineBuy = typeof c.unitBuy === 'number' ? c.unitBuy : (c.itemId ? (items.find(i => i.id === c.itemId)?.buy || 0) : 0);
          } else if (c.type === 'bill') {
            lineBuy = typeof c.unitBuy === 'number' ? c.unitBuy : roundTND(Math.max(0, c.unitPrice - (c.commission || 0)));
          }
          return {
            type: c.type,
            itemId: c.itemId || null,
            itemName: c.type === 'item' ? c.label : null,
            qty: c.qty,
            unitBuy: (c.type === 'item' || c.type === 'bill') ? lineBuy : undefined,
            unitPrice: c.unitPrice,
            cardOperator: c.cardOperator || null,
            cardValue: c.cardValue || null,
            total: c.total
          };
        });

        const newDebt: Debt = {
          id: `${transactionId}_debt`,
          customerName: invoiceCustomerName,
          customerPhone: invoiceCustomerPhone || undefined,
          note: cart.map(c => c.label).join(' + '),
          lines: debtLines,
          amount: grandTotal,
          paid: initialPayVal,
          date,
          status: (initialPayVal >= grandTotal - 0.001) ? 'paid' : 'open'
        };

        setDebts(prev => [newDebt, ...prev]);
        const resDebt = await putWithOutbox(`/debts/${newDebt.id}.json`, newDebt, newDebt.id);
        if (!resDebt.success || resDebt.pending) {
          recordsAllOk = false;
        }

        // Record upfront down payment into income/cash register if present
        if (initialPayVal > 0) {
          const totalDebtCost = debtLines.reduce((s, line) => {
            if (line.type === 'item' || line.type === 'bill') {
              return s + ((line.unitBuy || 0) * (line.qty || 1));
            }
            return s;
          }, 0);
          const profitRatio = grandTotal > 0 ? Math.max(0, (grandTotal - totalDebtCost) / grandTotal) : 1;
          const downPaymentCommission = roundTND(initialPayVal * profitRatio);

          const downPaymentIncome: OtherIncome = {
            id: `${transactionId}_downpay`,
            category: 'debt_payment',
            label: `دفعة أولى / تسبيق دين - ${invoiceCustomerName} (${cart.map(c => c.label).join(' + ')})`,
            amount: initialPayVal,
            commission: downPaymentCommission,
            date,
            debtId: newDebt.id
          };
          setOtherIncome(prev => [downPaymentIncome, ...prev]);
          const resDownpay = await putWithOutbox(`/otherIncome/${downPaymentIncome.id}.json`, downPaymentIncome, downPaymentIncome.id, newDebt.id);
          if (!resDownpay.success || resDownpay.pending) {
            recordsAllOk = false;
          }
        }

        const remainingDebt = Math.max(0, roundTND(grandTotal - initialPayVal));
        logAudit('sale', `فاتورة مبيعات بالدين للحريف ${invoiceCustomerName}: المجموع ${grandTotal} د.ت (تسبيق: ${initialPayVal} د.ت - المتبقي: ${remainingDebt} د.ت)`);
        triggerToast(`🧾 تم حفظ الدين على ${invoiceCustomerName} (تسبيق: ${initialPayVal.toFixed(3)} د.ت | متبقي: ${remainingDebt.toFixed(3)} د.ت)`);
        
        triggerTelegramDebtNotification(invoiceCustomerName, remainingDebt, `تسبيق: ${initialPayVal.toFixed(3)} د.ت | ${cart.map(c => c.label).join(' + ')}`, invoiceCustomerPhone || undefined);
      } else {
        const createdSales: Sale[] = [];
        const createdIncomes: OtherIncome[] = [];

        let lineIdx = 0;
        for (const line of cart) {
          lineIdx++;
          if (line.type === 'item') {
            const sale: Sale = {
              id: `${transactionId}_s_${lineIdx}`,
              itemId: line.itemId || null,
              itemName: line.label,
              qty: line.qty,
              unitPrice: line.unitPrice,
              unitBuy: line.unitBuy || 0,
              total: line.total,
              date
            };
            createdSales.push(sale);
            const resSale = await putWithOutbox(`/sales/${sale.id}.json`, sale, sale.id);
            if (!resSale.success || resSale.pending) {
              recordsAllOk = false;
            }
          } else {
            const income: OtherIncome = {
              id: `${transactionId}_inc_${lineIdx}`,
              category: line.type,
              label: line.label,
              amount: line.total,
              commission: line.commission || 0,
              date,
              cardOperator: line.cardOperator || null,
              cardValue: line.cardValue || null,
              qty: line.qty || null
            };
            createdIncomes.push(income);
            const resInc = await putWithOutbox(`/otherIncome/${income.id}.json`, income, income.id);
            if (!resInc.success || resInc.pending) {
              recordsAllOk = false;
            }
          }
        }

        if (createdSales.length > 0) setSales(prev => [...createdSales, ...prev]);
        if (createdIncomes.length > 0) setOtherIncome(prev => [...createdIncomes, ...prev]);

        logAudit('sale', `فاتورة بيع نقدية جديدة: ${grandTotal} د.ت`);
        triggerToast('✅ تم تسجيل المبيعات النقدية وتحديث الخزينة');
      }

      // 5. Operation conclusively completed: update status & remove durable pending sale
      if (recordsAllOk) {
        if (!trySavePendingSale(durablePendingSale, 'completed')) {
          setIsFinalizing(false);
          return triggerToast('❌ فشل حفظ الحالة (completed) في التخزين الدائم');
        }
        const removed = removePendingSale(transactionId);
        if (!removed) console.warn('Failed to verify deletion of pending sale', transactionId);
      } else {
        if (!trySavePendingSale(durablePendingSale, 'records_in_progress')) {
        setIsFinalizing(false);
        return triggerToast('❌ فشل حفظ الحالة (records_in_progress) في التخزين الدائم');
      }
        triggerToast('⚠️ تم إنقاص المخزن ولكن تعذر تسجيل بعض القيود المالية بالكامل. سيعاد تسجيلها تلقائياً');
      }

      if (showInvoice) {
        const initialPayVal = invoiceIsDebt ? roundTND(Math.min(grandTotal, Math.max(0, parseFloat(invoiceInitialPayment) || 0))) : 0;
        setLastInvoice({
          id: transactionId.toUpperCase(),
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
          customerPhone: invoiceCustomerPhone || undefined,
          downPayment: initialPayVal
        });
      } else {
        setLastInvoice(null);
      }

      triggerWhatsAppNotification(cart, grandTotal, invoiceIsDebt, invoiceCustomerName);
      triggerTelegramNotification(cart, grandTotal, invoiceIsDebt, invoiceCustomerName);

      setCart([]);
      setInvoiceCustomerName('');
      setInvoiceCustomerPhone('');
      setInvoiceInitialPayment('');
      setInvoiceIsDebt(false);
      loadAllData();
    } catch (err) {
      console.error('Error in handleFinalizeInvoice:', err);
      // BUG-4B-02: NEVER remove PendingSale if rollback fails or if stock completed
      if (durablePendingSale.status === 'stock_in_progress' || (durablePendingSale.status as string) === 'created') {
        trySavePendingSale(durablePendingSale, 'rollback_in_progress');
        await executeRollback(durablePendingSale);
      }
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
        const stockSteps: PendingStockStep[] = [];
        
        if (isSaleRecord) {
          const record = sales.find(s => s.id === id);
          if (record && record.itemId) {
            stockSteps.push({
              kind: 'item',
              targetId: record.itemId,
              qty: record.qty || 1,
              opId: `revert_sale_${id}`,
              revertOpId: '',
              status: 'pending'
            });
          }
        } else {
          const record = otherIncome.find(o => o.id === id);
          if (record) {
            if ((record.category === 'recharge' || record.category === 'card') && record.cardOperator && record.cardValue) {
              const normOp = normalizeOpName(record.cardOperator);
              const normVal = String(record.cardValue).trim();
              let card = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
              let cardId = card ? card.id : `std_card_${normOp.replace(/\s+/g, '')}_${normVal}`;
              stockSteps.push({
                kind: 'card',
                targetId: cardId,
                qty: record.qty || 1,
                opId: `revert_card_${id}`,
                revertOpId: '',
                status: 'pending'
              });
            }
            if (record.category === 'forfait' && record.cardOperator) {
              let op = record.cardOperator;
              if (op === 'Ooredoo 1005' || op === 'Ooredoo_1005') {
                op = 'Ooredoo_1005';
              } else if (op === 'Ooredoo 1006' || op === 'Ooredoo_1006') {
                op = 'Ooredoo_1006';
              } else if (op === 'Ooredoo') {
                op = 'Ooredoo_1005';
              }
              stockSteps.push({
                kind: 'forfait',
                targetId: op,
                qty: record.amount,
                opId: `revert_forfait_${id}`,
                revertOpId: '',
                status: 'pending'
              });
            }
            if (record.category === 'photo') {
              stockSteps.push({
                kind: 'photo',
                targetId: 'photo',
                qty: record.qty || 1,
                opId: `revert_photo_${id}`,
                revertOpId: '',
                status: 'pending'
              });
            }
            if (record.category === 'debt_payment' && record.debtId) {
              stockSteps.push({
                kind: 'debt_pay',
                targetId: record.debtId,
                qty: -record.amount,
                opId: `revert_pay_${id}`,
                revertOpId: '',
                status: 'pending'
              });
            }
          }
        }

        const pendingDel: PendingDeleteHistorySale = {
          id: `del_sale_${id}`,
          createdAt: Date.now(),
          saleId: id,
          isSaleRecord,
          stockSteps,
          status: 'created'
        };

        if (!savePendingDeleteHistorySale(pendingDel)) {
          triggerToast('❌ فشل حفظ قيد الحذف محلياً، تم إيقاف العملية');
          return;
        }

        // Optimistically update React state immediately
        if (isSaleRecord) {
          const record = sales.find(s => s.id === id);
          if (record && record.itemId) {
            setItems(prev => prev.map(item => item.id === record.itemId ? { ...item, qty: item.qty + (record.qty || 1) } : item));
          }
          setSales(prev => prev.filter(s => s.id !== id));
        } else {
          const record = otherIncome.find(o => o.id === id);
          if (record) {
            if ((record.category === 'recharge' || record.category === 'card') && record.cardOperator && record.cardValue) {
              const restoreQty = record.qty || 1;
              const normOp = normalizeOpName(record.cardOperator);
              const normVal = String(record.cardValue).trim();
              const card = cardStock.find(c => normalizeOpName(c.operator) === normOp && String(c.value).trim() === normVal);
              if (card) {
                setCardStock(prev => prev.map(c => c.id === card.id ? { ...c, qty: c.qty + restoreQty } : c));
              } else {
                const canonicalId = `std_card_${normOp.replace(/\s+/g, '')}_${normVal}`;
                const newCard: CardStockEntry = {
                  id: canonicalId,
                  kind: 'recharge',
                  operator: normOp,
                  value: normVal,
                  qty: restoreQty
                };
                // Optimistically create new card locally if missing
                setCardStock(prev => [...prev, newCard]);
              }
            }
            if (record.category === 'forfait' && record.cardOperator) {
              let op = record.cardOperator;
              if (op === 'Ooredoo 1005' || op === 'Ooredoo_1005') {
                op = 'Ooredoo_1005';
              } else if (op === 'Ooredoo 1006' || op === 'Ooredoo_1006') {
                op = 'Ooredoo_1006';
              } else if (op === 'Ooredoo') {
                op = 'Ooredoo_1005';
              }
              setForfaitBalance(prev => {
                const next = { ...prev };
                next[op] = roundTND((next[op] || 0) + record.amount);
                next.Ooredoo = roundTND((next.Ooredoo_1005 || 0) + (next.Ooredoo_1006 || 0));
                return next;
              });
            }
            if (record.category === 'photo') {
              setPhotoPaperStock(prev => prev + (record.qty || 1));
            }
            if (record.category === 'debt_payment' && record.debtId) {
              const targetDebt = debts.find(d => d.id === record.debtId);
              if (targetDebt) {
                const newPaid = Math.max(0, roundTND(targetDebt.paid - record.amount));
                const updatedDebt: Debt = {
                  ...targetDebt,
                  paid: newPaid,
                  status: (newPaid >= targetDebt.amount - 0.001) ? 'paid' : 'open'
                };
                setDebts(prev => prev.map(d => d.id === record.debtId ? updatedDebt : d));
              }
            }
          }
          setOtherIncome(prev => prev.filter(o => o.id !== id));
        }

        if (!trySavePendingDeleteHistorySale(pendingDel, 'stock_restore_in_progress')) return;

        let allStockCompleted = true;
        for (const step of pendingDel.stockSteps) {
          let res;
          if (step.kind === 'item') {
            res = await safeIncrementItemQty(step.targetId, step.qty, undefined, 6, step.opId);
          } else if (step.kind === 'card') {
            const cardId = step.targetId;
            const existingCard = cardStock.find(c => c.id === cardId);
            res = await safeIncrementCardQty(cardId, step.qty, undefined, 6, step.opId);
            if (!existingCard && res && res.success) {
              const parts = cardId.replace('std_card_', '').split('_');
              if (parts.length >= 2) {
                const rawOp = parts.slice(0, -1).join(' ');
                const val = parts[parts.length - 1];
                await patchWithOutbox(`/cardStock/${cardId}.json`, {
                  id: cardId,
                  kind: 'recharge',
                  operator: normalizeOpName(rawOp),
                  value: val
                });
              }
            }
          } else if (step.kind === 'forfait') {
            res = await safeIncrementForfait({ [step.targetId]: step.qty }, 6, step.opId);
          } else if (step.kind === 'photo') {
            res = await safeIncrementPhotoStock(step.qty, undefined, 6, step.opId);
          } else if (step.kind === 'debt_pay') {
            res = await safeIncrementDebtPaid(step.targetId, step.qty, 6, step.opId);
            if (res && res.success) {
              const debt = debts.find(d => d.id === step.targetId);
              if (debt) {
                const newPaid = Math.max(0, roundTND(debt.paid + step.qty));
                const newStatus = (newPaid >= debt.amount - 0.001) ? 'paid' : 'open';
                await patchWithOutbox(`/debts/${step.targetId}.json`, { status: newStatus });
              }
            }
          }

          if (res && res.success && !res.pending) {
            step.status = 'completed';
            savePendingDeleteHistorySale(pendingDel);
          } else {
            allStockCompleted = false;
          }
        }

        if (!allStockCompleted) {
          triggerToast('⏳ تم حفظ إلغاء العملية واسترجاع المخزون في قائمة الانتظار، سيُستكمل تلقائياً عند توفر الشبكة');
          return;
        }

        if (!trySavePendingDeleteHistorySale(pendingDel, 'stock_restore_completed')) return;
        if (!trySavePendingDeleteHistorySale(pendingDel, 'sale_delete_in_progress')) return;

        const path = isSaleRecord ? `/sales/${id}.json` : `/otherIncome/${id}.json`;
        const ok = await putWithOutbox(path, null);
        if (ok.success && !ok.pending) {
          if (trySavePendingDeleteHistorySale(pendingDel, 'completed')) {
            removePendingDeleteHistorySale(pendingDel.id);
          }
          triggerToast('✅ تم إلغاء وحذف المدخول بنجاح');
          logAudit('delete', `إلغاء مدخول ومعاملة`);
          loadAllData();
        } else {
          triggerToast('⏳ تم استرجاع المخزون وحفظ حذف المدخول في قائمة الانتظار للمزامنة');
        }
      }
    });
  };

  // ---- 7. General Admin resets / utilities ----
  const handleSaveStartingCash = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedVal = parseFloat(startingCashInput);
    if (isNaN(parsedVal) || parsedVal < 0) {
      return triggerToast('❌ الرجاء إدخال مبلغ صحيح غير سالب لكاش البداية');
    }
    if (!await promptAndVerifyPin('أدخل الرمز السري لتسجيل فلوس الكاسة الحالية:')) return;
    const inputVal = roundTND(parsedVal);

    const okReg = await putWithOutbox('/cashRegister.json', inputVal);
    if (okReg.success) {
      setCashRegister(inputVal);
      setStartingCashInput('');
      // Only set lastCashResetTimestamp if none exists yet, do NOT reset ongoing shift timestamp
      if (!lastCashResetTimestamp) {
        const newTimestamp = new Date().toISOString();
        await putWithOutbox('/lastCashResetTimestamp.json', newTimestamp);
        setLastCashResetTimestamp(newTimestamp);
      }
      triggerToast('✅ تم تحديث كاش البداية بنجاح');
      loadAllData();
    } else {
      triggerToast('❌ تعذر حفظ كاش البداية');
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

      await patchWithOutbox(`/items/${keep.id}.json`, { barcodes: mergedBarcodes });
      const qtyToAdd = totalQty - keep.qty;
      if (qtyToAdd > 0) {
        await safeIncrementItemQty(keep.id, qtyToAdd, keep.qty);
      }

      // Delete other duplicate instances
      for (let x = 1; x < group.length; x++) {
        await putWithOutbox(`/items/${group[x].id}.json`, null);
      }
    }

    triggerToast('🧹 تم تجميع ودمج السلع المكررة بنجاح!');
    loadAllData();
  };

  const handleResetIncomeHistory = async (days: number) => {
    const shiftStartMs = lastCashResetTimestamp ? new Date(lastCashResetTimestamp).getTime() : Date.now();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    // Only remove archived sales that are strictly older than the active shift start
    const salesToRemove = sales.filter(s => {
      const t = new Date(s.date).getTime();
      return t < shiftStartMs && t >= cutoff;
    });
    const otherToRemove = otherIncome.filter(o => {
      const t = new Date(o.date).getTime();
      return t < shiftStartMs && t >= cutoff;
    });

    if (salesToRemove.length === 0 && otherToRemove.length === 0) {
      return triggerToast('❌ لا توجد أي مبيعات أرشيفية سابقة للوردية الحالية في هذه الفترة المحددة');
    }

    if (!await promptAndVerifyPin(`⚠️ هل أنت متأكد من تنظيف السحابة ومسح ${salesToRemove.length} مبيعة قديمة و ${otherToRemove.length} مدخول أقدم من الوردية الحالية؟`)) return;

    // Generate and save/send PDF report before deleting records
    triggerToast('📊 جاري توليد تقرير PDF التصفير للأرشيف...');
    await generateResetReportPDF(salesToRemove, otherToRemove, days);

    if (salesToRemove.length > 0) {
      const salesPatch: Record<string, null> = {};
      salesToRemove.forEach(s => { salesPatch[s.id] = null; });
      await patchWithOutbox('/sales.json', salesPatch);
    }
    if (otherToRemove.length > 0) {
      const otherPatch: Record<string, null> = {};
      otherToRemove.forEach(o => { otherPatch[o.id] = null; });
      await patchWithOutbox('/otherIncome.json', otherPatch);
    }

    const removedSalesIds = new Set(salesToRemove.map(s => s.id));
    const removedOtherIds = new Set(otherToRemove.map(o => o.id));
    setSales(prev => prev.filter(s => !removedSalesIds.has(s.id)));
    setOtherIncome(prev => prev.filter(o => !removedOtherIds.has(o.id)));

    triggerToast('🧹 تم تنظيف المبيعات الأرشيفية القديمة وتوفير مساحة السحابة دون المساس بالوردية الحالية');
    loadAllData();
  };

  // Change security pin
  const handleChangePin = async () => {
    const current = await openInputDialog({
      title: 'تغيير رمز المدير',
      message: 'أدخل رمز المدير الحالي:',
      inputType: 'password',
      placeholder: 'الرمز الحالي...'
    });
    if (!current) return;

    const isCurrentOk = await verifyManagerPinViaAuth(current);
    const currentH = await sha256Hex(current);

    if (!isCurrentOk && currentH !== managerPin) {
      return triggerToast('❌ الرمز الحالي غير صحيح');
    }

    const next = await openInputDialog({
      title: 'رمز المدير الجديد',
      message: 'أدخل رمز المدير الجديد (4 أرقام أو أكثر):',
      inputType: 'password',
      placeholder: 'الرمز الجديد...'
    });
    if (!next || next.trim().length < 4) return triggerToast('❌ يجب أن يتكون الرمز من 4 أرقام على الأقل');

    const nextTrimmed = next.trim();
    
    // Try to update on Firebase Auth first
    const updateAuthSuccess = await updateManagerPinViaAuth(nextTrimmed);
    
    // Also save hash to RTDB /pin.json as backup/offline verification
    const nextH = await sha256Hex(nextTrimmed);
    let resOk = false;
    try {
      const res = await fetch(dbUrl('/pin.json'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextH)
      });
      resOk = res.ok;
    } catch (e) {
      resOk = false;
    }

    if (updateAuthSuccess || resOk) {
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
          const amtStr = await openInputDialog({
            title: 'زيادة كمية السلعة عبر الباركود',
            message: `السلعة "${match.name}" موجودة بالستوك بالباركود (${singleCode}). أدخل الكمية الإضافية لزيادتها:`,
            inputType: 'number',
            defaultValue: '1',
            step: '1',
            min: '1'
          });
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
        const ok = await patchWithOutbox(`/items/${match.id}.json`, { barcodes: updatedBarcodes });
        if (ok.success) {
          triggerToast(`✅ تم ربط الباركود الإضافي لـ "${match.name}"`);
          loadAllData();
        }
      }
    }
  };

  // ---- 9. Dashboard Financial Calculations ----
  const currentShiftSales = useMemo(() => {
    const resetTimeMs = lastCashResetTimestamp ? new Date(lastCashResetTimestamp).getTime() : 0;
    return sales.filter(s => new Date(s.date).getTime() >= resetTimeMs);
  }, [sales, lastCashResetTimestamp]);

  const currentShiftOtherIncome = useMemo(() => {
    const resetTimeMs = lastCashResetTimestamp ? new Date(lastCashResetTimestamp).getTime() : 0;
    return otherIncome.filter(o => new Date(o.date).getTime() >= resetTimeMs && o.destination !== 'manager');
  }, [otherIncome, lastCashResetTimestamp]);

  const currentShiftManagerDebtIncome = useMemo(() => {
    const resetTimeMs = lastCashResetTimestamp ? new Date(lastCashResetTimestamp).getTime() : 0;
    return otherIncome.filter(o => new Date(o.date).getTime() >= resetTimeMs && o.destination === 'manager');
  }, [otherIncome, lastCashResetTimestamp]);

  const currentShiftExpenses = useMemo(() => {
    const resetTimeMs = lastCashResetTimestamp ? new Date(lastCashResetTimestamp).getTime() : 0;
    return expenses.filter(e => new Date(e.date).getTime() >= resetTimeMs);
  }, [expenses, lastCashResetTimestamp]);

  const isResettingShiftRef = useRef<boolean>(false);

  const handlePerformShiftReset = async (data: {
    sellerName: string;
    salesTotal: number;
    otherIncomeTotal: number;
    expensesTotal: number;
    expectedCash: number;
    actualCash: number;
    cashWithdrawn: number;
    newStartingCash: number;
    notes: string;
  }) => {
    if (isResettingShiftRef.current) return;
    isResettingShiftRef.current = true;

    try {
      // 1. Generate & download PDF report for the current shift (and send to Telegram)
      triggerToast('📊 جاري توليد تقرير PDF الوردية...');
      await generateShiftReportPDF(
        {
          sellerName: data.sellerName,
          startingCash: cashRegister,
          salesTotal: data.salesTotal,
          otherIncomeTotal: data.otherIncomeTotal,
          expensesTotal: data.expensesTotal,
          expectedCash: data.expectedCash,
          actualCash: data.actualCash,
          cashWithdrawn: data.cashWithdrawn,
          newStartingCash: data.newStartingCash,
          notes: data.notes
        },
        currentShiftSales,
        currentShiftOtherIncome
      );

      // 2. Clear outbox queue & wipe sales, other income, and expenses from Firebase
      triggerToast('🧹 جاري تفريغ سجلات الوردية من السحابة...');
      clearOutboxForPaths(['/sales', '/otherIncome', '/expenses']);

      // Batch delete from Firebase using fast patch / put operations
      if (sales.length > 0) {
        const salesPatch: Record<string, null> = {};
        sales.forEach(s => { salesPatch[s.id] = null; });
        await patchWithOutbox('/sales.json', salesPatch);
      } else {
        await putWithOutbox('/sales.json', null);
      }

      if (otherIncome.length > 0) {
        const incomePatch: Record<string, null> = {};
        otherIncome.forEach(o => { incomePatch[o.id] = null; });
        await patchWithOutbox('/otherIncome.json', incomePatch);
      } else {
        await putWithOutbox('/otherIncome.json', null);
      }

      if (expenses.length > 0) {
        const expensePatch: Record<string, null> = {};
        expenses.forEach(e => { expensePatch[e.id] = null; });
        await patchWithOutbox('/expenses.json', expensePatch);
      } else {
        await putWithOutbox('/expenses.json', null);
      }

      // Clear local state immediately so UI updates cleanly
      setSales([]);
      setOtherIncome([]);
      setExpenses([]);

      // 3. Clear any legacy shiftLogs node & save new starting cash + reset timestamp
      const resetTimestamp = new Date().toISOString();
      clearOutboxForPaths(['/shiftLogs']);
      await putWithOutbox('/shiftLogs.json', null);
      const okReg = await putWithOutbox('/cashRegister.json', data.newStartingCash);
      const okTime = await putWithOutbox('/lastCashResetTimestamp.json', resetTimestamp);

      if (okReg.success || okTime.success) {
        setCashRegister(data.newStartingCash);
        setLastCashResetTimestamp(resetTimestamp);
        setShowShiftHandoverModal(false);
        triggerToast('✅ تم تصفير الكاسة، حفظ تقرير PDF، ومسح السجلات من الفايربيز بنجاح');
        logAudit('reset', `تصفير الوردية وتفريغ السحابة: ${data.sellerName} (كاش مفرغ: ${data.cashWithdrawn.toFixed(3)} د.ت)`);
        loadAllData();
      } else {
        triggerToast('❌ حدث خطأ أثناء تصفير الكاسة وتسليم الوردية');
      }
    } finally {
      isResettingShiftRef.current = false;
    }
  };

  const filteredDashboardData = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOf7Days = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const startOf30Days = startOfToday - 29 * 24 * 60 * 60 * 1000;

    const resetTimeMs = lastCashResetTimestamp ? new Date(lastCashResetTimestamp).getTime() : 0;

    const inRange = (dateStr: string) => {
      if (!dateStr) return false;
      const t = new Date(dateStr).getTime();
      if (dashboardDateFilter === 'shift') {
        return t >= resetTimeMs;
      }
      if (dashboardDateFilter === 'today') return t >= startOfToday;
      if (dashboardDateFilter === 'yesterday') return t >= startOfYesterday && t < startOfToday;
      if (dashboardDateFilter === '7days') return t >= startOf7Days;
      if (dashboardDateFilter === '30days') return t >= startOf30Days;
      return true; // 'all'
    };

    const dSales = sales.filter(s => inRange(s.date));
    const dOtherAll = otherIncome.filter(o => inRange(o.date));
    const dOther = dOtherAll.filter(o => o.destination !== 'manager'); // Only drawer income
    const dManagerDebts = dOtherAll.filter(o => o.destination === 'manager'); // Manager collected debts
    const dExpenses = expenses.filter(e => inRange(e.date));

    const totalSalesVal = dSales.reduce((s, c) => s + c.total, 0);
    const totalForfaitSalesVal = dOther.filter(o => o.category === 'forfait').reduce((s, c) => s + c.amount, 0);
    const totalRechargeSalesVal = dOther.filter(o => o.category === 'recharge').reduce((s, c) => s + c.amount, 0);
    const totalPhotoSalesVal = dOther.filter(o => o.category === 'photo').reduce((s, c) => s + c.amount, 0);
    const totalServiceSalesVal = dOther.filter(o => o.category === 'service').reduce((s, c) => s + c.amount, 0);
    const totalBillSalesVal = dOther.filter(o => o.category === 'bill').reduce((s, c) => s + c.amount, 0);
    const totalDebtPaymentSalesVal = dOther.filter(o => o.category === 'debt_payment').reduce((s, c) => s + c.amount, 0);
    const totalManagerDebtPaymentVal = dManagerDebts.reduce((s, c) => s + c.amount, 0);
    
    const totalServicesAndOthersVal = dOther.filter(o => o.category !== 'forfait' && o.category !== 'recharge').reduce((s, c) => s + c.amount, 0);
    const totalOtherVal = dOther.reduce((s, c) => s + c.amount, 0);
    const totalExpensesVal = dExpenses.reduce((s, c) => s + c.amount, 0);

    // Profit calculations for selected period (includes commissions from all categories and all destinations)
    const totalBuyCostOfSalesVal = dSales.reduce((s, c) => s + ((c.unitBuy || 0) * c.qty), 0);
    const totalItemProfitsVal = totalSalesVal - totalBuyCostOfSalesVal;
    const totalOtherProfitsVal = dOtherAll.reduce((s, c) => s + (c.commission || 0), 0);
    const netProfitVal = totalItemProfitsVal + totalOtherProfitsVal - totalExpensesVal;

    const totalCashInflow = totalSalesVal + totalOtherVal;
    
    // Expected Cash in register calculation:
    let expectedCashInHandVal = 0;

    if (dashboardDateFilter === 'shift' || dashboardDateFilter === 'today' || dashboardDateFilter === 'all') {
      expectedCashInHandVal = cashRegister + totalCashInflow - totalExpensesVal;
    } else {
      expectedCashInHandVal = totalCashInflow - totalExpensesVal;
    }

    return {
      dSales,
      dOther,
      dManagerDebts,
      dExpenses,
      totalSales: totalSalesVal,
      totalForfaitSales: totalForfaitSalesVal,
      totalRechargeSales: totalRechargeSalesVal,
      totalPhotoSales: totalPhotoSalesVal,
      totalServiceSales: totalServiceSalesVal,
      totalBillSales: totalBillSalesVal,
      totalDebtPaymentSales: totalDebtPaymentSalesVal,
      totalManagerDebtPayment: totalManagerDebtPaymentVal,
      totalServicesAndOthers: totalServicesAndOthersVal,
      totalOther: totalOtherVal,
      totalExpenses: totalExpensesVal,
      totalCashInflow,
      totalBuyCostOfSales: totalBuyCostOfSalesVal,
      netProfit: netProfitVal,
      expectedCashInHand: expectedCashInHandVal
    };
  }, [sales, otherIncome, expenses, cashRegister, dashboardDateFilter, lastCashResetTimestamp]);

  const {
    dOther,
    totalSales,
    totalForfaitSales,
    totalRechargeSales,
    totalPhotoSales,
    totalServiceSales,
    totalBillSales,
    totalDebtPaymentSales,
    totalManagerDebtPayment,
    totalServicesAndOthers,
    totalOther,
    totalExpenses,
    totalCashInflow,
    totalBuyCostOfSales,
    netProfit,
    expectedCashInHand
  } = filteredDashboardData;

  const totalOwed = useMemo(
    () => debts.filter(d => d.status === 'open').reduce((s, d) => s + Math.max(0, roundTND((d.amount || 0) - (d.paid || 0))), 0),
    [debts]
  );

  // Smart Customer Grouping and Debt Calculations
  const groupedCustomerDebts = useMemo(() => {
    return groupDebtsByCustomer(debts);
  }, [debts]);

  const deferredInvoiceCustomerName = useDeferredValue(invoiceCustomerName);
  const deferredInvoiceCustomerPhone = useDeferredValue(invoiceCustomerPhone);

  // Real-time suggestions for POS cart credit/debt input (reuses groupedCustomerDebts)
  const invoiceCustomerSuggestions = useMemo(() => {
    return findCustomerSuggestionsFromGroups(
      deferredInvoiceCustomerName,
      deferredInvoiceCustomerPhone,
      groupedCustomerDebts,
      45
    );
  }, [deferredInvoiceCustomerName, deferredInvoiceCustomerPhone, groupedCustomerDebts]);

  const topInvoiceCustomerMatch = useMemo(() => {
    if (!deferredInvoiceCustomerName || deferredInvoiceCustomerName.trim().length < 2) return null;
    const top = invoiceCustomerSuggestions[0];
    if (!top || top.score < 85) return null;
    if (top.canonicalName.trim().toLowerCase() === deferredInvoiceCustomerName.trim().toLowerCase()) {
      return null;
    }
    return top;
  }, [deferredInvoiceCustomerName, invoiceCustomerSuggestions]);

  // Stable handlers for DebtsTab so unrelated App re-renders don't trigger DebtsTab re-renders
  const debtHandlersRef = useRef({
    handleAddManualDebt,
    handleEditCustomer,
    handlePayCustomerGroup,
    handlePayDebt,
    handleDeleteDebt
  });
  debtHandlersRef.current = {
    handleAddManualDebt,
    handleEditCustomer,
    handlePayCustomerGroup,
    handlePayDebt,
    handleDeleteDebt
  };
  const stableOnAddManualDebt = useCallback(
    (data: { name: string; phone: string; amount: string; note: string }) => debtHandlersRef.current.handleAddManualDebt(data),
    []
  );
  const stableOnEditCustomer = useCallback(
    (group: CustomerDebtGroup) => debtHandlersRef.current.handleEditCustomer(group),
    []
  );
  const stableOnPayCustomerGroup = useCallback(
    (group: CustomerDebtGroup, isFullPayment: boolean) => debtHandlersRef.current.handlePayCustomerGroup(group, isFullPayment),
    []
  );
  const stableOnPayDebt = useCallback(
    (debtId: string, fullPayment: boolean) => debtHandlersRef.current.handlePayDebt(debtId, fullPayment),
    []
  );
  const stableOnDeleteDebt = useCallback(
    (id: string) => debtHandlersRef.current.handleDeleteDebt(id),
    []
  );

  // Render variables
  const paidDebts = useMemo(
    () =>
      debts
        .filter(d => d.status === 'paid')
        .sort((a, b) => (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0))
        .slice(0, 8),
    [debts]
  );
  const lowStockItems = useMemo(() => items.filter(i => i.qty <= 3), [items]);

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
    const q = normalizeArabic(stockSearch);
    const matchesSearch = !stockSearch || normalizeArabic(i.name).includes(q)
      || (i.barcodes && i.barcodes.some(b => normalizeArabic(b).includes(q)))
      || (i.barcode ? normalizeArabic(i.barcode).includes(q) : false);
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
      icon: o.category === 'recharge' ? '📶' : o.category === 'forfait' ? '🌐' : o.category === 'photo' ? '🪪' : o.category === 'bill' ? '🧾' : o.category === 'debt_payment' ? '💳' : '🔧'
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
          <div className="flex flex-wrap items-center gap-3">
            {/* Theme Mode Selector (Device Auto / Dark / Light) */}
            <div className="flex items-center bg-stone-800/90 border border-stone-700/80 rounded-xl p-0.5 shadow-inner">
              <button
                type="button"
                onClick={() => {
                  setThemeMode('system');
                  triggerToast('💻 تم ضبط المظهر تلقائياً حسب إعدادات جهازك');
                }}
                className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer select-none ${
                  themeMode === 'system' 
                    ? 'bg-red-700 text-white shadow-xs' 
                    : 'text-stone-400 hover:text-stone-200'
                }`}
                title="تلقائي: يتبع الوضع الداكن أو الفاتح لنظام جهازك"
              >
                <Laptop size={13} />
                <span className="text-[10px] hidden sm:inline">حسب الجهاز</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setThemeMode('dark');
                  triggerToast('🌙 تم تفعيل الوضع الداكن (الليلي)');
                }}
                className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer select-none ${
                  themeMode === 'dark' 
                    ? 'bg-red-700 text-white shadow-xs' 
                    : 'text-stone-400 hover:text-stone-200'
                }`}
                title="الوضع الداكن دائماً"
              >
                <Moon size={13} />
                <span className="text-[10px] hidden sm:inline">داكن</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setThemeMode('light');
                  triggerToast('☀️ تم تفعيل الوضع الفاتح (النهاري)');
                }}
                className={`px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1 transition-all cursor-pointer select-none ${
                  themeMode === 'light' 
                    ? 'bg-red-700 text-white shadow-xs' 
                    : 'text-stone-400 hover:text-stone-200'
                }`}
                title="الوضع الفاتح دائماً"
              >
                <Sun size={13} />
                <span className="text-[10px] hidden sm:inline">فاتح</span>
              </button>
            </div>

            <div className="flex flex-col items-center sm:items-end gap-1.5">
              <span className={`text-[10px] px-3 py-1 rounded-full font-extrabold flex items-center gap-1.5 border transition-all ${
                connectionStatus === 'connected' 
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 shadow-xs' 
                  : connectionStatus === 'checking'
                  ? 'bg-amber-950/80 text-amber-300 border-amber-500/50 animate-pulse'
                  : 'bg-rose-950/80 text-rose-300 border-rose-500/50'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'connected' 
                    ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' 
                    : connectionStatus === 'checking'
                    ? 'bg-amber-400 animate-ping'
                    : 'bg-rose-500'
                }`} />
                {connectionStatus === 'connected' 
                  ? (outboxCount > 0 ? `مزامنة نشطة 🟢 (${outboxCount} معلق)` : 'مزامنة نشطة 🟢') 
                  : connectionStatus === 'checking'
                  ? 'جاري المزامنة...'
                  : (outboxCount > 0 ? `أوفلاين 🔴 (${outboxCount} معلق)` : 'غير متصل (أوفلاين) 🔴')
                }
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

      {/* Offline Pending Outbox Warning Banner */}
      {outboxCount > 0 && (() => {
        const outboxList = loadOutbox();
        const failedCount = outboxList.filter(e => !!e.error).length;
        const pendingCount = outboxCount - failedCount;
        return (
          <div className="bg-rose-600 text-white px-4 py-3 shadow-lg flex flex-wrap items-center justify-between gap-3 z-40 text-xs font-bold border-b-2 border-rose-800">
            <div className="flex items-center gap-2.5 max-w-3xl">
              <span className="text-xl shrink-0">{failedCount > 0 ? '🚨' : '⚠️'}</span>
              <div>
                <span className="font-black text-sm block">
                  {failedCount > 0 
                    ? `تنبيه: يوجد ${failedCount} عملية فشلت بشكل دائم بسبب نقص في المخزون أو تعارض!`
                    : `تنبيه هام: يوجد ${pendingCount} عملية معلقة لم تُرسل للسحابة من هذا الجهاز!`
                  }
                </span>
                <span className="text-[11px] opacity-90 font-medium block mt-0.5">
                  {failedCount > 0
                    ? 'تم تسجيل المبيعات لكن لم يتم خصم المخزون. يرجى مراجعة المخزن.'
                    : 'هذه العمليات محلياً فقط. لا تغلق المتصفح قبل إرسالها لتفادي فقدان البيانات.'
                  }
                </span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {failedCount > 0 && (
                <button
                  onClick={() => {
                    const list = loadOutbox();
                    saveOutboxList(list.filter(e => !e.error));
                    triggerToast('🗑️ تم مسح الإشعارات الخاصة بالعمليات الفاشلة');
                  }}
                  className="bg-rose-800 text-white hover:bg-rose-900 px-3 py-2 rounded-xl text-xs font-bold shadow-md cursor-pointer transition-all"
                >
                  مسح تنبيه الفشل
                </button>
              )}
              {pendingCount > 0 && (
                <button
                  onClick={handleManualFlushOutbox}
                  className="bg-white text-rose-950 hover:bg-rose-100 px-4 py-2 rounded-xl text-xs font-black shadow-md cursor-pointer transition-all flex items-center gap-1.5"
                >
                  <RefreshCw size={14} className="animate-spin-slow" />
                  <span>إرسال المعلق ({pendingCount})</span>
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Main Tab Navigation */}
      {currentRole && (
        <nav className="bg-white/90 backdrop-blur-md border-b border-stone-200 sticky top-0 z-30 shadow-sm px-4 py-2.5">
          <div className="max-w-4xl mx-auto flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
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
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-200/80 pb-3">
                    <div>
                      <h3 className="font-extrabold text-stone-800 text-base flex items-center gap-2">
                        💵 رصيد صندوق الكاسة الأساسي للوردية
                      </h3>
                      <p className="text-stone-500 text-[11px] mt-0.5">
                        {lastCashResetTimestamp ? `آخر تصفير للوردية: ${new Date(lastCashResetTimestamp).toLocaleString('ar-TN')}` : 'بدء حسابات الوردية الحالية'}
                      </p>
                    </div>
                    <button 
                      type="button"
                      onClick={() => setShowShiftHandoverModal(true)}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold px-4 py-2.5 rounded-xl text-xs cursor-pointer shadow-md transition-all flex items-center justify-center gap-1.5"
                    >
                      <span>🔄 تصفير الكاسة وتسليم الوردية</span>
                    </button>
                  </div>
                  
                  <form onSubmit={handleSaveStartingCash} className="flex gap-2 mt-3">
                    <input
                      id="starting-cash-inp"
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="0.000"
                      value={startingCashInput}
                      onChange={e => setStartingCashInput(e.target.value)}
                      className="flex-1 bg-white border border-stone-200 px-3 py-2 rounded-xl text-stone-800 font-mono text-sm"
                    />
                    <button type="submit" className="bg-stone-800 hover:bg-stone-900 text-white font-bold px-4 rounded-xl text-xs cursor-pointer">
                      تعديل كاش البداية
                    </button>
                  </form>
                  
                  <div className="mt-3 flex justify-between items-center bg-white/80 border border-amber-200 rounded-xl p-3">
                    <span className="text-stone-600 text-xs font-bold">كاش البداية المسجل للوردية الحالية:</span>
                    <span className="font-mono font-bold text-red-800 text-lg">{cashRegister.toFixed(3)} د.ت</span>
                  </div>
                </div>

                {/* Active Shift Header Banner */}
                <div className="bg-white rounded-2xl border border-stone-200 p-3 shadow-xs flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-extrabold text-stone-800">
                    <span className="p-1.5 bg-red-100 text-red-700 rounded-xl">☀️</span>
                    <span>حسابات الوردية الحالية المفتوحة (منذ آخر تصفير للكاسة)</span>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-xl text-xs font-black">
                    وردية نشطة 🟢
                  </span>
                </div>

                {/* Dashboard Stats Panel */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-emerald-50/80 border border-emerald-200 p-4 rounded-2xl text-center shadow-xs">
                    <span className="text-xs font-bold text-emerald-800">🛍️ مبيعات السلع والمنتجات</span>
                    <div className="font-mono text-xl font-black text-emerald-700 mt-1">{totalSales.toFixed(3)} د.ت</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowForfaitBreakdownModal(true)}
                    className="bg-blue-50/80 border border-blue-200 hover:border-blue-400 p-4 rounded-2xl text-center shadow-xs cursor-pointer transition-all hover:bg-blue-100/90 hover:scale-[1.02] group relative flex flex-col justify-between"
                    title="انقر لعرض تفاصيل مبيعات كل مشغل"
                  >
                    <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-blue-900">
                      <span>🌐 إجمالي مبيعات الفورفي</span>
                      <span className="text-[9px] bg-blue-200/90 text-blue-950 px-1.5 py-0.5 rounded-md font-extrabold group-hover:bg-blue-600 group-hover:text-white transition-colors">
                        تفاصيل 🔍
                      </span>
                    </div>
                    <div className="font-mono text-xl font-black text-blue-700 my-0.5">{totalForfaitSales.toFixed(3)} د.ت</div>
                    <div className="text-[10px] text-blue-600 font-bold underline underline-offset-2 opacity-90 group-hover:opacity-100">
                      انقر لرؤية المبيعات حسب المشغل
                    </div>
                  </button>
                  <div className="bg-amber-50/80 border border-amber-200 p-4 rounded-2xl text-center shadow-xs">
                    <span className="text-xs font-bold text-amber-800">📶 إجمالي بطاقات الشحن</span>
                    <div className="font-mono text-xl font-black text-amber-700 mt-1">{totalRechargeSales.toFixed(3)} د.ت</div>
                  </div>
                  <div className="bg-purple-50/80 border border-purple-200 p-4 rounded-2xl text-center shadow-xs flex flex-col justify-center">
                    <span className="text-xs font-bold text-purple-800">🛠️ بقية الخدمات والعمليات</span>
                    <div className="font-mono tabular-nums text-xl font-black text-purple-700 mt-1">{totalServicesAndOthers.toFixed(3)} د.ت</div>
                    {totalBillSales > 0 && (
                      <div className="text-[10px] text-purple-700/80 font-bold mt-1 font-mono tabular-nums">
                        منها فواتير izi الزيتونة: {totalBillSales.toFixed(3)} د.ت
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-stone-900 text-stone-100 p-4 rounded-2xl border border-stone-800 shadow-md flex flex-col justify-between">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-amber-400 font-bold">
                        💰 الكاش المتوقع بالدرج (الوردية الحالية)
                      </span>
                      <span className="text-[10px] bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded-md font-bold">
                        مطابقة الكاسة
                      </span>
                    </div>
                    <div className="font-mono text-2xl font-black text-amber-400 my-1 text-center">{expectedCashInHand.toFixed(3)} د.ت</div>
                    <div className="text-[10px] text-stone-300 border-t border-stone-800 pt-1.5 mt-1 font-mono text-center dir-ltr">
                      (بداية الوردية: {cashRegister.toFixed(3)} + مداخيل: {totalCashInflow.toFixed(3)} - مصاريف: {totalExpenses.toFixed(3)})
                    </div>
                  </div>
                  <div className="bg-rose-50/80 border border-rose-200 p-4 rounded-2xl text-center flex flex-col justify-between">
                    <span className="text-xs text-rose-800 font-bold">💸 المصاريف المسجلة</span>
                    <div className="font-mono text-2xl font-black text-rose-700 mt-1">{totalExpenses.toFixed(3)} د.ت</div>
                    <div className="text-[10px] text-rose-600 font-medium border-t border-rose-200/60 pt-1 mt-1">
                      عدد المصاريف: {filteredDashboardData.dExpenses.length} عملية
                    </div>
                  </div>
                  <div className="bg-orange-50/80 border border-orange-200 p-4 rounded-2xl text-center flex flex-col justify-between">
                    <span className="text-xs text-orange-800 font-bold">📑 إجمالي الديون القائمة</span>
                    <div className="font-mono text-2xl font-black text-orange-700 mt-1">{totalOwed.toFixed(3)} د.ت</div>
                    <div className="text-[10px] text-orange-600 font-medium border-t border-orange-200/60 pt-1 mt-1">
                      الديون غير الخالصة لجميع الحرفاء
                    </div>
                  </div>
                </div>

                {totalManagerDebtPayment > 0 && (
                  <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/60 p-3 rounded-2xl flex items-center justify-between px-4 text-xs shadow-xs animate-fade-in">
                    <div className="flex items-center gap-2 text-purple-950 dark:text-purple-200">
                      <span className="text-base">💼</span>
                      <div>
                        <span className="font-extrabold">سداد ديون استلمها المدير مباشرة (خارج الكاسة):</span>
                        <span className="text-[10px] text-purple-700 dark:text-purple-400 block">تم استبعادها آلياً من كاش الدرج والمبيعات</span>
                      </div>
                    </div>
                    <span className="font-mono text-sm font-black text-purple-800 dark:text-purple-300">
                      {totalManagerDebtPayment.toFixed(3)} د.ت
                    </span>
                  </div>
                )}

                {/* Quick inventory totals */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white p-3.5 rounded-2xl border border-stone-200 flex items-center justify-between px-5">
                    <span className="text-xs text-stone-500 font-bold">📦 أنواع السلع في الستوك:</span>
                    <span className="font-mono text-base font-black text-stone-800">{items.length} نوع</span>
                  </div>
                  <div className="bg-white p-3.5 rounded-2xl border border-stone-200 flex items-center justify-between px-5">
                    <span className="text-xs text-stone-500 font-bold">🧩 مجموع القطع الإجمالي:</span>
                    <span className="font-mono text-base font-black text-stone-800">{items.reduce((s, i) => s + i.qty, 0)} قطعة</span>
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
                      expenses.slice(0, expensesLimit).map((e) => (
                        <div key={e.id} className="flex justify-between items-center text-xs p-2.5 bg-stone-50 rounded-xl border border-stone-100">
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
                          <label className="block text-[11px] text-stone-500 mb-1">الباركود والصورة (معاً)</label>
                          <input 
                            type="file" 
                            ref={itemDirectFileInputRef} 
                            accept="image/*" 
                            className="hidden" 
                            onChange={handleDirectItemPhotoUpload} 
                          />
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
                              className="bg-stone-800 hover:bg-stone-900 text-white p-2.5 rounded-xl cursor-pointer transition-colors"
                              title="مسح باركود بالكاميرا"
                            >
                              <Camera size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => itemDirectFileInputRef.current?.click()}
                              className="bg-stone-700 hover:bg-stone-800 text-white p-2.5 rounded-xl cursor-pointer text-xs flex items-center gap-1 shrink-0 transition-colors"
                              title="التقاط أو رفع صورة مباشرة"
                            >
                              <Camera size={14} className="text-amber-300" />
                              <span className="hidden sm:inline font-bold">صورة</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setVisualRecognitionMode('stock');
                                setTargetItemToCapturePhoto(null);
                                setShowVisualRecognitionModal(true);
                              }}
                              className="bg-amber-600 hover:bg-amber-700 text-white p-2.5 rounded-xl cursor-pointer font-bold text-xs flex items-center gap-1 shrink-0 transition-colors"
                              title="التعرف الذكي والبحث بالذكاء الاصطناعي"
                            >
                              <Sparkles size={14} />
                              <span className="hidden sm:inline">تحليل</span>
                            </button>
                          </div>
                          {newItem.imageUrl && (
                            <div className="mt-2 flex items-center justify-between gap-2 bg-amber-50/80 p-2 rounded-xl border border-amber-200 text-xs text-amber-900 font-bold shadow-2xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <img 
                                  src={newItem.imageUrl} 
                                  alt="صورة السلعة" 
                                  className="w-8 h-8 rounded-lg object-cover border border-amber-300 shadow-2xs shrink-0" 
                                />
                                <span className="truncate text-[11px]">✨ تم إرفاق صورة السلعة بنجاح</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => itemDirectFileInputRef.current?.click()}
                                  className="text-[10px] bg-amber-200/80 hover:bg-amber-300 text-amber-900 px-2 py-1 rounded-lg transition-colors font-extrabold cursor-pointer"
                                >
                                  تغيير
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setNewItem(prev => ({ ...prev, imageUrl: '' }))}
                                  className="text-[10px] bg-rose-100 hover:bg-rose-200 text-rose-800 px-2 py-1 rounded-lg transition-colors font-extrabold cursor-pointer"
                                >
                                  إزالة
                                </button>
                              </div>
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
                        {cardStock.map((c) => (
                          <div key={c.id} className="flex justify-between items-center text-xs p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                            <span className="font-bold text-stone-800">📶 {c.operator} — {c.value} د.ت</span>
                            <div className="flex items-center gap-2">
                              {currentRole === 'manager' ? (
                                <div className="flex items-center gap-1.5">
                                  <button 
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleAdjustCardQty(c.id, -1); }}
                                    className="w-6 h-6 rounded-lg bg-stone-200 border border-stone-300 text-stone-800 hover:bg-stone-300 active:bg-stone-400 active:scale-85 flex items-center justify-center font-black font-mono text-xs cursor-pointer select-none transition-all duration-75"
                                    title="إنقاص 1"
                                  >
                                    -
                                  </button>
                                  <button 
                                    type="button"
                                    onClick={() => handleEditCardQty(c.id)}
                                    className={`px-2.5 py-1 rounded-lg font-bold font-mono text-[11px] cursor-pointer select-none transition-all active:scale-95 ${
                                      c.qty <= 3 ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                    }`}
                                    title="تعديل الكمية الدقيقة"
                                  >
                                    {c.qty} قطع
                                  </button>
                                  <button 
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleAdjustCardQty(c.id, 1); }}
                                    className="w-6 h-6 rounded-lg bg-stone-200 border border-stone-300 text-stone-800 hover:bg-stone-300 active:bg-stone-400 active:scale-85 flex items-center justify-center font-black font-mono text-xs cursor-pointer select-none transition-all duration-75"
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
                            <label className="block text-[10px] text-stone-500 mb-1">المشغل / الحساب</label>
                            <select value={addBalanceOperator} onChange={e => setAddBalanceOperator(e.target.value)} className="w-full bg-stone-50 border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-bold">
                              <option value="Ooredoo_1005">🔴 Ooredoo (حساب 1005)</option>
                              <option value="Ooredoo_1006">🔴 Ooredoo (حساب 1006)</option>
                              <option value="Orange">🟠 Orange</option>
                              <option value="Tunisie Telecom">🔵 اتصالات تونس (Tunisie Telecom)</option>
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
                    <div className="space-y-2.5">
                      {/* Ooredoo with 1005 & 1006 accounts */}
                      {(() => {
                        const bal1005 = forfaitBalance.Ooredoo_1005 || 0;
                        const bal1006 = forfaitBalance.Ooredoo_1006 || 0;
                        const totalOoredoo = (forfaitBalance.Ooredoo_1005 !== undefined || forfaitBalance.Ooredoo_1006 !== undefined) 
                          ? (bal1005 + bal1006) 
                          : (forfaitBalance.Ooredoo || 0);

                        return (
                          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100 space-y-2">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-extrabold text-red-950 flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block"></span>
                                🌐 رصيد Ooredoo (الإجمالي)
                              </span>
                              <span 
                                className={`px-3 py-1 rounded-full font-black font-mono text-[12px] ${
                                  totalOoredoo <= 10 ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-red-100 text-red-900 border border-red-200'
                                }`}
                              >
                                {totalOoredoo.toFixed(3)} د.ت
                              </span>
                            </div>

                            {/* Sub accounts 1005 and 1006 */}
                            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-red-100/80">
                              <div className="flex justify-between items-center bg-white px-2.5 py-1.5 rounded-lg border border-red-100 text-[11px]">
                                <span className="font-bold text-stone-700">حساب 1005:</span>
                                {currentRole === 'manager' ? (
                                  <button
                                    type="button"
                                    onClick={() => handleEditForfaitBalanceExact('Ooredoo_1005', 'Ooredoo (حساب 1005)')}
                                    className="font-mono font-bold text-red-700 hover:underline cursor-pointer bg-red-50 px-1.5 py-0.5 rounded"
                                    title="انقر لتعديل رصيد حساب 1005"
                                  >
                                    {bal1005.toFixed(3)} د.ت ✏️
                                  </button>
                                ) : (
                                  <span className="font-mono font-bold text-stone-800">{bal1005.toFixed(3)} د.ت</span>
                                )}
                              </div>

                              <div className="flex justify-between items-center bg-white px-2.5 py-1.5 rounded-lg border border-red-100 text-[11px]">
                                <span className="font-bold text-stone-700">حساب 1006:</span>
                                {currentRole === 'manager' ? (
                                  <button
                                    type="button"
                                    onClick={() => handleEditForfaitBalanceExact('Ooredoo_1006', 'Ooredoo (حساب 1006)')}
                                    className="font-mono font-bold text-red-700 hover:underline cursor-pointer bg-red-50 px-1.5 py-0.5 rounded"
                                    title="انقر لتعديل رصيد حساب 1006"
                                  >
                                    {bal1006.toFixed(3)} د.ت ✏️
                                  </button>
                                ) : (
                                  <span className="font-mono font-bold text-stone-800">{bal1006.toFixed(3)} د.ت</span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Orange and Tunisie Telecom */}
                      {[
                        { key: 'Orange', name: 'Orange', color: 'orange', dot: 'bg-orange-500', bg: 'bg-orange-50/50', border: 'border-orange-100' },
                        { key: 'Tunisie Telecom', name: 'اتصالات تونس (Tunisie Telecom)', color: 'sky', dot: 'bg-sky-600', bg: 'bg-sky-50/50', border: 'border-sky-100' }
                      ].map((opItem) => {
                        const bal = forfaitBalance[opItem.key] || 0;
                        return (
                          <div key={opItem.key} className={`flex justify-between items-center text-xs p-2.5 ${opItem.bg} rounded-xl border ${opItem.border}`}>
                            <span className="font-bold text-stone-800 flex items-center gap-1.5">
                              <span className={`w-2.5 h-2.5 rounded-full ${opItem.dot} inline-block`}></span>
                              🌐 رصيد {opItem.name}
                            </span>
                            {currentRole === 'manager' ? (
                              <button 
                                onClick={() => handleEditForfaitBalanceExact(opItem.key, opItem.name)}
                                className={`px-3 py-1 rounded-full font-bold font-mono text-[11px] cursor-pointer hover:scale-105 transition-transform ${
                                  bal <= 5 ? 'bg-rose-100 text-rose-800' : 'bg-stone-100 text-stone-800'
                                }`}
                                title={`انقر لتعديل رصيد ${opItem.name}`}
                              >
                                {bal.toFixed(3)} د.ت ✏️
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

                {/* Section D: Photo Paper Stock Management */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {currentRole === 'manager' && (
                    <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                      <h3 className="font-extrabold text-stone-800 text-xs mb-3 flex items-center gap-2">
                        <span>🪪 تسجيل وتزويد رولو ورق الصور الشمسية</span>
                      </h3>
                      <form onSubmit={handleAddPhotoStock} className="space-y-3">
                        <div>
                          <label className="block text-[10px] text-stone-500 mb-1">عدد الصور المضافة للرولو</label>
                          <input 
                            type="number" 
                            placeholder="مثلاً: 100 أو 200"
                            value={photoStockInput}
                            onChange={e => setPhotoStockInput(e.target.value)}
                            className="w-full bg-stone-50 border border-stone-200 px-3 py-2.5 rounded-xl text-xs text-stone-800 font-mono"
                          />
                        </div>
                        <button type="submit" className="w-full bg-purple-700 hover:bg-purple-800 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer shadow-xs transition-all">
                          ➕ إضافة الكمية لرولو الصور
                        </button>
                      </form>
                    </div>
                  )}

                  <div className={`bg-white rounded-2xl border border-stone-200 p-5 shadow-xs ${currentRole !== 'manager' ? 'col-span-1 md:col-span-2' : ''}`}>
                    <h3 className="font-extrabold text-stone-800 text-xs mb-3 flex items-center justify-between">
                      <span>📊 مخزون رولو ورق الصور الحالية</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold ${
                        photoPaperStock <= 10 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {photoPaperStock <= 10 ? '⚠️ مخزون منخفض' : '✅ متوفر'}
                      </span>
                    </h3>
                    <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-lg">
                          🪪
                        </div>
                        <div>
                          <div className="font-extrabold text-stone-800 text-xs">ورق الصور الشمسية (رولو)</div>
                          <div className="text-[10px] text-stone-500">الكمية الإجمالية المتبقية للطباعة</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {currentRole === 'manager' ? (
                          <div className="flex items-center gap-1.5">
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleQuickAdjustPhotoStock(-10); }}
                              className="px-2 py-1 rounded-lg bg-stone-200 border border-stone-300 text-stone-800 hover:bg-stone-300 active:bg-stone-400 active:scale-85 font-bold font-mono text-[10px] cursor-pointer transition-all select-none duration-75"
                              title="إنقاص 10 صور"
                            >
                              -10
                            </button>
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleQuickAdjustPhotoStock(-1); }}
                              className="w-7 h-7 rounded-lg bg-stone-200 border border-stone-300 text-stone-800 hover:bg-stone-300 active:bg-stone-400 active:scale-85 flex items-center justify-center font-bold font-mono text-xs cursor-pointer select-none transition-all duration-75"
                              title="إنقاص 1 صورة"
                            >
                              -
                            </button>
                            <button 
                              type="button"
                              onClick={handleEditPhotoStock}
                              className={`px-3 py-1.5 rounded-xl font-black font-mono text-xs cursor-pointer shadow-2xs transition-all active:scale-95 ${
                                photoPaperStock <= 10 ? 'bg-rose-600 text-white' : 'bg-purple-700 text-white'
                              }`}
                              title="اضغط لتعديل الرقم مباشرة"
                            >
                              {photoPaperStock} صورة
                            </button>
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleQuickAdjustPhotoStock(1); }}
                              className="w-7 h-7 rounded-lg bg-stone-200 border border-stone-300 text-stone-800 hover:bg-stone-300 active:bg-stone-400 active:scale-85 flex items-center justify-center font-bold font-mono text-xs cursor-pointer select-none transition-all duration-75"
                              title="زيادة 1 صورة"
                            >
                              +
                            </button>
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleQuickAdjustPhotoStock(10); }}
                              className="px-2 py-1 rounded-lg bg-stone-200 border border-stone-300 text-stone-800 hover:bg-stone-300 active:bg-stone-400 active:scale-85 font-bold font-mono text-[10px] cursor-pointer transition-all select-none duration-75"
                              title="زيادة 10 صور"
                            >
                              +10
                            </button>
                          </div>
                        ) : (
                          <span className={`px-3 py-1.5 rounded-xl font-black font-mono text-xs ${
                            photoPaperStock <= 10 ? 'bg-rose-100 text-rose-800' : 'bg-purple-100 text-purple-900'
                          }`}>
                            {photoPaperStock} صورة
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section E: Forfait plan Catalog list */}
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
                    {forfaitPlans
                      .slice()
                      .sort((a, b) => a.price - b.price)
                      .map((p) => (
                      <div key={p.id} className="flex justify-between items-center p-2.5 bg-stone-50 rounded-xl border border-stone-100">
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
                      filteredItems.map((i) => (
                        <div key={i.id} className="p-3 bg-stone-50 hover:bg-stone-100/50 border border-stone-100 rounded-xl transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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

                          <div className="flex items-center gap-1.5 justify-end">
                            {currentRole === 'manager' && (
                              <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleAdjustQty(i.id, -1); }} 
                                className="w-7 h-7 flex items-center justify-center bg-stone-200 hover:bg-stone-300 active:bg-stone-400 active:scale-85 text-stone-800 rounded-lg cursor-pointer transition-all select-none shadow-2xs font-mono font-black text-sm"
                                title="إنقاص 1 من المخزن"
                              >
                                <Minus size={14} strokeWidth={2.5} />
                              </button>
                            )}
                            <button 
                              type="button"
                              onClick={() => currentRole === 'manager' ? handleEditQtyExact(i.id) : undefined}
                              disabled={currentRole !== 'manager'}
                              className={`px-3 py-1 font-mono text-xs font-black rounded-lg transition-all select-none active:scale-95 ${
                                i.qty <= 3 ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                              } ${currentRole === 'manager' ? 'cursor-pointer hover:opacity-90' : 'cursor-default'}`}
                              title={currentRole === 'manager' ? 'انقر لتحديد الكمية بدقة' : 'الكمية المتوفرة بالمخزن'}
                            >
                              {i.qty} {currentRole === 'manager' ? 'قطع' : 'قطع متوفرة'}
                            </button>
                            {currentRole === 'manager' && (
                              <button 
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleAdjustQty(i.id, 1); }} 
                                className="w-7 h-7 flex items-center justify-center bg-stone-200 hover:bg-stone-300 active:bg-stone-400 active:scale-85 text-stone-800 rounded-lg cursor-pointer transition-all select-none shadow-2xs font-mono font-black text-sm"
                                title="زيادة 1 للمخزن"
                              >
                                <Plus size={14} strokeWidth={2.5} />
                              </button>
                            )}
                            <button 
                              type="button"
                              onClick={() => setScannerContext(`manage-${i.id}`)}
                              className="p-1.5 bg-stone-800 text-stone-100 hover:bg-stone-900 active:scale-90 rounded-lg cursor-pointer transition-all"
                              title="ربط باركود إضافي"
                            >
                              <Camera size={14} />
                            </button>
                            {currentRole === 'manager' && (
                              <button 
                                type="button"
                                onClick={() => handleDeleteItem(i.id)} 
                                className="p-1.5 text-stone-400 hover:text-red-700 active:scale-90 cursor-pointer transition-all"
                                title="حذف السلعة"
                              >
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
                          if (e.target.value === 'forfait' && availableForfaitPlans.length > 0) {
                            setForfaitPlanId(availableForfaitPlans[0].id);
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
                        <option value="bill">🧾 خلاص الفاتورات (منصة izi الزيتونة)</option>
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
                              {sellFilteredItems.map((i) => {
                                const cat = i.category || 'accessory';
                                const catInfo = CATEGORY_MAP[cat] || CATEGORY_MAP.accessory;
                                return (
                                  <option key={i.id} value={i.id}>
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
                      {incomeType === 'recharge' && (() => {
                        const [face] = rechargeValOpt.split('|').map(Number);
                        const cardEntry = cardStock.find(c => c.operator === rechargeOp && String(c.value) === String(face));
                        const available = cardEntry ? cardEntry.qty : 0;
                        return (
                          <div className="space-y-3">
                            {/* Live Card Stock Badge */}
                            <div className={`p-3 rounded-xl border text-xs flex justify-between items-center transition-all ${
                              available > 3
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                : available > 0
                                ? 'bg-amber-50 border-amber-200 text-amber-800'
                                : 'bg-rose-50 border-rose-200 text-rose-800'
                            }`}>
                              <div className="flex items-center gap-2">
                                <span className="text-base">📶</span>
                                <div>
                                  <div className="font-bold">المخزون الحالي لبطاقات {rechargeOp} ({face} د.ت):</div>
                                  <div className="text-xs font-mono font-black mt-0.5">
                                    {available > 0 ? `✅ متوفر بالمخزن: ${available} قطعة` : '❌ المخزن فارغ (0 قطعة)'}
                                  </div>
                                </div>
                              </div>
                              {currentRole === 'manager' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCardOperator(rechargeOp);
                                    setCardValue(String(face));
                                    setCurrentTab('stock');
                                  }}
                                  className="text-[10px] font-bold bg-white border border-stone-300 px-2.5 py-1.5 rounded-lg hover:bg-stone-50 cursor-pointer shadow-2xs text-stone-800 shrink-0"
                                >
                                  ➕ شحن/تزويد
                                </button>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] text-stone-500 mb-0.5">المشغل</label>
                                <select value={rechargeOp} onChange={e => setRechargeOp(e.target.value)} className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-bold">
                                  <option value="Ooredoo">Ooredoo</option>
                                  <option value="Orange">Orange</option>
                                  <option value="Tunisie Telecom">Tunisie Telecom</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-[10px] text-stone-500 mb-0.5">الفئة والقيمة</label>
                                <select value={rechargeValOpt} onChange={e => setRechargeValOpt(e.target.value)} className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-bold">
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
                                  className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono font-bold"
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
                        );
                      })()}

                      {/* Sub-form: Forfait */}
                      {incomeType === 'forfait' && (
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">المشغل</label>
                              <select 
                                value={forfaitOp} 
                                onChange={e => {
                                  const nextOp = e.target.value;
                                  setForfaitOp(nextOp);
                                  if (!nextOp.includes('Ooredoo') && forfaitPlanId.startsWith('ooredoo_nkalmek_')) {
                                    setForfaitPlanId(forfaitPlans[0]?.id || '');
                                  }
                                }} 
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-bold"
                              >
                                <option value="Ooredoo 1005">🔴 Ooredoo 1005</option>
                                <option value="Ooredoo 1006">🔴 Ooredoo 1006</option>
                                <option value="Orange">🟠 Orange</option>
                                <option value="Tunisie Telecom">🔵 اتصالات تونس (Tunisie Telecom)</option>
                              </select>
                              <span className="text-[9px] text-stone-500 block mt-1 font-mono font-medium">
                                الرصيد المتوفر: {
                                  forfaitOp === 'Ooredoo 1005'
                                    ? `${(forfaitBalance.Ooredoo_1005 || 0).toFixed(3)} د.ت`
                                    : forfaitOp === 'Ooredoo 1006'
                                    ? `${(forfaitBalance.Ooredoo_1006 || 0).toFixed(3)} د.ت`
                                    : forfaitOp === 'Ooredoo'
                                    ? `${((forfaitBalance.Ooredoo_1005 || 0) + (forfaitBalance.Ooredoo_1006 || 0) || (forfaitBalance.Ooredoo || 0)).toFixed(3)} د.ت`
                                    : `${(forfaitBalance[forfaitOp] || 0).toFixed(3)} د.ت`
                                }
                              </span>
                            </div>
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">اختر الباقة</label>
                              <select 
                                value={forfaitPlanId} 
                                onChange={e => setForfaitPlanId(e.target.value)} 
                                dir="ltr"
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 text-left font-mono font-medium"
                              >
                                <option value="" dir="rtl" className="font-sans">-- اختر الباقة --</option>
                                {availableForfaitPlans.map((p) => (
                                  <option key={p.id} value={p.id} dir="ltr">
                                    {p.name} {p.validity ? `(${p.validity})` : ''} ── {p.price.toFixed(3)} DT
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
                        <div className="space-y-2">
                          <div className="flex items-center justify-between p-2.5 rounded-xl bg-purple-50 border border-purple-100 text-xs">
                            <div className="flex items-center gap-1.5 font-bold text-purple-950">
                              <span>🪪 رولو ورق الصور المتبقي بالمخزن:</span>
                              <span className={`font-mono font-black px-2 py-0.5 rounded-lg text-xs ${
                                photoPaperStock <= 0 ? 'bg-rose-600 text-white' : photoPaperStock <= 10 ? 'bg-amber-500 text-white' : 'bg-purple-700 text-white'
                              }`}>
                                {photoPaperStock} صورة
                              </span>
                            </div>
                            {photoPaperStock <= 0 && (
                              <span className="text-[11px] font-bold text-rose-600 animate-pulse">⚠️ الرولو فارغ! يرجى إبلاغ المدير للتزويد</span>
                            )}
                          </div>
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
                              <label className="block text-[10px] text-stone-700 mb-0.5 font-bold">عدد الصور (الكمية)</label>
                              <input 
                                type="number" 
                                min="1"
                                placeholder="1"
                                value={photoQty}
                                onChange={e => setPhotoQty(e.target.value)}
                                className="w-full bg-white border border-purple-300 focus:border-purple-600 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono font-bold"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">المبلغ النهائي (د.ت)</label>
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

                      {/* Sub-form: Bill Payments (izi - Zitouna Payment) */}
                      {incomeType === 'bill' && (
                        <div className="space-y-3">
                          <div className="text-[11px] font-bold text-stone-700">
                            🧾 خلاص الفاتورات عبر منصة <span className="font-mono text-red-700">izi</span> (الزيتونة)
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">نوع الفاتورة</label>
                              <select
                                value={billType}
                                onChange={e => setBillType(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-bold"
                              >
                                <option value="STEG (كهرباء وغاز)">⚡ STEG (فاتورة الكهرباء والغاز)</option>
                                <option value="SONEDE (ماء)">💧 SONEDE (فاتورة الماء)</option>
                                <option value="أنترنات / خط قار">🌐 أنترنات / خط قار (Topnet / TT / Orange / Ooredoo)</option>
                                <option value="جوال / اشتراك (Postpaid)">📱 فاتورة جوال / اشتراك شهري</option>
                                <option value="معاليم الطريق السيار / جباية">🚗 الطريق السيار / جباية / معاليم عمومية</option>
                                <option value="other">🧾 فاتورة أخرى...</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">قيمة الفاتورة (د.ت)</label>
                              <input
                                type="number"
                                step="0.001"
                                min="0"
                                placeholder="0.000"
                                value={billAmount}
                                onChange={e => setBillAmount(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono font-bold"
                              />
                            </div>
                          </div>

                          {billType === 'other' && (
                            <div>
                              <label className="block text-[10px] text-stone-500 mb-0.5">اكتب نوع الفاتورة بالتفصيل</label>
                              <input
                                type="text"
                                placeholder="مثال: فاتورة CNSS، خط نقل، اشتراك..."
                                value={billCustomDesc}
                                onChange={e => setBillCustomDesc(e.target.value)}
                                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800"
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-[10px] text-stone-500 mb-0.5">رقم الفاتورة / العقد / الهاتف (اختياري)</label>
                            <input
                              type="text"
                              placeholder="مثال: رقم العقد أو الهاتف"
                              value={billReference}
                              onChange={e => setBillReference(e.target.value)}
                              className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs text-stone-800 font-mono"
                            />
                          </div>
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
                      cart.map((line) => (
                        <div key={line.id} className="p-3 bg-stone-50 hover:bg-stone-100/60 rounded-xl border border-stone-200/80 text-[11px] transition-all space-y-2">
                          {/* Row 1: Item Label & Delete Button */}
                          <div className="flex justify-between items-start gap-2">
                            <div className="font-bold text-stone-900 text-xs leading-snug flex-1 break-words">
                              {line.label}
                            </div>
                            <button 
                              type="button"
                              onClick={() => handleRemoveFromCart(line.id)}
                              className="text-stone-400 hover:text-red-700 p-1 rounded hover:bg-red-50 cursor-pointer transition-colors shrink-0"
                              title="حذف من الفاتورة"
                            >
                              <X size={14} />
                            </button>
                          </div>

                          {/* Row 2: Price Editing & Quantity Stepper & Line Total */}
                          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-stone-200/50 flex-wrap sm:flex-nowrap">
                            {/* Price Editing Section */}
                            <div className="flex items-center gap-1 shrink-0">
                              {editingCartLineId === line.id ? (
                                <form 
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    handleSaveInlinePrice(line.id);
                                  }}
                                  className="flex items-center gap-1 bg-amber-50 p-1 rounded-lg border border-amber-300"
                                >
                                  <span className="text-[10px] text-amber-900 font-bold shrink-0">السعر:</span>
                                  <input
                                    type="number"
                                    step="0.001"
                                    min="0"
                                    value={editingCartPriceVal}
                                    onChange={(e) => setEditingCartPriceVal(e.target.value)}
                                    autoFocus
                                    className="w-16 px-1.5 py-0.5 bg-white border border-amber-400 rounded text-xs font-mono font-bold text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                  />
                                  <button
                                    type="submit"
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white p-1 rounded text-[10px] font-bold cursor-pointer transition-colors"
                                    title="حفظ السعر الجديد"
                                  >
                                    <Check size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingCartLineId(null)}
                                    className="bg-stone-200 hover:bg-stone-300 text-stone-700 p-1 rounded text-[10px] font-bold cursor-pointer transition-colors"
                                    title="إلغاء"
                                  >
                                    <X size={12} />
                                  </button>
                                </form>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleEditCartLinePrice(line.id)}
                                  className="font-mono font-bold text-amber-900 bg-amber-100/90 hover:bg-amber-200 px-2 py-0.5 rounded-lg border border-amber-300 flex items-center gap-1 cursor-pointer transition-colors text-[11px]"
                                  title="انقر لتعديل سعر هذا المنتج في الفاتورة الحالية"
                                >
                                  <span>{line.unitPrice.toFixed(3)} د.ت</span>
                                  <Pencil size={10} className="text-amber-800 shrink-0" />
                                </button>
                              )}
                            </div>

                            {/* Right side: Quantity Controls & Line Total */}
                            <div className="flex items-center gap-2 shrink-0 ms-auto">
                              <div className="flex items-center gap-1 bg-white border border-stone-200 rounded-lg p-0.5 shadow-2xs">
                                <button
                                  type="button"
                                  onClick={() => handleAdjustCartLineQty(line.id, -1)}
                                  className="w-5 h-5 flex items-center justify-center text-stone-800 font-black hover:bg-stone-200 active:bg-stone-300 active:scale-85 rounded cursor-pointer transition-all select-none duration-75"
                                  title="إنقاص الكمية"
                                >
                                  -
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleEditCartLineQtyExact(line.id)}
                                  className="font-mono font-extrabold px-1.5 text-xs text-stone-900 hover:text-amber-700 hover:bg-stone-100 active:scale-95 rounded cursor-pointer transition-all select-none"
                                  title="انقر لتحديد الكمية بالضبط"
                                >
                                  {line.qty}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAdjustCartLineQty(line.id, 1)}
                                  className="w-5 h-5 flex items-center justify-center text-stone-800 font-black hover:bg-stone-200 active:bg-stone-300 active:scale-85 rounded cursor-pointer transition-all select-none duration-75"
                                  title="زيادة الكمية"
                                >
                                  +
                                </button>
                              </div>

                              <span className="font-mono font-black text-stone-900 text-xs min-w-[50px] text-left">
                                {line.total.toFixed(3)} د.ت
                              </span>
                            </div>
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
                      <div className="space-y-2 bg-stone-50 dark:bg-stone-800/60 p-2.5 rounded-xl border border-stone-100 dark:border-stone-700/60 text-[10px]">
                        <div>
                          <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5 font-medium">اسم الحريف (اختياري / مهم للدين)</label>
                          <input 
                            type="text" 
                            placeholder="اسم الحريف"
                            value={invoiceCustomerName}
                            onChange={e => setInvoiceCustomerName(e.target.value)}
                            className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 px-2 py-1.5 rounded-lg text-xs text-stone-800 dark:text-stone-100"
                          />

                          {/* Smart detection alert banner in POS cart */}
                          {topInvoiceCustomerMatch && (
                            <div className="mt-1.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700/70 p-2 rounded-lg text-[10px] space-y-1 animate-fade-in">
                              <div className="flex items-start gap-1 text-amber-900 dark:text-amber-200 font-bold leading-tight">
                                <AlertCircle size={12} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                                <div>
                                  <span>هل تقصد: </span>
                                  <span className="font-black text-amber-800 dark:text-amber-300 underline">{topInvoiceCustomerMatch.canonicalName}</span>؟
                                </div>
                              </div>
                              <div className="text-[9px] text-amber-800/80 dark:text-amber-300/80">
                                {topInvoiceCustomerMatch.reason}
                                {topInvoiceCustomerMatch.totalRemaining > 0 && ` • باقي عليه: ${topInvoiceCustomerMatch.totalRemaining.toFixed(3)} د.ت`}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setInvoiceCustomerName(topInvoiceCustomerMatch.canonicalName);
                                  if (topInvoiceCustomerMatch.phone) setInvoiceCustomerPhone(topInvoiceCustomerMatch.phone);
                                }}
                                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-1 px-2 rounded text-[9px] flex items-center justify-center gap-1 cursor-pointer transition-colors shadow-xs"
                              >
                                <UserCheck size={11} /> ربط مع حساب "{topInvoiceCustomerMatch.canonicalName}"
                              </button>
                            </div>
                          )}

                          {/* Quick suggestion chips in POS cart */}
                          {invoiceCustomerSuggestions.length > 0 && !topInvoiceCustomerMatch && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {invoiceCustomerSuggestions.slice(0, 3).map((sug, i) => (
                                <button
                                  key={`${sug.canonicalName}-${sug.phone || i}`}
                                  type="button"
                                  onClick={() => {
                                    setInvoiceCustomerName(sug.canonicalName);
                                    if (sug.phone) setInvoiceCustomerPhone(sug.phone);
                                  }}
                                  className="bg-stone-100 hover:bg-stone-200 dark:bg-stone-700 dark:hover:bg-stone-600 text-stone-700 dark:text-stone-200 px-1.5 py-0.5 rounded text-[9px] transition-colors border border-stone-200 dark:border-stone-600 cursor-pointer flex items-center gap-1"
                                >
                                  <span>👤 {sug.canonicalName}</span>
                                  {sug.totalRemaining > 0 && <span className="text-rose-600 dark:text-rose-400 font-mono font-bold">({sug.totalRemaining.toFixed(3)})</span>}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <div>
                          <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5 font-medium">رقم تليفون الحريف (اختياري)</label>
                          <input 
                            type="text" 
                            placeholder="رقم الهاتف"
                            value={invoiceCustomerPhone}
                            onChange={e => setInvoiceCustomerPhone(e.target.value)}
                            className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 px-2 py-1.5 rounded-lg text-xs font-mono text-stone-800 dark:text-stone-100"
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
                        ...sales.map(s => ({ ...s, isSale: true, label: `${s.itemName} × ${s.qty}`, icon: '🛍️', destination: 'drawer' as const })),
                        ...otherIncome.map(o => ({ 
                          ...o, 
                          isSale: false, 
                          label: o.label, 
                          destination: o.destination || 'drawer',
                          icon: o.destination === 'manager' 
                            ? '💼' 
                            : o.category === 'recharge' ? '📶' : o.category === 'forfait' ? '🌐' : o.category === 'photo' ? '🪪' : o.category === 'bill' ? '🧾' : o.category === 'debt_payment' ? '💳' : '🔧' 
                        }))
                      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

                      if (merged.length === 0) {
                        return <p className="text-stone-400 text-center py-6 text-xs">لا توجد عمليات مسجلة لتوة</p>;
                      }

                      return merged.slice(0, 10).map((entry) => (
                        <div key={`${entry.isSale ? 's' : 'o'}_${entry.id}`} className="flex justify-between items-center p-2.5 bg-stone-50 rounded-xl border border-stone-100">
                          <div>
                            <div className="font-bold text-stone-800 text-xs flex items-center gap-1.5 flex-wrap">
                              <span>{entry.icon} {entry.label}</span>
                              {entry.destination === 'manager' && (
                                <span className="bg-purple-100 text-purple-900 border border-purple-200 text-[9px] px-1.5 py-0.2 rounded font-black">
                                  💼 جيب المدير (خارج الكاسة)
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-stone-400">{new Date(entry.date).toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className={`font-mono font-bold text-xs ${entry.destination === 'manager' ? 'text-purple-800' : 'text-emerald-700'}`}>
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
                      expenses.slice(0, expensesLimit).map((e) => (
                        <div key={e.id} className="flex justify-between items-center text-xs p-2.5 bg-stone-50 rounded-xl border border-stone-100">
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
              <DebtsTab
                debts={debts}
                groupedCustomerDebts={groupedCustomerDebts}
                totalOwed={totalOwed}
                paidDebts={paidDebts}
                currentRole={currentRole}
                onAddManualDebt={stableOnAddManualDebt}
                onEditCustomer={stableOnEditCustomer}
                onPayCustomerGroup={stableOnPayCustomerGroup}
                onPayDebt={stableOnPayDebt}
                onDeleteDebt={stableOnDeleteDebt}
              />
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
                  <h3 className="font-extrabold text-stone-800 text-xs text-rose-800 mb-1">🧹 تنظيف أرشيف المبيعات القديمة (لتوفير مساحة الفايربيز)</h3>
                  <p className="text-stone-400 text-[10px] mb-3">يمسح سجلات المبيعات القديمة السابقة للوردية الحالية لحفظ المساحة المجانية للسيرفر (دون المساس بحسابات الوردية الحالية):</p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleResetIncomeHistory(30)} className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-3 py-2 rounded-xl text-[11px] border border-rose-200 cursor-pointer">تنظيف الأرشيف الأقدم من 30 يوماً</button>
                    <button onClick={() => handleResetIncomeHistory(7)} className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-3 py-2 rounded-xl text-[11px] border border-rose-200 cursor-pointer">تنظيف الأرشيف الأقدم من 7 أيام</button>
                    <button onClick={() => handleResetIncomeHistory(1)} className="bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-3 py-2 rounded-xl text-[11px] border border-rose-200 cursor-pointer">تنظيف كل ما هو قبل الوردية الحالية</button>
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
                          <option value="bill">🧾 خلاص الفاتورات (منصة izi الزيتونة)</option>
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
                         .map((entry) => (
                          <div key={`${entry.isSale ? 's' : 'o'}_${entry.id}`} className="flex justify-between items-center p-2.5 bg-stone-50 hover:bg-stone-100/50 rounded-xl border border-stone-100 transition-colors">
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



              </div>
            )}

            {/* TAB 6: SETTINGS (Manager Only) */}
            {currentTab === 'settings' && currentRole === 'manager' && (
              <div className="space-y-4">
                
                {/* Theme & Dark Mode Preference Card */}
                <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-xs">
                  <h3 className="font-extrabold text-stone-800 text-xs mb-1 flex items-center gap-1.5">
                    <span>🌓 مظهر التطبيق والوضع الداكن (Dark Mode)</span>
                  </h3>
                  <p className="text-stone-400 text-[11px] mb-3">اختر مظهر التطبيق المفضل أو اجعله متطابقاً تلقائياً مع نظام جهازك:</p>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 max-w-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setThemeMode('system');
                        triggerToast('💻 تم ضبط المظهر تلقائياً حسب إعدادات جهازك');
                      }}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center text-center gap-1.5 transition-all cursor-pointer select-none ${
                        themeMode === 'system'
                          ? 'border-red-700 bg-red-50 text-red-700 font-bold shadow-xs'
                          : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      <Laptop size={20} />
                      <span className="text-xs font-bold">تلقائي حسب الجهاز</span>
                      <span className="text-[10px] text-stone-400 font-normal">
                        {isDarkEffective ? '(حالياً داكن 🌙)' : '(حالياً فاتح ☀️)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setThemeMode('dark');
                        triggerToast('🌙 تم تفعيل الوضع الداكن (الليلي)');
                      }}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center text-center gap-1.5 transition-all cursor-pointer select-none ${
                        themeMode === 'dark'
                          ? 'border-red-700 bg-red-50 text-red-700 font-bold shadow-xs'
                          : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      <Moon size={20} />
                      <span className="text-xs font-bold">الوضع الداكن دائماً</span>
                      <span className="text-[10px] text-stone-400 font-normal">مريح للعين ليلاً</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setThemeMode('light');
                        triggerToast('☀️ تم تفعيل الوضع الفاتح (النهاري)');
                      }}
                      className={`p-3 rounded-xl border flex flex-col items-center justify-center text-center gap-1.5 transition-all cursor-pointer select-none ${
                        themeMode === 'light'
                          ? 'border-red-700 bg-red-50 text-red-700 font-bold shadow-xs'
                          : 'border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      <Sun size={20} />
                      <span className="text-xs font-bold">الوضع الفاتح دائماً</span>
                      <span className="text-[10px] text-stone-400 font-normal">واجهة نهارية كلاسيكية</span>
                    </button>
                  </div>
                </div>

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

          </div>
        ) : (
          /* Authentication Screen Overlay UI */
          <LoginOverlay 
            onChooseSeller={() => {
              setCurrentRole('seller');
              setCurrentTab('income');
              sessionStorage.setItem('yosri_role_v2', 'seller');
            }}
            onAttemptManagerLogin={async (pin) => {
              const success = await signInManager(pin);
              if (success) {
                setCurrentRole('manager');
                setCurrentTab('income');
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
      <DuplicateProductModal 
        isOpen={showDuplicateModal}
        newItemInput={newItem}
        similarCandidates={duplicateCandidates}
        onConfirmIncreaseQuantity={handleConfirmIncreaseQuantity}
        onConfirmCreateNew={handleCreateNewProductDirectly}
        onClose={() => setShowDuplicateModal(false)}
      />

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
        onAttachPhotoToForm={(img) => {
          setNewItem(prev => ({ ...prev, imageUrl: img }));
          triggerToast('📸 تم إرفاق صورة السلعة لنموذج الإضافة بنجاح!');
        }}
        targetItemToUpdate={targetItemToCapturePhoto}
        mode={visualRecognitionMode}
      />

      {scannerContext && (
        <BarcodeScannerPopup 
          onScan={handleBarcodeScanned} 
          onClose={() => setScannerContext(null)} 
        />
      )}

      {/* Forfait Breakdown Modal */}
      {showForfaitBreakdownModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-fade-in font-sans" dir="rtl">
          <div className="bg-white rounded-3xl border border-stone-200 p-5 sm:p-6 w-full max-w-2xl shadow-2xl animate-scale-up text-right max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <span className="p-2.5 bg-blue-100 text-blue-700 rounded-2xl text-xl">🌐</span>
                <div>
                  <h3 className="font-extrabold text-stone-900 text-base sm:text-lg">
                    توزيع مبيعات شحن الفورفاي حسب المشغل
                  </h3>
                  <p className="text-stone-500 text-xs">
                    تفاصيل مبيعات باقات الإنترنت والإنترنت للهواتف
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowForfaitBreakdownModal(false)}
                className="text-stone-400 hover:text-stone-700 p-2 rounded-xl hover:bg-stone-100 transition-colors cursor-pointer text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto py-4 space-y-5 flex-1 pr-1">
              {/* Total Banner */}
              <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-4 rounded-2xl shadow-md flex items-center justify-between">
                <div>
                  <span className="text-xs text-blue-100 font-bold block">إجمالي مبيعات الفورفي للفترة المحددة</span>
                  <span className="font-mono text-2xl font-black">{totalForfaitSales.toFixed(3)} د.ت</span>
                </div>
                <div className="text-left bg-white/10 px-3.5 py-1.5 rounded-xl border border-white/20">
                  <span className="text-[11px] text-blue-100 block">إجمالي العمليات</span>
                  <span className="font-mono font-bold text-sm">{dOther.filter(o => o.category === 'forfait').length} عملية</span>
                </div>
              </div>

              {/* Breakdown Grid by Operator */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Ooredoo */}
                {(() => {
                  const isOor = (o: OtherIncome) => o.category === 'forfait' && (
                    (o.cardOperator && o.cardOperator.includes('Ooredoo')) || (!o.cardOperator && o.label.includes('Ooredoo'))
                  );
                  const opSales = dOther
                    .filter(isOor)
                    .reduce((s, c) => s + c.amount, 0);
                  const opCount = dOther
                    .filter(isOor)
                    .length;
                  const pct = totalForfaitSales > 0 ? ((opSales / totalForfaitSales) * 100).toFixed(1) : '0';

                  return (
                    <div className="bg-red-50/70 border-2 border-red-200 p-3.5 rounded-2xl relative overflow-hidden flex flex-col justify-between shadow-xs">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-extrabold text-red-950 text-sm flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block shadow-xs"></span>
                          أوريدو (Ooredoo)
                        </span>
                        <span className="text-[10px] font-extrabold bg-red-200/80 text-red-900 px-2 py-0.5 rounded-full">
                          {pct}%
                        </span>
                      </div>
                      <div className="font-mono text-xl font-black text-red-700 my-1">
                        {opSales.toFixed(3)} <span className="text-xs">د.ت</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-stone-600 mt-2 pt-2 border-t border-red-200/60 font-medium">
                        <span>العمليات: <b>{opCount}</b></span>
                        <span className="text-[10px] text-red-800 font-mono">
                          رصيد: {((forfaitBalance.Ooredoo_1005 || 0) + (forfaitBalance.Ooredoo_1006 || 0) || (forfaitBalance.Ooredoo || 0)).toFixed(3)} د.ت
                        </span>
                      </div>
                    </div>
                  );
                })()}

                {/* Orange */}
                {(() => {
                  const opSales = dOther
                    .filter(o => o.category === 'forfait' && (o.cardOperator === 'Orange' || (!o.cardOperator && o.label.includes('Orange'))))
                    .reduce((s, c) => s + c.amount, 0);
                  const opCount = dOther
                    .filter(o => o.category === 'forfait' && (o.cardOperator === 'Orange' || (!o.cardOperator && o.label.includes('Orange'))))
                    .length;
                  const pct = totalForfaitSales > 0 ? ((opSales / totalForfaitSales) * 100).toFixed(1) : '0';

                  return (
                    <div className="bg-orange-50/70 border-2 border-orange-200 p-3.5 rounded-2xl relative overflow-hidden flex flex-col justify-between shadow-xs">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-extrabold text-orange-950 text-sm flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block shadow-xs"></span>
                          أورنج (Orange)
                        </span>
                        <span className="text-[10px] font-extrabold bg-orange-200/80 text-orange-900 px-2 py-0.5 rounded-full">
                          {pct}%
                        </span>
                      </div>
                      <div className="font-mono text-xl font-black text-orange-700 my-1">
                        {opSales.toFixed(3)} <span className="text-xs">د.ت</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-stone-600 mt-2 pt-2 border-t border-orange-200/60 font-medium">
                        <span>العمليات: <b>{opCount}</b></span>
                        <span className="text-[10px] text-orange-800 font-mono">رصيد: {forfaitBalance.Orange?.toFixed(3) || '0.000'}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Tunisie Telecom */}
                {(() => {
                  const opSales = dOther
                    .filter(o => o.category === 'forfait' && (o.cardOperator === 'Tunisie Telecom' || (!o.cardOperator && (o.label.includes('Telecom') || o.label.includes('اتصالات')))))
                    .reduce((s, c) => s + c.amount, 0);
                  const opCount = dOther
                    .filter(o => o.category === 'forfait' && (o.cardOperator === 'Tunisie Telecom' || (!o.cardOperator && (o.label.includes('Telecom') || o.label.includes('اتصالات')))))
                    .length;
                  const pct = totalForfaitSales > 0 ? ((opSales / totalForfaitSales) * 100).toFixed(1) : '0';

                  return (
                    <div className="bg-sky-50/70 border-2 border-sky-200 p-3.5 rounded-2xl relative overflow-hidden flex flex-col justify-between shadow-xs">
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-extrabold text-sky-950 text-sm flex items-center gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-sky-600 inline-block shadow-xs"></span>
                          اتصالات تونس
                        </span>
                        <span className="text-[10px] font-extrabold bg-sky-200/80 text-sky-900 px-2 py-0.5 rounded-full">
                          {pct}%
                        </span>
                      </div>
                      <div className="font-mono text-xl font-black text-sky-700 my-1">
                        {opSales.toFixed(3)} <span className="text-xs">د.ت</span>
                      </div>
                      <div className="flex justify-between items-center text-[11px] text-stone-600 mt-2 pt-2 border-t border-sky-200/60 font-medium">
                        <span>العمليات: <b>{opCount}</b></span>
                        <span className="text-[10px] text-sky-800 font-mono">رصيد: {forfaitBalance['Tunisie Telecom']?.toFixed(3) || '0.000'}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Detailed Transactions List */}
              <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h4 className="font-bold text-stone-800 text-xs flex items-center gap-2">
                    📜 سجل عمليات الفورفي المسجلة
                  </h4>
                  <div className="flex items-center gap-1 flex-wrap">
                    {['all', 'Ooredoo', 'Orange', 'Tunisie Telecom'].map(op => (
                      <button
                        key={op}
                        type="button"
                        onClick={() => setForfaitFilterOp(op)}
                        className={`text-[10px] px-2.5 py-1 rounded-lg font-bold transition-colors cursor-pointer ${
                          forfaitFilterOp === op
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-white text-stone-600 border border-stone-200 hover:bg-stone-100'
                        }`}
                      >
                        {op === 'all' ? 'الكل' : op === 'Tunisie Telecom' ? 'اتصالات تونس' : op}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
                  {otherIncome
                    .filter(o => o.category === 'forfait')
                    .filter(o => {
                      if (forfaitFilterOp === 'all') return true;
                      const op = o.cardOperator || (o.label.includes('Ooredoo') ? 'Ooredoo' : o.label.includes('Orange') ? 'Orange' : 'Tunisie Telecom');
                      if (forfaitFilterOp === 'Ooredoo') return op.includes('Ooredoo');
                      return op === forfaitFilterOp;
                    })
                    .length === 0 ? (
                      <div className="text-center py-6 text-stone-400 text-xs">
                        لا توجد عمليات فورفي مسجلة لهذا المشغل
                      </div>
                    ) : (
                      otherIncome
                        .filter(o => o.category === 'forfait')
                        .filter(o => {
                          if (forfaitFilterOp === 'all') return true;
                          const op = o.cardOperator || (o.label.includes('Ooredoo') ? 'Ooredoo' : o.label.includes('Orange') ? 'Orange' : 'Tunisie Telecom');
                          if (forfaitFilterOp === 'Ooredoo') return op.includes('Ooredoo');
                          return op === forfaitFilterOp;
                        })
                        .slice(0, 40)
                        .map(entry => {
                          const opName = entry.cardOperator || (entry.label.includes('Ooredoo') ? 'Ooredoo' : entry.label.includes('Orange') ? 'Orange' : 'Tunisie Telecom');
                          return (
                            <div key={entry.id} className="bg-white p-2.5 rounded-xl border border-stone-200 flex items-center justify-between text-xs hover:border-blue-300 transition-colors">
                              <div>
                                <div className="font-bold text-stone-800 flex items-center gap-1.5">
                                  <span className={`w-2 h-2 rounded-full ${
                                    opName.includes('Ooredoo') ? 'bg-red-500' : opName === 'Orange' ? 'bg-orange-500' : 'bg-sky-500'
                                  }`} />
                                  {entry.label}
                                </div>
                                <div className="text-[10px] text-stone-400 mt-0.5 font-mono">
                                  {entry.date ? new Date(entry.date).toLocaleString('ar-TN') : ''}
                                </div>
                              </div>
                              <div className="text-left font-mono">
                                <div className="font-black text-blue-700">{entry.amount.toFixed(3)} د.ت</div>
                              </div>
                            </div>
                          );
                        })
                    )
                  }
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-stone-100 flex justify-end">
              <button
                onClick={() => setShowForfaitBreakdownModal(false)}
                className="bg-stone-900 hover:bg-stone-800 text-white font-bold px-6 py-2.5 rounded-xl text-xs cursor-pointer transition-colors shadow-md"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shift Handover Modal */}
      <ShiftHandoverModal
        isOpen={showShiftHandoverModal}
        onClose={() => setShowShiftHandoverModal(false)}
        lastResetTimestamp={lastCashResetTimestamp}
        startingCash={cashRegister}
        currentShiftSales={currentShiftSales}
        currentShiftOtherIncome={currentShiftOtherIncome}
        currentShiftManagerDebtIncome={currentShiftManagerDebtIncome}
        currentShiftExpenses={currentShiftExpenses}
        outboxCount={outboxCount}
        onFlushOutbox={handleManualFlushOutbox}
        onPerformReset={handlePerformShiftReset}
      />

      {/* Pay Debt Modal */}
      <PayDebtModal
        isOpen={!!payDebtTarget}
        onClose={() => setPayDebtTarget(null)}
        target={payDebtTarget}
        onConfirmPayment={handleExecuteDebtPayment}
      />

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

      {/* Custom Input Modal Dialog (replaces window.prompt for iFrame compatibility) */}
      {inputDialog.isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in font-sans"
          dir="rtl"
          onKeyDown={e => {
            if (e.key === 'Escape') resolveInputDialog(null);
          }}
        >
          <div className="bg-white rounded-3xl border border-stone-200 p-6 w-full max-w-sm shadow-2xl animate-scale-up text-right">
            <h3 className="font-extrabold text-stone-900 text-sm mb-2 flex items-center gap-2">
              <Pencil size={15} className="text-red-700 shrink-0" />
              <span>{inputDialog.title}</span>
            </h3>
            <p className="text-stone-600 text-xs leading-relaxed mb-4 whitespace-pre-line">
              {inputDialog.message}
            </p>

            {inputDialog.inputType === 'select' && inputDialog.options ? (
              <div className="space-y-1.5 mb-4">
                {inputDialog.options.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => resolveInputDialog(opt.value)}
                    className={`w-full text-right px-3.5 py-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-between ${
                      inputDialog.value === opt.value
                        ? 'bg-red-50 border-red-600 text-red-900'
                        : 'bg-stone-50 border-stone-200 text-stone-800 hover:bg-stone-100'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {inputDialog.value === opt.value && <Check size={14} className="text-red-700" />}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => resolveInputDialog(null)}
                  className="w-full mt-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-extrabold py-2.5 rounded-xl text-xs cursor-pointer transition-colors"
                >
                  إلغاء
                </button>
              </div>
            ) : (
              <form
                onSubmit={e => {
                  e.preventDefault();
                  resolveInputDialog(inputDialog.value);
                }}
                className="space-y-4"
              >
                <input
                  type={inputDialog.inputType}
                  step={inputDialog.step}
                  min={inputDialog.min}
                  placeholder={inputDialog.placeholder}
                  value={inputDialog.value}
                  onChange={e => setInputDialog(prev => ({ ...prev, value: e.target.value }))}
                  autoFocus
                  className="w-full bg-stone-50 border border-stone-300 focus:border-red-700 px-3.5 py-2.5 rounded-xl text-sm text-stone-900 font-mono focus:outline-none focus:ring-2 focus:ring-red-700/20"
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="submit"
                    className="bg-red-700 hover:bg-red-800 text-white font-black py-2.5 rounded-xl text-xs cursor-pointer shadow-md transition-colors"
                  >
                    تأكيد ✅
                  </button>
                  <button
                    type="button"
                    onClick={() => resolveInputDialog(null)}
                    className="bg-stone-100 hover:bg-stone-200 text-stone-700 font-extrabold py-2.5 rounded-xl text-xs cursor-pointer transition-colors"
                  >
                    إلغاء
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Connection Indicator footer status line */}
      {currentRole && (
        <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 py-2 px-4 shadow-md text-[10px] text-stone-400 text-center select-none z-30">
          📍 العنوان: نبر، الكاف | هاتف: <span dir="ltr" className="inline-block font-mono">41 444 355</span> | متصل بالخادم السحابي لـ Yosri GSM
        </footer>
      )}
    </div>
  );
}
