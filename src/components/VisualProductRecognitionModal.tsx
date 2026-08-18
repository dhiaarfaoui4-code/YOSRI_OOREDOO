import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Check, Sparkles, Plus, Image as ImageIcon, RefreshCw, Zap, Search, AlertCircle, CheckCircle2, Cpu, BrainCircuit } from 'lucide-react';
import { Item } from '../types';

interface VisualProductRecognitionModalProps {
  items: Item[];
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct: (item: Item) => void;
  onUpdateItemImage: (itemId: string, imageUrl: string) => void;
  onAddNewItemWithImage?: (name: string, sellPrice: number, buyPrice: number, qty: number, category: string, imageUrl: string, barcode?: string) => void;
  onAttachPhotoToForm?: (imageUrl: string) => void;
  targetItemToUpdate?: Item | null;
  mode?: 'sell' | 'stock';
}

export interface GeminiMatchResult {
  item: Item;
  overallScore: number; // 0 to 100 confidence
  reason: string;
}

// Fast client-side image optimization helper (downscale to max 720px, 0.82 quality for crisp text & details)
const compressImageForAnalysis = (srcDataUrl: string, maxDim = 720, quality = 0.82): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
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
        resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
        resolve(srcDataUrl);
      }
    };
    img.onerror = () => resolve(srcDataUrl);
    img.src = srcDataUrl;
  });
};

