import React, { useState, useEffect } from 'react';
import {
  Plus,
  Trash2,
  Copy,
  ChevronLeft,
  ChevronRight,
  Check,
  Sparkles,
  RotateCcw,
  Camera,
  Sliders,
  Utensils
} from 'lucide-react';
import {
  DailyNutritionLog,
  FoodEntry,
  FoodItem,
  MealCategory,
  UserProfile
} from '../../types';
import { db } from '../../storage/db';
import { getCurrentDayKey } from '../../storage/nutritionTargetCommit';
import { resolveDiaryTargets, targetSourceCaption } from '../../utils/nutritionTargets';
import { BarcodeScanner } from './BarcodeScanner';
import { NutritionGoalWizard } from './NutritionGoalWizard';
import { NutritionGoalGauge } from './NutritionGoalGauge';
import { WaterIntakeLogger } from './WaterIntakeLogger';
import { MACRO_META } from './MacroBar';
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  PageHeader,
  SectionHeading,
  SegmentedControl,
  Textarea
} from '../ui';

interface NutritionViewProps {
  profile: UserProfile;
  onProfileUpdated?: (p: UserProfile) => void;
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

export const NutritionView: React.FC<NutritionViewProps> = ({ profile, onProfileUpdated }) => {
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

  // Macro Target Wizard modal state
  const [isWizardOpen, setIsWizardOpen] = useState<boolean>(false);

  // UI-only state: which entry is awaiting remove confirmation, and feedback for "copy yesterday"
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

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
    setPendingRemoveId(null);
    setCopyNotice(null);
    const curr = new Date(selectedDate);
    curr.setDate(curr.getDate() + daysDelta);
    setSelectedDate(curr.toISOString().split('T')[0]);
  };

  const totalCalories = currentLog.entries.reduce((acc, curr) => acc + (curr.calories || 0), 0);
  const totalProtein = Math.round(currentLog.entries.reduce((acc, curr) => acc + (curr.protein || 0), 0));
  const totalCarbs = Math.round(currentLog.entries.reduce((acc, curr) => acc + (curr.carbs || 0), 0));
  const totalFat = Math.round(currentLog.entries.reduce((acc, curr) => acc + (curr.fat || 0), 0));

