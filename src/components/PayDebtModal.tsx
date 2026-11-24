import React, { useState, useEffect } from 'react';
import { Debt } from '../types';
import { CustomerDebtGroup } from '../utils/customerDebtMatcher';
import { X, Check, CreditCard, User, AlertCircle, Building2, Briefcase } from 'lucide-react';

export interface PayDebtModalTarget {
  type: 'single' | 'group';
  debt?: Debt;
  group?: CustomerDebtGroup;
  defaultAmount?: number;
}

interface PayDebtModalProps {
  isOpen: boolean;
  onClose: () => void;
  target: PayDebtModalTarget | null;
  onConfirmPayment: (params: {
    target: PayDebtModalTarget;
    amount: number;
    destination: 'drawer' | 'manager';
    notes?: string;
  }) => Promise<void> | void;
}

export const PayDebtModal: React.FC<PayDebtModalProps> = ({
  isOpen,
  onClose,
  target,
  onConfirmPayment
}) => {
  const [payAmountInput, setPayAmountInput] = useState<string>('');
  const [destination, setDestination] = useState<'drawer' | 'manager'>('drawer');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const customerName = target?.type === 'group' 
    ? (target.group?.canonicalName || 'حريف')
    : (target?.debt?.customerName || 'حريف');

  const customerPhone = target?.type === 'group'
    ? target.group?.phone
    : target?.debt?.customerPhone;

  const totalRemaining = target?.type === 'group'
    ? (target.group?.totalRemaining || 0)
    : (target?.debt ? Math.max(0, target.debt.amount - target.debt.paid) : 0);

  const openDebtsCount = target?.type === 'group'
    ? (target.group?.openDebts.length || 0)
    : 1;

  useEffect(() => {
    if (isOpen && target) {
      const initialAmt = target.defaultAmount !== undefined 
        ? target.defaultAmount 
        : totalRemaining;
      setPayAmountInput(initialAmt.toFixed(3));
      setDestination('drawer');
      setIsSubmitting(false);
      setErrorMsg('');
    }
  }, [isOpen, target, totalRemaining]);

  if (!isOpen || !target) return null;

  const payAmount = parseFloat(payAmountInput) || 0;
  const isFullPayment = Math.abs(payAmount - totalRemaining) <= 0.005;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (payAmount <= 0) {
      setErrorMsg('يرجى إدخال مبلغ صحيح أكبر من 0.');
      return;
    }
    if (payAmount > totalRemaining + 0.001) {
      setErrorMsg(`المبلغ المدفوع (${payAmount.toFixed(3)}) يتجاوز إجمالي الدين المتبقي (${totalRemaining.toFixed(3)} د.ت)`);
      return;
    }
    setErrorMsg('');

    try {
      setIsSubmitting(true);
      await onConfirmPayment({
        target,
        amount: payAmount,
        destination
      });
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-fade-in font-sans" dir="rtl">
      <div className="bg-white dark:bg-stone-900 rounded-3xl border border-stone-200 dark:border-stone-800 p-5 sm:p-6 w-full max-w-lg shadow-2xl animate-scale-up text-right max-h-[92vh] flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-3.5 border-b border-stone-100 dark:border-stone-800">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 rounded-xl text-lg">
              💳
            </span>
            <div>
              <h3 className="font-extrabold text-stone-900 dark:text-stone-100 text-sm sm:text-base">
                سداد دين الحريف
              </h3>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                تسجيل دفعة نقدية وتحديد وجهة استلام المبلغ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 py-3 overflow-y-auto pr-1">
          {/* Customer Summary Card */}
          <div className="bg-stone-50 dark:bg-stone-800/60 p-3.5 rounded-2xl border border-stone-200/80 dark:border-stone-700/80 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 flex items-center justify-center text-xs font-bold">
                  <User size={14} />
                </span>
                <div>
                  <div className="font-extrabold text-stone-900 dark:text-stone-100 text-sm">
                    {customerName}
                  </div>
                  {customerPhone && (
                    <div className="text-[10px] text-stone-400 font-mono">
                      📞 <span dir="ltr" className="inline-block font-mono">{customerPhone}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="text-left">
                <div className="text-[10px] text-stone-400">إجمالي المستحق</div>
                <div className="font-mono text-base font-black text-rose-700 dark:text-rose-400">
                  {totalRemaining.toFixed(3)} د.ت
                </div>
              </div>
            </div>

            {target.type === 'group' && openDebtsCount > 1 && (
              <div className="text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/50 p-2 rounded-xl border border-amber-200/60 dark:border-amber-800/40">
                ⚡ سيتم توزيع المبلغ آلياً على {openDebtsCount} ديون مفتوحة بالترتيب من الأقدم للأحدث.
              </div>
            )}

            {target.type === 'single' && target.debt?.note && (
              <div className="text-[11px] text-stone-600 dark:text-stone-300 bg-white dark:bg-stone-900 p-2 rounded-xl border border-stone-200 dark:border-stone-700">
                📝 التفاصيل: {target.debt.note}
              </div>
            )}
          </div>

          {/* Payment Amount Input */}
          <div>
            <label className="block text-xs font-bold text-stone-700 dark:text-stone-300 mb-1.5">
              المبلغ المدفوع (د.ت)
            </label>
            <div className="relative">
              <input
                type="number"
                step="0.001"
                min="0.001"
                max={totalRemaining + 0.001}
                required
                value={payAmountInput}
                onChange={e => { setPayAmountInput(e.target.value); if (errorMsg) setErrorMsg(''); }}
                className="w-full bg-stone-50 dark:bg-stone-800 border-2 border-stone-200 dark:border-stone-700 focus:border-rose-500 dark:focus:border-rose-500 rounded-2xl px-3.5 py-2.5 text-base font-mono font-black text-stone-900 dark:text-stone-100 outline-none transition-all"
                placeholder="0.000"
              />
              <span className="absolute left-3.5 top-3 text-xs font-bold text-stone-400">
                د.ت
              </span>
            </div>

            {errorMsg && (
              <div className="mt-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-700 text-rose-800 dark:text-rose-200 text-[11px] font-bold flex items-center gap-1.5">
                <AlertCircle size={14} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {/* Quick Amount Buttons */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => setPayAmountInput(totalRemaining.toFixed(3))}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer border ${
                  isFullPayment
                    ? 'bg-emerald-700 text-white border-emerald-700 shadow-xs'
                    : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700 hover:bg-stone-200'
                }`}
              >
                ✅ كامل المبلغ ({totalRemaining.toFixed(3)})
              </button>

              {totalRemaining > 10 && (
                <button
                  type="button"
                  onClick={() => setPayAmountInput(Math.min(totalRemaining, 10).toFixed(3))}
                  className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700 hover:bg-stone-200 cursor-pointer"
                >
                  10.000 د.ت
                </button>
              )}

              {totalRemaining > 20 && (
                <button
                  type="button"
                  onClick={() => setPayAmountInput(Math.min(totalRemaining, 20).toFixed(3))}
                  className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700 hover:bg-stone-200 cursor-pointer"
                >
                  20.000 د.ت
                </button>
              )}

              {totalRemaining > 50 && (
                <button
                  type="button"
                  onClick={() => setPayAmountInput(Math.min(totalRemaining, 50).toFixed(3))}
                  className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 border border-stone-200 dark:border-stone-700 hover:bg-stone-200 cursor-pointer"
                >
                  50.000 د.ت
                </button>
              )}
            </div>
          </div>

          {/* Crucial Destination Selector (Drawer vs Manager's Pocket) */}
          <div className="space-y-2 pt-1">
            <label className="block text-xs font-extrabold text-stone-800 dark:text-stone-200">
              أين ذهب هذا المبلغ؟ (وجهة الاستلام)
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option 1: To Drawer / Caisse */}
              <button
                type="button"
                onClick={() => setDestination('drawer')}
                className={`p-3 rounded-2xl border-2 text-right transition-all flex flex-col justify-between gap-1.5 cursor-pointer ${
                  destination === 'drawer'
                    ? 'border-emerald-600 bg-emerald-50/80 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100 shadow-xs'
                    : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800/40 hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs flex items-center gap-1.5">
                    <Building2 size={16} className={destination === 'drawer' ? 'text-emerald-700 dark:text-emerald-400' : 'text-stone-400'} />
                    <span>إلى صندوق الكاسة (Caisse)</span>
                  </span>
                  {destination === 'drawer' && (
                    <span className="w-4 h-4 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]">
                      ✓
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-stone-500 dark:text-stone-400 leading-tight">
                  يُضاف لمدخول الوردية وحسابات الصندوق وتصفير الكاسة.
                </p>
                <span className="inline-block mt-0.5 text-[9px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100/80 dark:bg-emerald-900/60 px-2 py-0.5 rounded-full w-fit">
                  ✅ يُحتسب مع مبيعات الدرج
                </span>
              </button>

              {/* Option 2: To Manager's Pocket */}
              <button
                type="button"
                onClick={() => setDestination('manager')}
                className={`p-3 rounded-2xl border-2 text-right transition-all flex flex-col justify-between gap-1.5 cursor-pointer ${
                  destination === 'manager'
                    ? 'border-amber-600 bg-amber-50/80 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 shadow-xs'
                    : 'border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-800/40 hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-xs flex items-center gap-1.5">
                    <Briefcase size={16} className={destination === 'manager' ? 'text-amber-700 dark:text-amber-400' : 'text-stone-400'} />
                    <span>إلى جيب المدير مباشرة</span>
                  </span>
                  {destination === 'manager' && (
                    <span className="w-4 h-4 rounded-full bg-amber-600 text-white flex items-center justify-center text-[10px]">
                      ✓
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-stone-500 dark:text-stone-400 leading-tight">
                  استلمه المدير نقداً في جيبه أو بحسابه الخاص (خارج الكاسة).
                </p>
                <span className="inline-block mt-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100/80 dark:bg-amber-900/60 px-2 py-0.5 rounded-full w-fit">
                  🚫 لا يُحتسب في كاسة الوردية
                </span>
              </button>
            </div>

            {destination === 'manager' && (
              <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded-xl text-[10px] text-amber-900 dark:text-amber-200 flex items-start gap-1.5 animate-fade-in">
                <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div>
                  <strong>ملاحظة هامة:</strong> سيتم إسقاط وتخفيض هذا الدين من حساب الحريف فوراً، ولكن لن تتم مطالبة البائع بتسليم هذا المبلغ عند تصفير كاسة الوردية لأنه لم يدخل درج النقود.
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-stone-100 dark:border-stone-800">
            <button
              type="submit"
              disabled={isSubmitting || payAmount <= 0}
              className={`flex-1 font-bold py-2.5 px-4 rounded-2xl text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-md transition-all text-white ${
                destination === 'manager'
                  ? 'bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300'
                  : 'bg-emerald-700 hover:bg-emerald-800 disabled:bg-stone-300'
              }`}
            >
              <Check size={16} />
              <span>
                {isSubmitting
                  ? 'جاري التسجيل...'
                  : `تأكيد سداد ${payAmount.toFixed(3)} د.ت ${destination === 'manager' ? '(لجيب المدير)' : '(بالكاسة)'}`}
              </span>
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 dark:bg-stone-800 dark:hover:bg-stone-700 text-stone-700 dark:text-stone-300 rounded-2xl text-xs font-bold transition-colors cursor-pointer"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
