import React, { useState } from 'react';
import { ShieldAlert, User, Key, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { AppRole } from '../types';

interface LoginOverlayProps {
  onChooseSeller: () => void;
  onAttemptManagerLogin: (pin: string) => Promise<boolean>;
}

export const LoginOverlay: React.FC<LoginOverlayProps> = ({ onChooseSeller, onAttemptManagerLogin }) => {
  const [view, setView] = useState<'choice' | 'pin'>('choice');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showPin, setShowPin] = useState(false);

  const handleManagerLogin = async () => {
    if (!pin) {
      setErrorMsg('الرجاء إدخال الرمز السري');
      return;
    }
    setLoading(true);
    setErrorMsg('');
    const success = await onAttemptManagerLogin(pin);
    setLoading(false);
    if (!success) {
      setErrorMsg('الرمز السري غير صحيح ❌');
      setPin('');
    }
  };

  return (
    <div className="fixed inset-0 bg-stone-900/90 backdrop-blur-md flex items-center justify-center p-4 z-40 animate-fade-in" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 border border-stone-100 shadow-2xl transition-all duration-300">
        
        {/* Choice View */}
        {view === 'choice' && (
          <div className="text-center">
            <div className="w-16 h-16 bg-red-50 text-red-700 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-red-100">
              <ShieldAlert size={32} className="animate-pulse" />
            </div>
            <h2 className="text-xl font-extrabold text-stone-800 tracking-tight">👋 Yosri GSM</h2>
            <p className="text-stone-400 text-xs mt-1">تسيير البضاعة والبيع — اختر واجهتك للدخول</p>

            <div className="space-y-3 mt-6">
              <button
                onClick={onChooseSeller}
                className="w-full bg-stone-50 hover:bg-stone-100 text-stone-800 font-bold py-3.5 px-4 rounded-xl flex items-center justify-between border border-stone-200 transition-all cursor-pointer group active:scale-[0.99]"
              >
                <span className="flex items-center gap-3">
                  <span className="w-9 h-9 bg-stone-100 text-stone-600 rounded-lg flex items-center justify-center group-hover:bg-white transition-colors">
                    <User size={18} />
                  </span>
                  واجهة البائع
                </span>
                <span className="text-stone-400 group-hover:translate-x-[-4px] transition-transform">◀</span>
              </button>

              <button
                onClick={() => setView('pin')}
                className="w-full bg-red-700 hover:bg-red-800 text-white font-bold py-3.5 px-4 rounded-xl flex items-center justify-between transition-all cursor-pointer shadow-md shadow-red-700/15 group active:scale-[0.99]"
              >
                <span className="flex items-center gap-3">
                  <span className="w-9 h-9 bg-red-800 text-red-200 rounded-lg flex items-center justify-center">
                    <Key size={18} />
                  </span>
                  واجهة المدير (Yosri)
                </span>
                <span className="text-red-200 group-hover:translate-x-[-4px] transition-transform">◀</span>
              </button>
            </div>
          </div>
        )}

        {/* PIN Entry View */}
        {view === 'pin' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-extrabold text-stone-800 text-base">🔒 دخول المدير</h3>
              <button 
                onClick={() => { setView('choice'); setErrorMsg(''); setPin(''); }}
                className="text-stone-400 hover:text-stone-600 flex items-center gap-1 text-xs font-semibold cursor-pointer"
              >
                <ArrowRight size={16} />
                رجوع
              </button>
            </div>

            <p className="text-stone-400 text-[11px] mb-4">أدخل الرمز السري للمدير (الافتراضي هو 1234).</p>

            <div className="relative">
              <input
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ''));
                  setErrorMsg('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleManagerLogin();
                }}
                disabled={loading}
                placeholder="الرمز السري"
                className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl font-mono text-center text-xl tracking-widest text-stone-800 focus:outline-none focus:border-red-700 focus:ring-1 focus:ring-red-700/50 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute left-3 top-3.5 text-stone-400 hover:text-stone-600"
              >
                {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {errorMsg && (
              <p className="text-rose-600 text-[11px] text-center font-bold mt-2">
                {errorMsg}
              </p>
            )}

            <button
              onClick={handleManagerLogin}
              disabled={loading || !pin}
              className="w-full bg-red-700 hover:bg-red-800 disabled:bg-stone-200 disabled:text-stone-400 text-white font-bold py-3 px-4 rounded-xl mt-4 flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-red-700/10"
            >
              {loading ? (
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                'تأكيد الدخول ✅'
              )}
            </button>
          </div>
        )}

      </div>
    </div>
  );
};
