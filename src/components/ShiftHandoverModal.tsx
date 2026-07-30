import React, { useState } from 'react';
import { Sale, OtherIncome, Expense } from '../types';

interface ShiftHandoverModalProps {
  isOpen: boolean;
  onClose: () => void;
  lastResetTimestamp: string | null;
  startingCash: number;
  currentShiftSales: Sale[];
  currentShiftOtherIncome: OtherIncome[];
  currentShiftExpenses: Expense[];
  outboxCount?: number;
  onFlushOutbox?: () => Promise<any>;
  onPerformReset: (data: {
    sellerName: string;
    salesTotal: number;
    otherIncomeTotal: number;
    expensesTotal: number;
    expectedCash: number;
    actualCash: number;
    cashWithdrawn: number;
    newStartingCash: number;
    notes: string;
  }) => void;
}

export const ShiftHandoverModal: React.FC<ShiftHandoverModalProps> = ({
  isOpen,
  onClose,
  lastResetTimestamp,
  startingCash,
  currentShiftSales,
  currentShiftOtherIncome,
  currentShiftExpenses,
  outboxCount = 0,
  onFlushOutbox,
  onPerformReset
}) => {
  if (!isOpen) return null;

  const salesTotal = currentShiftSales.reduce((sum, s) => sum + s.total, 0);
  const otherIncomeTotal = currentShiftOtherIncome.reduce((sum, o) => sum + o.amount, 0);
  const expensesTotal = currentShiftExpenses.reduce((sum, e) => sum + e.amount, 0);
  
  const expectedCash = startingCash + salesTotal + otherIncomeTotal - expensesTotal;

  const [sellerName, setSellerName] = useState('الوردية الصباحية');
  const [actualCashInput, setActualCashInput] = useState(expectedCash.toFixed(3));
  const [newStartingCashInput, setNewStartingCashInput] = useState('0.000');
  const [notes, setNotes] = useState('');

  const actualCash = parseFloat(actualCashInput) || 0;
  const newStartingCash = parseFloat(newStartingCashInput) || 0;
  const cashWithdrawn = Math.max(0, actualCash - newStartingCash);
  const difference = actualCash - expectedCash;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (outboxCount > 0) {
      const confirmForce = window.confirm(
        `⚠️ تحذير هام جداً:\nيوجد ${outboxCount} عملية مسجلة محلياً ولم تُرسل بعد للسحابة من هذا الجهاز!\n\n` +
        `إذا قمت بالتصفير الآن دون إرسالها، فلن تُحسب هذه المبيعات في السيرفر السحابي وقد تسبب فارقاً في الكاش.\n\n` +
        `يرجى التأكد من تشغيل الإنترنت والضغط على زر "إعادة محاولة إرسال العمليات".\n\n` +
        `هل تريد التصفير والتسليم رغم ذلك؟`
      );
      if (!confirmForce) return;
    }

    onPerformReset({
      sellerName,
      salesTotal,
      otherIncomeTotal,
      expensesTotal,
      expectedCash,
      actualCash,
      cashWithdrawn,
      newStartingCash,
      notes
    });
  };

  const formattedStartTime = lastResetTimestamp 
    ? new Date(lastResetTimestamp).toLocaleString('ar-TN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
    : 'بداية اليوم';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 animate-fade-in font-sans" dir="rtl">
      <div className="bg-white rounded-3xl border border-stone-200 p-5 sm:p-6 w-full max-w-xl shadow-2xl animate-scale-up text-right max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-stone-100">
          <div className="flex items-center gap-2.5">
            <span className="p-2.5 bg-amber-100 text-amber-800 rounded-2xl text-xl">📋</span>
            <div>
              <h3 className="font-extrabold text-stone-900 text-base sm:text-lg">
                تصفير الكاسة وتسليم الوردية
              </h3>
              <p className="text-stone-500 text-xs">
                فصل حسابات البائع الصباحي والمسائي ومطابقة الصندوق
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="text-stone-400 hover:text-stone-700 p-2 rounded-xl hover:bg-stone-100 transition-colors cursor-pointer text-xl font-bold"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleFormSubmit} className="space-y-4 py-4 overflow-y-auto pr-1 flex-1">
          {/* Outbox Pending Warning Card */}
          {outboxCount > 0 && (
            <div className="bg-rose-500 text-white p-3.5 rounded-2xl border-2 border-rose-700 shadow-md text-xs space-y-2">
              <div className="flex items-center justify-between gap-2 font-black">
                <span className="text-sm">⚠️ يوجد {outboxCount} عملية معلقة لم تُرسل للسحابة!</span>
                {onFlushOutbox && (
                  <button
                    type="button"
                    onClick={onFlushOutbox}
                    className="bg-white text-rose-900 hover:bg-rose-100 font-black px-3 py-1 rounded-xl text-[11px] cursor-pointer shadow-xs transition-colors shrink-0"
                  >
                    إرسال الآن 🔄
                  </button>
                )}
              </div>
              <p className="leading-relaxed opacity-95">
                هذه العمليات مسجلة محلياً على هذا الجهاز فقط. يرجى التأكد من تشغيل الواي فاي والضغط على زر الإرسال قبل التصفير لتفادي أي فارق بالصندوق.
              </p>
            </div>
          )}

          {/* Shift Info Banner */}
          <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3 text-xs text-stone-600 flex justify-between items-center">
            <div>
              <span className="font-bold text-stone-800">بداية الوردية الحالية:</span> {formattedStartTime}
            </div>
            <div>
              <span className="font-bold text-stone-800">عدد العمليات:</span> {currentShiftSales.length + currentShiftOtherIncome.length}
            </div>
          </div>

          {/* Current Shift Summary Breakdown */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl text-center">
              <span className="text-emerald-800 font-bold block text-[11px]">مبيعات السلع والخدمات</span>
              <span className="font-mono font-black text-emerald-700 text-sm">{(salesTotal + otherIncomeTotal).toFixed(3)} د.ت</span>
            </div>
            <div className="bg-rose-50 border border-rose-200 p-2.5 rounded-xl text-center">
              <span className="text-rose-800 font-bold block text-[11px]">المصاريف اليومية</span>
              <span className="font-mono font-black text-rose-700 text-sm">{expensesTotal.toFixed(3)} د.ت</span>
            </div>
          </div>

          {/* Expected Cash in Drawer Card */}
          <div className="bg-amber-500 text-white p-4 rounded-2xl shadow-md text-center">
            <span className="text-xs text-amber-100 font-bold block">💰 الكاش المفترض توفره بالدرج لهذه الوردية</span>
            <div className="font-mono text-2xl font-black my-1">{expectedCash.toFixed(3)} د.ت</div>
            <div className="text-[10px] text-amber-100 opacity-90 font-mono dir-ltr">
              ({startingCash.toFixed(3)} كاش بداية + {(salesTotal + otherIncomeTotal).toFixed(3)} مداخيل - {expensesTotal.toFixed(3)} مصاريف)
            </div>
          </div>

          {/* Handover Inputs */}
          <div className="space-y-3 bg-stone-50 p-3.5 rounded-2xl border border-stone-200">
            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1">
                🏷️ اسم الوردية / البائع الصباحي:
              </label>
              <input
                type="text"
                value={sellerName}
                onChange={e => setSellerName(e.target.value)}
                placeholder="مثال: الوردية الصباحية - علي"
                className="w-full bg-white border border-stone-200 px-3 py-2 rounded-xl text-xs font-bold text-stone-800"
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-stone-800 mb-1">
                  💵 الكاش الفعلي الموجود بالصندوق الآن:
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={actualCashInput}
                  onChange={e => setActualCashInput(e.target.value)}
                  className="w-full bg-white border-2 border-stone-300 focus:border-amber-500 px-3 py-2 rounded-xl font-mono text-sm font-bold text-stone-900"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-stone-800 mb-1">
                  📥 كاش البداية للوردية القادمة (المتبقي بالدرج):
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={newStartingCashInput}
                  onChange={e => setNewStartingCashInput(e.target.value)}
                  className="w-full bg-white border-2 border-stone-300 focus:border-amber-500 px-3 py-2 rounded-xl font-mono text-sm font-bold text-stone-900"
                  required
                />
              </div>
            </div>

            {/* Difference / Discrepancy Notice */}
            {Math.abs(difference) >= 0.001 ? (
              <div className={`p-2.5 rounded-xl text-xs font-bold flex justify-between items-center ${
                difference < 0 ? 'bg-rose-100 text-rose-900 border border-rose-300' : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
              }`}>
                <span>{difference < 0 ? '⚠️ يوجد عجز بالصندوق بقيمة:' : '✨ يوجد فائض بالصندوق بقيمة:'}</span>
                <span className="font-mono text-sm font-black">{Math.abs(difference).toFixed(3)} د.ت</span>
              </div>
            ) : (
              <div className="p-2 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 text-center">
                ✅ الحسابات متطابقة تماماً 100% مع المبلغ المفترض بالصندوق
              </div>
            )}

            {/* Amount Withdrawn Summary */}
            <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl flex justify-between items-center text-xs">
              <span className="font-bold text-blue-900">🏦 الصافي المسحوب للخزنة / المدير:</span>
              <span className="font-mono text-base font-black text-blue-700">{cashWithdrawn.toFixed(3)} د.ت</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-stone-700 mb-1">
                📝 ملاحظات إضافية (اختياري):
              </label>
              <input
                type="text"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="أدخل أي ملاحظة تخص تسليم الوردية..."
                className="w-full bg-white border border-stone-200 px-3 py-1.5 rounded-xl text-xs text-stone-800"
              />
            </div>
          </div>

          {/* Notice about Cloud cleanup & PDF generation */}
          <div className="bg-amber-50 border border-amber-200 p-3 rounded-2xl text-[11px] text-amber-900 flex items-center gap-2">
            <span className="text-base">📄</span>
            <div>
              <p className="font-bold">توليد تقرير PDF حيني وتفريغ السحابة تلقائياً:</p>
              <p className="text-amber-800/90 text-[10px]">
                سيتم استخراج تقرير PDF رسمي مفصل للوردية وتصفير المبيعات من الفايربيز للحفاظ على مجانية وقوة السيرفر.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setActualCashInput(expectedCash.toFixed(3));
                setNewStartingCashInput('0.000');
              }}
              className="w-full sm:w-auto px-3 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-[11px] cursor-pointer flex items-center justify-center gap-1"
            >
              <span>⚡ ضبط مطابقة تلقائية (100%)</span>
            </button>
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 rounded-xl border border-stone-200 text-stone-600 hover:bg-stone-100 font-bold text-xs cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-black text-xs cursor-pointer shadow-md transition-all flex items-center gap-1.5"
              >
                <span>🔄 تأكيد التصفير وتوليد PDF</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