  // Targets for the day being viewed. Today keeps using the live profile targets. A past day uses the
  // targets saved with its STORED log; getNutritionLogForDate fabricates an unsaved log (stamped with the
  // current profile targets) for days that have none, so only a stored log counts as a snapshot.
  const todayKey = getCurrentDayKey();
  const logIsStored =
    selectedDate < todayKey && db.getNutritionLogs().some((l) => l.date === selectedDate);
  const resolvedTargets = resolveDiaryTargets({
    date: selectedDate,
    today: todayKey,
    profile,
    log: currentLog,
    logIsStored
  });
  const calTarget = resolvedTargets.calories;
  const proTarget = resolvedTargets.protein;
  const carbTarget = resolvedTargets.carbs;
  const fatTarget = resolvedTargets.fat;
  const targetCaption = targetSourceCaption(resolvedTargets.source);

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
      setCopyNotice(`Nothing was logged on ${yesterdayStr}, so there is nothing to copy.`);
      return;
    }
    setCopyNotice(null);

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

  const yesterdayKey = (() => {
    const d = new Date(todayKey);
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  })();
  const dateLabel =
    selectedDate === todayKey
      ? 'Today'
      : selectedDate === yesterdayKey
      ? 'Yesterday'
      : new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        });

  const aiTotals = {
    calories: aiParsedItems.reduce((acc, i) => acc + (Number(i.calories) || 0), 0),
    protein: aiParsedItems.reduce((acc, i) => acc + (Number(i.protein) || 0), 0)
  };
  const activeMealLabel = MEAL_CATEGORIES.find((c) => c.id === activeMealCategory)?.label;
  const portion = portionMultiplier > 0 ? portionMultiplier : 1;

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Nutrition"
        title="Daily diary"
        description="Calories, macros, meals and hydration for the day you are viewing."
        className="mb-0!"
        actions={
          <>
            <Button
              onClick={() => {
                setActiveMealCategory('lunch');
                setIsBarcodeScannerOpen(true);
              }}
              title="Scan packaged food barcode with camera"
              icon={<Camera className="w-4 h-4" aria-hidden />}
            >
              Scan Barcode
            </Button>
            <Button
              variant="secondary"
              onClick={() => setIsWizardOpen(true)}
              title="Calibrate nutrition targets with Goal & TDEE Wizard"
              icon={<Sliders className="w-4 h-4" aria-hidden />}
            >
              Goal Wizard
            </Button>
          </>
        }
      />

      {/* Date navigation + diary tools */}
      <Card pad="sm" as="section" aria-label="Diary date">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              iconOnly
              onClick={() => changeDate(-1)}
              title="Previous Day"
              aria-label="Previous day"
            >
              <ChevronLeft className="w-5 h-5" aria-hidden />
            </Button>
            <div className="min-w-[7.5rem] text-center" aria-live="polite">
              <div className="text-sm font-semibold text-white">{dateLabel}</div>
              <div className="text-label font-mono text-zinc-500 tabular-nums">{selectedDate}</div>
            </div>
            <Button
              variant="secondary"
              iconOnly
              onClick={() => changeDate(1)}
              title="Next Day"
              aria-label="Next day"
            >
              <ChevronRight className="w-5 h-5" aria-hidden />
            </Button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {selectedDate !== todayKey && (
              <Button
                variant="ghost"
                onClick={() => {
                  setPendingRemoveId(null);
                  setCopyNotice(null);
                  setSelectedDate(todayKey);
                }}
              >
                Jump to today
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleDuplicateYesterday}
              title="Duplicate all meals from previous day"
              icon={<Copy className="w-4 h-4" aria-hidden />}
            >
              Copy previous day
            </Button>
          </div>
        </div>

        {copyNotice && (
          <p role="status" className="mt-3 text-xs text-zinc-400">
            {copyNotice}
          </p>
        )}
        {targetCaption && (
          <p
            data-testid="target-source-caption"
            data-target-source={resolvedTargets.source}
            className="mt-3 text-label leading-relaxed text-zinc-500"
          >
            {targetCaption}
          </p>
        )}
      </Card>

      {/* Calories + macros: the one place these totals are shown */}
      <NutritionGoalGauge
        currentCalories={totalCalories}
        targetCalories={calTarget}
        currentProtein={totalProtein}
        targetProtein={proTarget}
        currentCarbs={totalCarbs}
        targetCarbs={carbTarget}
        currentFat={totalFat}
        targetFat={fatTarget}
        profile={profile}
        onOpenWizard={() => setIsWizardOpen(true)}
      />

      {/* Meals */}
      <section aria-label="Meals">
        <SectionHeading
          title="Meals"
          description={
            currentLog.entries.length === 0
              ? 'Nothing logged for this day yet.'
              : `${currentLog.entries.length} ${currentLog.entries.length === 1 ? 'item' : 'items'} logged`
          }
        />
        <div className="space-y-3 sm:space-y-4">
          {MEAL_CATEGORIES.map((cat) => {
            const categoryEntries = currentLog.entries.filter((e) => e.mealCategory === cat.id);
            const catCalories = Math.round(categoryEntries.reduce((acc, curr) => acc + (curr.calories || 0), 0));
            const catProtein = Math.round(categoryEntries.reduce((acc, curr) => acc + (curr.protein || 0), 0));

            return (
              <Card key={cat.id} as="article" aria-label={cat.label} pad="none">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-white truncate">{cat.label}</h3>
                    <p className="text-label font-mono text-zinc-500 tabular-nums mt-0.5">
                      {categoryEntries.length > 0 ? `${catCalories} kcal · ${catProtein}g protein` : 'Empty'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      iconOnly
                      onClick={() => {
                        setActiveMealCategory(cat.id);
                        setIsBarcodeScannerOpen(true);
                      }}
                      title={`Scan barcode directly into ${cat.label}`}
                      aria-label={`Scan barcode into ${cat.label}`}
                    >
                      <Camera className="w-4 h-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setActiveMealCategory(cat.id);
                        setIsManualModalOpen(true);
                      }}
                      title="Quick manual entry"
                      aria-label={`Add custom food to ${cat.label}`}
                    >
                      Custom
                    </Button>
                    <Button
                      onClick={() => {
                        setActiveMealCategory(cat.id);
                        setIsAddModalOpen(true);
                      }}
                      aria-label={`Add food to ${cat.label}`}
                      icon={<Plus className="w-4 h-4" aria-hidden />}
                    >
                      Add
                    </Button>
                  </div>
                </div>

                {categoryEntries.length === 0 ? (
                  <div className="mx-4 sm:mx-5 mb-4 rounded-control border border-dashed border-line px-4 py-3 text-xs text-zinc-500">
                    No foods logged in {cat.label} yet
                  </div>
                ) : (
                  <ul className="border-t border-line divide-y divide-line">
                    {categoryEntries.map((entry) => (
                      <li key={entry.id} className="px-4 sm:px-5 py-3">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <p className="text-sm font-medium text-white truncate">{entry.name}</p>
                              {entry.isEstimate && <Badge tone="neutral">Est.</Badge>}
                            </div>
                            <p className="text-label font-mono text-zinc-500 mt-0.5">
                              {entry.quantity} &times; {entry.servingUnit}
                            </p>
                            <p className="text-label font-mono mt-1 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums">
                              <span style={{ color: MACRO_META.protein.color }}>{entry.protein}g P</span>
                              <span style={{ color: MACRO_META.carbs.color }}>{entry.carbs}g C</span>
                              <span style={{ color: MACRO_META.fat.color }}>{entry.fat}g F</span>
                            </p>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-sm font-semibold font-mono text-white tabular-nums">
                              {entry.calories} <span className="text-label font-normal text-zinc-500">kcal</span>
                            </span>
                            <Button
                              variant="ghost"
                              iconOnly
                              onClick={() => setPendingRemoveId(entry.id)}
                              title="Remove item"
                              aria-label={`Remove ${entry.name}`}
                            >
                              <Trash2 className="w-4 h-4" aria-hidden />
                            </Button>
                          </div>
                        </div>

                        {pendingRemoveId === entry.id && (
                          <div
                            role="alertdialog"
                            aria-label={`Confirm removing ${entry.name}`}
                            className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-control border border-danger/30 bg-danger/5 px-3 py-2"
                          >
                            <span className="text-xs text-zinc-300">Remove this entry from {cat.label}?</span>
                            <div className="flex items-center gap-2">
                              <Button variant="ghost" size="sm" onClick={() => setPendingRemoveId(null)}>
                                Keep
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => {
                                  handleRemoveEntry(entry.id);
                                  setPendingRemoveId(null);
                                }}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      </section>

      {/* Hydration */}
      <WaterIntakeLogger
        waterMl={currentLog.waterMl || 0}
        onUpdateWater={(newWater) => {
          const updated = { ...currentLog, waterMl: newWater };
          saveLog(updated);
        }}
        profile={profile}
        selectedDate={selectedDate}
        onSelectDate={(date) => setSelectedDate(date)}
      />

      {/* MODAL 1: SEARCH & ADD FROM DATABASE / AI MEAL PARSER */}
      <Modal
        open={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title={`Add food to ${activeMealLabel ?? 'meal'}`}
        description="Search the food list or describe a meal and let the AI parser estimate it."
        size="lg"
        footer={
          addMode === 'database' ? (
            <>
              <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!selectedFoodItem} onClick={handleAddFromDatabase}>
                Log Food Entry
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button
                disabled={aiParsedItems.length === 0}
                onClick={handleLogAiMealItems}
                icon={<Check className="w-4 h-4" aria-hidden />}
              >
                Log All {aiParsedItems.length} Items
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SegmentedControl<'database' | 'ai_parser'>
              ariaLabel="How to add food"
              value={addMode}
              onChange={setAddMode}
              options={[
                { value: 'database', label: 'Food Database' },
                { value: 'ai_parser', label: 'AI Parser' }
              ]}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsAddModalOpen(false);
                setIsBarcodeScannerOpen(true);
              }}
              icon={<Camera className="w-4 h-4" aria-hidden />}
            >
              Scan barcode
            </Button>
          </div>

          {addMode === 'database' ? (
            <>
              <Input
                label="Search foods"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Chicken breast, rice, oats, whey, eggs…"
                autoComplete="off"
              />

              {filteredFoods.length === 0 ? (
                <div className="rounded-control border border-dashed border-line px-4 py-6 text-center space-y-3">
                  <p className="text-sm text-zinc-300">No foods match &ldquo;{searchQuery}&rdquo;.</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setManualName(searchQuery.trim());
                      setIsAddModalOpen(false);
                      setIsManualModalOpen(true);
                    }}
                  >
                    Enter it as a custom food
                  </Button>
                </div>
              ) : (
                <ul className="max-h-[40dvh] overflow-y-auto overscroll-contain space-y-1.5 pr-0.5" aria-label="Food results">
                  {filteredFoods.slice(0, 25).map((food) => {
                    const isSelected = selectedFoodItem?.id === food.id;
                    return (
                      <li key={food.id}>
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedFoodItem(food)}
                          className={`w-full text-left rounded-control border px-3.5 py-3 transition-colors ${
                            isSelected
                              ? 'border-accent bg-accent/10'
                              : 'border-line bg-surface-2 hover:border-line-strong'
                          }`}
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="text-sm font-medium text-white min-w-0">{food.name}</span>
                            <span className="text-sm font-semibold font-mono text-white tabular-nums shrink-0">
                              {food.calories} <span className="text-label font-normal text-zinc-500">kcal</span>
                            </span>
                          </span>
                          <span className="block text-label font-mono text-zinc-500 mt-0.5 tabular-nums">
                            Per {food.servingSize} {food.servingUnit} ·{' '}
                            <span style={{ color: MACRO_META.protein.color }}>{food.protein}g P</span> ·{' '}
                            <span style={{ color: MACRO_META.carbs.color }}>{food.carbs}g C</span> ·{' '}
                            <span style={{ color: MACRO_META.fat.color }}>{food.fat}g F</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              {selectedFoodItem && (
                <div className="rounded-control border border-line bg-surface-2 p-3.5 grid grid-cols-[8rem_1fr] gap-4 items-end">
                  <Input
                    label={`Servings (${selectedFoodItem.servingUnit})`}
                    type="number"
                    inputMode="decimal"
                    mono
                    step="0.25"
                    min="0.1"
                    value={portionMultiplier}
                    onChange={(e) => setPortionMultiplier(parseFloat(e.target.value) || 1)}
                  />
                  <div className="text-right font-mono tabular-nums" aria-live="polite">
                    <div className="text-lg font-semibold text-accent">
                      {Math.round(selectedFoodItem.calories * portion)} kcal
                    </div>
                    <div className="text-label text-zinc-500">
                      {(selectedFoodItem.protein * portion).toFixed(1)}g P · {(selectedFoodItem.carbs * portion).toFixed(1)}g C ·{' '}
                      {(selectedFoodItem.fat * portion).toFixed(1)}g F
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Textarea
                  label="Describe your meal"
                  hint="Include amounts where you can, e.g. 200g grilled chicken breast, 1.5 cups rice, half an avocado."
                  value={aiMealQuery}
                  onChange={(e) => setAiMealQuery(e.target.value)}
                  placeholder="200g grilled chicken breast with 1.5 cups jasmine rice and 1 cup steamed broccoli"
                  rows={3}
                />
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    disabled={!aiMealQuery.trim()}
                    loading={aiMealLoading}
                    onClick={handleParseAiMeal}
                    icon={<Sparkles className="w-4 h-4" aria-hidden />}
                  >
                    {aiMealLoading ? 'Analyzing macros…' : 'Extract Macros'}
                  </Button>
                </div>
              </div>

              {aiMealError && (
                <div role="alert" className="rounded-control border border-danger/30 bg-danger/5 p-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-danger">{aiMealError}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleParseAiMeal}
                    disabled={aiMealLoading || !aiMealQuery.trim()}
                    icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden />}
                  >
                    Try again
                  </Button>
                </div>
              )}

              {aiParsedItems.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 text-label font-mono text-zinc-500">
                    <span>Parsed items ({aiParsedItems.length}) · estimates</span>
                    <span className="text-zinc-300 tabular-nums">
                      Total: {aiTotals.calories} kcal · {aiTotals.protein.toFixed(0)}g P
                    </span>
                  </div>
                  <ul className="space-y-1.5">
                    {aiParsedItems.map((item, idx) => (
                      <li
                        key={idx}
                        className="rounded-control border border-line bg-surface-2 px-3.5 py-3 flex items-start justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white">{item.name}</p>
                          <p className="text-label font-mono text-zinc-500 tabular-nums">
                            {item.quantity} {item.servingUnit} ·{' '}
                            <span style={{ color: MACRO_META.protein.color }}>{item.protein}g P</span> ·{' '}
                            <span style={{ color: MACRO_META.carbs.color }}>{item.carbs}g C</span> ·{' '}
                            <span style={{ color: MACRO_META.fat.color }}>{item.fat}g F</span>
                          </p>
                        </div>
                        <span className="text-sm font-semibold font-mono text-white tabular-nums shrink-0">
                          {item.calories} kcal
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL 2: MANUAL FOOD CREATOR */}
      <Modal
        open={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        title="Custom food"
        description={`Enter the values from a package label or restaurant guide. It is logged to ${activeMealLabel ?? 'the selected meal'} and saved to your food list.`}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsManualModalOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!manualName.trim()} onClick={handleAddManualFood} icon={<Utensils className="w-4 h-4" aria-hidden />}>
              Save &amp; Log Entry
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Food or dish name"
            type="text"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            placeholder="Protein bar, homemade curry"
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Serving"
              hint="e.g. 1 bar, 200g, 1 bowl"
              type="text"
              value={manualServingUnit}
              onChange={(e) => setManualServingUnit(e.target.value)}
            />
            <Input
              label="Calories (kcal)"
              type="number"
              inputMode="decimal"
              mono
              min="0"
              value={manualCalories || ''}
              onChange={(e) => setManualCalories(parseFloat(e.target.value) || 0)}
              placeholder="0"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Protein (g)"
              type="number"
              inputMode="decimal"
              mono
              min="0"
              step="0.5"
              value={manualProtein || ''}
              onChange={(e) => setManualProtein(parseFloat(e.target.value) || 0)}
              placeholder="0"
            />
            <Input
              label="Carbs (g)"
              type="number"
              inputMode="decimal"
              mono
              min="0"
              step="0.5"
              value={manualCarbs || ''}
              onChange={(e) => setManualCarbs(parseFloat(e.target.value) || 0)}
              placeholder="0"
            />
            <Input
              label="Fat (g)"
              type="number"
              inputMode="decimal"
              mono
              min="0"
              step="0.5"
              value={manualFat || ''}
              onChange={(e) => setManualFat(parseFloat(e.target.value) || 0)}
              placeholder="0"
            />
          </div>
        </div>
      </Modal>

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

      {/* NUTRITION GOAL & TDEE WIZARD MODAL */}
      <NutritionGoalWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        profile={profile}
        currentLog={currentLog}
        onTargetsUpdated={(newProfile, newLog) => {
          // Adopt the returned log only if it is the diary day being viewed
          if (newLog && newLog.date === selectedDate) {
            setCurrentLog(newLog);
          }
          if (onProfileUpdated) {
            onProfileUpdated(newProfile);
          }
        }}
      />
    </div>
  );
};
