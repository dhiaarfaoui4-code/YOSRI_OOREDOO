import React, { useEffect, useState, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X, RefreshCw, Sparkles } from 'lucide-react';

interface BarcodeScannerPopupProps {
  onScan: (code: string) => void;
  onClose: () => void;
}

export const BarcodeScannerPopup: React.FC<BarcodeScannerPopupProps> = ({ onScan, onClose }) => {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [currentCamIdx, setCurrentCamIdx] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSwitching, setIsSwitching] = useState(false);
  const [showFlash, setShowFlash] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = 'qr-reader-target';
  const hasScannedRef = useRef(false);

  // Keep a stable ref of the scanner callback so re-renders of the parent don't teardown/restart the camera!
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Quick camera beep sound: short high-pitch sine wave generated natively via Web Audio API (100% offline & zero dependencies)
  const playShutterSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.08);
      
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.error('Audio context error:', e);
    }
  };

  useEffect(() => {
    let active = true;
    hasScannedRef.current = false;
    let scannerInstance: Html5Qrcode | null = null;

    async function initScanner() {
      try {
        const devices = await Html5Qrcode.getCameras();
        if (!active) return;

        if (devices && devices.length > 0) {
          // Prefer environment/rear cameras
          const rearCams = devices.filter(c => /back|rear|environment|خلفية/i.test(c.label || ''));
          const pool = rearCams.length > 0 ? rearCams : devices;
          const normal = pool.find(c => !/wide|ultra|tele|macro/i.test(c.label || ''));
          
          const chosen = normal || pool[0];
          const chosenIdx = devices.indexOf(chosen);

          setCameras(devices);
          setCurrentCamIdx(chosenIdx);

          // Start scanner
          const scanner = new Html5Qrcode(containerId);
          scannerInstance = scanner;
          qrScannerRef.current = scanner;

          await scanner.start(
            chosen.id,
            { 
              fps: 25, 
              qrbox: { width: 280, height: 130 },
              disableFlip: true
            },
            (text) => {
              if (active && !hasScannedRef.current) {
                hasScannedRef.current = true;
                onScanRef.current(text);
              }
            },
            () => {} // Suppress noise
          );

          // If cleanup happened during start, stop it immediately
          if (!active) {
            if (scanner.isScanning) {
              await scanner.stop().catch(() => {});
            }
            try { scanner.clear(); } catch (e) {}
          }
        } else {
          setErrorMessage('لم يتم العثور على أي كاميرا.');
        }
      } catch (err: any) {
        console.error(err);
        if (active) {
          setErrorMessage('تعذر تشغيل الكاميرا. يرجى السماح بصلاحية الكاميرا.');
        }
      }
    }

    initScanner();

    return () => {
      active = false;
      if (scannerInstance) {
        const inst = scannerInstance;
        if (inst.isScanning) {
          inst.stop().then(() => {
            try { inst.clear(); } catch (e) {}
          }).catch(err => {
            console.error('Error stopping scanner during cleanup:', err);
          });
        } else {
          try { inst.clear(); } catch (e) {}
        }
      }
    };
  }, []);

  const switchCamera = async () => {
    if (!qrScannerRef.current || cameras.length < 2 || isSwitching) return;
    setIsSwitching(true);
    
    try {
      if (qrScannerRef.current.isScanning) {
        await qrScannerRef.current.stop();
      }
      try { qrScannerRef.current.clear(); } catch (e) {}
      
      hasScannedRef.current = false; // Reset lock on camera switch
      
      const nextIdx = (currentCamIdx + 1) % cameras.length;
      setCurrentCamIdx(nextIdx);
      
      const nextCam = cameras[nextIdx];
      await qrScannerRef.current.start(
        nextCam.id,
        { 
          fps: 25, 
          qrbox: { width: 280, height: 130 },
          disableFlip: true
        },
        (text) => {
          if (!hasScannedRef.current) {
            hasScannedRef.current = true;
            onScanRef.current(text);
          }
        },
        () => {}
      );
    } catch (err) {
      console.error('Failed to switch camera:', err);
      setErrorMessage('فشل تبديل الكاميرا.');
    } finally {
      setIsSwitching(false);
    }
  };

  // Capture current video frame and analyze for all barcodes in it (Multi-Barcode Detection)
  const captureAndAnalyze = async () => {
    if (analyzing) return;
    
    const video = document.querySelector(`#${containerId} video`) as HTMLVideoElement;
    if (!video) {
      setErrorMessage('تعذر العثور على تغذية الكاميرا النشطة لالتقاط الصورة.');
      return;
    }
    
    setAnalyzing(true);
    setShowFlash(true);
    playShutterSound();
    
    // Quick flash duration
    setTimeout(() => setShowFlash(false), 150);
    
    try {
      // 1. Draw video frame to canvas
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || video.clientWidth || 640;
      canvas.height = video.videoHeight || video.clientHeight || 480;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // 2. Try native BarcodeDetector first (extremely fast, hardware-accelerated, decodes multiple codes together)
      const BarcodeDetectorClass = (window as any).BarcodeDetector;
      let detectedCodes: string[] = [];
      
      if (BarcodeDetectorClass) {
        try {
          const formats = await BarcodeDetectorClass.getSupportedFormats();
          const detector = new BarcodeDetectorClass({ formats });
          const results = await detector.detect(canvas);
          if (results && results.length > 0) {
            detectedCodes = results.map((r: any) => r.rawValue).filter(Boolean);
          }
        } catch (detectorError) {
          console.error('BarcodeDetector error:', detectorError);
        }
      }
      
      // 3. Fallback to Html5Qrcode scanFile if no codes detected or BarcodeDetector is not supported (e.g. iOS Safari)
      if (detectedCodes.length === 0 && qrScannerRef.current) {
        await new Promise<void>((resolve) => {
          canvas.toBlob(async (blob) => {
            if (!blob || !qrScannerRef.current) {
              resolve();
              return;
            }
            try {
              const file = new File([blob], 'captured_frame.png', { type: 'image/png' });
              const decodedText = await qrScannerRef.current.scanFile(file, false);
              if (decodedText) {
                detectedCodes = [decodedText];
              }
            } catch (scanError) {
              console.log('Static image scan fell back or found nothing:', scanError);
            }
            resolve();
          }, 'image/png');
        });
      }
      
      // 4. Return results or notify
      if (detectedCodes.length > 0) {
        const uniqueCodes = Array.from(new Set(detectedCodes));
        onScanRef.current(uniqueCodes.join(', '));
      } else {
        alert('لم يتم العثور على أي باركود في الصورة الملتقطة. يرجى محاذاة الكود جيداً والمحاولة مجدداً.');
      }
    } catch (err) {
      console.error('Capture and analyze failed:', err);
      setErrorMessage('فشل التقاط الصورة وتحليلها.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-md p-5 border border-stone-200 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-stone-800 text-base flex items-center gap-2">
            <Camera size={20} className="text-red-700 animate-pulse" />
            صوّب الكاميرا على الباركود
          </h3>
          <button 
            onClick={onClose}
            className="p-1 rounded-full hover:bg-stone-100 text-stone-500 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {errorMessage ? (
          <div className="bg-rose-50 text-rose-700 text-xs p-3 rounded-xl border border-rose-100 text-center mb-4">
            {errorMessage}
          </div>
        ) : (
          <div className="relative bg-stone-950 rounded-xl overflow-hidden aspect-[4/3] border-2 border-stone-800 shadow-inner flex items-center justify-center">
            <div id={containerId} className="w-full h-full" />
            
            {/* Target Box styling */}
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
              <div className="w-[280px] h-[130px] border-2 border-dashed border-yellow-400 rounded-xl animate-pulse shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
            </div>

            {/* Camera flash shutter feedback effect */}
            {showFlash && (
              <div className="absolute inset-0 bg-white z-10 transition-opacity duration-150 opacity-100" />
            )}
          </div>
        )}

        {/* Shutter snapshot analysis button */}
        {!errorMessage && (
          <button
            onClick={captureAndAnalyze}
            disabled={analyzing}
            className="w-full mt-3 bg-red-700 hover:bg-red-800 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.98] disabled:opacity-75 cursor-pointer text-sm"
          >
            <Sparkles size={18} className="text-yellow-400" />
            {analyzing ? 'جاري التقاط وتحليل الأكواد...' : '📸 التقاط وقراءة كل الأكواد معاً'}
          </button>
        )}

        <div className="flex gap-2 mt-3">
          {cameras.length > 1 && (
            <button
              onClick={switchCamera}
              className="flex-1 bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold py-2 px-4 rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer text-xs"
            >
              <RefreshCw size={14} />
              تبديل الكاميرا ({currentCamIdx + 1}/{cameras.length})
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold py-2 px-4 rounded-xl transition-all cursor-pointer text-xs border border-rose-100"
          >
            غلق الكاميرا
          </button>
        </div>
      </div>
    </div>
  );
};
