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
  RotateCcw
} from 'lucide-react';
import {
  DailyNutritionLog,
  FoodEntry,
  FoodItem,
  MealCategory,
  UserProfile
} from '../../types';
import { db } from '../../storage/db';

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

  // Date changers
  const changeDate = (daysDelta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + daysDelta);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  // Nutrition Totals
  const totalCalories = Math.round(
    currentLog.entries.reduce((sum, e) => sum + (Number(e.calories) || 0), 0)
  );
  const totalProtein = Math.round(
    currentLog.entries.reduce((sum, e) => sum + (Number(e.protein) || 0), 0)
  );
  const totalCarbs = Math.round(
    currentLog.entries.reduce((sum, e) => sum + (Number(e.carbs) || 0), 0)
  );
  const totalFat = Math.round(
    currentLog.entries.reduce((sum, e) => sum + (Number(e.fat) || 0), 0)
  );
  const totalFiber = Math.round(
    currentLog.entries.reduce((sum, e) => sum + (Number(e.fiber) || 0), 0)
  );

  const calTarget = currentLog.targetCalories || profile.dailyCalorieTarget || 2600;
  const proTarget = currentLog.targetProtein || profile.dailyProteinTarget || 165;
  const carbTarget = currentLog.targetCarbs || profile.dailyCarbsTarget || 300;
  const fatTarget = currentLog.targetFat || profile.dailyFatTarget || 65;

  const calRemaining = calTarget - totalCalories;
  const proRemaining = proTarget - totalProtein;

  // Food search filtering
  const filteredFoods = foodDatabase.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Add food entry from database
  const handleAddFromDatabase = () => {
    if (!selectedFoodItem) return;

    const mult = Number(portionMultiplier) || 1;
    const newEntry: FoodEntry = {
      id: `entry-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      foodId: selectedFoodItem.id,
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

  // AI Meal Parser
  const handleParseAiMeal = async () => {
    if (!aiMealQuery.trim()) return;
    setAiMealLoading(true);
    setAiMealError(null);
    setAiParsedItems([]);

    try {
      const res = await fetch('/api/ai-food-parser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: aiMealQuery,
          mealCategory: activeMealCategory
        })
      });
      const data = await res.json();
      if (data.success && data.items) {
        setAiParsedItems(data.items);
      } else {
        setAiMealError(data.error || 'Failed to parse meal items.');
      }
    } catch (err: any) {
      setAiMealError(err?.message || 'Network error analyzing meal.');
    } finally {
      setAiMealLoading(false);
    }
  };

  const handleLogAiMealItems = () => {
    if (aiParsedItems.length === 0) return;
    const newEntries: FoodEntry[] = aiParsedItems.map((item, idx) => ({
      id: `ai-food-${Date.now()}-${idx}`,
      name: item.name,
      mealCategory: activeMealCategory,
      quantity: Number(item.quantity) || 1,
      servingUnit: item.servingUnit || 'portion',
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

  // Add manual food / custom meal
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

    // Save also to custom foods database for quick future reuse
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

  // Remove food entry
  const handleRemoveEntry = (entryId: string) => {
    const updated = {
      ...currentLog,
      entries: currentLog.entries.filter((e) => e.id !== entryId)
    };
    saveLog(updated);
  };

  // Duplicate yesterday's meals
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

  // Water tracking
  const updateWater = (deltaMl: number) => {
    const newWater = Math.max(0, (currentLog.waterMl || 0) + deltaMl);
    const updated = { ...currentLog, waterMl: newWater };
    saveLog(updated);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Top Nutrition Command Header */}
      <div className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-5 lg:p-7 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
          <div>
            <div className="flex items-center gap-2 text-lime-400 text-xs font-mono font-semibold uppercase tracking-wider mb-1">
              <Apple className="w-4 h-4" />
              <span>Nutrition &amp; Macro Command</span>
            </div>
            <h1 className="text-xl lg:text-2xl font-bold text-zinc-100">
              Daily Macro Diary
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Fuel your progressive overload and body recomposition goals.
            </p>
          </div>

          {/* Date Selector Navigation */}
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl p-1.5 self-start sm:self-auto font-mono text-xs">
            <button
              onClick={() => changeDate(-1)}
              className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
              title="Previous Day"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-2 font-bold text-zinc-200 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-lime-400" />
              <span>{selectedDate}</span>
            </div>
            <button
              onClick={() => changeDate(1)}
              className="p-1.5 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200"
              title="Next Day"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Macro Overview Bars & Target Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
          {/* Calories */}
          <div className="p-3.5 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1.5">
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Calories</span>
            <div className="text-lg font-mono font-extrabold text-zinc-100">
              {totalCalories}{' '}
              <span className="text-xs font-normal text-zinc-500">/ {calTarget}</span>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  totalCalories > calTarget ? 'bg-amber-400' : 'bg-lime-400'
                }`}
                style={{ width: `${Math.min(100, (totalCalories / calTarget) * 100)}%` }}
              />
            </div>
            <div className="text-[10px] font-mono text-zinc-400">
              {calRemaining >= 0 ? `${calRemaining} kcal left` : `${Math.abs(calRemaining)} kcal over`}
            </div>
          </div>

          {/* Protein */}
          <div className="p-3.5 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1.5">
            <span className="text-[10px] font-mono text-lime-400/90 uppercase tracking-wider font-semibold">
              Protein
            </span>
            <div className="text-lg font-mono font-extrabold text-lime-400">
              {totalProtein}g{' '}
              <span className="text-xs font-normal text-zinc-500">/ {proTarget}g</span>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-lime-400 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, (totalProtein / proTarget) * 100)}%` }}
              />
            </div>
            <div className="text-[10px] font-mono text-zinc-400">
              {proRemaining <= 0 ? 'Target achieved!' : `${proRemaining}g left`}
            </div>
          </div>

          {/* Carbohydrates */}
          <div className="p-3.5 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1.5">
            <span className="text-[10px] font-mono text-sky-400/90 uppercase tracking-wider font-semibold">
              Carbohydrates
            </span>
            <div className="text-lg font-mono font-extrabold text-sky-400">
              {totalCarbs}g{' '}
              <span className="text-xs font-normal text-zinc-500">/ {carbTarget}g</span>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-sky-400 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, (totalCarbs / carbTarget) * 100)}%` }}
              />
            </div>
            <div className="text-[10px] font-mono text-zinc-400">
              {Math.max(0, carbTarget - totalCarbs)}g remaining
            </div>
          </div>

          {/* Fats */}
          <div className="p-3.5 bg-zinc-900/70 border border-zinc-800/80 rounded-xl space-y-1.5">
            <span className="text-[10px] font-mono text-amber-400/90 uppercase tracking-wider font-semibold">
              Healthy Fats
            </span>
            <div className="text-lg font-mono font-extrabold text-amber-400">
              {totalFat}g{' '}
              <span className="text-xs font-normal text-zinc-500">/ {fatTarget}g</span>
            </div>
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-amber-400 h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.min(100, (totalFat / fatTarget) * 100)}%` }}
              />
            </div>
            <div className="text-[10px] font-mono text-zinc-400">
              {Math.max(0, fatTarget - totalFat)}g remaining
            </div>
          </div>
        </div>

        {/* Quick Duplicate Button */}
        <div className="mt-5 pt-4 border-t border-zinc-800/60 flex items-center justify-between text-xs">
          <button
            onClick={handleDuplicateYesterday}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition-colors"
            title="Duplicate all meals from previous day"
          >
            <Copy className="w-3.5 h-3.5 text-lime-400" />
            <span>Duplicate Yesterday&apos;s Diary</span>
          </button>

          {/* Optional Hydration Tracking Widget */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Droplets className="w-4 h-4 text-sky-400" />
              <span className="font-mono font-bold text-zinc-200">
                {(currentLog.waterMl || 0).toLocaleString()} ml
              </span>
            </div>
            <div className="flex items-center gap-1 font-mono text-[11px]">
              <button
                onClick={() => updateWater(250)}
                className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sky-400"
              >
                +250ml
              </button>
              <button
                onClick={() => updateWater(500)}
                className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-sky-400"
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
              className="bg-[#0d1117] border border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-lg space-y-3"
            >
              <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-zinc-100 text-sm sm:text-base">{cat.label}</h3>
                  {categoryEntries.length > 0 && (
                    <span className="text-xs font-mono text-zinc-500">
                      ({catCalories} kcal &middot; {catProtein}g pro)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setActiveMealCategory(cat.id);
                      setIsManualModalOpen(true);
                    }}
                    className="p-1.5 text-zinc-500 hover:text-zinc-300 text-xs rounded transition-colors"
                    title="Quick manual entry"
                  >
                    Custom
                  </button>
                  <button
                    onClick={() => {
                      setActiveMealCategory(cat.id);
                      setIsAddModalOpen(true);
                    }}
                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-lime-400 text-xs font-semibold rounded-lg flex items-center gap-1 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Food</span>
                  </button>
                </div>
              </div>

              {categoryEntries.length === 0 ? (
                <div className="py-3 text-center text-zinc-600 text-xs">
                  No foods logged in {cat.label} yet
                </div>
              ) : (
                <div className="space-y-2">
                  {categoryEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-3 bg-zinc-900/50 hover:bg-zinc-900 border border-zinc-800/80 rounded-xl flex items-center justify-between text-xs transition-colors"
                    >
                      <div>
                        <div className="font-bold text-zinc-200">{entry.name}</div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                          <span>{entry.quantity} &times; {entry.servingUnit}</span>
                          <span className="mx-1.5">&middot;</span>
                          <span className="text-lime-400">{entry.protein}g P</span>
                          <span className="mx-1">&middot;</span>
                          <span className="text-sky-400">{entry.carbs}g C</span>
                          <span className="mx-1">&middot;</span>
                          <span className="text-amber-400">{entry.fat}g F</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-zinc-200 text-sm">
                          {entry.calories} kcal
                        </span>
                        <button
                          onClick={() => handleRemoveEntry(entry.id)}
                          className="p-1 text-zinc-600 hover:text-rose-400 transition-colors"
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
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12161c] border border-zinc-800 rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-zinc-100 text-base">
                  Add Food to {MEAL_CATEGORIES.find((c) => c.id === activeMealCategory)?.label}
                </h3>
                <p className="text-xs text-zinc-400">Search verified fitness staples or use AI natural language parsing.</p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                Close
              </button>
            </div>

            {/* Mode Toggle Tabs */}
            <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-semibold">
              <button
                onClick={() => setAddMode('database')}
                className={`py-1.5 rounded-lg transition-colors ${
                  addMode === 'database'
                    ? 'bg-zinc-800 text-lime-400 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                Verified Food Database
              </button>
              <button
                onClick={() => setAddMode('ai_parser')}
                className={`py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                  addMode === 'ai_parser'
                    ? 'bg-zinc-800 text-lime-400 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5 text-lime-400" />
                <span>AI Meal Parser</span>
              </button>
            </div>

            {addMode === 'database' ? (
              <>
                {/* Search Input */}
                <div className="relative">
                  <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search chicken breast, rice, oats, whey, eggs..."
                    className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100 text-xs focus:outline-none focus:border-lime-400"
                  />
                </div>

                {/* Food items list */}
                <div className="overflow-y-auto divide-y divide-zinc-800/80 pr-1 flex-1 min-h-[200px]">
                  {filteredFoods.slice(0, 25).map((food) => {
                    const isSelected = selectedFoodItem?.id === food.id;
                    return (
                      <div
                        key={food.id}
                        onClick={() => setSelectedFoodItem(food)}
                        className={`p-3 cursor-pointer rounded-xl transition-colors ${
                          isSelected
                            ? 'bg-zinc-800 border border-lime-400/60'
                            : 'hover:bg-zinc-850/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-zinc-200 text-xs">{food.name}</span>
                          <span className="font-mono text-xs font-bold text-zinc-100">
                            {food.calories} kcal
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                          Per {food.servingSize} {food.servingUnit} &middot;{' '}
                          <span className="text-lime-400">{food.protein}g P</span> &middot;{' '}
                          <span className="text-sky-400">{food.carbs}g C</span> &middot;{' '}
                          <span className="text-amber-400">{food.fat}g F</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Portion selector when food is chosen */}
                {selectedFoodItem && (
                  <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-3 text-xs bg-zinc-900/60 p-3 rounded-xl">
                    <div>
                      <label className="block text-zinc-400 text-[11px] mb-1">
                        Portion Servings ({selectedFoodItem.servingUnit})
                      </label>
                      <input
                        type="number"
                        step="0.25"
                        min="0.1"
                        value={portionMultiplier}
                        onChange={(e) => setPortionMultiplier(parseFloat(e.target.value) || 1)}
                        className="w-20 px-2 py-1 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-bold font-mono"
                      />
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-sm font-bold text-lime-400">
                        {Math.round(selectedFoodItem.calories * portionMultiplier)} kcal
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {(selectedFoodItem.protein * portionMultiplier).toFixed(1)}g Protein
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!selectedFoodItem}
                    onClick={handleAddFromDatabase}
                    className="touch-press px-4 py-2 bg-lime-400 disabled:opacity-40 text-black font-bold rounded-lg text-xs"
                  >
                    Log Food Entry
                  </button>
                </div>
              </>
            ) : (
              /* AI SMART MEAL PARSER MODE */
              <div className="space-y-4 flex-1 flex flex-col min-h-[220px]">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    Describe your meal in natural English
                  </label>
                  <textarea
                    value={aiMealQuery}
                    onChange={(e) => setAiMealQuery(e.target.value)}
                    placeholder="e.g. 200g grilled chicken breast with 1.5 cups jasmine rice, half an avocado and 1 cup steamed broccoli"
                    rows={3}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100 text-xs focus:outline-none focus:border-lime-400"
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11px] text-zinc-500">
                      Powered by Gemini Sports Nutrition AI
                    </span>
                    <button
                      type="button"
                      disabled={aiMealLoading || !aiMealQuery.trim()}
                      onClick={handleParseAiMeal}
                      className="px-3.5 py-1.5 bg-lime-400/20 hover:bg-lime-400/30 text-lime-300 border border-lime-400/40 text-xs font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-40"
                    >
                      {aiMealLoading ? (
                        <>
                          <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                          <span>Analyzing Macros...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Extract Macros</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {aiMealError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                    {aiMealError}
                  </div>
                )}

                {/* Parsed items result */}
                {aiParsedItems.length > 0 && (
                  <div className="space-y-2 flex-1 overflow-y-auto">
                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 uppercase font-bold">
                      <span>Parsed Items ({aiParsedItems.length})</span>
                      <span className="text-lime-400">
                        Total: {aiParsedItems.reduce((acc, i) => acc + (Number(i.calories) || 0), 0)} kcal &middot; {aiParsedItems.reduce((acc, i) => acc + (Number(i.protein) || 0), 0).toFixed(0)}g P
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {aiParsedItems.map((item, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-bold text-zinc-200">{item.name}</span>
                            <div className="text-[11px] font-mono text-zinc-400">
                              {item.quantity} {item.servingUnit} &middot;{' '}
                              <span className="text-lime-400">{item.protein}g P</span> &middot;{' '}
                              <span className="text-sky-400">{item.carbs}g C</span> &middot;{' '}
                              <span className="text-amber-400">{item.fat}g F</span>
                            </div>
                          </div>
                          <span className="font-mono font-bold text-zinc-100">
                            {item.calories} kcal
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 mt-auto border-t border-zinc-800">
                  <button
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={aiParsedItems.length === 0}
                    onClick={handleLogAiMealItems}
                    className="touch-press px-4 py-2 bg-lime-400 hover:bg-lime-300 disabled:opacity-40 text-black font-bold rounded-lg text-xs shadow-md flex items-center gap-1.5"
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

      {/* MODAL 2: MANUAL FOOD / PACKAGED LABEL VALUE CREATOR */}
      {isManualModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#12161c] border border-zinc-800 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="font-bold text-zinc-100 text-base">Custom Food / Label Values</h3>
            <p className="text-xs text-zinc-400">
              Input nutrition values directly from a food package label or restaurant guide.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-zinc-400 mb-1">Food / Dish Name</label>
                <input
                  type="text"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="e.g. Protein Bar, Homemade Curry"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-lime-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 mb-1">Serving Unit</label>
                  <input
                    type="text"
                    value={manualServingUnit}
                    onChange={(e) => setManualServingUnit(e.target.value)}
                    placeholder="e.g. 1 bar, 200g, 1 bowl"
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">Calories (kcal)</label>
                  <input
                    type="number"
                    value={manualCalories || ''}
                    onChange={(e) => setManualCalories(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-lime-400 mb-1">Protein (g)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={manualProtein || ''}
                    onChange={(e) => setManualProtein(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-sky-400 mb-1">Carbs (g)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={manualCarbs || ''}
                    onChange={(e) => setManualCarbs(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-amber-400 mb-1">Fat (g)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={manualFat || ''}
                    onChange={(e) => setManualFat(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="w-full px-2 py-1.5 bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsManualModalOpen(false)}
                className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleAddManualFood}
                className="px-4 py-2 bg-lime-400 text-black font-bold rounded-lg text-xs"
              >
                Save &amp; Log Entry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
