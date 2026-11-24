import React, { useState, useMemo, useDeferredValue, useCallback, useEffect } from 'react';
import {
  Plus, AlertCircle, UserCheck, CreditCard, Users, Layers, Search,
  CheckCircle, Pencil, PhoneCall, Merge, Check, ChevronDown, ChevronUp, Trash2,
  ArrowUpDown
} from 'lucide-react';
import { Debt, AppRole } from '../types';
import {
  CustomerDebtGroup,
  DebtSortOption,
  findCustomerSuggestionsFromGroups,
  sortCustomerDebtGroups,
  sortIndividualDebts
} from '../utils/customerDebtMatcher';

const VALID_SORT_OPTIONS: readonly DebtSortOption[] = [
  'highest_amount',
  'newest',
  'oldest',
  'lowest_amount',
  'most_debts',
  'name_asc'
];

const DEBT_SORT_STORAGE_KEY = 'yosri_debt_sort';

function readSavedSortOption(): DebtSortOption {
  try {
    const raw = localStorage.getItem(DEBT_SORT_STORAGE_KEY);
    if (raw && (VALID_SORT_OPTIONS as readonly string[]).includes(raw)) {
      return raw as DebtSortOption;
    }
  } catch {
    // ignore storage access issues
  }
  return 'highest_amount';
}

function roundTND3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

function formatDateTN(dateStr?: string): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-TN');
}

function getDaysElapsed(ts?: number, fallbackDate?: string): number {
  const targetTs = ts && ts > 0 ? ts : (fallbackDate ? new Date(fallbackDate).getTime() : 0);
  if (!targetTs || Number.isNaN(targetTs)) return 0;
  return Math.max(0, Math.floor((Date.now() - targetTs) / (1000 * 60 * 60 * 24)));
}


const SEARCH_NORM_CACHE = new Map<string, string>();
function normalizeArabicFast(str: string): string {
  if (!str) return '';
  const cached = SEARCH_NORM_CACHE.get(str);
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

  if (SEARCH_NORM_CACHE.size >= 3000) {
    SEARCH_NORM_CACHE.clear();
  }
  SEARCH_NORM_CACHE.set(str, res);
  return res;
}

interface ManualDebtFormProps {
  groupedCustomerDebts: CustomerDebtGroup[];
  onAddManualDebt: (data: { name: string; phone: string; amount: string; note: string }) => Promise<boolean>;
}

