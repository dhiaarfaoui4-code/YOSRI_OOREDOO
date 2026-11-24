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
  customerPhone?: string;
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
    invoice.customerPhone ? `الهاتف: ${invoice.customerPhone}` : null,
    `المجموع: ${invoice.grandTotal.toFixed(3)} د.ت`,
    invoice.isDebt ? 'بيع بالدين' : 'بيع نقدي'
  ].filter(Boolean).join('\n');
  const qrImgUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=' + encodeURIComponent(qrText);

  const handlePrint = () => {
    const printContent = document.getElementById('printable-invoice-area');
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
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
          * { box-sizing: border-box; }
          body { font-family: system-ui, -apple-system, 'Segoe UI', Tahoma, Arial, sans-serif; padding: 24px; color: #1c1917; direction: rtl; margin: 0; }
          .ltr-num, [dir="ltr"] { direction: ltr !important; unicode-bidi: isolate !important; display: inline-block; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-left { text-align: left; }
          .font-bold { font-weight: 700; }
          .font-extrabold { font-weight: 800; }
          .font-semibold { font-weight: 600; }
          .font-medium { font-weight: 500; }
          .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
          .text-2xl { font-size: 22px; margin: 0; }
          .text-sm { font-size: 14px; }
          .text-xs { font-size: 12px; }
          .text-\\[11px\\] { font-size: 11px; }
          .text-\\[10px\\] { font-size: 10px; }
          .text-red-700 { color: #b91c1c; }
          .text-stone-800 { color: #292524; }
          .text-stone-700 { color: #44403c; }
          .text-stone-600 { color: #57534e; }
          .text-stone-400 { color: #a8a29e; }
          .text-emerald-700, .text-emerald-800 { color: #047857; }
          .text-rose-700, .text-rose-800 { color: #be123c; }
          .text-white { color: #ffffff; }
          .bg-stone-50 { background-color: #fafaf9; }
          .bg-stone-100 { background-color: #f5f5f4; }
          .bg-emerald-50, .bg-emerald-50\\/50 { background-color: #ecfdf5; }
          .bg-rose-50, .bg-rose-50\\/50 { background-color: #fff1f2; }
          .bg-amber-50\\/50 { background-color: #fffbeb; }
          .bg-red-700 { background-color: #b91c1c; }
          .border { border: 1px solid #e7e5e4; }
          .border-b { border-bottom: 1px solid #f5f5f4; }
          .border-stone-100 { border-color: #f5f5f4; }
          .border-stone-200 { border-color: #e7e5e4; }
          .border-emerald-100 { border-color: #d1fae5; }
          .border-rose-100 { border-color: #ffe4e6; }
          .rounded-xl { border-radius: 12px; }
          .rounded-lg { border-radius: 8px; }
          .rounded-full { border-radius: 9999px; }
          .p-1 { padding: 4px; }
          .p-2 { padding: 8px; }
          .p-3 { padding: 12px; }
          .px-3 { padding-left: 12px; padding-right: 12px; }
          .py-1 { padding-top: 4px; padding-bottom: 4px; }
          .mt-1 { margin-top: 4px; }
          .mt-3 { margin-top: 12px; }
          .mt-4 { margin-top: 16px; }
          .mt-5 { margin-top: 20px; }
          .mt-6 { margin-top: 24px; }
          .leading-relaxed { line-height: 1.75; }
          .inline-block { display: inline-block; }
          .flex { display: flex; }
          .flex-wrap { flex-wrap: wrap; }
          .flex-col { flex-direction: column; }
          .items-center { align-items: center; }
          .justify-center { justify-content: center; }
          .gap-2 { gap: 8px; }
          .w-full { width: 100%; }
          .w-28 { width: 112px; }
          .h-28 { height: 112px; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th { background: #b91c1c; color: #fff; padding: 8px; }
          td { padding: 8px; border-bottom: 1px solid #eee; }
          @media print {
            body { padding: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .no-print { display: none !important; }
          }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
        <div style="margin-top: 24px; text-align: center;" class="no-print">
          <button onclick="window.print()" style="background: #b91c1c; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer;">🖨️ طباعة الفاتورة</button>
        </div>
      </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
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
            <div className="text-stone-400 text-[11px] mt-1">
              فاتورة بيع — <span dir="ltr" className="ltr-num inline-block">{dateStr}</span>
            </div>
          </div>

          <div className="mt-4 p-3 bg-stone-50 rounded-xl text-stone-600 text-xs leading-relaxed border border-stone-100">
            📍 <span className="font-bold text-stone-800">العنوان:</span> نبر، الكاف<br />
            📞 <span className="font-bold text-stone-800">الهاتف:</span>{' '}
            <span dir="ltr" className="ltr-num inline-block font-mono font-semibold text-stone-800">41 444 355</span>
            {' — '}
            <span dir="ltr" className="ltr-num inline-block font-mono font-semibold text-stone-800">98 674 871</span>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            {invoice.customerName && (
              <span className="inline-block bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-medium border border-emerald-100">
                👤 الحريف: {invoice.customerName}
              </span>
            )}
            {invoice.customerPhone && (
              <span className="inline-block bg-stone-100 text-stone-700 px-3 py-1 rounded-full text-xs font-medium border border-stone-200">
                📞 <span dir="ltr" className="ltr-num inline-block font-mono">{invoice.customerPhone}</span>
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
                <tr key={`${idx}-${l.name}-${l.qty}-${l.total}`} className="border-b border-stone-100">
                  <td className="p-2 font-medium text-stone-800">{l.name}</td>
                  <td className="p-2 text-center text-stone-600"><span dir="ltr" className="ltr-num inline-block font-mono">{l.qty}</span></td>
                  <td className="p-2 text-center text-stone-600"><span dir="ltr" className="ltr-num inline-block font-mono">{l.unitPrice.toFixed(3)}</span></td>
                  <td className="p-2 text-left text-stone-800 font-bold"><span dir="ltr" className="ltr-num inline-block font-mono">{l.total.toFixed(3)}</span></td>
                </tr>
              ))}
              <tr className="font-bold text-stone-900 bg-amber-50/50">
                <td colSpan={3} className="p-3 text-right text-stone-700 text-sm">المجموع الكلي</td>
                <td className="p-3 text-left text-red-700 text-sm font-extrabold">
                  <span dir="ltr" className="ltr-num inline-block font-mono">{invoice.grandTotal.toFixed(3)}</span> د.ت
                </td>
              </tr>
              {invoice.isDebt && invoice.downPayment !== undefined && invoice.downPayment > 0 && (
                <>
                  <tr className="text-stone-700 bg-emerald-50/50 text-xs font-bold">
                    <td colSpan={3} className="p-2 text-right text-emerald-800">الدفعة الأولى (تسبيق نقدي)</td>
                    <td className="p-2 text-left text-emerald-800 font-extrabold">
                      <span dir="ltr" className="ltr-num inline-block font-mono">{invoice.downPayment.toFixed(3)}</span> د.ت
                    </td>
                  </tr>
                  <tr className="text-stone-900 bg-rose-50/50 text-xs font-bold">
                    <td colSpan={3} className="p-2 text-right text-rose-800">المتبقي بالدين</td>
                    <td className="p-2 text-left text-rose-800 font-extrabold">
                      <span dir="ltr" className="ltr-num inline-block font-mono">{Math.max(0, invoice.grandTotal - invoice.downPayment).toFixed(3)}</span> د.ت
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>

          {/* QR Code */}
          <div className="mt-6 flex flex-col items-center justify-center">
            <img src={qrImgUrl} alt="QR Code" className="w-28 h-28 border border-stone-200 p-1 rounded-lg shadow-xs" />
            <span className="text-[10px] text-stone-400 mt-1">
              رمز الفاتورة: <span dir="ltr" className="ltr-num inline-block font-mono">{invoice.id}</span>
            </span>
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
