import { ScannedFoodNutrients, ScannedFoodProduct } from '../types';

/**
 * Parses raw nutrient number safely.
 * Returns `null` if the nutrient is not declared in the database.
 * Returns genuine `0` if explicitly zero.
 */
export function parseNutrientValue(value: any): number | null {
  if (value === undefined || value === null || value === '' || Number.isNaN(Number(value))) {
    return null;
  }
  const num = Number(value);
  if (num === 0) return 0;
  return Number(num.toFixed(1));
}

/**
 * Sanitizes barcode string removing spaces, dashes, and non-alphanumeric chars.
 */
export function sanitizeBarcode(raw: string): string {
  if (!raw) return '';
  return raw.trim().replace(/[^0-9a-zA-Z]/g, '');
}

/**
 * Normalizes upstream Open Food Facts JSON into strict typed ScannedFoodProduct.
 */
export function normalizeOpenFoodFactsProduct(raw: any, barcode: string): ScannedFoodProduct {
  const name =
    raw.product_name ||
    raw.product_name_en ||
    raw.product_name_fr ||
    raw.generic_name ||
    'Unnamed Packaged Product';

  const brand = raw.brands ? raw.brands.split(',')[0].trim() : undefined;
  const imageUrl = raw.image_front_small_url || raw.image_front_url || raw.image_url || undefined;
  const nutriments = raw.nutriments || {};

  // Check if product is liquid (ml)
  const isLiquid =
    (raw.serving_quantity_unit && raw.serving_quantity_unit.toLowerCase() === 'ml') ||
    (raw.serving_size && /ml|cl|liter|litre/i.test(raw.serving_size)) ||
    (raw.categories && /beverage|drink|liquid|milk|juice|water/i.test(raw.categories));

  // Extract per-100g nutrients
  let kcal100g = parseNutrientValue(nutriments['energy-kcal_100g']);
  if (kcal100g === null && nutriments['energy_100g']) {
    // If only kJ is provided, convert kJ to kcal: 1 kJ = 0.239006 kcal
    const kj = Number(nutriments['energy_100g']);
    if (!Number.isNaN(kj) && kj > 0) {
      kcal100g = Math.round(kj * 0.239006);
    }
  }

  const per100g: ScannedFoodNutrients = {
    calories: kcal100g,
    protein: parseNutrientValue(nutriments['proteins_100g']),
    carbs: parseNutrientValue(nutriments['carbohydrates_100g']),
    fat: parseNutrientValue(nutriments['fat_100g']),
    fiber: parseNutrientValue(nutriments['fiber_100g'])
  };

  // Extract per-serving nutrients
  let kcalServing = parseNutrientValue(nutriments['energy-kcal_serving']);
  if (kcalServing === null && nutriments['energy_serving']) {
    const kj = Number(nutriments['energy_serving']);
    if (!Number.isNaN(kj) && kj > 0) {
      kcalServing = Math.round(kj * 0.239006);
    }
  }

  const perServing: ScannedFoodNutrients = {
    calories: kcalServing,
    protein: parseNutrientValue(nutriments['proteins_serving']),
    carbs: parseNutrientValue(nutriments['carbohydrates_serving']),
    fat: parseNutrientValue(nutriments['fat_serving']),
    fiber: parseNutrientValue(nutriments['fiber_serving'])
  };

  // Parse serving size details
  const servingSizeText = raw.serving_size ? String(raw.serving_size).trim() : undefined;
  let servingQuantity: number | undefined = undefined;
  let servingUnit = isLiquid ? 'ml' : 'g';

  if (raw.serving_quantity && !Number.isNaN(Number(raw.serving_quantity))) {
    servingQuantity = Number(raw.serving_quantity);
  } else if (servingSizeText) {
    // Try to extract numeric quantity e.g. "30 g" -> 30, "1 bottle (330ml)" -> 330
    const match = servingSizeText.match(/(\d+(?:\.\d+)?)\s*(g|ml|oz)/i);
    if (match) {
      servingQuantity = parseFloat(match[1]);
      if (match[2].toLowerCase() === 'ml') servingUnit = 'ml';
      if (match[2].toLowerCase() === 'g') servingUnit = 'g';
    }
  }

  const hasServingData = Boolean(
    perServing.calories !== null ||
    perServing.protein !== null ||
    (servingQuantity && servingQuantity > 0) ||
    servingSizeText
  );

  // If perServing is missing but we have servingQuantity and per100g, synthesize per-serving
  if (
    hasServingData &&
    perServing.calories === null &&
    servingQuantity &&
    per100g.calories !== null
  ) {
    const ratio = servingQuantity / 100;
    perServing.calories = Math.round(per100g.calories * ratio);
    perServing.protein = per100g.protein !== null ? Number((per100g.protein * ratio).toFixed(1)) : null;
    perServing.carbs = per100g.carbs !== null ? Number((per100g.carbs * ratio).toFixed(1)) : null;
    perServing.fat = per100g.fat !== null ? Number((per100g.fat * ratio).toFixed(1)) : null;
    perServing.fiber = per100g.fiber !== null ? Number((per100g.fiber * ratio).toFixed(1)) : null;
  }

  // Detect incomplete data warning
  let incompleteDataWarning: string | undefined = undefined;
  if (per100g.calories === null && perServing.calories === null) {
    incompleteDataWarning = 'Calorie information is not listed in Open Food Facts for this product.';
  } else if (per100g.protein === null && perServing.protein === null) {
    incompleteDataWarning = 'Protein information is unlisted for this product.';
  }

  const categories = raw.categories ? String(raw.categories).split(',').map((c) => c.trim()) : [];

  return {
    barcode,
    name,
    brand,
    imageUrl,
    servingSizeText,
    servingQuantity,
    servingUnit,
    hasServingData,
    perServing,
    per100g,
    isLiquid,
    categories,
    incompleteDataWarning
  };
}