const ManualDebtForm: React.FC<ManualDebtFormProps> = React.memo(({
  groupedCustomerDebts,
  onAddManualDebt
}) => {
  const [manualDebt, setManualDebt] = useState({ name: '', phone: '', amount: '', note: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const deferredName = useDeferredValue(manualDebt.name);
  const deferredPhone = useDeferredValue(manualDebt.phone);

  // Compute suggestions ONCE per deferred input change directly from pre-grouped customers
  const manualDebtSuggestions = useMemo(() => {
    return findCustomerSuggestionsFromGroups(deferredName, deferredPhone, groupedCustomerDebts, 45);
  }, [deferredName, deferredPhone, groupedCustomerDebts]);

  const topManualDebtMatch = useMemo(() => {
    if (!deferredName || deferredName.trim().length < 2) return null;
    const top = manualDebtSuggestions[0];
    if (!top || top.score < 85) return null;
    if (top.canonicalName.trim().toLowerCase() === deferredName.trim().toLowerCase()) {
      return null;
    }
    return top;
  }, [deferredName, manualDebtSuggestions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      const ok = await onAddManualDebt(manualDebt);
      if (ok) {
        setManualDebt({ name: '', phone: '', amount: '', note: '' });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs h-fit space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-extrabold text-stone-800 dark:text-stone-100 text-xs text-rose-800 dark:text-rose-400 flex items-center gap-1.5">
          <Plus size={16} /> تسجيل دين يدوي خارجي
        </h3>
        <span className="text-[10px] bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-bold px-2 py-0.5 rounded-full">
          دفتر الديون
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5 font-medium">اسم الحريف بالكامل</label>
          <input
            type="text"
            placeholder="اسم الحريف (مثال: أحمد الطرابلسي)"
            value={manualDebt.name}
            onChange={e => setManualDebt(prev => ({ ...prev, name: e.target.value }))}
            className="w-full bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 px-3 py-2 rounded-xl text-xs text-stone-800 dark:text-stone-100 focus:ring-2 focus:ring-rose-500 focus:outline-none"
          />

          {/* Smart Fuzzy Detection Alert Prompt */}
          {topManualDebtMatch && (
            <div className="mt-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 p-2.5 rounded-xl text-[11px] animate-fade-in space-y-1.5">
              <div className="flex items-start gap-1.5 text-amber-900 dark:text-amber-200 font-bold">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div>
                  <span>هل تقصد الحريف المسجل: </span>
                  <strong className="underline decoration-amber-500 font-black">{topManualDebtMatch.canonicalName}</strong>؟
                </div>
              </div>
              <div className="text-[10px] text-amber-800/80 dark:text-amber-300/80 pr-4">
                {topManualDebtMatch.reason}
                {topManualDebtMatch.totalRemaining > 0 && ` • لديه حالياً ديون قائمة بقيمة ${topManualDebtMatch.totalRemaining.toFixed(3)} د.ت`}
              </div>
              <button
                type="button"
                onClick={() => {
                  setManualDebt(prev => ({
                    ...prev,
                    name: topManualDebtMatch.canonicalName,
                    phone: topManualDebtMatch.phone || prev.phone
                  }));
                }}
                className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-1 px-2 rounded-lg text-[10px] flex items-center justify-center gap-1 cursor-pointer transition-all shadow-xs"
              >
                <UserCheck size={12} /> اعتماد اسم وبيانات "{topManualDebtMatch.canonicalName}"
              </button>
            </div>
          )}

          {/* Smart Quick Suggestion Pills */}
          {manualDebtSuggestions.length > 0 && !topManualDebtMatch && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              <span className="text-[9px] text-stone-400 dark:text-stone-500 w-full font-medium">حرفاء مسجلون مطابقون:</span>
              {manualDebtSuggestions.slice(0, 3).map((sug, i) => (
                <button
                  key={`${sug.canonicalName}-${sug.phone || i}`}
                  type="button"
                  onClick={() => setManualDebt(prev => ({ ...prev, name: sug.canonicalName, phone: sug.phone || prev.phone }))}
                  className="bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-800 dark:text-stone-200 px-2 py-0.5 rounded-full text-[10px] transition-colors border border-stone-200 dark:border-stone-700 cursor-pointer flex items-center gap-1"
                >
                  <span>👤 {sug.canonicalName}</span>
                  {sug.totalRemaining > 0 && (
                    <span className="text-rose-600 dark:text-rose-400 font-mono font-bold">({sug.totalRemaining.toFixed(3)} د.ت)</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5 font-medium">رقم هاتف الحريف</label>
          <input
            type="text"
            placeholder="رقم الهاتف (اختياري)"
            value={manualDebt.phone}
            onChange={e => setManualDebt(prev => ({ ...prev, phone: e.target.value }))}
            className="w-full bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 px-3 py-2 rounded-xl text-xs text-stone-800 dark:text-stone-100 font-mono focus:ring-2 focus:ring-rose-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5 font-medium">المبلغ د.ت</label>
          <input
            type="number"
            step="0.001"
            placeholder="0.000"
            value={manualDebt.amount}
            onChange={e => setManualDebt(prev => ({ ...prev, amount: e.target.value }))}
            className="w-full bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 px-3 py-2 rounded-xl text-xs text-stone-800 dark:text-stone-100 font-mono focus:ring-2 focus:ring-rose-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[10px] text-stone-500 dark:text-stone-400 mb-0.5 font-medium">تفاصيل وملاحظة الدين</label>
          <input
            type="text"
            placeholder="سلفة كاش، شاحن، بطاقة..."
            value={manualDebt.note}
            onChange={e => setManualDebt(prev => ({ ...prev, note: e.target.value }))}
            className="w-full bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 px-3 py-2 rounded-xl text-xs text-stone-800 dark:text-stone-100 focus:ring-2 focus:ring-rose-500 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl text-xs cursor-pointer shadow-xs transition-colors flex items-center justify-center gap-1.5"
        >
          <CreditCard size={14} /> سجل الدين بالدفتر 💳
        </button>
      </form>
    </div>
  );
});

interface DebtCustomerGroupCardProps {
  group: CustomerDebtGroup;
  isExpanded: boolean;
  currentRole: AppRole;
  onToggleExpand: (groupId: string) => void;
  onEditCustomer: (group: CustomerDebtGroup) => void;
  onPayCustomerGroup: (group: CustomerDebtGroup, isFullPayment: boolean) => void;
  onPayDebt: (debtId: string, fullPayment: boolean) => void;
  onDeleteDebt: (id: string) => void;
}

const DebtCustomerGroupCard: React.FC<DebtCustomerGroupCardProps> = React.memo(({
  group,
  isExpanded,
  currentRole,
  onToggleExpand,
  onEditCustomer,
  onPayCustomerGroup,
  onPayDebt,
  onDeleteDebt
}) => {
  const hasMultipleNames = group.allNames.length > 1;
  const oldestOpenDisplay = formatDateTN(group.oldestOpenDate || group.oldestDate);
  const latestOpenDisplay = formatDateTN(group.latestOpenDate || group.latestDate);
  const daysSinceOldest = getDaysElapsed(group.oldestOpenTs, group.oldestOpenDate || group.oldestDate);
  const hasDistinctOpenDates = group.openDebts.length > 1 && oldestOpenDisplay !== latestOpenDisplay;

  return (
    <div className="p-3.5 bg-stone-50 dark:bg-stone-800/60 hover:bg-stone-100/60 dark:hover:bg-stone-800 rounded-2xl border border-stone-200/80 dark:border-stone-700/80 transition-all space-y-2.5">
      {/* Group Top Row: Customer info & Total Balance */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="font-extrabold text-stone-900 dark:text-stone-100 text-sm flex items-center gap-1.5">
              <span className="w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center justify-center text-xs font-black">
                👤
              </span>
              <span>{group.canonicalName}</span>
              {currentRole === 'manager' && (
                <button
                  type="button"
                  onClick={() => onEditCustomer(group)}
                  className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors cursor-pointer"
                  title="تعديل اسم أو هاتف الحريف"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>

            {group.openDebts.length > 1 && (
              <span className="bg-amber-100 dark:bg-amber-950/80 text-amber-900 dark:text-amber-300 font-extrabold px-2 py-0.5 rounded-full text-[10px] tabular-nums">
                {group.openDebts.length} ديون مفتوحة ⚡
              </span>
            )}

            {group.phone && (
              <a
                href={`tel:${group.phone}`}
                className="text-[10px] text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 font-mono flex items-center gap-1 bg-white dark:bg-stone-900 px-2 py-0.5 rounded-full border border-stone-200 dark:border-stone-700"
              >
                <PhoneCall size={10} /> <span dir="ltr" className="inline-block font-mono">{group.phone}</span>
              </a>
            )}
          </div>

          {/* Unboxed Date & Overdue Metadata */}
          <div className="flex items-center flex-wrap gap-1.5 text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">
            {hasDistinctOpenDates ? (
              <>
                <span>
                  أقدم دين: <span dir="ltr" className="inline-block font-mono">{oldestOpenDisplay}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  آخر دين: <span dir="ltr" className="inline-block font-mono">{latestOpenDisplay}</span>
                </span>
              </>
            ) : (
              <span>
                التاريخ: <span dir="ltr" className="inline-block font-mono">{latestOpenDisplay}</span>
              </span>
            )}
            {daysSinceOldest >= 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className={daysSinceOldest >= 30 ? 'text-amber-700 dark:text-amber-400 font-bold' : ''}>
                  منذ {daysSinceOldest} يوم
                </span>
              </>
            )}
          </div>

          {/* Smart Multiple Names / Fuzzy Cluster Alert */}
          {hasMultipleNames && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/40 px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-800/60">
              <Merge size={12} className="shrink-0" />
              <span>رصد أسماء متشابهة: {group.allNames.join(' ، ')}</span>
              {currentRole === 'manager' && (
                <button
                  type="button"
                  onClick={() => onEditCustomer(group)}
                  className="mr-auto font-bold text-amber-900 dark:text-amber-200 underline hover:text-amber-700 cursor-pointer text-[10px]"
                >
                  توحيد الاسم 🪄
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right side: Amount & Settle Actions */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <div className="text-right">
            <div className="text-[10px] text-stone-400">إجمالي المتبقي</div>
            <div className="font-mono tabular-nums text-base font-black text-rose-700 dark:text-rose-400">
              {group.totalRemaining.toFixed(3)} د.ت
            </div>
          </div>
        </div>
      </div>

      {/* Customer Group Actions Bar */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-stone-200/60 dark:border-stone-700/60 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPayCustomerGroup(group, true)}
            className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-2.5 py-1 rounded-lg text-[10px] cursor-pointer transition-colors shadow-xs flex items-center gap-1"
            title="سداد كامل الديون المفتوحة لهذا الحريف دفعة واحدة"
          >
            <Check size={12} /> سداد كامل ({group.totalRemaining.toFixed(3)} د.ت)
          </button>

          <button
            type="button"
            onClick={() => onPayCustomerGroup(group, false)}
            className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2.5 py-1 rounded-lg text-[10px] cursor-pointer transition-colors shadow-xs flex items-center gap-1"
            title="تسديد دفعة على الحساب يتم توزيعها تلقائياً على أقدم الديون"
          >
            <CreditCard size={12} /> دفعة على الحساب 💵
          </button>
        </div>

        {/* Toggle breakdown button */}
        <button
          type="button"
          onClick={() => onToggleExpand(group.id)}
          className="text-stone-600 dark:text-stone-300 hover:text-stone-900 dark:hover:text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer px-2 py-1 rounded-lg hover:bg-stone-200/60 dark:hover:bg-stone-700 transition-colors"
        >
          <span>تفاصيل الديون ({group.debts.length})</span>
          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {/* Expanded Itemized Debt Records for this customer */}
      {isExpanded && (
        <div className="pt-2 border-t border-stone-200/60 dark:border-stone-700/60 space-y-2 animate-fade-in">
          <div className="text-[10px] font-bold text-stone-500 dark:text-stone-400 flex items-center justify-between">
            <span>سجل الديون الفردية الخاصة بـ "{group.canonicalName}":</span>
            {group.paidDebts.length > 0 && (
              <span className="font-normal text-stone-400 tabular-nums">
                {group.openDebts.length} مفتوح · {group.paidDebts.length} مخلص
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {group.debts.map((d, dIdx) => {
              const dRemaining = Math.max(0, roundTND3(d.amount - d.paid));
              const isPaid = d.status === 'paid' || dRemaining <= 0.001;

              return (
                <div
                  key={d.id || dIdx}
                  className={`p-2 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 border ${
                    isPaid
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/60 dark:border-emerald-800/40 opacity-75'
                      : 'bg-white dark:bg-stone-900 border-stone-200 dark:border-stone-700'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-stone-800 dark:text-stone-200 text-xs">
                        {d.note || 'دين'}
                      </span>
                      {d.customerName !== group.canonicalName && (
                        <span className="text-[9px] bg-stone-100 dark:bg-stone-800 text-stone-500 px-1.5 py-0.2 rounded">
                          سُجل باسم: {d.customerName}
                        </span>
                      )}
                      {isPaid && (
                        <span className="text-[9px] bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-300 font-bold px-1.5 py-0.2 rounded">
                          مخلص بالكامل ✅
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-stone-400">
                      التاريخ: <span dir="ltr" className="inline-block">{new Date(d.date).toLocaleDateString('fr-TN')}</span>
                      {d.customerPhone && (
                        <>
                          {' • 📞 '}
                          <span dir="ltr" className="inline-block font-mono">{d.customerPhone}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <div className="text-right font-mono text-xs font-bold">
                      <span className="text-stone-400 text-[10px]">الأصل: {d.amount.toFixed(3)}</span>{' '}
                      <span className={isPaid ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
                        المتبقي: {dRemaining.toFixed(3)} د.ت
                      </span>
                    </div>

                    {!isPaid && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onPayDebt(d.id, true)}
                          className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-2 py-0.5 rounded text-[10px] cursor-pointer"
                          title="سداد هذا الدين الفردي"
                        >
                          ✅ سداد
                        </button>
                        <button
                          type="button"
                          onClick={() => onPayDebt(d.id, false)}
                          className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2 py-0.5 rounded text-[10px] cursor-pointer"
                          title="سداد جزء من هذا الدين"
                        >
                          💵 جزء
                        </button>
                      </div>
                    )}

                    {currentRole === 'manager' && (
                      <button
                        type="button"
                        onClick={() => onDeleteDebt(d.id)}
                        className="text-stone-400 hover:text-red-700 cursor-pointer p-1 rounded hover:bg-red-50 dark:hover:bg-red-950"
                        title="حذف هذا الدين"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

export interface DebtsTabProps {
  debts: Debt[];
  groupedCustomerDebts: CustomerDebtGroup[];
  totalOwed: number;
  paidDebts: Debt[];
  currentRole: AppRole;
  onAddManualDebt: (data: { name: string; phone: string; amount: string; note: string }) => Promise<boolean>;
  onEditCustomer: (group: CustomerDebtGroup) => void;
  onPayCustomerGroup: (group: CustomerDebtGroup, isFullPayment: boolean) => void;
  onPayDebt: (debtId: string, fullPayment: boolean) => void;
  onDeleteDebt: (id: string) => void;
}

const INITIAL_GROUPED_LIMIT = 40;
const INITIAL_LIST_LIMIT = 50;

export const DebtsTab: React.FC<DebtsTabProps> = React.memo(({
  debts,
  groupedCustomerDebts,
  totalOwed,
  paidDebts,
  currentRole,
  onAddManualDebt,
  onEditCustomer,
  onPayCustomerGroup,
  onPayDebt,
  onDeleteDebt
}) => {
  const [debtSearch, setDebtSearch] = useState('');
  const deferredDebtSearch = useDeferredValue(debtSearch);

  const [debtViewMode, setDebtViewMode] = useState<'grouped' | 'list'>('grouped');
  const [sortBy, setSortBy] = useState<DebtSortOption>(readSavedSortOption);
  const [expandedCustomerGroups, setExpandedCustomerGroups] = useState<Record<string, boolean>>({});
  const [groupedLimit, setGroupedLimit] = useState(INITIAL_GROUPED_LIMIT);
  const [listLimit, setListLimit] = useState(INITIAL_LIST_LIMIT);

  const handleSortChange = useCallback((nextSort: DebtSortOption) => {
    setSortBy(nextSort);
    try {
      localStorage.setItem(DEBT_SORT_STORAGE_KEY, nextSort);
    } catch {
      // ignore storage errors
    }
  }, []);

  // Reset pagination limits when search query, view mode, or sort order changes
  useEffect(() => {
    setGroupedLimit(INITIAL_GROUPED_LIMIT);
    setListLimit(INITIAL_LIST_LIMIT);
  }, [deferredDebtSearch, debtViewMode, sortBy]);

  const normalizedQuery = useMemo(() => normalizeArabicFast(deferredDebtSearch), [deferredDebtSearch]);
  const rawSearchTrimmed = useMemo(() => deferredDebtSearch.trim(), [deferredDebtSearch]);

  const openCustomerGroups = useMemo(() => {
    const baseOpen = groupedCustomerDebts.filter(g => g.totalRemaining > 0.001);
    const filtered = (!normalizedQuery && !rawSearchTrimmed)
      ? baseOpen
      : baseOpen.filter(g =>
          g.allNames.some(n => normalizeArabicFast(n).includes(normalizedQuery)) ||
          (g.phone && g.phone.includes(rawSearchTrimmed))
        );

    const sorted = sortCustomerDebtGroups(filtered, sortBy);

    if (!normalizedQuery && !rawSearchTrimmed) {
      return sorted;
    }

    // Prioritize exact / prefix name or phone matches when actively searching
    const getGroupRank = (g: CustomerDebtGroup): number => {
      if (rawSearchTrimmed && g.phone === rawSearchTrimmed) return 3;
      if (normalizedQuery) {
        if (g.allNames.some(n => normalizeArabicFast(n) === normalizedQuery)) return 3;
        if (g.allNames.some(n => normalizeArabicFast(n).startsWith(normalizedQuery))) return 2;
      }
      if (rawSearchTrimmed && g.phone && g.phone.startsWith(rawSearchTrimmed)) return 2;
      return 1;
    };

    return [...sorted].sort((a, b) => getGroupRank(b) - getGroupRank(a));
  }, [groupedCustomerDebts, normalizedQuery, rawSearchTrimmed, sortBy]);

  const openDebts = useMemo(() => {
    const baseOpen = debts.filter(d => d.status === 'open');
    const filtered = (!normalizedQuery && !rawSearchTrimmed)
      ? baseOpen
      : baseOpen.filter(d =>
          normalizeArabicFast(d.customerName).includes(normalizedQuery) ||
          (d.customerPhone && d.customerPhone.includes(rawSearchTrimmed))
        );

    const effectiveSort: DebtSortOption = sortBy === 'most_debts' ? 'highest_amount' : sortBy;
    const sorted = sortIndividualDebts(filtered, effectiveSort);

    if (!normalizedQuery && !rawSearchTrimmed) {
      return sorted;
    }

    const getDebtRank = (d: Debt): number => {
      if (rawSearchTrimmed && d.customerPhone === rawSearchTrimmed) return 3;
      const normName = normalizeArabicFast(d.customerName);
      if (normalizedQuery) {
        if (normName === normalizedQuery) return 3;
        if (normName.startsWith(normalizedQuery)) return 2;
      }
      if (rawSearchTrimmed && d.customerPhone && d.customerPhone.startsWith(rawSearchTrimmed)) return 2;
      return 1;
    };

    return [...sorted].sort((a, b) => getDebtRank(b) - getDebtRank(a));
  }, [debts, normalizedQuery, rawSearchTrimmed, sortBy]);

  const visibleCustomerGroups = useMemo(() => {
    return openCustomerGroups.slice(0, groupedLimit);
  }, [openCustomerGroups, groupedLimit]);

  const visibleOpenDebts = useMemo(() => {
    return openDebts.slice(0, listLimit);
  }, [openDebts, listLimit]);

  const toggleExpandGroup = useCallback((groupId: string) => {
    setExpandedCustomerGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  const handleGroupedScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) {
      setGroupedLimit(prev => (prev < openCustomerGroups.length ? prev + 40 : prev));
    }
  }, [openCustomerGroups.length]);

  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) {
      setListLimit(prev => (prev < openDebts.length ? prev + 50 : prev));
    }
  }, [openDebts.length]);

  const sortOptions = useMemo(() => {
    const base: { id: DebtSortOption; label: string }[] = [
      { id: 'highest_amount', label: 'الأعلى مبلغاً' },
      { id: 'newest', label: 'الأحدث' },
      { id: 'oldest', label: 'الأقدم' },
      { id: 'lowest_amount', label: 'الأقل مبلغاً' },
      { id: 'name_asc', label: 'الاسم (أ-ي)' }
    ];
    if (debtViewMode === 'grouped') {
      base.splice(4, 0, { id: 'most_debts', label: 'الأكثر ديوناً' });
    }
    return base;
  }, [debtViewMode]);

  const activeSortForView: DebtSortOption =
    debtViewMode === 'list' && sortBy === 'most_debts' ? 'highest_amount' : sortBy;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Add debt form */}
      <ManualDebtForm
        groupedCustomerDebts={groupedCustomerDebts}
        onAddManualDebt={onAddManualDebt}
      />

      {/* Debts listing columns (width 2) */}
      <div className="md:col-span-2 space-y-4">
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs space-y-3">

          {/* Header with stats and View Mode Switcher */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-stone-100 dark:border-stone-800">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-stone-800 dark:text-stone-100 text-sm">📋 الديون المفتوحة</h3>
                <span className="bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 px-2.5 py-0.5 rounded-full text-[10px] font-black font-mono tabular-nums">
                  المجموع: {totalOwed.toFixed(3)} د.ت
                </span>
              </div>
              <p className="text-[11px] text-stone-500 dark:text-stone-400 mt-0.5 tabular-nums">
                {openCustomerGroups.length} حرفاء مدينين • إجمالي {openDebts.length} دين مفتوح
              </p>
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center bg-stone-100 dark:bg-stone-800 p-1 rounded-xl gap-1 text-xs shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setDebtViewMode('grouped')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold transition-all text-[11px] whitespace-nowrap shrink-0 cursor-pointer ${
                  debtViewMode === 'grouped'
                    ? 'bg-white dark:bg-stone-900 text-rose-700 dark:text-rose-400 shadow-xs'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                <Users size={13} /> تجميع ذكي للحرفاء ({openCustomerGroups.length})
              </button>
              <button
                type="button"
                onClick={() => setDebtViewMode('list')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-bold transition-all text-[11px] whitespace-nowrap shrink-0 cursor-pointer ${
                  debtViewMode === 'list'
                    ? 'bg-white dark:bg-stone-900 text-rose-700 dark:text-rose-400 shadow-xs'
                    : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-200'
                }`}
              >
                <Layers size={13} /> السجلات الفردية ({openDebts.length})
              </button>
            </div>
          </div>

          {/* Search Bar & Sort Toolbar */}
          <div className="space-y-2">
            <div className="relative">
              <input
                type="text"
                placeholder="🔍 فتش باسم الحريف (يتعرف على الحروف المختلفة والأرقام)..."
                value={debtSearch}
                onChange={e => setDebtSearch(e.target.value)}
                className="w-full bg-stone-50 dark:bg-stone-800/80 border border-stone-200 dark:border-stone-700 pl-10 pr-3 py-2 rounded-xl text-xs text-stone-800 dark:text-stone-100 focus:ring-2 focus:ring-rose-500 focus:outline-none"
              />
              <Search className="absolute left-3 top-2.5 text-stone-400" size={14} />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-stone-500 dark:text-stone-400 flex items-center gap-1 ml-1 shrink-0">
                <ArrowUpDown size={12} /> ترتيب:
              </span>
              <div className="flex items-center flex-wrap gap-1 bg-stone-100/90 dark:bg-stone-800/80 p-1 rounded-xl">
                {sortOptions.map(opt => {
                  const isActive = activeSortForView === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleSortChange(opt.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-white dark:bg-stone-900 text-rose-700 dark:text-rose-400 shadow-xs'
                          : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* GROUPED VIEW */}
          {debtViewMode === 'grouped' && (
            <div
              onScroll={handleGroupedScroll}
              className="space-y-3 max-h-[500px] overflow-y-auto pr-1"
            >
              {openCustomerGroups.length === 0 ? (
                <div className="text-center py-10 space-y-1 text-stone-400 dark:text-stone-500">
                  <CheckCircle size={32} className="mx-auto text-emerald-500 opacity-80" />
                  <p className="font-bold text-xs">لا يوجد أي ديون مفتوحة حالياً 🎉</p>
                  <p className="text-[10px]">كافة الحرفاء قاموا بتسوية مستحقاتهم بالكامل</p>
                </div>
              ) : (
                <>
                  {visibleCustomerGroups.map(group => (
                    <DebtCustomerGroupCard
                      key={group.id}
                      group={group}
                      isExpanded={!!expandedCustomerGroups[group.id]}
                      currentRole={currentRole}
                      onToggleExpand={toggleExpandGroup}
                      onEditCustomer={onEditCustomer}
                      onPayCustomerGroup={onPayCustomerGroup}
                      onPayDebt={onPayDebt}
                      onDeleteDebt={onDeleteDebt}
                    />
                  ))}
                  {openCustomerGroups.length > groupedLimit && (
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setGroupedLimit(prev => prev + 40)}
                        className="bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 font-bold px-4 py-2 rounded-xl text-xs cursor-pointer transition-colors"
                      >
                        عرض المزيد (+{Math.min(40, openCustomerGroups.length - groupedLimit)} من أصل {openCustomerGroups.length - groupedLimit} متبقي)
                      </button>
                      <button
                        type="button"
                        onClick={() => setGroupedLimit(openCustomerGroups.length)}
                        className="text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 font-bold px-3 py-2 rounded-xl text-[11px] cursor-pointer"
                      >
                        عرض الكل
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* FLAT LIST VIEW */}
          {debtViewMode === 'list' && (
            <div
              onScroll={handleListScroll}
              className="space-y-2 max-h-[500px] overflow-y-auto pr-1"
            >
              {openDebts.length === 0 ? (
                <p className="text-stone-400 text-center py-8 text-xs">لا يوجد أي ديون مفتوحة حالياً 🎉</p>
              ) : (
                <>
                  {visibleOpenDebts.map((d, idx) => {
                    const remaining = Math.max(0, roundTND3(d.amount - d.paid));
                    return (
                      <div key={d.id || idx} className="p-3 bg-stone-50 dark:bg-stone-800/60 hover:bg-stone-100/50 dark:hover:bg-stone-800 border border-stone-100 dark:border-stone-700/60 rounded-xl transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div>
                          <div className="font-bold text-stone-900 dark:text-stone-100">{d.customerName}</div>
                          {d.customerPhone && (
                            <div className="text-[10px] text-stone-400 font-mono">
                              📞 <span dir="ltr" className="inline-block font-mono">{d.customerPhone}</span>
                            </div>
                          )}
                          <div className="text-[10px] text-stone-500 dark:text-stone-400 mt-0.5">📝 التفاصيل: {d.note}</div>
                          <div className="text-[10px] text-stone-400 tabular-nums">
                            التاريخ: <span dir="ltr" className="inline-block font-mono">{formatDateTN(d.date)}</span>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="font-bold font-mono tabular-nums">
                            <span className="text-stone-400">المجموع: {d.amount.toFixed(3)}</span>{' '}
                            <span className="text-rose-700 dark:text-rose-400">المتبقي: {remaining.toFixed(3)} د.ت</span>
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => onPayDebt(d.id, true)} className="bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-2 py-1 rounded-lg text-[10px] cursor-pointer">
                              ✅ سداد كامل
                            </button>
                            <button onClick={() => onPayDebt(d.id, false)} className="bg-amber-600 hover:bg-amber-700 text-white font-bold px-2 py-1 rounded-lg text-[10px] cursor-pointer">
                              💵 جزء
                            </button>
                            {currentRole === 'manager' && (
                              <button onClick={() => onDeleteDebt(d.id)} className="text-stone-400 hover:text-red-700 cursor-pointer p-1">
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {openDebts.length > listLimit && (
                    <div className="flex items-center justify-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setListLimit(prev => prev + 50)}
                        className="bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-200 font-bold px-4 py-2 rounded-xl text-xs cursor-pointer transition-colors"
                      >
                        عرض المزيد (+{Math.min(50, openDebts.length - listLimit)} من أصل {openDebts.length - listLimit} متبقي)
                      </button>
                      <button
                        type="button"
                        onClick={() => setListLimit(openDebts.length)}
                        className="text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 font-bold px-3 py-2 rounded-xl text-[11px] cursor-pointer"
                      >
                        عرض الكل
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Recently paid debts */}
        <div className="bg-white dark:bg-stone-900 rounded-2xl border border-stone-200 dark:border-stone-800 p-5 shadow-xs text-xs">
          <h3 className="font-extrabold text-stone-800 dark:text-stone-100 text-xs mb-3 text-emerald-800 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle size={14} /> ديون مخلصة مؤخراً
          </h3>
          {paidDebts.length === 0 ? (
            <p className="text-stone-400 dark:text-stone-500 text-center py-6">لا توجد ديون مخلصة مسجلة</p>
          ) : (
            <div className="space-y-1.5">
              {paidDebts.map((d, idx) => (
                <div key={d.id || idx} className="flex justify-between items-center p-2.5 bg-emerald-50/45 dark:bg-emerald-950/30 rounded-xl border border-emerald-100 dark:border-emerald-900/40 gap-2">
                  <div className="min-w-0">
                    <span className="font-bold text-stone-800 dark:text-stone-200">{d.customerName}</span>
                    {d.note && <span className="text-[10px] text-stone-400 mr-2">{d.note}</span>}
                    <span className="text-[10px] text-stone-400 mr-2 tabular-nums">
                      · <span dir="ltr" className="inline-block font-mono">{formatDateTN(d.date)}</span>
                    </span>
                  </div>
                  <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-bold shrink-0">{d.amount.toFixed(3)} د.ت</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