export const VisualProductRecognitionModal: React.FC<VisualProductRecognitionModalProps> = ({
  items,
  isOpen,
  onClose,
  onSelectProduct,
  onUpdateItemImage,
  onAddNewItemWithImage,
  onAttachPhotoToForm,
  targetItemToUpdate,
  mode = 'sell'
}) => {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanStepMessage, setScanStepMessage] = useState<string>('');
  const [useWebcam, setUseWebcam] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [matchResults, setMatchResults] = useState<GeminiMatchResult[]>([]);
  const [selectedItemToBind, setSelectedItemToBind] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoSelectedProduct, setAutoSelectedProduct] = useState<Item | null>(null);
  
  // New Item Quick Add State
  const [showQuickAddForm, setShowQuickAddForm] = useState<boolean>(false);
  const [newItemName, setNewItemName] = useState<string>('');
  const [newItemBarcode, setNewItemBarcode] = useState<string>('');
  const [newItemSell, setNewItemSell] = useState<string>('');
  const [newItemBuy, setNewItemBuy] = useState<string>('');
  const [newItemQty, setNewItemQty] = useState<string>('1');
  const [newItemCategory, setNewItemCategory] = useState<string>('accessory');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start camera
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('المتصفح لا يدعم الوصول للكاميرا مباشرة');
      }
      setUseWebcam(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.warn('Camera access note:', err?.message || err);
      setUseWebcam(false);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError' || (err.message && err.message.includes('Permission denied'))) {
        setCameraError('لم يتم منح إذن الكاميرا من المتصفح. يمكنك تفعيل الإذن من شريط العنوان أو استخدام زر "رفع صورة علبة" أدناه.');
      } else {
        setCameraError('لم نتمكن من الوصول للكاميرا حالياً. يمكنك استخدام زر "رفع صورة علبة" واختيار الصورة مباشرة.');
      }
    }
  };

  // Stop camera
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setUseWebcam(false);
  };

  useEffect(() => {
    if (isOpen) {
      startCamera();
    } else {
      stopCamera();
      setCapturedImage(null);
      setMatchResults([]);
      setShowQuickAddForm(false);
      setAutoSelectedProduct(null);
      setSearchQuery('');
    }
    return () => stopCamera();
  }, [isOpen]);

  // Handle image capture from live camera stream
  const captureFromVideo = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedImage(dataUrl);
    analyzeCapturedImage(dataUrl);
  };

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target?.result as string;
      setCapturedImage(dataUrl);
      analyzeCapturedImage(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  // Run Gemini Vision recognition via server-side endpoint
  const analyzeCapturedImage = async (dataUrl: string) => {
    setIsScanning(true);
    setMatchResults([]);
    setAutoSelectedProduct(null);
    setScanStepMessage('⚡ جاري التحليل الفائق للسلعة بواسطة Gemini Vision...');

    try {
      // Compress image to max 720px / 0.82 quality for clear text and packaging recognition
      const optimizedImage = await compressImageForAnalysis(dataUrl, 720, 0.82);

      const response = await fetch('/api/recognize-product', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          imageData: optimizedImage,
          inventory: items.map(i => ({
            id: i.id,
            name: i.name,
            sell: i.sell,
            category: i.category,
            barcode: i.barcode
          }))
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'فشل الاتصال بخدمة Gemini Vision');
      }

      const rawCandidates: any[] = data.candidates || [];
      const results: GeminiMatchResult[] = [];

      for (const cand of rawCandidates) {
        let foundItem = items.find(i => String(i.id) === String(cand.itemId));
        if (!foundItem && cand.itemId) {
          const candIdLower = String(cand.itemId).toLowerCase().trim();
          foundItem = items.find(i => 
            String(i.id).toLowerCase() === candIdLower ||
            (i.barcode && String(i.barcode).toLowerCase().trim() === candIdLower) ||
            i.name.toLowerCase().includes(candIdLower) ||
            candIdLower.includes(i.name.toLowerCase())
          );
        }
        if (foundItem) {
          // Avoid duplicate results
          if (!results.some(r => r.item.id === foundItem!.id)) {
            results.push({
              item: foundItem,
              overallScore: Math.min(100, Math.max(0, Math.round(cand.confidence || 0))),
              reason: cand.reason || 'مطابقة بصرية بواسطة الذكاء الاصطناعي'
            });
          }
        }
      }

      // Sort descending by confidence score
      results.sort((a, b) => b.overallScore - a.overallScore);
      setMatchResults(results);

      // Auto selection in sell mode if top candidate has high confidence (>= 90%)
      if (mode === 'sell' && results.length > 0 && results[0].overallScore >= 90) {
        const top = results[0];
        setAutoSelectedProduct(top.item);
        setTimeout(() => {
          onSelectProduct(top.item);
          onClose();
        }, 900);
      }
    } catch (err: any) {
      console.error('Gemini Vision analysis error:', err);
      alert(`خطأ في التعرف على المنتج: ${err.message || 'يرجى المحاولة مجدداً'}`);
    } finally {
      setIsScanning(false);
      setScanStepMessage('');
    }
  };

  // Manual seller selection handler
  const handleUserSelectProduct = (item: Item) => {
    onSelectProduct(item);
    onClose();
  };

  // Bind captured photo to selected product
  const handleSavePhotoToProduct = () => {
    if (!capturedImage || !selectedItemToBind) return;
    onUpdateItemImage(selectedItemToBind, capturedImage);
    const updatedItem = items.find(i => i.id === selectedItemToBind);
    if (updatedItem) {
      analyzeCapturedImage(capturedImage);
    }
  };

  // Filtered results for manual search bar
  const filteredResults = matchResults.filter(r => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      r.item.name.toLowerCase().includes(q) ||
      (r.item.barcode && r.item.barcode.includes(q)) ||
      (r.item.category && r.item.category.toLowerCase().includes(q))
    );
  });

  const topMatchScore = matchResults.length > 0 ? matchResults[0].overallScore : 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm flex items-center justify-center p-3 z-50 animate-fade-in font-sans text-stone-900" dir="rtl">
      <div className="bg-white rounded-3xl border border-stone-200 p-4 sm:p-6 w-full max-w-4xl max-h-[94vh] flex flex-col shadow-2xl animate-scale-up text-right">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-stone-100 pb-3 mb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="bg-amber-600 text-white p-2.5 rounded-2xl shadow-sm">
              <Camera size={20} />
            </div>
            <div>
              <h3 className="font-black text-stone-900 text-sm sm:text-base flex items-center gap-2">
                {targetItemToUpdate ? (
                  `📸 التقاط صورة لـ: "${targetItemToUpdate.name}"`
                ) : mode === 'sell' ? (
                  '📸 التعرف البصري الفائق للبيع (Gemini Vision)'
                ) : (
                  '📸 إدارة صور المخزن والتعرف البصري'
                )}
              </h3>
              <p className="text-[11px] text-stone-500 font-medium">
                تحليل مباشر لعلبة وهيكل المنتج بمحرك Gemini Vision ذو الدقة العالية
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-800 hover:bg-stone-100 rounded-full transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-1 flex-1">
          
          {/* Left Side: Camera & Photo Frame */}
          <div className="space-y-3 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="relative bg-stone-900 rounded-2xl overflow-hidden aspect-4/3 flex items-center justify-center border-2 border-stone-800 shadow-inner">
                {capturedImage ? (
                  <div className="relative w-full h-full">
                    <img src={capturedImage} alt="Captured product" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => {
                        setCapturedImage(null);
                        setMatchResults([]);
                        setAutoSelectedProduct(null);
                        if (!useWebcam) startCamera();
                      }}
                      className="absolute top-2 right-2 bg-black/70 hover:bg-black text-white p-2 rounded-full cursor-pointer transition-all shadow-md"
                      title="إعادة الالتقاط"
                    >
                      <RefreshCw size={14} />
                    </button>
                  </div>
                ) : useWebcam ? (
                  <div className="relative w-full h-full">
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-6 border-2 border-dashed border-amber-400/80 rounded-2xl pointer-events-none flex items-center justify-center">
                      <span className="text-[10px] bg-black/70 text-amber-300 font-bold px-2.5 py-1 rounded-lg backdrop-blur-xs">
                        ضع علبة المنتج أو الجهاز بوضوح داخل الإطار
                      </span>
                    </div>
                  </div>
                ) : cameraError ? (
                  <div className="p-5 text-center space-y-2.5 bg-stone-900 text-stone-200 rounded-2xl max-w-xs">
                    <AlertCircle className="mx-auto text-amber-400" size={32} />
                    <p className="text-xs font-bold text-amber-100 leading-relaxed">{cameraError}</p>
                    <div className="flex justify-center gap-2 pt-1">
                      <button 
                        type="button"
                        onClick={startCamera}
                        className="bg-stone-800 hover:bg-stone-700 text-stone-200 font-extrabold px-3 py-1.5 rounded-xl text-xs cursor-pointer border border-stone-700"
                      >
                        إعادة المحاولة
                      </button>
                      <button 
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold px-3 py-1.5 rounded-xl text-xs cursor-pointer flex items-center gap-1 shadow-sm"
                      >
                        <Upload size={14} /> رفع صورة
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center space-y-2">
                    <Camera className="mx-auto text-stone-500" size={36} />
                    <p className="text-xs text-stone-400 font-bold">الكاميرا غير نشطة</p>
                    <button 
                      type="button"
                      onClick={startCamera}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-extrabold px-3 py-1.5 rounded-xl text-xs cursor-pointer"
                    >
                      تشغيل الكاميرا
                    </button>
                  </div>
                )}

                {isScanning && (
                  <div className="absolute inset-0 bg-stone-950/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2.5 text-white p-4 text-center">
                    <Sparkles size={32} className="text-amber-400 animate-spin" />
                    <span className="text-xs font-black text-amber-200 animate-pulse">{scanStepMessage || 'جاري المعالجة...'}</span>
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button 
                  type="button"
                  onClick={captureFromVideo}
                  disabled={!useWebcam || !!capturedImage}
                  className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white font-black py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all"
                >
                  <Camera size={16} /> 📸 التقط الصورة للتحليل
                </button>

                <button 
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-stone-800 hover:bg-stone-900 text-white font-bold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm cursor-pointer transition-all"
                >
                  <Upload size={16} /> رفع صورة علبة
                </button>
                <input 
                  ref={fileInputRef} 
                  type="file" 
                  accept="image/*" 
                  onChange={handleFileUpload} 
                  className="hidden" 
                />
              </div>

              {/* Target Item Update Banner */}
              {capturedImage && targetItemToUpdate && (
                <div className="bg-amber-50 border-2 border-amber-400 rounded-2xl p-3 text-center space-y-2 animate-scale-up">
                  <p className="text-xs font-black text-amber-950">
                    إسناد هذه الصورة للسلعة: <span className="underline decoration-amber-500">{targetItemToUpdate.name}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      if (capturedImage && targetItemToUpdate) {
                        onUpdateItemImage(targetItemToUpdate.id, capturedImage);
                        onClose();
                      }
                    }}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-700/20"
                  >
                    <Check size={16} /> 💾 حفظ الصورة للمنتج الآن
                  </button>
                </div>
              )}
            </div>

            {/* Stock Mode Options */}
            {capturedImage && !targetItemToUpdate && mode === 'stock' && (
              <div className="bg-stone-50 border border-stone-200 rounded-2xl p-3 space-y-3 mt-auto">
                {/* Primary Action: Attach to main product addition form */}
                {onAttachPhotoToForm && (
                  <button
                    type="button"
                    onClick={() => {
                      if (capturedImage) {
                        onAttachPhotoToForm(capturedImage);
                        onClose();
                      }
                    }}
                    className="w-full bg-amber-600 hover:bg-amber-700 text-white font-extrabold py-2.5 px-3 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-amber-600/20 transition-all"
                  >
                    <Check size={16} /> 📌 اعتماد هذه الصورة للسلعة الجاري إدخالها (مع الباركود)
                  </button>
                )}

                <div className="flex items-center justify-between pt-1 border-t border-stone-200">
                  <span className="text-xs font-black text-stone-900">
                    {showQuickAddForm ? '✨ إضافة سلعة جديدة بالصورة والباركود للستوك' : '💾 خيارات أخرى للصورة:'}
                  </span>
                  <button 
                    type="button"
                    onClick={() => setShowQuickAddForm(!showQuickAddForm)}
                    className="text-[10px] font-extrabold bg-amber-100 text-amber-900 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                  >
                    {showQuickAddForm ? 'تغيير لربط بمنتج مسجل' : '➕ إنشاء سلعة جديدة مباشرة من هنا'}
                  </button>
                </div>

                {showQuickAddForm ? (
                  <div className="space-y-2 bg-white p-2.5 rounded-xl border border-amber-200">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 mb-0.5">اسم السلعة الجديد *</label>
                      <input 
                        type="text"
                        placeholder="مثال: شاحن أنكر 20W أصلي"
                        value={newItemName}
                        onChange={e => setNewItemName(e.target.value)}
                        className="w-full border border-stone-200 rounded-lg p-1.5 text-xs font-bold text-stone-900"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 mb-0.5">الباركود (اختياري)</label>
                      <input 
                        type="text"
                        placeholder="اكتب أو امسح الباركود"
                        value={newItemBarcode}
                        onChange={e => setNewItemBarcode(e.target.value)}
                        className="w-full border border-stone-200 rounded-lg p-1.5 text-xs font-mono font-bold text-stone-900"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <label className="block text-[9px] font-bold text-stone-600 mb-0.5">سعر البيع (د.ت) *</label>
                        <input 
                          type="number"
                          step="0.001"
                          placeholder="25.000"
                          value={newItemSell}
                          onChange={e => setNewItemSell(e.target.value)}
                          className="w-full border border-stone-200 rounded-lg p-1.5 text-xs font-mono font-bold text-red-700"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-600 mb-0.5">سعر الشراء</label>
                        <input 
                          type="number"
                          step="0.001"
                          placeholder="15.000"
                          value={newItemBuy}
                          onChange={e => setNewItemBuy(e.target.value)}
                          className="w-full border border-stone-200 rounded-lg p-1.5 text-xs font-mono font-bold text-stone-800"
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-bold text-stone-600 mb-0.5">الكمية الابتدائي</label>
                        <input 
                          type="number"
                          placeholder="5"
                          value={newItemQty}
                          onChange={e => setNewItemQty(e.target.value)}
                          className="w-full border border-stone-200 rounded-lg p-1.5 text-xs font-mono font-bold text-emerald-700"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <select
                        value={newItemCategory}
                        onChange={e => setNewItemCategory(e.target.value)}
                        className="flex-1 border border-stone-200 rounded-lg px-2 py-1 text-xs font-bold text-stone-700"
                      >
                        <option value="accessory">🔌 أكسسوارات أخرى</option>
                        <option value="phone">📱 هاتف جوال</option>
                        <option value="battery">🔋 بطارية</option>
                        <option value="speaker">🔊 سبيكر / صوت</option>
                        <option value="bluetooth">🎧 سماعات بلوتوث</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          if (!newItemName.trim() || !newItemSell) return alert('الرجاء إدخال الاسم وسعر البيع');
                          if (onAddNewItemWithImage && capturedImage) {
                            onAddNewItemWithImage(
                              newItemName.trim(),
                              parseFloat(newItemSell) || 0,
                              parseFloat(newItemBuy) || 0,
                              parseInt(newItemQty) || 1,
                              newItemCategory,
                              capturedImage,
                              newItemBarcode.trim()
                            );
                            setNewItemName('');
                            setNewItemBarcode('');
                            setNewItemSell('');
                            setNewItemBuy('');
                            setShowQuickAddForm(false);
                            onClose();
                          }
                        }}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold px-3 py-1.5 rounded-xl text-xs flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <Plus size={14} /> إضافة للستوك
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <select 
                      value={selectedItemToBind}
                      onChange={e => setSelectedItemToBind(e.target.value)}
                      className="flex-1 bg-white border border-stone-200 rounded-xl px-2 py-1.5 text-xs font-bold text-stone-800"
                    >
                      <option value="">-- اختر سلعة مسجلة لربط الصورة بها --</option>
                      {items.map(i => (
                        <option key={i.id} value={i.id}>{i.name} ({i.sell.toFixed(3)} د.ت)</option>
                      ))}
                    </select>
                    <button 
                      type="button"
                      onClick={handleSavePhotoToProduct}
                      disabled={!selectedItemToBind}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-3 py-1.5 rounded-xl text-xs cursor-pointer shrink-0"
                    >
                      حفظ الصورة
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Side: Gemini Vision Candidate Results */}
          <div className="flex flex-col h-full space-y-2">
            
            {/* Candidates Banner Header */}
            <div className="flex items-center justify-between bg-stone-900 text-white px-3.5 py-2.5 rounded-xl text-xs font-extrabold">
              <span className="flex items-center gap-1.5">
                <BrainCircuit size={16} className="text-amber-400" />
                المرشحات الأكثر مطابقة (Gemini Vision AI)
              </span>
              <span className="text-[10px] text-amber-300 font-mono">
                {matchResults.length} مرشح
              </span>
            </div>

            {/* Threshold Banner 1: > 90% Auto Selected */}
            {autoSelectedProduct && (
              <div className="bg-emerald-500 text-white p-3.5 rounded-2xl shadow-lg border border-emerald-600 flex items-center gap-3 animate-bounce">
                <CheckCircle2 size={24} className="shrink-0 text-emerald-100" />
                <div>
                  <div className="font-extrabold text-xs">⚡ تم تحديد أسرع مطابقة (نسبة ثقة أكبر من 90%)</div>
                  <div className="text-[11px] font-black text-emerald-100">{autoSelectedProduct.name} ({autoSelectedProduct.sell.toFixed(3)} د.ت)</div>
                </div>
              </div>
            )}

            {/* Threshold Banner 2: High Confidence Candidates */}
            {!autoSelectedProduct && matchResults.length > 0 && topMatchScore >= 70 && (
              <div className="bg-emerald-50 border border-emerald-300 p-3 rounded-2xl text-emerald-950 flex items-start gap-2 text-xs">
                <Sparkles size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-extrabold block">✨ اختر المنتج المناسب بضغطة واحدة:</strong>
                  تم العثور على أفضل المرشحات المتطابقة مع الصورة المسجلة بالمخزن.
                </div>
              </div>
            )}

            {/* Threshold Banner 3: Low Confidence / No strong match */}
            {!autoSelectedProduct && matchResults.length > 0 && topMatchScore < 70 && (
              <div className="bg-amber-50 border border-amber-300 p-3 rounded-2xl text-amber-950 flex items-start gap-2 text-xs">
                <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-extrabold block">⚠️ أفضل نتيجة مطابقة: {topMatchScore}%:</strong>
                  يمكنك اختيار المنتج الأقرب من القائمة أدناه أو البحث يدويًا.
                </div>
              </div>
            )}

            {/* Search Bar filter */}
            {matchResults.length > 0 && (
              <div className="relative">
                <Search size={14} className="absolute right-3 top-2.5 text-stone-400" />
                <input 
                  type="text"
                  placeholder="🔍 تصفية القائمة بالاسم أو الباركود..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl pr-8 pl-3 py-1.5 text-xs font-bold text-stone-800 focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            {/* Candidates List */}
            <div className="flex-1 overflow-y-auto space-y-2 max-h-80 md:max-h-96 pr-1 divide-y divide-stone-100">
              {matchResults.length === 0 ? (
                <div className="p-8 text-center text-stone-400 space-y-2">
                  <ImageIcon size={36} className="mx-auto text-stone-300" />
                  <p className="text-xs font-bold">التقط صورة للسلعة لتحليلها مباشرة بواسطة نموذج Gemini Vision</p>
                </div>
              ) : (
                filteredResults.map((matchRes) => {
                  const { item, overallScore, reason } = matchRes;
                  const isTopMatch = overallScore === topMatchScore && overallScore >= 70;

                  return (
                    <div 
                      key={item.id}
                      className={`pt-2.5 pb-2 flex flex-col gap-1.5 p-3 rounded-2xl transition-all ${
                        isTopMatch 
                          ? 'bg-emerald-50/90 border-2 border-emerald-400 shadow-xs' 
                          : overallScore >= 55 
                          ? 'bg-amber-50/60 border border-amber-200' 
                          : 'hover:bg-stone-50 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          {item.imageUrl ? (
                            <img src={item.imageUrl} alt={item.name} className="w-12 h-12 object-cover rounded-xl border border-stone-200 shrink-0" />
                          ) : (
                            <div className="w-12 h-12 bg-amber-100 text-amber-900 rounded-xl flex items-center justify-center font-bold text-base shrink-0 border border-amber-200">
                              📦
                            </div>
                          )}
                          <div className="truncate">
                            <h4 className="font-extrabold text-xs text-stone-900 truncate">{item.name}</h4>
                            <div className="text-[10px] text-stone-500 flex items-center gap-2 flex-wrap mt-0.5">
                              <span>المتوفر: <strong className={item.qty > 0 ? 'text-emerald-700 font-black' : 'text-red-600'}>{item.qty} قطعة</strong></span>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-black border ${
                                overallScore >= 80 
                                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs' 
                                  : overallScore >= 60 
                                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300' 
                                  : 'bg-amber-100 text-amber-900 border-amber-300'
                              }`}>
                                ثقة {overallScore}% {overallScore >= 80 && '🔥'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-black text-xs text-stone-900 ml-1">
                            {item.sell.toFixed(3)} <span className="text-[9px]">د.ت</span>
                          </span>

                          {capturedImage && (
                            <button
                              type="button"
                              title="ربط الصورة الملتقطة بهذا المنتج"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (capturedImage) {
                                  onUpdateItemImage(item.id, capturedImage);
                                  handleUserSelectProduct(item);
                                }
                              }}
                              className="bg-amber-100 hover:bg-amber-200 text-amber-950 font-extrabold px-2 py-1.5 rounded-xl text-[10px] flex items-center gap-1 border border-amber-300 transition-colors cursor-pointer"
                            >
                              <Sparkles size={11} className="text-amber-700" /> ربط
                            </button>
                          )}

                          <button 
                            type="button"
                            onClick={() => handleUserSelectProduct(item)}
                            className={`font-black px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow-sm cursor-pointer transition-all ${
                              overallScore >= 70
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-amber-600 hover:bg-amber-700 text-white'
                            }`}
                          >
                            <Plus size={12} /> اختيار 🛒
                          </button>
                        </div>
                      </div>

                      {/* Gemini Reasoning */}
                      {reason && (
                        <div className="pt-1 border-t border-stone-200/60 text-[10px] text-stone-700 font-semibold flex items-center gap-1">
                          <Sparkles size={12} className="text-amber-600 shrink-0" />
                          <span>{reason}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500 shrink-0">
          <span className="flex items-center gap-1">
            <Cpu size={14} className="text-amber-600" />
            مطابقة بصرية فورية عبر Gemini Vision (معالجة آمنة بدون كشف المفتاح) 🧠
          </span>
          <button 
            type="button"
            onClick={onClose}
            className="bg-stone-200 hover:bg-stone-300 text-stone-800 font-extrabold px-4 py-2 rounded-xl text-xs cursor-pointer"
          >
            إغلاق
          </button>
        </div>

      </div>
    </div>
  );
};
