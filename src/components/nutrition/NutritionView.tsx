import React, { useState, useEffect } from 'react';
import {
  Apple,
  Plus,
  Trash2,
  Search,
  Droplets,
  Copy,
  ChevronLeft,
  ChevronRight,
  Flame,
  Check,
  Edit2,
  Calendar,
  Layers,
  Sparkles,
  RotateCcw,
  Camera
} from 'lucide-react';
import {
  DailyNutritionLog,
  FoodEntry,
  FoodItem,
  MealCategory,
  UserProfile
} from '../../types';
import { db } from '../../storage/db';
import { BarcodeScanner } from './BarcodeScanner';

interface NutritionViewProps {
  profile: UserProfile;
}

const MEAL_CATEGORIES: { id: MealCategory; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'pre_workout', label: 'Pre-Workout' },
  { id: 'post_workout', label: 'Post-Workout' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snacks', label: 'Snacks' },
  { id: 'custom', label: 'Custom Meals' }
];

export const NutritionView: React.FC<NutritionViewProps> = ({ profile }) => {
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [currentLog, setCurrentLog] = useState<DailyNutritionLog>(() =>
    db.getNutritionLogForDate(new Date().toISOString().split('T')[0])
  );
  const [foodDatabase, setFoodDatabase] = useState<FoodItem[]>([]);

  // Search & add food modal
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [addMode, setAddMode] = useState<'database' | 'ai_parser'>('database');
  const [activeMealCategory, setActiveMealCategory] = useState<MealCategory>('breakfast');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedFoodItem, setSelectedFoodItem] = useState<FoodItem | null>(null);
  const [portionMultiplier, setPortionMultiplier] = useState<number>(1);

  // AI Meal Parser state
  const [aiMealQuery, setAiMealQuery] = useState<string>('');
  const [aiMealLoading, setAiMealLoading] = useState<boolean>(false);
  const [aiMealError, setAiMealError] = useState<string | null>(null);
  const [aiParsedItems, setAiParsedItems] = useState<any[]>([]);

  // Manual Custom food creator modal
  const [isManualModalOpen, setIsManualModalOpen] = useState<boolean>(false);
  const [manualName, setManualName] = useState<string>('');
  const [manualCalories, setManualCalories] = useState<number>(0);
  const [manualProtein, setManualProtein] = useState<number>(0);
  const [manualCarbs, setManualCarbs] = useState<number>(0);
  const [manualFat, setManualFat] = useState<number>(0);
  const [manualFiber, setManualFiber] = useState<number>(0);
  const [manualServingUnit, setManualServingUnit] = useState<string>('g');

  // Barcode Scanner modal state
  const [isBarcodeScannerOpen, setIsBarcodeScannerOpen] = useState<boolean>(false);

  useEffect(() => {
    setFoodDatabase(db.getAllFoods());
  }, []);

  useEffect(() => {
    const log = db.getNutritionLogForDate(selectedDate);
    setCurrentLog(log);
  }, [selectedDate]);

  const saveLog = (log: DailyNutritionLog) => {
    setCurrentLog(log);
    db.saveNutritionLogForDate(log);
  };

  const handleAddScannedFoodEntry = (scanned: {
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
  }) => {
    const displayName = scanned.brand ? `${scanned.brand} — ${scanned.name}` : scanned.name;
    const newEntry: FoodEntry = {
      id: `entry-scan-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: displayName,
      brand: scanned.brand,
      barcode: scanned.barcode,
      imageUrl: scanned.imageUrl,
      mealCategory: scanned.mealCategory,
      quantity: scanned.quantity,
      servingUnit: scanned.servingUnit,
      calories: scanned.calories,
      protein: scanned.protein,
      carbs: scanned.carbs,
      fat: scanned.fat,
      fiber: scanned.fiber,
      isEstimate: false,
      timeLogged: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updated = {
      ...currentLog,
      entries: [...currentLog.entries, newEntry]
    };
    saveLog(updated);
  };

  const handleOpenCustomWithBarcode = (prefill: { name: string; barcode: string }) => {
    setManualName(prefill.name || '');
    setIsManualModalOpen(true);
  };

  const changeDate = (daysDelta: number) => {
    const curr = new Date(selectedDate);
    curr.setDate(curr.getDate() + daysDelta);
    setSelectedDate(curr.toISOString().split('T')[0]);
  };

  const totalCalories = currentLog.entries.reduce((acc, curr) => acc + (curr.calories || 0), 0);
  const totalProtein = Math.round(currentLog.entries.reduce((acc, curr) => acc + (curr.protein || 0), 0));
  const totalCarbs = Math.round(currentLog.entries.reduce((acc, curr) => acc + (curr.carbs || 0), 0));
  const totalFat = Math.round(currentLog.entries.reduce((acc, curr) => acc + (curr.fat || 0), 0));

  const calTarget = profile.dailyCalorieTarget || 2600;
  const proTarget = profile.dailyProteinTarget || 165;
  const carbTarget = profile.dailyCarbsTarget || 300;
  const fatTarget = profile.dailyFatTarget || 70;

  const calRemaining = calTarget - totalCalories;
  const proRemaining = proTarget - totalProtein;

  const filteredFoods = foodDatabase.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAddFromDatabase = () => {
    if (!selectedFoodItem) return;
    const mult = portionMultiplier > 0 ? portionMultiplier : 1;

    const newEntry: FoodEntry = {
      id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: selectedFoodItem.name,
      mealCategory: activeMealCategory,
      quantity: mult,
      servingUnit: selectedFoodItem.servingUnit,
      calories: Math.round(selectedFoodItem.calories * mult),
      protein: Number((selectedFoodItem.protein * mult).toFixed(1)),
      carbs: Number((selectedFoodItem.carbs * mult).toFixed(1)),
      fat: Number((selectedFoodItem.fat * mult).toFixed(1)),
      fiber: selectedFoodItem.fiber ? Number((selectedFoodItem.fiber * mult).toFixed(1)) : undefined,
      isEstimate: false,
      timeLogged: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const updated = {
      ...currentLog,
      entries: [...currentLog.entries, newEntry]
    };
    saveLog(updated);
    setIsAddModalOpen(false);
    setSelectedFoodItem(null);
    setPortionMultiplier(1);
    setSearchQuery('');
  };

  const handleParseAiMeal = async () => {
    if (!aiMealQuery.trim()) return;
    setAiMealLoading(true);
    setAiMealError(null);

    try {
      const res = await fetch('/api/ai-food-parser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: aiMealQuery })
      });
      const json = await res.json();
      if (json.success && json.items) {
        setAiParsedItems(json.items);
      } else {
        setAiMealError(json.error || 'Failed to parse meal breakdown');
      }
    } catch (e: any) {
      setAiMealError(e.message || 'Error communicating with AI parser service');
    } finally {
      setAiMealLoading(false);
    }
  };

  const handleLogAiMealItems = () => {
    if (aiParsedItems.length === 0) return;

    const newEntries: FoodEntry[] = aiParsedItems.map((item) => ({
      id: `entry-ai-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: item.name,
      mealCategory: activeMealCategory,
      quantity: item.quantity || 1,
      servingUnit: item.servingUnit || 'serving',
      calories: Math.round(Number(item.calories) || 0),
      protein: Number(Number(item.protein || 0).toFixed(1)),
      carbs: Number(Number(item.carbs || 0).toFixed(1)),
      fat: Number(Number(item.fat || 0).toFixed(1)),
      fiber: item.fiber ? Number(Number(item.fiber).toFixed(1)) : undefined,
      isEstimate: true,
      timeLogged: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    const updated = {
      ...currentLog,
      entries: [...currentLog.entries, ...newEntries]
    };
    saveLog(updated);
    setIsAddModalOpen(false);
    setAiMealQuery('');
    setAiParsedItems([]);
  };

  const handleAddManualFood = () => {
    if (!manualName.trim()) return;

    const newEntry: FoodEntry = {
      id: `entry-custom-${Date.now()}`,
      name: manualName.trim(),
      mealCategory: activeMealCategory,
      quantity: 1,
      servingUnit: manualServingUnit || 'serving',
      calories: Number(manualCalories) || 0,
      protein: Number(manualProtein) || 0,
      carbs: Number(manualCarbs) || 0,
      fat: Number(manualFat) || 0,
      fiber: Number(manualFiber) || 0,
      isEstimate: false,
      timeLogged: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const newCustomItem: FoodItem = {
      id: `cust-food-${Date.now()}`,
      name: manualName.trim(),
      servingSize: 1,
      servingUnit: manualServingUnit || 'serving',
      calories: Number(manualCalories) || 0,
      protein: Number(manualProtein) || 0,
      carbs: Number(manualCarbs) || 0,
      fat: Number(manualFat) || 0,
      fiber: Number(manualFiber) || 0,
      isCustom: true
    };
    const updatedCustoms = [...db.getCustomFoods(), newCustomItem];
    db.saveCustomFoods(updatedCustoms);
    setFoodDatabase(db.getAllFoods());

    const updated = {
      ...currentLog,
      entries: [...currentLog.entries, newEntry]
    };
    saveLog(updated);
    setIsManualModalOpen(false);
    setManualName('');
    setManualCalories(0);
    setManualProtein(0);
    setManualCarbs(0);
    setManualFat(0);
  };

  const handleRemoveEntry = (entryId: string) => {
    const updated = {
      ...currentLog,
      entries: currentLog.entries.filter((e) => e.id !== entryId)
    };
    saveLog(updated);
  };

  const handleDuplicateYesterday = () => {
    const yesterday = new Date(selectedDate);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const prevLog = db.getNutritionLogForDate(yesterdayStr);

    if (!prevLog || prevLog.entries.length === 0) {
      return;
    }

    const copiedEntries = prevLog.entries.map((e) => ({
      ...e,
      id: `entry-copied-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timeLogged: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }));

    const updated = {
      ...currentLog,
      entries: [...currentLog.entries, ...copiedEntries]
    };
    saveLog(updated);
  };

  const updateWater = (deltaMl: number) => {
    const newWater = Math.max(0, (currentLog.waterMl || 0) + deltaMl);
    const updated = { ...currentLog, waterMl: newWater };
    saveLog(updated);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Nutrition Command Header */}
      <div className="reshape-card p-6 lg:p-7 overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[var(--border-card)]">
          <div>
            <div className="flex items-center gap-2 text-volt-adaptive text-xs font-mono font-bold tracking-wide mb-1">
              <Apple className="w-4 h-4 stroke-[2.5]" />
              <span>Nutrition &amp; Macro Command</span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-nrc font-bold text-[var(--text-primary)] tracking-tight">
              Daily Macro Fuel &amp; Diary
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-1 font-sans">
              Fuel your progressive overload, muscular recovery, and body recomposition goals.
            </p>
          </div>

          {/* Top Actions: Barcode Scanner & Date Navigation */}
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
            <button
              onClick={() => {
                setActiveMealCategory('lunch');
                setIsBarcodeScannerOpen(true);
              }}
              className="touch-press px-4 py-2.5 bg-accent hover:bg-accent text-accent-ink font-nrc font-bold text-sm rounded-2xl flex items-center gap-2 transition-transform"
              title="Scan packaged food barcode with camera"
            >
              <Camera className="w-4 h-4 stroke-[2.5]" />
              <span>Scan Barcode</span>
            </button>

            {/* Date Selector Navigation */}
            <div className="flex items-center gap-1.5 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-2xl p-1.5 font-mono text-xs">
              <button
                onClick={() => changeDate(-1)}
                className="p-1.5 hover:bg-[var(--chip-bg)] rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Previous Day"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="px-2 font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-accent" />
                <span>{selectedDate}</span>
              </div>
              <button
                onClick={() => changeDate(1)}
                className="p-1.5 hover:bg-[var(--chip-bg)] rounded-xl text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                title="Next Day"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Macro Overview Bars & Target Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mt-6">
          {/* Calories */}
          <div className="p-4 reshape-card-subtle space-y-2">
            <span className="text-[11px] font-mono text-[var(--text-muted)] tracking-wide font-bold">Calories</span>
            <div className="text-xl font-mono font-bold text-[var(--text-primary)] tabular-nums">
              {totalCalories}{' '}
              <span className="text-xs font-normal text-[var(--text-muted)]">/ {calTarget}</span>
            </div>
            <div className="w-full bg-[var(--chip-bg)] h-2 rounded-full overflow-hidden border border-[var(--border-card)]">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  totalCalories > calTarget ? 'bg-amber-400' : 'bg-accent'
                }`}
                style={{ width: `${Math.min(100, (totalCalories / calTarget) * 100)}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-[var(--text-secondary)]">
              {calRemaining >= 0 ? `${calRemaining} kcal left` : `${Math.abs(calRemaining)} kcal over`}
            </div>
          </div>

          {/* Protein */}
          <div className="p-4 reshape-card-subtle space-y-2">
            <span className="text-[11px] font-mono text-volt-adaptive tracking-wide font-bold">
              Protein
            </span>
            <div className="text-xl font-mono font-bold text-volt-adaptive tabular-nums">
              {totalProtein}g{' '}
              <span className="text-xs font-normal text-[var(--text-muted)]">/ {proTarget}g</span>
            </div>
            <div className="w-full bg-[var(--chip-bg)] h-2 rounded-full overflow-hidden border border-[var(--border-card)]">
              <div
                className="bg-accent h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (totalProtein / proTarget) * 100)}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-[var(--text-secondary)]">
              {proRemaining <= 0 ? 'Target achieved!' : `${proRemaining}g left`}
            </div>
          </div>

          {/* Carbohydrates */}
          <div className="p-4 reshape-card-subtle space-y-2">
            <span className="text-[11px] font-mono text-sky-500 tracking-wide font-bold">
              Carbohydrates
            </span>
            <div className="text-xl font-mono font-bold text-sky-500 tabular-nums">
              {totalCarbs}g{' '}
              <span className="text-xs font-normal text-[var(--text-muted)]">/ {carbTarget}g</span>
            </div>
            <div className="w-full bg-[var(--chip-bg)] h-2 rounded-full overflow-hidden border border-[var(--border-card)]">
              <div
                className="bg-sky-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (totalCarbs / carbTarget) * 100)}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-[var(--text-secondary)]">
              {Math.max(0, carbTarget - totalCarbs)}g remaining
            </div>
          </div>

          {/* Fats */}
          <div className="p-4 reshape-card-subtle space-y-2">
            <span className="text-[11px] font-mono text-amber-500 tracking-wide font-bold">
              Healthy Fats
            </span>
            <div className="text-xl font-mono font-bold text-amber-500 tabular-nums">
              {totalFat}g{' '}
              <span className="text-xs font-normal text-[var(--text-muted)]">/ {fatTarget}g</span>
            </div>
            <div className="w-full bg-[var(--chip-bg)] h-2 rounded-full overflow-hidden border border-[var(--border-card)]">
              <div
                className="bg-amber-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, (totalFat / fatTarget) * 100)}%` }}
              />
            </div>
            <div className="text-[11px] font-mono text-[var(--text-secondary)]">
              {Math.max(0, fatTarget - totalFat)}g remaining
            </div>
          </div>
        </div>

        {/* Quick Duplicate & Water Bar */}
        <div className="mt-5 pt-4 border-t border-[var(--border-card)] flex flex-wrap items-center justify-between gap-x-4 gap-y-3 text-xs">
          <button
            onClick={handleDuplicateYesterday}
            className="flex items-center gap-1.5 h-9 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
            title="Duplicate all meals from previous day"
          >
            <Copy className="w-3.5 h-3.5 text-accent" />
            <span>Duplicate Yesterday&apos;s Diary</span>
          </button>

          {/* Hydration Tracking Widget */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
              <Droplets className="w-4 h-4 text-sky-400" />
              <span className="font-mono font-bold text-[var(--text-primary)] tabular-nums">
                {(currentLog.waterMl || 0).toLocaleString()} ml
              </span>
            </div>
            <div className="flex items-center gap-1 font-mono text-[11px]">
              <button
                onClick={() => updateWater(250)}
                className="px-2.5 py-1 bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] rounded-xl text-sky-500 border border-sky-400/20"
              >
                +250ml
              </button>
              <button
                onClick={() => updateWater(500)}
                className="px-2.5 py-1 bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] rounded-xl text-sky-500 border border-sky-400/20"
              >
                +500ml
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* MEALS LIST BY CATEGORY */}
      <div className="space-y-4">
        {MEAL_CATEGORIES.map((cat) => {
          const categoryEntries = currentLog.entries.filter((e) => e.mealCategory === cat.id);
          const catCalories = categoryEntries.reduce((acc, curr) => acc + (curr.calories || 0), 0);
          const catProtein = categoryEntries.reduce((acc, curr) => acc + (curr.protein || 0), 0);

          return (
            <div
              key={cat.id}
              className="reshape-card p-4 sm:p-5 space-y-3"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-card)]">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-[var(--text-primary)] text-base">{cat.label}</h3>
                  {categoryEntries.length > 0 && (
                    <span className="text-xs font-mono text-[var(--text-muted)]">
                      ({catCalories} kcal · {catProtein}g pro)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => {
                      setActiveMealCategory(cat.id);
                      setIsBarcodeScannerOpen(true);
                    }}
                    className="px-2.5 py-1.5 bg-[var(--bg-subtle)] hover:bg-[var(--chip-bg)] border border-[var(--border-card)] hover:border-accent/50 text-[var(--text-secondary)] hover:text-volt-adaptive text-xs font-semibold rounded-xl flex items-center gap-1 transition-colors"
                    title={`Scan barcode directly into ${cat.label}`}
                  >
                    <Camera className="w-3.5 h-3.5 text-accent" />
                    <span className="hidden sm:inline">Scan</span>
                  </button>
                  <button
                    onClick={() => {
                      setActiveMealCategory(cat.id);
                      setIsManualModalOpen(true);
                    }}
                    className="px-2.5 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs rounded-xl bg-[var(--bg-subtle)] border border-[var(--border-card)] transition-colors"
                    title="Quick manual entry"
                  >
                    Custom
                  </button>
                  <button
                    onClick={() => {
                      setActiveMealCategory(cat.id);
                      setIsAddModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-accent hover:bg-accent text-accent-ink text-xs font-bold rounded-xl flex items-center gap-1 transition-colors shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5 stroke-[3]" />
                    <span>Add Food</span>
                  </button>
                </div>
              </div>

              {categoryEntries.length === 0 ? (
                <div className="py-4 text-center text-[var(--text-muted)] text-xs font-sans">
                  No foods logged in {cat.label} yet
                </div>
              ) : (
                <div className="space-y-2">
                  {categoryEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-3.5 bg-[var(--bg-subtle)] hover:bg-[var(--bg-surface-elevated)] border border-[var(--border-card)] rounded-2xl flex items-center justify-between text-xs transition-colors"
                    >
                      <div>
                        <div className="font-bold text-[var(--text-primary)] text-sm">{entry.name}</div>
                        <div className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
                          <span>{entry.quantity} &times; {entry.servingUnit}</span>
                          <span className="mx-1.5">·</span>
                          <span className="text-volt-adaptive font-bold">{entry.protein}g P</span>
                          <span className="mx-1">·</span>
                          <span className="text-sky-500 font-bold">{entry.carbs}g C</span>
                          <span className="mx-1">·</span>
                          <span className="text-amber-500 font-bold">{entry.fat}g F</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-[var(--text-primary)] text-sm tabular-nums">
                          {entry.calories} kcal
                        </span>
                        <button
                          onClick={() => handleRemoveEntry(entry.id)}
                          className="p-1.5 text-[var(--text-muted)] hover:text-rose-500 rounded-lg transition-colors"
                          title="Remove item"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* MODAL 1: SEARCH & ADD FROM DATABASE / AI MEAL PARSER */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="reshape-card p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[90dvh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-[var(--text-primary)] text-base">
                  Add Food to {MEAL_CATEGORIES.find((c) => c.id === activeMealCategory)?.label}
                </h3>
                <p className="text-xs text-[var(--text-secondary)]">Search verified fitness staples or use AI natural language parsing.</p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs px-2 py-1"
              >
                Close
              </button>
            </div>

            {/* Mode Toggle Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-2xl text-xs font-semibold">
              <button
                onClick={() => setAddMode('database')}
                className={`py-2 rounded-xl transition-colors truncate px-2 text-xs ${
                  addMode === 'database'
                    ? 'bg-accent text-accent-ink shadow-sm font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                Food Database
              </button>
              <button
                onClick={() => setAddMode('ai_parser')}
                className={`py-2 rounded-xl transition-colors flex items-center justify-center gap-1 truncate px-2 text-xs ${
                  addMode === 'ai_parser'
                    ? 'bg-accent text-accent-ink shadow-sm font-bold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span>AI Parser</span>
              </button>
              <button
                onClick={() => {
                  setIsAddModalOpen(false);
                  setIsBarcodeScannerOpen(true);
                }}
                className="py-2 rounded-xl transition-colors flex items-center justify-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--chip-bg)] truncate px-2 text-xs"
              >
                <Camera className="w-3.5 h-3.5 text-accent shrink-0" />
                <span>Barcode</span>
              </button>
            </div>

            {addMode === 'database' ? (
              <>
                {/* Search Input */}
                <div className="relative">
                  <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-3" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search chicken breast, rice, oats, whey, eggs..."
                    className="w-full pl-9 pr-3 py-2.5 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-2xl text-[var(--text-primary)] text-xs focus:outline-none focus:border-accent"
                  />
                </div>

                {/* Food items list */}
                <div className="overflow-y-auto divide-y divide-[var(--border-card)] pr-1 flex-1 min-h-[200px]">
                  {filteredFoods.slice(0, 25).map((food) => {
                    const isSelected = selectedFoodItem?.id === food.id;
                    return (
                      <div
                        key={food.id}
                        onClick={() => setSelectedFoodItem(food)}
                        className={`p-3 cursor-pointer rounded-2xl transition-colors ${
                          isSelected
                            ? 'bg-[var(--chip-bg)] border border-accent/60'
                            : 'hover:bg-[var(--chip-bg)]'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[var(--text-primary)] text-xs">{food.name}</span>
                          <span className="font-mono text-xs font-bold text-[var(--text-primary)]">
                            {food.calories} kcal
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-[var(--text-muted)] mt-0.5">
                          Per {food.servingSize} {food.servingUnit} ·{' '}
                          <span className="text-volt-adaptive font-semibold">{food.protein}g P</span> ·{' '}
                          <span className="text-sky-500 font-semibold">{food.carbs}g C</span> ·{' '}
                          <span className="text-amber-500 font-semibold">{food.fat}g F</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Portion selector when food is chosen */}
                {selectedFoodItem && (
                  <div className="pt-3 border-t border-[var(--border-card)] flex items-center justify-between gap-3 text-xs bg-[var(--bg-subtle)] p-3.5 rounded-2xl">
                    <div>
                      <label className="block text-[var(--text-secondary)] text-[11px] mb-1">
                        Portion Servings ({selectedFoodItem.servingUnit})
                      </label>
                      <input
                        type="number"
                        step="0.25"
                        min="0.1"
                        value={portionMultiplier}
                        onChange={(e) => setPortionMultiplier(parseFloat(e.target.value) || 1)}
                        className="w-20 px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl text-[var(--text-primary)] font-bold font-mono"
                      />
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-base font-bold text-volt-adaptive">
                        {Math.round(selectedFoodItem.calories * portionMultiplier)} kcal
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {(selectedFoodItem.protein * portionMultiplier).toFixed(1)}g Protein
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 bg-[var(--bg-subtle)] border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-xl text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!selectedFoodItem}
                    onClick={handleAddFromDatabase}
                    className="touch-press px-5 py-2 bg-accent disabled:opacity-40 text-accent-ink font-bold rounded-xl text-xs"
                  >
                    Log Food Entry
                  </button>
                </div>
              </>
            ) : (
              /* AI SMART MEAL PARSER MODE */
              <div className="space-y-4 flex-1 flex flex-col min-h-[220px]">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    Describe your meal in natural English
                  </label>
                  <textarea
                    value={aiMealQuery}
                    onChange={(e) => setAiMealQuery(e.target.value)}
                    placeholder="e.g. 200g grilled chicken breast with 1.5 cups jasmine rice, half an avocado and 1 cup steamed broccoli"
                    rows={3}
                    className="w-full px-3 py-2 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-2xl text-[var(--text-primary)] text-xs focus:outline-none focus:border-accent"
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-[var(--text-muted)] font-mono">
                      Sports Nutrition AI
                    </span>
                    <button
                      type="button"
                      disabled={aiMealLoading || !aiMealQuery.trim()}
                      onClick={handleParseAiMeal}
                      className="px-3.5 py-1.5 bg-accent text-accent-ink text-xs font-bold rounded-xl flex items-center gap-1.5 disabled:opacity-40 shadow-sm"
                    >
                      {aiMealLoading ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                          <span>Analyzing Macros...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span>Extract Macros</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {aiMealError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-xs text-rose-400">
                    {aiMealError}
                  </div>
                )}

                {aiParsedItems.length > 0 && (
                  <div className="space-y-2 flex-1 overflow-y-auto">
                    <div className="flex items-center justify-between text-[11px] font-mono text-[var(--text-muted)] font-bold">
                      <span>Parsed Items ({aiParsedItems.length})</span>
                      <span className="text-volt-adaptive">
                        Total: {aiParsedItems.reduce((acc, i) => acc + (Number(i.calories) || 0), 0)} kcal · {aiParsedItems.reduce((acc, i) => acc + (Number(i.protein) || 0), 0).toFixed(0)}g P
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {aiParsedItems.map((item, idx) => (
                        <div
                          key={idx}
                          className="p-3 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-2xl flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-bold text-[var(--text-primary)]">{item.name}</span>
                            <div className="text-[11px] font-mono text-[var(--text-muted)]">
                              {item.quantity} {item.servingUnit} ·{' '}
                              <span className="text-volt-adaptive font-semibold">{item.protein}g P</span> ·{' '}
                              <span className="text-sky-500 font-semibold">{item.carbs}g C</span> ·{' '}
                              <span className="text-amber-500 font-semibold">{item.fat}g F</span>
                            </div>
                          </div>
                          <span className="font-mono font-bold text-[var(--text-primary)]">
                            {item.calories} kcal
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 mt-auto border-t border-[var(--border-card)]">
                  <button
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 bg-[var(--bg-subtle)] border border-[var(--border-card)] text-[var(--text-secondary)] rounded-xl text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={aiParsedItems.length === 0}
                    onClick={handleLogAiMealItems}
                    className="touch-press px-5 py-2 bg-accent hover:bg-accent disabled:opacity-40 text-accent-ink font-bold rounded-xl text-xs shadow-md flex items-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                    <span>Log All {aiParsedItems.length} Items</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: MANUAL FOOD CREATOR */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="reshape-card p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="font-bold text-[var(--text-primary)] text-base">Custom Food / Label Values</h3>
            <p className="text-xs text-[var(--text-secondary)]">
              Input nutrition values directly from a food package label or restaurant guide.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[var(--text-secondary)] mb-1">Food / Dish Name</label>
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="e.g. Protein Bar, Homemade Curry"
                  className="w-full px-3 py-2 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl text-[var(--text-primary)] focus:outline-none focus:border-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">Serving Unit</label>
                  <input
                    type="text"
                    value={manualServingUnit}
                    onChange={(e) => setManualServingUnit(e.target.value)}
                    placeholder="e.g. 1 bar, 200g, 1 bowl"
                    className="w-full px-3 py-2 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl text-[var(--text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[var(--text-secondary)] mb-1">Calories (kcal)</label>
                  <input
                    type="number"
                    value={manualCalories || ''}
                    onChange={(e) => setManualCalories(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl text-[var(--text-primary)] font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-volt-adaptive mb-1 font-semibold">Protein (g)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={manualProtein || ''}
                    onChange={(e) => setManualProtein(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-2 py-1.5 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl text-[var(--text-primary)] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sky-500 mb-1 font-semibold">Carbs (g)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={manualCarbs || ''}
                    onChange={(e) => setManualCarbs(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-2 py-1.5 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl text-[var(--text-primary)] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-amber-500 mb-1 font-semibold">Fat (g)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={manualFat || ''}
                    onChange={(e) => setManualFat(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-2 py-1.5 bg-[var(--bg-subtle)] border border-[var(--border-card)] rounded-xl text-[var(--text-primary)] font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="px-4 py-2 bg-[var(--bg-subtle)] border border-[var(--border-card)] text-[var(--text-secondary)] rounded-xl text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleAddManualFood}
                className="px-5 py-2 bg-accent hover:bg-accent text-accent-ink font-bold rounded-xl text-xs"
              >
                Save &amp; Log Entry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NUTRITION BARCODE SCANNER MODAL */}
      {isBarcodeScannerOpen && (
        <BarcodeScanner
          isOpen={isBarcodeScannerOpen}
          onClose={() => setIsBarcodeScannerOpen(false)}
          defaultMealCategory={activeMealCategory}
          onAddFoodEntry={handleAddScannedFoodEntry}
          onOpenManualCustomFood={handleOpenCustomWithBarcode}
        />
      )}
    </div>
  );
};
