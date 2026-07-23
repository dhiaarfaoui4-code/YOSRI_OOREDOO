import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Check, Sparkles, Plus, Image as ImageIcon, RefreshCw, Zap, Search, AlertCircle, CheckCircle2, Cpu, BrainCircuit, Type } from 'lucide-react';
import { recognize } from 'tesseract.js';
import { Item } from '../types';
import { calculateMultiFactorMatch, recordVisualOcrCorrection, MultiFactorMatchResult } from '../utils/productSimilarity';

interface VisualProductRecognitionModalProps {
  items: Item[];
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct: (item: Item) => void;
  onUpdateItemImage: (itemId: string, imageUrl: string) => void;
  onAddNewItemWithImage?: (name: string, sellPrice: number, buyPrice: number, qty: number, category: string, imageUrl: string) => void;
  targetItemToUpdate?: Item | null;
  mode?: 'sell' | 'stock';
}

interface ImageFeatures {
  grid: number[][]; // 8x8 grid of [R,G,B]
  centerGrid: number[][]; // 4x4 center object area
  colorHist: number[]; // 24-bin normalized color histogram
}

// Extract multi-layered visual feature vector from an HTMLImageElement
function extractFeaturesFromImage(imgElement: HTMLImageElement): ImageFeatures {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { grid: [], centerGrid: [], colorHist: new Array(24).fill(0) };
  }

  ctx.drawImage(imgElement, 0, 0, 128, 128);
  const imgData = ctx.getImageData(0, 0, 128, 128).data;
  const totalPixels = 128 * 128;

  // 1. Color histogram (24 bins: 8 R, 8 G, 8 B)
  const colorHist = new Array(24).fill(0);
  for (let i = 0; i < imgData.length; i += 4) {
    const rBin = Math.min(7, Math.floor(imgData[i] / 32));
    const gBin = Math.min(7, Math.floor(imgData[i + 1] / 32));
    const bBin = Math.min(7, Math.floor(imgData[i + 2] / 32));

    colorHist[rBin]++;
    colorHist[8 + gBin]++;
    colorHist[16 + bBin]++;
  }
  for (let i = 0; i < 24; i++) {
    colorHist[i] /= totalPixels;
  }

  // 2. Downsample to 8x8 grid for spatial layout
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = 8;
  gridCanvas.height = 8;
  const gridCtx = gridCanvas.getContext('2d');
  if (gridCtx) {
    gridCtx.drawImage(canvas, 0, 0, 8, 8);
    const gridData = gridCtx.getImageData(0, 0, 8, 8).data;
    const grid: number[][] = [];
    for (let i = 0; i < gridData.length; i += 4) {
      grid.push([gridData[i], gridData[i + 1], gridData[i + 2]]);
    }

    // 4x4 center grid
    const centerGrid: number[][] = [];
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) {
        const idx = (y * 8 + x) * 4;
        centerGrid.push([gridData[idx], gridData[idx + 1], gridData[idx + 2]]);
      }
    }

    return { grid, centerGrid, colorHist };
  }

  return { grid: [], centerGrid: [], colorHist };
}

// Compute smart visual similarity (0 to 100)
function compareImageFeatures(featA: ImageFeatures, featB: ImageFeatures): number {
  if (!featA || !featB || featA.grid.length === 0 || featB.grid.length === 0) return 0;

  // 1. Color histogram intersection match
  let histDiff = 0;
  for (let i = 0; i < 24; i++) {
    histDiff += Math.abs(featA.colorHist[i] - featB.colorHist[i]);
  }
  const histSim = Math.max(0, 100 * (1 - histDiff / 1.1));

  // 2. Center Grid similarity
  let centerDiffSum = 0;
  for (let i = 0; i < featA.centerGrid.length; i++) {
    const dr = featA.centerGrid[i][0] - featB.centerGrid[i][0];
    const dg = featA.centerGrid[i][1] - featB.centerGrid[i][1];
    const db = featA.centerGrid[i][2] - featB.centerGrid[i][2];
    centerDiffSum += Math.sqrt(dr * dr + dg * dg + db * db);
  }
  const avgCenterDiff = centerDiffSum / featA.centerGrid.length;
  const centerSim = Math.max(0, 100 * (1 - avgCenterDiff / 160));

  // 3. Full 8x8 Grid spatial similarity
  let gridDiffSum = 0;
  for (let i = 0; i < featA.grid.length; i++) {
    const dr = featA.grid[i][0] - featB.grid[i][0];
    const dg = featA.grid[i][1] - featB.grid[i][1];
    const db = featA.grid[i][2] - featB.grid[i][2];
    gridDiffSum += Math.sqrt(dr * dr + dg * dg + db * db);
  }
  const avgGridDiff = gridDiffSum / featA.grid.length;
  const gridSim = Math.max(0, 100 * (1 - avgGridDiff / 180));

  const total = Math.round(histSim * 0.45 + centerSim * 0.40 + gridSim * 0.15);
  return Math.min(100, Math.max(0, total));
}

