import React, { useState } from 'react';
import { Item } from '../types';
import { SimilarityResult } from '../utils/productSimilarity';
import { AlertTriangle, CheckCircle, PackagePlus, Plus, Sparkles, X, ArrowLeftRight, Layers, Tag } from 'lucide-react';

interface DuplicateProductModalProps {
  isOpen: boolean;
  newItemInput: {
    name: string;
    barcode: string;
    buy: string;
    sell: string;
    qty: string;
    category: string;
    imageUrl?: string;
  };
  similarCandidates: SimilarityResult[];
  onConfirmIncreaseQuantity: (existingItem: Item, addedQty: number, buyPrice: number, sellPrice: number) => void;
  onConfirmCreateNew: () => void;
  onClose: () => void;
}

export const DuplicateProductModal: React.FC<DuplicateProductModalProps> = ({
  isOpen,
  newItemInput,
  similarCandidates,
  onConfirmIncreaseQuantity,
  onConfirmCreateNew,
  onClose
}) => {
  if (!isOpen || similarCandidates.length === 0) return null;

  // Selected candidate index (default to 0 - highest similarity)
  const [selectedIndex, setSelectedIndex] = useState(0);
  const currentMatch = similarCandidates[selectedIndex] || similarCandidates[0];
  const existingItem = currentMatch.item;

  const newQty = parseInt(newItemInput.qty) || 1;
  const newBuyPrice = parseFloat(newItemInput.buy) || existingItem.buy;
  const newSellPrice = parseFloat(newItemInput.sell) || existingItem.sell;

  const [customAddedQty, setCustomAddedQty] = useState<number>(newQty);

  const getBadgeColor = (score: number) => {
    if (score >= 85) return 'bg-red-100 text-red-800 border-red-300';
    if (score >= 70) return 'bg-amber-100 text-amber-800 border-amber-300';
    return 'bg-blue-100 text-blue-800 border-blue-300';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full overflow-hidden border border-stone-200 flex flex-col max-h-[92vh] text-stone-800 font-sans">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-red-600 px-5 py-4 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-2xl backdrop-blur-md">
              <Sparkles size={22} className="text-amber-100 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-base sm:text-lg">اكتشاف منتج مشابه في المخزن</h3>
                <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border bg-white text-stone-900 shadow-sm`}>
                  تشابه {currentMatch.overallScore}%
                </span>
              </div>
              <p className="text-xs text-amber-100 font-medium">
                وجدنا منتجًا موجودًا بنسبة تشابه {currentMatch.overallScore}%
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white bg-black/10 hover:bg-black/20 p-2 rounded-xl transition-colors cursor-pointer"
            title="إغلاق"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
          
          {/* Multiple candidates selector tabs if more than one match */}
          {similarCandidates.length > 1 && (
            <div className="bg-stone-100 p-2 rounded-2xl border border-stone-200">
              <p className="text-[11px] font-bold text-stone-600 mb-1.5 px-1">المنتجات المشابهة المحتملة ({similarCandidates.length}):</p>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {similarCandidates.map((cand, idx) => (
                  <button
                    key={cand.item.id}
                    onClick={() => {
                      setSelectedIndex(idx);
                      setCustomAddedQty(newQty);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-all border ${
                      selectedIndex === idx
                        ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                        : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    {cand.item.name} ({cand.overallScore}%)
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Alert Message */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex items-start gap-3">
            <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
            <div className="text-xs text-amber-900 leading-relaxed">
              <p className="font-extrabold text-amber-950 mb-0.5">
                وجدنا منتجًا مشابهًا بنسبة {currentMatch.overallScore}%
              </p>
              قد يكون المنتج الذي تحاول إضافته هو نفسه السلعة الموجودة في الستوك. اختر دمج الكمية لمنع التكرار وضمان صحة المخزون.
            </div>
          </div>

          {/* Side-by-Side Comparison Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            
            {/* Existing Product Card */}
            <div className="bg-stone-50 border-2 border-stone-200 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-2 left-2 bg-stone-200 text-stone-700 text-[10px] font-black px-2 py-0.5 rounded-lg">
                المنتج الموجود
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2 pt-2">
                  {existingItem.imageUrl ? (
                    <img src={existingItem.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover border border-stone-300" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-stone-200 flex items-center justify-center text-stone-500 font-bold text-xs">
                      لا صورة
                    </div>
                  )}
                  <div>
                    <h4 className="font-black text-sm text-stone-900 leading-tight">{existingItem.name}</h4>
                    <span className="text-[10px] text-stone-500 font-bold bg-white px-2 py-0.5 rounded border border-stone-200 inline-block mt-1">
                      {existingItem.category || 'عام'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs border-t border-stone-200 pt-3.5 mt-2">
                  <div className="flex justify-between text-stone-600">
                    <span>المخزون الحالي:</span>
                    <span className="font-black text-stone-900 bg-amber-100 text-amber-900 px-2 py-0.5 rounded-lg">
                      {existingItem.qty} قطعة
                    </span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>سعر البيع الحالي:</span>
                    <span className="font-mono font-bold text-stone-800">{existingItem.sell.toFixed(3)} د.ت</span>
                  </div>
                  {existingItem.buy > 0 && (
                    <div className="flex justify-between text-stone-500 text-[11px]">
                      <span>سعر الشراء:</span>
                      <span className="font-mono">{existingItem.buy.toFixed(3)} د.ت</span>
                    </div>
                  )}
                  {existingItem.barcodes && existingItem.barcodes.length > 0 && (
                    <div className="text-[10px] text-stone-500 font-mono truncate pt-1">
                      الباركود: {existingItem.barcodes.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* New Input Product Card */}
            <div className="bg-amber-50/70 border-2 border-amber-300 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-2 left-2 bg-amber-200 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-lg">
                المنتج الجديد
              </div>
              <div>
                <div className="flex items-center gap-3 mb-2 pt-2">
                  {newItemInput.imageUrl ? (
                    <img src={newItemInput.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover border border-amber-300" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-xs">
                      جديد
                    </div>
                  )}
                  <div>
                    <h4 className="font-black text-sm text-stone-900 leading-tight">{newItemInput.name}</h4>
                    <span className="text-[10px] text-amber-800 font-bold bg-white px-2 py-0.5 rounded border border-amber-200 inline-block mt-1">
                      {newItemInput.category || 'عام'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 text-xs border-t border-amber-200 pt-3.5 mt-2">
                  <div className="flex justify-between text-stone-600">
                    <span>الكمية المراد إضافتها:</span>
                    <span className="font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-lg">
                      +{newQty} قطعة
                    </span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>سعر البيع الجديد:</span>
                    <span className="font-mono font-bold text-stone-800">
                      {newSellPrice.toFixed(3)} د.ت
                    </span>
                  </div>
                  {newBuyPrice > 0 && (
                    <div className="flex justify-between text-stone-500 text-[11px]">
                      <span>سعر الشراء الجديد:</span>
                      <span className="font-mono">{newBuyPrice.toFixed(3)} د.ت</span>
                    </div>
                  )}
                  {newItemInput.barcode && (
                    <div className="text-[10px] text-amber-800 font-mono truncate pt-1">
                      الباركود: {newItemInput.barcode}
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* Match Reasons */}
          {currentMatch.reasons && currentMatch.reasons.length > 0 && (
            <div className="bg-stone-50 p-3 rounded-2xl border border-stone-200">
              <p className="text-xs font-bold text-stone-700 mb-1.5 flex items-center gap-1.5">
                <CheckCircle size={14} className="text-emerald-600" />
                عوامل التشابه التي تم رصدها:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {currentMatch.reasons.map((reason, rIdx) => (
                  <span key={rIdx} className="text-[11px] font-bold bg-white text-stone-800 border border-stone-200 px-2.5 py-1 rounded-xl">
                    {reason}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Quantity adjustment input for option 1 */}
          <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-2xl flex items-center justify-between gap-3">
            <div className="text-xs font-bold text-emerald-950">
              تحديد الكمية المضافة للمنتج الحالي:
              <span className="block text-[10px] font-normal text-emerald-700">
                المخزون الجديد سيكون: {existingItem.qty} + {customAddedQty} = <strong className="text-emerald-900 font-black">{existingItem.qty + customAddedQty} قطعة</strong>
              </span>
            </div>
            <div className="flex items-center gap-1 bg-white border border-emerald-300 rounded-xl p-1 shrink-0">
              <button
                type="button"
                onClick={() => setCustomAddedQty(Math.max(1, customAddedQty - 1))}
                className="w-7 h-7 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold rounded-lg flex items-center justify-center text-sm cursor-pointer"
              >
                -
              </button>
              <input
                type="number"
                min="1"
                value={customAddedQty}
                onChange={e => setCustomAddedQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-12 text-center text-xs font-black font-mono text-emerald-900 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCustomAddedQty(customAddedQty + 1)}
                className="w-7 h-7 bg-stone-100 hover:bg-stone-200 text-stone-800 font-bold rounded-lg flex items-center justify-center text-sm cursor-pointer"
              >
                +
              </button>
            </div>
          </div>

        </div>

        {/* Footer with ONLY the 2 choices requested */}
        <div className="bg-stone-100 px-4 py-3 border-t border-stone-200 flex flex-col sm:flex-row gap-2.5 shrink-0">
          
          {/* Option 1: Increase Quantity of Existing Product */}
          <button
            type="button"
            onClick={() => onConfirmIncreaseQuantity(existingItem, customAddedQty, newBuyPrice, newSellPrice)}
            className="flex-1 bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold py-3 px-4 rounded-2xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-700/15 transition-all"
          >
            <PackagePlus size={18} />
            <span>زيادة كمية المنتج الموجود ({existingItem.qty} ➔ {existingItem.qty + customAddedQty})</span>
          </button>

          {/* Option 2: Create New Product Despite Similarity */}
          <button
            type="button"
            onClick={onConfirmCreateNew}
            className="bg-stone-800 hover:bg-stone-900 text-stone-100 font-bold py-3 px-4 rounded-2xl text-xs flex items-center justify-center gap-2 cursor-pointer border border-stone-700 transition-all shrink-0"
          >
            <Plus size={16} />
            <span>إنشاء منتج جديد رغم التشابه</span>
          </button>

        </div>

      </div>
    </div>
  );
};