/**
 * Calculates scaled nutrients based on portion selection.
 * Multiplier applies to either standard serving or 100g base.
 */
export function calculatePortionNutrients(
  product: ScannedFoodProduct,
  mode: 'serving' | '100g' | 'custom_grams',
  multiplier: number,
  customGrams: number = 100
): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  servingLabel: string;
  isEstimate: boolean;
} {
  let baseNutrients: ScannedFoodNutrients;
  let scaleRatio = 1;
  let servingLabel = '';

  if (mode === 'serving' && product.hasServingData && product.perServing.calories !== null) {
    baseNutrients = product.perServing;
    scaleRatio = multiplier;
    servingLabel = multiplier === 1
      ? product.servingSizeText || `1 serving (${product.servingQuantity || 100}${product.servingUnit})`
      : `${multiplier} × (${product.servingSizeText || 'serving'})`;
  } else if (mode === 'custom_grams') {
    baseNutrients = product.per100g;
    scaleRatio = (customGrams * multiplier) / 100;
    servingLabel = `${Math.round(customGrams * multiplier)}${product.servingUnit}`;
  } else {
    // 100g mode
    baseNutrients = product.per100g;
    scaleRatio = multiplier;
    servingLabel = multiplier === 1 ? `100${product.servingUnit}` : `${Math.round(100 * multiplier)}${product.servingUnit}`;
  }

  const calories = baseNutrients.calories !== null ? Math.round(baseNutrients.calories * scaleRatio) : 0;
  const protein = baseNutrients.protein !== null ? Number((baseNutrients.protein * scaleRatio).toFixed(1)) : 0;
  const carbs = baseNutrients.carbs !== null ? Number((baseNutrients.carbs * scaleRatio).toFixed(1)) : 0;
  const fat = baseNutrients.fat !== null ? Number((baseNutrients.fat * scaleRatio).toFixed(1)) : 0;
  const fiber = baseNutrients.fiber !== null ? Number((baseNutrients.fiber * scaleRatio).toFixed(1)) : 0;

  const isEstimate = baseNutrients.calories === null;

  return {
    calories,
    protein,
    carbs,
    fat,
    fiber,
    servingLabel,
    isEstimate
  };
}

/**
 * Fetches product from Open Food Facts proxy endpoint.
 */
export async function lookupProductByBarcode(
  rawBarcode: string
): Promise<{
  success: boolean;
  found: boolean;
  product?: ScannedFoodProduct;
  fromCache?: boolean;
  error?: string;
}> {
  const barcode = sanitizeBarcode(rawBarcode);
  if (!barcode) {
    return { success: false, found: false, error: 'Please enter a valid numeric barcode.' };
  }

  try {
    const res = await fetch(`/api/nutrition/barcode/${encodeURIComponent(barcode)}`, {
      headers: { Accept: 'application/json' }
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 404 || data.found === false) {
        return {
          success: true,
          found: false,
          error: data.message || 'Product not found in Open Food Facts database.'
        };
      }
      return {
        success: false,
        found: false,
        error: data.error || `Server returned error (${res.status})`
      };
    }

    if (!data.found || !data.product) {
      return {
        success: true,
        found: false,
        error: data.message || 'Product not found in Open Food Facts database.'
      };
    }

    const normalized = normalizeOpenFoodFactsProduct(data.product, barcode);
    return {
      success: true,
      found: true,
      product: normalized,
      fromCache: data.fromCache
    };
  } catch (err: any) {
    console.error('Barcode lookup network error:', err);
    return {
      success: false,
      found: false,
      error: 'Network error connecting to barcode lookup service.'
    };
  }
}