export const VisualProductRecognitionModal: React.FC<VisualProductRecognitionModalProps> = ({
  items,
  isOpen,
  onClose,
  onSelectProduct,
  onUpdateItemImage,
  onAddNewItemWithImage,
  targetItemToUpdate,
  mode = 'sell'
}) => {
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanStepMessage, setScanStepMessage] = useState<string>('');
  const [extractedOcrText, setExtractedOcrText] = useState<string>('');
  const [useWebcam, setUseWebcam] = useState<boolean>(false);
  const [matchResults, setMatchResults] = useState<MultiFactorMatchResult[]>([]);
  const [selectedItemToBind, setSelectedItemToBind] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [autoSelectedProduct, setAutoSelectedProduct] = useState<Item | null>(null);
  
  // New Item Quick Add State
  const [showQuickAddForm, setShowQuickAddForm] = useState<boolean>(false);
  const [newItemName, setNewItemName] = useState<string>('');
  const [newItemSell, setNewItemSell] = useState<string>('');
  const [newItemBuy, setNewItemBuy] = useState<string>('');
  const [newItemQty, setNewItemQty] = useState<string>('1');
  const [newItemCategory, setNewItemCategory] = useState<string>('accessory');
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [itemFeatureMap, setItemFeatureMap] = useState<Record<string, ImageFeatures>>({});

  // Load image features asynchronously
  const loadFeaturesFromUrl = (src: string): Promise<ImageFeatures | null> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.src = src;
      img.onload = () => {
        resolve(extractFeaturesFromImage(img));
      };
      img.onerror = () => resolve(null);
    });
  };

  // Start webcam
  const startCamera = async () => {
    try {
      setUseWebcam(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error('Camera access error:', err);
      setUseWebcam(false);
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
      setExtractedOcrText('');
      setAutoSelectedProduct(null);
      setSearchQuery('');
    }
    return () => stopCamera();
  }, [isOpen]);

  // Handle image capture from live video feed
  const captureFromVideo = () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth || 320;
    canvas.height = videoRef.current.videoHeight || 240;
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

  // Run free in-browser Tesseract OCR and multi-factor comparison
  const analyzeCapturedImage = async (dataUrl: string) => {
    setIsScanning(true);
    setMatchResults([]);
    setAutoSelectedProduct(null);
    setScanStepMessage('🔍 1/2: جاري قراءة النصوص على علبة المنتج (Tesseract OCR)...');

    try {
      // 1. In-browser OCR using Tesseract.js (no paid API)
      let ocrText = '';
      try {
        const ocrResult = await recognize(dataUrl, 'eng');
        ocrText = (ocrResult.data.text || '').replace(/\n+/g, ' ').trim();
        setExtractedOcrText(ocrText);
      } catch (ocrErr) {
        console.warn('OCR processing error (skipping OCR layer):', ocrErr);
        ocrText = '';
      }

      setScanStepMessage('⚡ 2/2: تحليل الصورة والبيانات المخزنة (البراند، الموديل، السعة، القدرة، اللون)...');

      // 2. Extract visual features
      const capturedImg = new Image();
      capturedImg.src = dataUrl;
      await new Promise(res => { capturedImg.onload = res; });
      const capturedFeatures = extractFeaturesFromImage(capturedImg);

      const results: MultiFactorMatchResult[] = [];

      for (const item of items) {
        let visualScore = 0;
        if (item.imageUrl) {
          let feats = itemFeatureMap[item.id];
          if (!feats) {
            const loaded = await loadFeaturesFromUrl(item.imageUrl);
            if (loaded) {
              feats = loaded;
              setItemFeatureMap(prev => ({ ...prev, [item.id]: loaded }));
            }
          }
          if (feats) {
            visualScore = compareImageFeatures(capturedFeatures, feats);
          }
        }

        // Multi-Factor Match combining OCR, Brand, Model, Specs (e.g. 25W), Color, Visual Features & Local Memory
        const matchRes = calculateMultiFactorMatch(ocrText, visualScore, item);
        results.push(matchRes);
      }

      // Sort descending by overall confidence score
      results.sort((a, b) => b.overallScore - a.overallScore);
      setMatchResults(results);

      // 3. Threshold Decision Logic
      if (mode === 'sell' && results.length > 0) {
        const top = results[0];
        
        // Threshold > 95%: Direct Auto-Selection
        if (top.overallScore > 95) {
          setAutoSelectedProduct(top.item);
          recordVisualOcrCorrection(ocrText, top.item.id);
          
          // Auto choose and trigger onSelectProduct
          setTimeout(() => {
            onSelectProduct(top.item);
            onClose();
          }, 800);
        }
      }

    } catch (err) {
      console.error('Visual OCR analysis error:', err);
    } finally {
      setIsScanning(false);
      setScanStepMessage('');
    }
  };

  // Manual seller selection handler (Records decision for local learning)
  const handleUserSelectProduct = (item: Item) => {
    if (extractedOcrText) {
      recordVisualOcrCorrection(extractedOcrText, item.id);
    }
    onSelectProduct(item);
    onClose();
  };

  // Bind captured photo to selected product
  const handleSavePhotoToProduct = () => {
    if (!capturedImage || !selectedItemToBind) return;
    onUpdateItemImage(selectedItemToBind, capturedImage);
    const updatedItem = items.find(i => i.id === selectedItemToBind);
    if (updatedItem) {
      loadFeaturesFromUrl(capturedImage).then(feats => {
        if (feats) {
          setItemFeatureMap(prev => ({ ...prev, [selectedItemToBind]: feats }));
        }
        analyzeCapturedImage(capturedImage);
      });
    }
  };

  // Filtered results for manual search when accuracy < 70% or user types in search
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
                  '📸 التعرف بالصورة وقراءة العلبة (OCR + ذكاء متعدد) للبيع'
                ) : (
                  '📸 إدارة صور المخزن والتعرف البصري'
                )}
                <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-200">
                  100% مجاني بدون APIs مدفوعة
                </span>
              </h3>
              <p className="text-[11px] text-stone-500 font-medium">
                يقرأ النص المكتوب على العلبة (Tesseract OCR) ويقارن البراند، الموديل، السعة والقدرة W مع صورة المنتج والمخزون
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
          
          {/* Left / Top Side: Camera & Capture Viewfinder */}
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
                        setExtractedOcrText('');
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
                    {/* Camera overlay box */}
                    <div className="absolute inset-6 border-2 border-dashed border-amber-400/80 rounded-2xl pointer-events-none flex items-center justify-center">
                      <span className="text-[10px] bg-black/70 text-amber-300 font-bold px-2.5 py-1 rounded-lg backdrop-blur-xs">
                        ضع علبة المنتج والنصوص الواضحة داخل هذا الإطار
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center space-y-2">
                    <Camera className="mx-auto text-stone-500" size={36} />
                    <p className="text-xs text-stone-400 font-bold">الكاميرا غير نشطة</p>
                    <button 
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

              {/* Actions for Camera / Upload */}
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

              {/* Extracted OCR Text Display */}
              {extractedOcrText && (
                <div className="bg-stone-900 text-stone-100 p-3 rounded-2xl border border-stone-800 text-xs space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-400 font-extrabold text-[11px]">
                    <Type size={14} />
                    <span>النص المستخرج من العلبة (Tesseract OCR):</span>
                  </div>
                  <p className="font-mono text-[11px] text-stone-300 bg-black/40 p-2 rounded-xl leading-relaxed break-words max-h-20 overflow-y-auto dir-ltr text-left">
                    {extractedOcrText}
                  </p>
                </div>
              )}

              {/* If updating a specific item */}
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
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-stone-900">
                    {showQuickAddForm ? '✨ إضافة سلعة جديدة بالصورة للستوك' : '💾 خيارات الصورة الملتقطة:'}
                  </span>
                  <button 
                    type="button"
                    onClick={() => setShowQuickAddForm(!showQuickAddForm)}
                    className="text-[10px] font-extrabold bg-amber-100 text-amber-900 hover:bg-amber-200 px-2.5 py-1 rounded-lg transition-colors cursor-pointer"
                  >
                    {showQuickAddForm ? 'تغيير لربط بمنتج مسجل' : '➕ السلعة مش موجودة بالستوك؟ أضفها الآن'}
                  </button>
                </div>

                {showQuickAddForm ? (
                  <div className="space-y-2 bg-white p-2.5 rounded-xl border border-amber-200">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-600 mb-0.5">اسم السلعة الجديد *</label>
                      <input 
                        type="text"
                        placeholder="مثال: شاحن سامسونج 25W أصلي"
                        value={newItemName}
                        onChange={e => setNewItemName(e.target.value)}
                        className="w-full border border-stone-200 rounded-lg p-1.5 text-xs font-bold text-stone-900"
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
                              capturedImage
                            );
                            setNewItemName('');
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

          {/* Right Side: Recognition Results & Decision Thresholds */}
          <div className="flex flex-col h-full space-y-2">
            
            {/* Header */}
            <div className="flex items-center justify-between bg-stone-900 text-white px-3.5 py-2.5 rounded-xl text-xs font-extrabold">
              <span className="flex items-center gap-1.5">
                <BrainCircuit size={16} className="text-amber-400" />
                نتائج مطابقة الذكاء المركّب (OCR + براند + قدرة + لون + صورة)
              </span>
              <span className="text-[10px] text-stone-300 font-mono">
                {matchResults.length} منتج
              </span>
            </div>

            {/* Threshold Banner 1: > 95% Auto Selected */}
            {autoSelectedProduct && (
              <div className="bg-emerald-500 text-white p-3.5 rounded-2xl shadow-lg border border-emerald-600 flex items-center gap-3 animate-bounce">
                <CheckCircle2 size={24} className="shrink-0 text-emerald-100" />
                <div>
                  <div className="font-extrabold text-xs">⚡ تم اختيار المنتج تلقائياً (مطابقة أكبر من 95%)</div>
                  <div className="text-[11px] font-black text-emerald-100">{autoSelectedProduct.name} ({autoSelectedProduct.sell.toFixed(3)} د.ت)</div>
                </div>
              </div>
            )}

            {/* Threshold Banner 2: 70% - 95% High Confidence Match */}
            {!autoSelectedProduct && matchResults.length > 0 && topMatchScore >= 70 && topMatchScore <= 95 && (
              <div className="bg-emerald-50 border border-emerald-300 p-3 rounded-2xl text-emerald-950 flex items-start gap-2 text-xs">
                <Sparkles size={18} className="text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-extrabold block">✨ أفضل النتائج المطابقة (نسبة تشابه {topMatchScore}%):</strong>
                  اختر المنتج المناسب مباشرة من القائمة أدناه للبيع، وسيتم حفظ اختيارك محلياً لرفع الدقة في المرات القادمة.
                </div>
              </div>
            )}

            {/* Threshold Banner 3: < 70% Low Confidence Match Request Manual Search */}
            {!autoSelectedProduct && matchResults.length > 0 && topMatchScore < 70 && (
              <div className="bg-amber-50 border border-amber-300 p-3 rounded-2xl text-amber-950 flex items-start gap-2 text-xs">
                <AlertCircle size={18} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="font-extrabold block">⚠️ نسبة المطابقة أقل من 70% (أعلى نتيجة: {topMatchScore}%):</strong>
                  لم نتمكن من الجزم بالمنتج بدقة 100%. يرجى اختيار المنتج يدوياً أدناه أو استخدام خانة البحث السريع.
                </div>
              </div>
            )}

            {/* Manual Search Bar when < 70% or to easily locate products */}
            {matchResults.length > 0 && (
              <div className="relative">
                <Search size={14} className="absolute right-3 top-2.5 text-stone-400" />
                <input 
                  type="text"
                  placeholder="🔍 بحث يدوي عن سلعة بالاسم، البراند أو الباركود..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 rounded-xl pr-8 pl-3 py-1.5 text-xs font-bold text-stone-800 focus:outline-none focus:border-amber-500"
                />
              </div>
            )}

            {/* List of Matched Items */}
            <div className="flex-1 overflow-y-auto space-y-2 max-h-80 md:max-h-96 pr-1 divide-y divide-stone-100">
              {matchResults.length === 0 ? (
                <div className="p-8 text-center text-stone-400 space-y-2">
                  <ImageIcon size={36} className="mx-auto text-stone-300" />
                  <p className="text-xs font-bold">التقط صورة لعلبة المنتج لعرض نتائج المطابقة الشاملة فوراً</p>
                </div>
              ) : (
                filteredResults.map((matchRes) => {
                  const { item, overallScore, reasons } = matchRes;
                  const isTopMatch = overallScore === topMatchScore && overallScore >= 70;

                  return (
                    <div 
                      key={item.id}
                      className={`pt-2.5 pb-2 flex flex-col gap-1.5 p-2.5 rounded-2xl transition-all ${
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
                            <img src={item.imageUrl} alt={item.name} className="w-11 h-11 object-cover rounded-xl border border-stone-200 shrink-0" />
                          ) : (
                            <div className="w-11 h-11 bg-amber-100 text-amber-900 rounded-xl flex items-center justify-center font-bold text-base shrink-0 border border-amber-200">
                              📦
                            </div>
                          )}
                          <div className="truncate">
                            <h4 className="font-extrabold text-xs text-stone-900 truncate">{item.name}</h4>
                            <div className="text-[10px] text-stone-500 flex items-center gap-2 flex-wrap mt-0.5">
                              <span>الستوك: <strong className={item.qty > 0 ? 'text-emerald-700 font-black' : 'text-red-600'}>{item.qty} قطعة</strong></span>
                              <span className={`text-[9px] px-2 py-0.5 rounded-full font-black border ${
                                overallScore >= 85 
                                  ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs' 
                                  : overallScore >= 70 
                                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300' 
                                  : overallScore >= 50
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-stone-100 text-stone-600 border-stone-200'
                              }`}>
                                مطابقة {overallScore}% {overallScore >= 85 && '🔥'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono font-black text-xs text-stone-900">
                            {item.sell.toFixed(3)} <span className="text-[9px]">د.ت</span>
                          </span>

                          <button 
                            type="button"
                            onClick={() => handleUserSelectProduct(item)}
                            className={`font-black px-3.5 py-1.5 rounded-xl text-xs flex items-center gap-1 shadow-sm cursor-pointer transition-all ${
                              overallScore >= 70
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-amber-600 hover:bg-amber-700 text-white'
                            }`}
                          >
                            <Plus size={12} /> بيع 🛒
                          </button>
                        </div>
                      </div>

                      {/* Reasons pills */}
                      {reasons && reasons.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1 border-t border-stone-200/60">
                          {reasons.map((r, rIdx) => (
                            <span key={rIdx} className="text-[10px] font-bold bg-white text-stone-800 border border-stone-200 px-2 py-0.5 rounded-lg">
                              {r}
                            </span>
                          ))}
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
            Tesseract OCR + تحليل بصري + حِفظ القرارات محلياً بدون خوادم مدفوعة 🧠
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
