import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  Search,
  CheckCircle2,
  AlertCircle,
  Plus,
  Info,
  Flame,
  Edit2
} from 'lucide-react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { MealCategory, ScannedFoodProduct } from '../../types';
import {
  lookupProductByBarcode,
  calculatePortionNutrients,
  sanitizeBarcode
} from '../../services/openFoodFactsService';

export interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMealCategory?: MealCategory;
  onScanSuccess?: (barcode: string, product: ScannedFoodProduct | null) => void;
  onAddFoodEntry?: (entry: {
    name: string;
    brand?: string;
    barcode?: string;
    imageUrl?: string;
    mealCategory: MealCategory;
    quantity: number;
    servingUnit: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    fiber?: number;
  }) => void;
  onOpenManualCustomFood?: (prefill: { name: string; barcode: string }) => void;
}

const MEAL_CATEGORY_OPTIONS: { id: MealCategory; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'pre_workout', label: 'Pre-Workout' },
  { id: 'post_workout', label: 'Post-Workout' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snacks', label: 'Snacks' },
  { id: 'custom', label: 'Custom Meals' }
];

export const BarcodeScanner: React.FC<BarcodeScannerProps> = ({
  isOpen,
  onClose,
  defaultMealCategory = 'lunch',
  onScanSuccess,
  onAddFoodEntry,
  onOpenManualCustomFood
}) => {
  // Modes: camera viewfinder vs manual barcode entry
  const [activeMode, setActiveMode] = useState<'camera' | 'manual'>('camera');
  const [manualBarcodeInput, setManualBarcodeInput] = useState<string>('');

  // Scanning & lookup states
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isLookingUp, setIsLookingUp] = useState<boolean>(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [scannedProduct, setScannedProduct] = useState<ScannedFoodProduct | null>(null);

  // Portion adjustment states
  const [selectedMealCategory, setSelectedMealCategory] = useState<MealCategory>(defaultMealCategory);
  const [portionMode, setPortionMode] = useState<'serving' | '100g' | 'custom_grams'>('serving');
  const [portionMultiplier, setPortionMultiplier] = useState<number>(1);
  const [customGramAmount, setCustomGramAmount] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Scanner HTML5 instance ref & audio feedback
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const scanLockRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playBeep = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6 tone
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // Audio feedback unavailable
    }
  };

  // Safe camera teardown
  const stopScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch (err) {
        console.warn('Scanner stop warning:', err);
      }
      html5QrCodeRef.current = null;
    }
    setIsScanning(false);
  };

  // Initialize camera scanner when modal opens in camera mode
  useEffect(() => {
    if (!isOpen || activeMode !== 'camera' || scannedProduct) {
      stopScanner();
      return;
    }

    let isMounted = true;
    scanLockRef.current = false;

    const startScanner = async () => {
      setScannerError(null);
      setIsScanning(true);

      // Wait a tick for the container DOM element to mount
      await new Promise((r) => setTimeout(r, 100));
      if (!isMounted) return;

      const element = document.getElementById('barcode-scanner-viewfinder');
      if (!element) return;

      try {
        const scanner = new Html5Qrcode('barcode-scanner-viewfinder', {
          formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39
          ],
          verbose: false
        });

        html5QrCodeRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: { width: 260, height: 160 },
            aspectRatio: 1.333
          },
          (decodedText) => {
            if (scanLockRef.current) return;
            scanLockRef.current = true;
            playBeep();
            stopScanner();
            handleProcessBarcode(decodedText);
          },
          () => {
            // Quiet frame pass
          }
        );
      } catch (err: any) {
        if (isMounted) {
          console.error('Camera start error:', err);
          setScannerError(
            err?.message ||
              'Unable to access camera. Please ensure camera permissions are allowed, or enter the barcode manually.'
          );
          setIsScanning(false);
        }
      }
    };

    startScanner();

    return () => {
      isMounted = false;
      stopScanner();
    };
  }, [isOpen, activeMode, scannedProduct]);

  // Teardown when component unmounts
  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  const handleProcessBarcode = async (barcodeString: string) => {
    const clean = sanitizeBarcode(barcodeString);
    if (!clean) {
      setLookupError('Invalid barcode format.');
      return;
    }

    setScannedBarcode(clean);
    setIsLookingUp(true);
    setLookupError(null);

    const result = await lookupProductByBarcode(clean);
    setIsLookingUp(false);

    if (result.success && result.found && result.product) {
      setScannedProduct(result.product);
      setPortionMode(result.product.hasServingData ? 'serving' : '100g');
      setPortionMultiplier(1);
      if (result.product.servingQuantity) {
        setCustomGramAmount(result.product.servingQuantity);
      }
      if (onScanSuccess) {
        onScanSuccess(clean, result.product);
      }
    } else {
      setLookupError(
        result.error || `Product not found for barcode ${clean}. You can log it as a custom food.`
      );
      if (onScanSuccess) {
        onScanSuccess(clean, null);
      }
    }
  };

  const handleManualLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualBarcodeInput.trim()) return;
    handleProcessBarcode(manualBarcodeInput);
  };

  const handleResetScan = () => {
    setScannedProduct(null);
    setScannedBarcode(null);
    setLookupError(null);
    setScannerError(null);
    scanLockRef.current = false;
    setActiveMode('camera');
  };

  const handleConfirmAddToMeal = () => {
    if (!scannedProduct || isSubmitting) return;
    setIsSubmitting(true);

    const portion = calculatePortionNutrients(
      scannedProduct,
      portionMode,
      portionMultiplier,
      customGramAmount
    );

    if (onAddFoodEntry) {
      onAddFoodEntry({
        name: scannedProduct.name,
        brand: scannedProduct.brand,
        barcode: scannedProduct.barcode,
        imageUrl: scannedProduct.imageUrl,
        mealCategory: selectedMealCategory,
        quantity: portionMultiplier,
        servingUnit: portion.servingLabel,
        calories: portion.calories,
        protein: portion.protein,
        carbs: portion.carbs,
        fat: portion.fat,
        fiber: portion.fiber
      });
    }

    setIsSubmitting(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 animate-fade-in">
      <div className="bg-surface border border-line rounded-2xl max-w-md w-full shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[92vh]">
        {/* HEADER */}
        <div className="px-5 py-4 border-b border-line flex items-center justify-between bg-canvas/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center text-accent-ink font-bold font-nrc text-sm">
              NRC
            </div>
            <div>
              <h3 className="font-bold text-white text-sm sm:text-base tracking-tight flex items-center gap-1.5">
                <span>Food Barcode Scanner</span>
              </h3>
              <p className="text-[11px] font-mono text-zinc-400 tracking-wide">
                Open Food Facts Integration
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              stopScanner();
              onClose();
            }}
            className="w-8 h-8 rounded-full bg-surface-2 hover:bg-surface-3 border border-zinc-700/60 text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* BODY */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* LOOKING UP SPINNER */}
          {isLookingUp && (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-12 h-12 rounded-full border-2 border-line border-t-accent animate-spin" />
              <div className="text-sm font-bold text-white font-nrc tracking-wide">
                Searching Open Food Facts...
              </div>
              <p className="text-xs text-zinc-400 font-mono">Barcode: {scannedBarcode}</p>
            </div>
          )}

          {/* VIEW: CAMERA VIEWFINDER & MANUAL ENTRY */}
          {!isLookingUp && !scannedProduct && (
            <div className="space-y-4">
              {/* Mode Toggle */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-surface-2 border border-line rounded-2xl text-xs font-semibold">
                <button
                  onClick={() => {
                    setScannerError(null);
                    setLookupError(null);
                    setActiveMode('camera');
                  }}
                  className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                    activeMode === 'camera'
                      ? 'bg-surface-3 text-accent font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Scan with Camera</span>
                </button>

                <button
                  onClick={() => {
                    stopScanner();
                    setScannerError(null);
                    setLookupError(null);
                    setActiveMode('manual');
                  }}
                  className={`py-2 rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                    activeMode === 'manual'
                      ? 'bg-surface-3 text-accent font-bold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Type Barcode</span>
                </button>
              </div>

              {/* Camera Scanner Viewfinder */}
              {activeMode === 'camera' && (
                <div className="space-y-3">
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-[4/3] border border-line shadow-inner flex items-center justify-center">
                    <div id="barcode-scanner-viewfinder" className="w-full h-full" />

                    {/* Viewfinder Target Reticle */}
                    {isScanning && (
                      <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center">
                        <div className="relative w-64 h-36 border-2 border-white/30 rounded-xl">
                          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-accent -translate-x-0.5 -translate-y-0.5" />
                          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-accent translate-x-0.5 -translate-y-0.5" />
                          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-accent -translate-x-0.5 translate-y-0.5" />
                          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-accent translate-x-0.5 translate-y-0.5" />
                          <div className="w-full h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent animate-pulse absolute top-1/2 -translate-y-1/2" />
                        </div>
                        <span className="text-[11px] font-mono font-bold tracking-wide text-white/70 mt-2 bg-black/60 px-2.5 py-0.5 rounded-full backdrop-blur-sm">
                          Align barcode inside target
                        </span>
                      </div>
                    )}

                    {scannerError && (
                      <div className="absolute inset-0 p-4 bg-canvas/95 flex flex-col items-center justify-center text-center space-y-2.5">
                        <AlertCircle className="w-8 h-8 text-amber-400" />
                        <div className="text-xs font-bold text-white">Camera Unavailable</div>
                        <p className="text-[11px] text-zinc-400 max-w-xs">{scannerError}</p>
                        <button
                          onClick={() => setActiveMode('manual')}
                          className="px-4 py-2 bg-accent text-accent-ink font-bold text-xs rounded-xl transition-transform hover:scale-105 mt-1"
                        >
                          Enter Barcode Manually
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="text-[11px] text-zinc-400 text-center">
                    Hold packaging steady. Scans standard retail UPC-A, EAN-13, and EAN-8 barcodes.
                  </p>
                </div>
              )}

              {/* Manual Entry Fallback */}
              {activeMode === 'manual' && (
                <form onSubmit={handleManualLookup} className="space-y-3.5">
                  <div>
                    <label className="block text-zinc-300 text-xs font-bold mb-1.5">
                      Barcode Number (UPC / EAN)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoFocus
                      value={manualBarcodeInput}
                      onChange={(e) => setManualBarcodeInput(e.target.value)}
                      placeholder="e.g. 888849000010 or 3017624010701"
                      className="w-full px-3.5 py-3 bg-surface-2 border border-line-strong focus:border-accent rounded-xl text-white font-mono text-sm tracking-wide focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!manualBarcodeInput.trim()}
                    className="w-full py-3 bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-ink font-bold font-nrc text-sm rounded-xl tracking-tight transition-transform flex items-center justify-center gap-2"
                  >
                    <Search className="w-4 h-4 stroke-[2.5]" />
                    <span>Search Open Food Facts</span>
                  </button>

                  <div className="pt-2 border-t border-line space-y-1.5">
                    <span className="text-[11px] font-mono text-zinc-500 font-bold tracking-wide block">
                      Quick Test Barcodes:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setManualBarcodeInput('888849000010');
                          handleProcessBarcode('888849000010');
                        }}
                        className="px-2 py-1 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-[11px] text-zinc-300 font-mono transition-colors"
                      >
                        Quest Bar (888849000010)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setManualBarcodeInput('5449000000996');
                          handleProcessBarcode('5449000000996');
                        }}
                        className="px-2 py-1 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-[11px] text-zinc-300 font-mono transition-colors"
                      >
                        Coca-Cola (5449000000996)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setManualBarcodeInput('3017624010701');
                          handleProcessBarcode('3017624010701');
                        }}
                        className="px-2 py-1 rounded-lg bg-surface-2 hover:bg-surface-3 border border-line text-[11px] text-zinc-300 font-mono transition-colors"
                      >
                        Nutella (3017624010701)
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {/* Error Banner */}
              {lookupError && (
                <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs space-y-2">
                  <div className="flex items-start gap-2 text-amber-300 font-semibold">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                    <span>{lookupError}</span>
                  </div>
                  {onOpenManualCustomFood && scannedBarcode && (
                    <button
                      onClick={() => {
                        stopScanner();
                        onClose();
                        onOpenManualCustomFood({
                          name: '',
                          barcode: scannedBarcode
                        });
                      }}
                      className="w-full py-2 bg-surface-3 hover:bg-zinc-700 text-amber-300 font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Log as Custom Food</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* VIEW: PRODUCT REVIEW CARD & SERVING CUSTOMIZER */}
          {!isLookingUp && scannedProduct && (
            <div className="space-y-4 animate-fade-in">
              <div className="p-3.5 rounded-2xl bg-surface-2/80 border border-line flex gap-3.5">
                {scannedProduct.imageUrl ? (
                  <img
                    src={scannedProduct.imageUrl}
                    alt={scannedProduct.name}
                    className="w-16 h-16 rounded-xl object-cover bg-black border border-line shrink-0"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-surface-3 border border-zinc-700/60 flex items-center justify-center text-zinc-500 shrink-0">
                    <Flame className="w-6 h-6 text-zinc-600" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  {scannedProduct.brand && (
                    <span className="text-[11px] font-mono font-bold text-accent tracking-wide block truncate">
                      {scannedProduct.brand}
                    </span>
                  )}
                  <h4 className="font-bold text-white text-sm line-clamp-2 leading-snug">
                    {scannedProduct.name}
                  </h4>
                  <div className="text-[11px] font-mono text-zinc-400 mt-1 flex items-center gap-2">
                    <span>Barcode: {scannedProduct.barcode}</span>
                    {scannedProduct.servingSizeText && (
                      <>
                        <span>&middot;</span>
                        <span className="truncate">{scannedProduct.servingSizeText}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {scannedProduct.incompleteDataWarning && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-center gap-2">
                  <Info className="w-4 h-4 shrink-0 text-amber-400" />
                  <span>{scannedProduct.incompleteDataWarning}</span>
                </div>
              )}

              {/* Portion Mode Selector */}
              <div className="space-y-2">
                <label className="block text-[11px] font-mono font-bold tracking-wide text-zinc-400">
                  Select Serving Unit &amp; Portion
                </label>

                <div className="grid grid-cols-3 gap-1.5 p-1 bg-surface-2 border border-line rounded-xl text-xs font-semibold">
                  {scannedProduct.hasServingData && (
                    <button
                      onClick={() => {
                        setPortionMode('serving');
                        setPortionMultiplier(1);
                      }}
                      className={`py-1.5 rounded-lg transition-colors truncate px-1 text-[11px] ${
                        portionMode === 'serving'
                          ? 'bg-surface-3 text-accent font-bold shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Per Serving
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setPortionMode('100g');
                      setPortionMultiplier(1);
                    }}
                    className={`py-1.5 rounded-lg transition-colors truncate px-1 text-[11px] ${
                      portionMode === '100g'
                        ? 'bg-surface-3 text-accent font-bold shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Per 100{scannedProduct.servingUnit}
                  </button>

                  <button
                    onClick={() => {
                      setPortionMode('custom_grams');
                      setPortionMultiplier(1);
                    }}
                    className={`py-1.5 rounded-lg transition-colors truncate px-1 text-[11px] ${
                      portionMode === 'custom_grams'
                        ? 'bg-surface-3 text-accent font-bold shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Custom {scannedProduct.servingUnit}
                  </button>
                </div>
              </div>

              {/* Quantity Controls */}
              <div className="p-3 bg-surface-2/60 border border-line rounded-2xl flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-white block">
                    {portionMode === 'serving'
                      ? 'Number of Servings'
                      : portionMode === '100g'
                      ? `Multiples of 100${scannedProduct.servingUnit}`
                      : `Custom Weight (${scannedProduct.servingUnit})`}
                  </span>
                  <span className="text-[11px] text-zinc-400 font-mono">
                    {portionMode === 'serving'
                      ? scannedProduct.servingSizeText || '1 standard portion'
                      : portionMode === '100g'
                      ? `${Math.round(100 * portionMultiplier)}${scannedProduct.servingUnit} total`
                      : `${customGramAmount}${scannedProduct.servingUnit}`}
                  </span>
                </div>

                {portionMode === 'custom_grams' ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="1"
                      max="5000"
                      value={customGramAmount}
                      onChange={(e) => setCustomGramAmount(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 px-2.5 py-1.5 bg-surface-3 border border-line-strong rounded-xl text-center text-white font-mono font-bold text-xs"
                    />
                    <span className="text-zinc-400 text-xs font-mono">{scannedProduct.servingUnit}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPortionMultiplier((p) => Math.max(0.25, Number((p - 0.25).toFixed(2))))}
                      className="w-8 h-8 rounded-xl bg-surface-3 hover:bg-zinc-700 text-white font-bold flex items-center justify-center transition-colors text-sm"
                    >
                      &minus;
                    </button>
                    <input
                      type="number"
                      step="0.25"
                      min="0.25"
                      max="20"
                      value={portionMultiplier}
                      onChange={(e) => setPortionMultiplier(Math.max(0.1, Number(e.target.value) || 1))}
                      className="w-14 px-1 py-1 bg-surface-3 border border-line-strong rounded-xl text-center text-white font-mono font-bold text-xs"
                    />
                    <button
                      onClick={() => setPortionMultiplier((p) => Number((p + 0.25).toFixed(2)))}
                      className="w-8 h-8 rounded-xl bg-surface-3 hover:bg-zinc-700 text-white font-bold flex items-center justify-center transition-colors text-sm"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>

              {/* Calculated Macros Preview */}
              {(() => {
                const calculated = calculatePortionNutrients(
                  scannedProduct,
                  portionMode,
                  portionMultiplier,
                  customGramAmount
                );

                return (
                  <div className="p-4 rounded-2xl bg-gradient-to-br from-zinc-900 to-black border border-line space-y-3">
                    <div className="flex items-baseline justify-between border-b border-line pb-2">
                      <span className="text-xs font-mono font-bold text-zinc-400">
                        Total Nutrients ({calculated.servingLabel})
                      </span>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold font-nrc text-accent">
                          {calculated.calories}
                        </span>
                        <span className="text-xs font-mono font-bold text-zinc-400">KCAL</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div className="p-2 rounded-xl bg-canvas/80 border border-zinc-800/60">
                        <span className="text-[11px] font-mono font-bold text-lime-400 block">
                          Protein
                        </span>
                        <span className="text-sm font-mono font-bold text-white">
                          {calculated.protein}g
                        </span>
                      </div>

                      <div className="p-2 rounded-xl bg-canvas/80 border border-zinc-800/60">
                        <span className="text-[11px] font-mono font-bold text-sky-400 block">
                          Carbs
                        </span>
                        <span className="text-sm font-mono font-bold text-white">
                          {calculated.carbs}g
                        </span>
                      </div>

                      <div className="p-2 rounded-xl bg-canvas/80 border border-zinc-800/60">
                        <span className="text-[11px] font-mono font-bold text-amber-400 block">
                          Fat
                        </span>
                        <span className="text-sm font-mono font-bold text-white">
                          {calculated.fat}g
                        </span>
                      </div>

                      <div className="p-2 rounded-xl bg-canvas/80 border border-zinc-800/60">
                        <span className="text-[11px] font-mono font-bold text-purple-400 block">
                          Fiber
                        </span>
                        <span className="text-sm font-mono font-bold text-white">
                          {calculated.fiber}g
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Target Meal Category Selector */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-mono font-bold tracking-wide text-zinc-400">
                  Add To Meal
                </label>
                <select
                  value={selectedMealCategory}
                  onChange={(e) => setSelectedMealCategory(e.target.value as MealCategory)}
                  className="w-full px-3.5 py-2.5 bg-surface-2 border border-line-strong rounded-xl text-xs font-bold text-white focus:outline-none focus:border-accent"
                >
                  {MEAL_CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleResetScan}
                  className="px-4 py-3 bg-surface-2 hover:bg-surface-3 border border-line text-zinc-300 font-bold text-xs rounded-xl transition-colors"
                >
                  Scan Another
                </button>

                <button
                  type="button"
                  onClick={handleConfirmAddToMeal}
                  disabled={isSubmitting}
                  className="flex-1 py-3 bg-accent hover:bg-accent-hover text-accent-ink font-bold font-nrc text-sm rounded-xl tracking-tight transition-transform flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Plus className="w-4 h-4 stroke-[3]" />
                  <span>Add to {MEAL_CATEGORY_OPTIONS.find((c) => c.id === selectedMealCategory)?.label}</span>
                </button>
              </div>

              <p className="text-[11px] text-zinc-500 text-center font-mono pt-1">
                Data &amp; imagery provided by Open Food Facts under Open Database License (ODbL).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BarcodeScanner;
