import { FoodItem } from '../types';

export const COMMON_FOOD_DATABASE: FoodItem[] = [
  // Proteins
  { id: 'f-1', name: 'Chicken Breast (Cooked, Skinless)', servingSize: 100, servingUnit: 'g', calories: 165, protein: 31.0, carbs: 0, fat: 3.6, fiber: 0, isVerified: true },
  { id: 'f-2', name: 'Chicken Breast (Raw, Skinless)', servingSize: 100, servingUnit: 'g', calories: 120, protein: 22.5, carbs: 0, fat: 2.6, fiber: 0, isVerified: true },
  { id: 'f-3', name: 'Whole Large Egg', servingSize: 1, servingUnit: 'egg (50g)', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, fiber: 0, isVerified: true },
  { id: 'f-4', name: 'Egg Whites (Liquid)', servingSize: 100, servingUnit: 'ml / g', calories: 52, protein: 11.0, carbs: 0.7, fat: 0.2, fiber: 0, isVerified: true },
  { id: 'f-5', name: 'Whey Protein Isolate Powder', brand: 'Standard', servingSize: 30, servingUnit: 'scoop (30g)', calories: 115, protein: 25.0, carbs: 1.5, fat: 0.8, fiber: 0, isVerified: true },
  { id: 'f-6', name: 'Whey Protein Concentrate Powder', brand: 'Standard', servingSize: 30, servingUnit: 'scoop (30g)', calories: 125, protein: 24.0, carbs: 2.5, fat: 1.8, fiber: 0, isVerified: true },
  { id: 'f-7', name: 'Greek Yogurt 0% Fat (Plain)', servingSize: 150, servingUnit: 'g', calories: 88, protein: 15.0, carbs: 5.5, fat: 0.2, fiber: 0, isVerified: true },
  { id: 'f-8', name: 'Greek Yogurt 2% Fat (Plain)', servingSize: 150, servingUnit: 'g', calories: 110, protein: 14.0, carbs: 6.0, fat: 3.0, fiber: 0, isVerified: true },
  { id: 'f-9', name: 'Cottage Cheese (Low Fat 1%)', servingSize: 150, servingUnit: 'g', calories: 110, protein: 18.0, carbs: 4.5, fat: 1.5, fiber: 0, isVerified: true },
  { id: 'f-10', name: 'Lean Ground Beef (93/7 Cooked)', servingSize: 100, servingUnit: 'g', calories: 206, protein: 26.0, carbs: 0, fat: 10.5, fiber: 0, isVerified: true },
  { id: 'f-11', name: 'Extra Lean Ground Beef (96/4 Cooked)', servingSize: 100, servingUnit: 'g', calories: 160, protein: 27.5, carbs: 0, fat: 5.0, fiber: 0, isVerified: true },
  { id: 'f-12', name: 'Atlantic Salmon Fillet (Cooked)', servingSize: 100, servingUnit: 'g', calories: 208, protein: 22.0, carbs: 0, fat: 13.0, fiber: 0, isVerified: true },
  { id: 'f-13', name: 'Canned Tuna in Water (Drained)', servingSize: 100, servingUnit: 'g', calories: 116, protein: 25.5, carbs: 0, fat: 1.0, fiber: 0, isVerified: true },
  { id: 'f-14', name: 'Turkey Breast (Cooked, Sliced)', servingSize: 100, servingUnit: 'g', calories: 135, protein: 30.0, carbs: 0, fat: 1.5, fiber: 0, isVerified: true },
  { id: 'f-15', name: 'Tofu (Firm)', servingSize: 100, servingUnit: 'g', calories: 144, protein: 17.0, carbs: 2.8, fat: 8.7, fiber: 2.3, isVerified: true },

  // Carbohydrates
  { id: 'f-16', name: 'White Jasmine Rice (Cooked)', servingSize: 150, servingUnit: 'g', calories: 195, protein: 4.0, carbs: 43.0, fat: 0.4, fiber: 0.6, isVerified: true },
  { id: 'f-17', name: 'White Rice (Raw / Dry)', servingSize: 100, servingUnit: 'g', calories: 360, protein: 7.0, carbs: 79.0, fat: 0.6, fiber: 1.3, isVerified: true },
  { id: 'f-18', name: 'Brown Rice (Cooked)', servingSize: 150, servingUnit: 'g', calories: 165, protein: 3.5, carbs: 35.0, fat: 1.2, fiber: 2.6, isVerified: true },
  { id: 'f-19', name: 'Rolled Oats (Dry)', servingSize: 50, servingUnit: 'g', calories: 190, protein: 6.5, carbs: 34.0, fat: 3.2, fiber: 5.0, isVerified: true },
  { id: 'f-20', name: 'Sweet Potato (Baked, Flesh)', servingSize: 150, servingUnit: 'g', calories: 135, protein: 3.0, carbs: 31.0, fat: 0.2, fiber: 4.5, isVerified: true },
  { id: 'f-21', name: 'White Potato (Boiled / Baked)', servingSize: 150, servingUnit: 'g', calories: 130, protein: 3.0, carbs: 30.0, fat: 0.2, fiber: 2.8, isVerified: true },
  { id: 'f-22', name: 'Whole Wheat Bread', servingSize: 1, servingUnit: 'slice (40g)', calories: 95, protein: 4.0, carbs: 17.0, fat: 1.1, fiber: 2.5, isVerified: true },
  { id: 'f-23', name: 'White Bread / Sourdough', servingSize: 1, servingUnit: 'slice (40g)', calories: 100, protein: 3.5, carbs: 20.0, fat: 0.8, fiber: 1.0, isVerified: true },
  { id: 'f-24', name: 'Pasta (Cooked)', servingSize: 150, servingUnit: 'g', calories: 235, protein: 8.5, carbs: 46.0, fat: 1.5, fiber: 2.5, isVerified: true },
  { id: 'f-25', name: 'Cream of Rice (Dry Cereal)', servingSize: 45, servingUnit: 'g', calories: 160, protein: 3.0, carbs: 36.0, fat: 0.5, fiber: 1.0, isVerified: true },
  { id: 'f-26', name: 'Rice Cakes (Plain)', servingSize: 2, servingUnit: 'cakes (18g)', calories: 70, protein: 1.5, carbs: 15.0, fat: 0.5, fiber: 0.7, isVerified: true },
  { id: 'f-27', name: 'Banana (Medium Fresh)', servingSize: 1, servingUnit: 'medium (118g)', calories: 105, protein: 1.3, carbs: 27.0, fat: 0.3, fiber: 3.1, isVerified: true },
  { id: 'f-28', name: 'Blueberries (Fresh)', servingSize: 100, servingUnit: 'g', calories: 57, protein: 0.7, carbs: 14.5, fat: 0.3, fiber: 2.4, isVerified: true },
  { id: 'f-29', name: 'Apple (Medium Fresh)', servingSize: 1, servingUnit: 'medium (180g)', calories: 95, protein: 0.5, carbs: 25.0, fat: 0.3, fiber: 4.4, isVerified: true },
  { id: 'f-30', name: 'Pure Honey', servingSize: 20, servingUnit: 'tbsp (21g)', calories: 64, protein: 0.1, carbs: 17.3, fat: 0, fiber: 0, isVerified: true },

  // Fats & Oils
  { id: 'f-31', name: 'Extra Virgin Olive Oil', servingSize: 14, servingUnit: 'tbsp (14ml)', calories: 119, protein: 0, carbs: 0, fat: 13.5, fiber: 0, isVerified: true },
  { id: 'f-32', name: 'Natural Peanut Butter', servingSize: 32, servingUnit: '2 tbsp (32g)', calories: 190, protein: 8.0, carbs: 7.0, fat: 16.0, fiber: 2.5, isVerified: true },
  { id: 'f-33', name: 'Raw Almonds', servingSize: 28, servingUnit: 'handful (28g)', calories: 164, protein: 6.0, carbs: 6.0, fat: 14.0, fiber: 3.5, isVerified: true },
  { id: 'f-34', name: 'Avocado (Fresh Hass)', servingSize: 50, servingUnit: 'half small (50g)', calories: 80, protein: 1.0, carbs: 4.2, fat: 7.3, fiber: 3.4, isVerified: true },
  { id: 'f-35', name: 'Unsalted Butter', servingSize: 14, servingUnit: 'tbsp (14g)', calories: 102, protein: 0.1, carbs: 0, fat: 11.5, fiber: 0, isVerified: true },

  // Vegetables & Micros
  { id: 'f-36', name: 'Broccoli (Steamed)', servingSize: 100, servingUnit: 'g', calories: 35, protein: 2.4, carbs: 7.2, fat: 0.4, fiber: 3.3, isVerified: true },
  { id: 'f-37', name: 'Spinach (Raw Baby Leaves)', servingSize: 50, servingUnit: 'g', calories: 12, protein: 1.4, carbs: 1.8, fat: 0.2, fiber: 1.1, isVerified: true },
  { id: 'f-38', name: 'Green Asparagus', servingSize: 100, servingUnit: 'g', calories: 20, protein: 2.2, carbs: 3.9, fat: 0.2, fiber: 2.1, isVerified: true },
  { id: 'f-39', name: 'Bell Pepper (Mixed Raw)', servingSize: 100, servingUnit: 'g', calories: 26, protein: 1.0, carbs: 6.0, fat: 0.3, fiber: 2.1, isVerified: true },

  // Milks & Liquids
  { id: 'f-40', name: 'Unsweetened Almond Milk', servingSize: 240, servingUnit: 'cup (240ml)', calories: 30, protein: 1.0, carbs: 1.0, fat: 2.5, fiber: 0.5, isVerified: true },
  { id: 'f-41', name: 'Skim Milk 0% Fat', servingSize: 240, servingUnit: 'cup (240ml)', calories: 83, protein: 8.3, carbs: 12.2, fat: 0.2, fiber: 0, isVerified: true },
  { id: 'f-42', name: 'Fairlife Ultra-Filtered Skim Milk', brand: 'Fairlife', servingSize: 240, servingUnit: 'cup (240ml)', calories: 80, protein: 13.0, carbs: 6.0, fat: 0, fiber: 0, isVerified: true }
];
