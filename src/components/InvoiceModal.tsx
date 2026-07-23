import React from 'react';
import { X, Printer } from 'lucide-react';

interface InvoiceLine {
  name: string;
  qty: number;
  unitPrice: number;
  total: number;
  customerPhone?: string;
}

export interface InvoiceData {
  id: string;
  lines: InvoiceLine[];
  grandTotal: number;
  date: string;
  isDebt: boolean;
  customerName?: string;
  downPayment?: number;
}

interface InvoiceModalProps {
  invoice: InvoiceData | null;
  onClose: () => void;
}

export const InvoiceModal: React.FC<InvoiceModalProps> = ({ invoice, onClose }) => {
  if (!invoice) return null;

  const dt = new Date(invoice.date);
  const dateStr = dt.toLocaleDateString('fr-TN') + ' - ' + dt.toLocaleTimeString('fr-TN', { hour: '2-digit', minute: '2-digit' });

  const qrText = [
    'Yosri GSM',
    `فاتورة: ${invoice.id || ''}`,
    `التاريخ: ${dateStr}`,
    invoice.customerName ? `الحريف: ${invoice.customerName}` : null,
    `المجموع: ${invoice.grandTotal.toFixed(3)} د.ت`,
    invoice.isDebt ? 'بيع بالدين' : 'بيع نقدي'
  ].filter(Boolean).join('\n');
  const qrImgUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' + encodeURIComponent(qrText);

  const handlePrint = () => {
    const printContent = document.getElementById('printable-invoice-area');
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      // If window.open is blocked, fallback to standard window.print() on the main page
      window.print();
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>فاتورة - Yosri GSM</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; color: #1c1a17; direction: rtl; }
          h1 { color: #8c0a20; margin-bottom: 0; }
          .shop-sub { color: #4a453d; font-size: 14px; margin-top: 2px; font-weight: 600; }
          .sub { color: #8a8172; font-size: 13px; margin-top: 4px; }
          .shop-info { margin-top: 10px; padding: 12px 16px; background: #f8f5ef; border-radius: 10px; font-size: 13px; color: #4a453d; line-height: 1.9; }
          .shop-info b { color: #1c1a17; }
          .customer-tag { display: inline-block; margin-top: 10px; background: #eef6f0; color: #2d6a3e; padding: 4px 12px; border-radius: 20px; font-size: 13px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th { background: #8c0a20; color: #fff; padding: 8px; text-align: right; }
          td { padding: 8px; border-bottom: 1px solid #eee; }
          .total-row td { font-weight: bold; font-size: 16px; padding-top: 14px; border-top: 2px solid #8c0a20; }
          .debt-tag { display: inline-block; margin-top: 10px; background: #fbe9e5; color: #b3452f; padding: 4px 12px; border-radius: 20px; font-size: 13px; }
          .qr-wrap { margin-top: 28px; text-align: center; }
          .qr-wrap img { width: 130px; height: 130px; }
          .qr-wrap .qr-label { color: #8a8172; font-size: 11px; margin-top: 6px; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
        <div style="margin-top: 24px; text-align: center;" class="no-print">
          <button onclick="window.print()" style="background: #8c0a20; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; cursor: pointer;">🖨️ طباعة الفاتورة</button>
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col border border-stone-200">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between p-4 border-b border-stone-100 bg-stone-50 rounded-t-2xl">
          <h3 className="font-bold text-stone-800 text-lg">📄 معاينة الفاتورة قبل الطباعة</h3>
          <button 
            onClick={onClose}
            className="p-1 rounded-full hover:bg-stone-200 text-stone-500 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Content / Printable Area */}
        <div className="p-6 overflow-y-auto" id="printable-invoice-area">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-700 tracking-tight">Yosri GSM</h1>
            <div className="text-stone-700 font-semibold text-xs mt-1">بيع و تصليح الهاتف الجوال</div>
            <div className="text-stone-400 text-[11px] mt-1">فاتورة بيع — {dateStr}</div>
          </div>

          <div className="mt-4 p-3 bg-stone-50 rounded-xl text-stone-600 text-xs leading-relaxed border border-stone-100">
            📍 <span className="font-bold text-stone-800">العنوان:</span> نبر، الكاف<br />
            📞 <span className="font-bold text-stone-800">الهاتف:</span> 41 444 355 — 98 674 871
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            {invoice.customerName && (
              <span className="inline-block bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-medium border border-emerald-100">
                👤 الحريف: {invoice.customerName}
              </span>
            )}
            {invoice.isDebt ? (
              <span className="inline-block bg-rose-50 text-rose-700 px-3 py-1 rounded-full text-xs font-medium border border-rose-100">
                🧾 بيع بالدين
              </span>
            ) : (
              <span className="inline-block bg-stone-100 text-stone-700 px-3 py-1 rounded-full text-xs font-medium">
                💵 بيع نقدي
              </span>
            )}
          </div>

          {/* Lines Table */}
          <table className="w-full mt-5 text-right border-collapse text-xs">
            <thead>
              <tr className="bg-red-700 text-white font-medium">
                <th className="p-2 text-right rounded-r-lg">السلعة / الخدمة</th>
                <th className="p-2 text-center">الكمية</th>
                <th className="p-2 text-center">السعر</th>
                <th className="p-2 text-left rounded-l-lg">المجموع</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((l, idx) => (
                <tr key={idx} className="border-b border-stone-100">
                  <td className="p-2 font-medium text-stone-800">{l.name}</td>
                  <td className="p-2 text-center text-stone-600">{l.qty}</td>
                  <td className="p-2 text-center text-stone-600">{l.unitPrice.toFixed(3)}</td>
                  <td className="p-2 text-left text-stone-800 font-bold">{l.total.toFixed(3)}</td>
                </tr>
              ))}
              <tr className="font-bold text-stone-900 bg-amber-50/50">
                <td colSpan={3} className="p-3 text-right text-stone-700 text-sm">المجموع الكلي</td>
                <td className="p-3 text-left text-red-700 text-sm font-extrabold">{invoice.grandTotal.toFixed(3)} د.ت</td>
              </tr>
              {invoice.isDebt && invoice.downPayment !== undefined && invoice.downPayment > 0 && (
                <>
                  <tr className="text-stone-700 bg-emerald-50/50 text-xs font-bold">
                    <td colSpan={3} className="p-2 text-right text-emerald-800">الدفعة الأولى (تسبيق نقدي)</td>
                    <td className="p-2 text-left text-emerald-800 font-extrabold">{invoice.downPayment.toFixed(3)} د.ت</td>
                  </tr>
                  <tr className="text-stone-900 bg-rose-50/50 text-xs font-bold">
                    <td colSpan={3} className="p-2 text-right text-rose-800">المتبقي بالدين</td>
                    <td className="p-2 text-left text-rose-800 font-extrabold">{Math.max(0, invoice.grandTotal - invoice.downPayment).toFixed(3)} د.ت</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>

          {/* QR Code */}
          <div className="mt-6 flex flex-col items-center justify-center">
            <img src={qrImgUrl} alt="QR Code" className="w-28 h-28 border border-stone-200 p-1 rounded-lg shadow-xs" />
            <span className="text-[10px] text-stone-400 mt-1">رمز الفاتورة: {invoice.id}</span>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="p-4 border-t border-stone-100 bg-stone-50 flex gap-3 rounded-b-2xl">
          <button
            onClick={handlePrint}
            className="flex-1 bg-red-700 hover:bg-red-800 text-white font-semibold py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-red-700/10 active:scale-[0.98]"
          >
            <Printer size={18} />
            اطبع / احفظ PDF
          </button>
          <button
            onClick={onClose}
            className="bg-stone-200 hover:bg-stone-300 text-stone-700 font-semibold py-2.5 px-4 rounded-xl transition-all cursor-pointer active:scale-[0.98]"
          >
            إغلاق
          </button>
        </div>

      </div>
    </div>
  );
};
