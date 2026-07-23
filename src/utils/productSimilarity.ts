import { Item } from '../types';

export interface SimilarityResult {
  item: Item;
  overallScore: number; // 0 - 100
  reasons: string[];
  matchedBrand?: string;
  matchedModel?: string;
  matchedColor?: string;
  matchedSpecs?: string;
}

// Multilingual Dictionary mapping Arabic <-> French/English keywords
const KEYWORD_MAP: Record<string, string> = {
  // Brands & Devices
  'سامسونج': 'samsung',
  'ايفون': 'iphone',
  'آيفون': 'iphone',
  'أبل': 'apple',
  'ابل': 'apple',
  'شيومي': 'xiaomi',
  'شاومي': 'xiaomi',
  'ريدمي': 'redmi',
  'هواوي': 'huawei',
  'انكر': 'anker',
  'أنكر': 'anker',
  'جويروم': 'joyroom',
  'هوكو': 'hoco',
  'باسوس': 'baseus',
  'بيسوس': 'baseus',
  'اورايمو': 'oraimo',
  'ريمكس': 'remax',
  'ريماكس': 'remax',
  'جي بي ال': 'jbl',
  'لينوفو': 'lenovo',
  'ريلمي': 'realme',
  'انفينكس': 'infinix',
  'أوبو': 'oppo',
  'اوبو': 'oppo',
  'فيفو': 'vivo',
  'ديفيا': 'devia',

  // Categories & Item Types
  'شاحن': 'charger',
  'شارجور': 'charger',
  'chargeur': 'charger',
  'وصله': 'cable',
  'وصلة': 'cable',
  'خيط': 'cable',
  'كابل': 'cable',
  'غلاف': 'case',
  'كفر': 'case',
  'بوشات': 'case',
  'غطاء': 'case',
  'pochette': 'case',
  'coque': 'case',
  'سماعه': 'earphone',
  'سماعات': 'earphone',
  'ecouteur': 'earphone',
  'airpods': 'earphone',
  'حمايه': 'protector',
  'بلانده': 'protector',
  'incassable': 'protector',
  'بطاريه': 'battery',
  'بطارية': 'battery',
  'batterie': 'battery',
  'سبيكر': 'speaker',
  'مكبر': 'speaker',
  'baffle': 'speaker',

  // Colors
  'اسود': 'black',
  'أسود': 'black',
  'noir': 'black',
  'ابيض': 'white',
  'أبيض': 'white',
  'blanc': 'white',
  'احمر': 'red',
  'أحمر': 'red',
  'rouge': 'red',
  'ازرق': 'blue',
  'أزرق': 'blue',
  'bleu': 'blue',
  'ذهبي': 'gold',
  'dore': 'gold',
  'فضائي': 'silver',
  'سيلفر': 'silver',
  'argent': 'silver',
  'رمادي': 'gray',
  'gris': 'gray',
  'شفاف': 'transparent',
  'transparente': 'transparent',
  'وردي': 'pink',
  'rose': 'pink',
  'اخضر': 'green',
  'أخضر': 'green',
  'vert': 'green',
  'بنفسجي': 'purple',
  'موف': 'purple',
  'violet': 'purple',
};

const BRANDS = [
  'samsung', 'iphone', 'apple', 'xiaomi', 'redmi', 'realme', 'huawei', 'infinix',
  'oppo', 'vivo', 'anker', 'joyroom', 'hoco', 'baseus', 'remax', 'oraimo', 'jbl',
  'lenovo', 'borofone', 'ldnio', 'devia', 'incipio'
];

const COLORS = [
  'black', 'white', 'red', 'blue', 'gold', 'silver', 'gray', 'transparent', 'pink', 'green', 'purple'
];

/**
 * Normalizes Arabic and English text for comparison
 */
export function normalizeText(text: string): string {
  if (!text) return '';
  let str = text.toLowerCase().trim();
  
  // Remove Arabic diacritics (tashkeel)
  str = str.replace(/[\u064B-\u0652]/g, '');
  
  // Normalize letters
  str = str.replace(/[أإآ]/g, 'ا');
  str = str.replace(/ة/g, 'ه');
  str = str.replace(/ى/g, 'ي');
  
  // Remove punctuation except numbers, letters and spaces
  str = str.replace(/[^\w\s\u0600-\u06FF]/g, ' ');
  
  // Collapse spaces
  return str.replace(/\s+/g, ' ').trim();
}

/**
 * Tokenizes text into normalized standard keys using KEYWORD_MAP
 */
export function extractCanonicalTokens(text: string): string[] {
  const normalized = normalizeText(text);
  const words = normalized.split(' ').filter(w => w.length > 0);
  
  return words.map(w => KEYWORD_MAP[w] || w);
}

/**
 * Extracts brand name from text
 */
export function extractBrand(text: string): string | null {
  const tokens = extractCanonicalTokens(text);
  for (const t of tokens) {
    if (BRANDS.includes(t)) return t;
  }
  return null;
}

/**
 * Extracts color from text
 */
export function extractColor(text: string): string | null {
  const tokens = extractCanonicalTokens(text);
  for (const t of tokens) {
    if (COLORS.includes(t)) return t;
  }
  return null;
}

/**
 * Extracts capacity / power / size specs (e.g., 25w, 128gb, 20000mah, 44mm)
 */
export function extractSpecs(text: string): string[] {
  const str = text.toLowerCase();
  const matches = str.match(/\b\d+\s*(w|gb|mb|tb|mah|a|v|m|mm)\b/g);
  if (!matches) return [];
  return matches.map(m => m.replace(/\s+/g, ''));
}

/**
 * Extracts numeric model designation (e.g. 14 pro, a54, note 10, c55, s23, t13)
 */
export function extractModelTokens(text: string): string[] {
  const str = normalizeText(text);
  const matches = str.match(/\b([a-z]{1,2}\d{1,3}|\d{1,2}\s*(pro|max|plus|ultra|mini|lite)?)\b/g);
  if (!matches) return [];
  return matches.map(m => m.trim());
}

/**
 * Levenshtein Distance similarity (0.0 to 1.0)
 */
export function levenshteinSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  
  const len1 = s1.length;
  const len2 = s2.length;
  const matrix: number[][] = [];

  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  const maxLen = Math.max(len1, len2);
  return Math.max(0, 1 - distance / maxLen);
}

/**
 * Token set overlap similarity (order independent, language mapped)
 */
export function tokenSetSimilarity(text1: string, text2: string): number {
  const tokens1 = new Set(extractCanonicalTokens(text1));
  const tokens2 = new Set(extractCanonicalTokens(text2));

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  let intersection = 0;
  tokens1.forEach(t => {
    if (tokens2.has(t)) intersection++;
  });

  const union = new Set([...tokens1, ...tokens2]).size;
  return intersection / union;
}

// Storage key for user learning decisions
const LEARNING_STORAGE_KEY = 'yosri_learned_product_pairs';

interface LearningData {
  // key: "normName1||normName2" -> count positive (confirmed same) / negative (rejected)
  [pairKey: string]: { sameCount: number; diffCount: number };
}

/**
 * Retrieves learned pair records from localStorage
 */
function getLearningData(): LearningData {
  try {
    const raw = localStorage.getItem(LEARNING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Creates a unique symmetric key for two item names
 */
function getPairKey(name1: string, name2: string): string {
  const norm1 = normalizeText(name1);
  const norm2 = normalizeText(name2);
  return [norm1, norm2].sort().join('||');
}

/**
 * Get learning boost score modifier (-30 to +30)
 */
export function getLearnedPairModifier(name1: string, name2: string): number {
  const data = getLearningData();
  const pairKey = getPairKey(name1, name2);
  const record = data[pairKey];
  
  if (!record) return 0;
  
  const netSame = record.sameCount - record.diffCount;
  if (netSame > 0) {
    // Boost score by +15 up to +30 depending on how many times user confirmed
    return Math.min(30, netSame * 15);
  } else if (netSame < 0) {
    // Reduce score by -15 down to -30
    return Math.max(-30, netSame * 15);
  }
  return 0;
}

/**
 * Record user decision for pair learning
 */
export function recordLearningDecision(name1: string, name2: string, isSameProduct: boolean): void {
  try {
    const data = getLearningData();
    const pairKey = getPairKey(name1, name2);
    
    if (!data[pairKey]) {
      data[pairKey] = { sameCount: 0, diffCount: 0 };
    }
    
    if (isSameProduct) {
      data[pairKey].sameCount += 1;
    } else {
      data[pairKey].diffCount += 1;
    }
    
    localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.error('Failed to save learning decision', err);
  }
}

/**
 * Main Comparison Function:
 * Calculates similarity between a new product input and an existing inventory item.
 */
export function calculateProductSimilarity(
  newItem: { name: string; barcode?: string; barcodes?: string[]; imageUrl?: string },
  existingItem: Item
): SimilarityResult {
  const reasons: string[] = [];
  let baseScore = 0;

  const normNewName = normalizeText(newItem.name);
  const normExistName = normalizeText(existingItem.name);

  // 1. Exact Name Match
  if (normNewName === normExistName) {
    reasons.push('اسم السلعة متطابق تمامًا');
    return {
      item: existingItem,
      overallScore: 100,
      reasons
    };
  }

  // 2. Barcode Check
  const newBarcodes = newItem.barcodes || (newItem.barcode ? [newItem.barcode] : []);
  const existBarcodes = existingItem.barcodes || (existingItem.barcode ? [existingItem.barcode] : []);
  
  const hasMatchingBarcode = newBarcodes.some(b => b.trim() && existBarcodes.includes(b.trim()));
  if (hasMatchingBarcode) {
    reasons.push('✓ الباركود متطابق 100%');
    baseScore += 50; // Huge boost for barcode match
  }

  // 3. Image URL Match
  if (newItem.imageUrl && existingItem.imageUrl && newItem.imageUrl === existingItem.imageUrl) {
    reasons.push('✓ الصورة المرفقة متطابقة');
    baseScore += 30;
  }

  // 4. Brand Comparison
  const brandNew = extractBrand(newItem.name);
  const brandExist = extractBrand(existingItem.name);
  
  if (brandNew && brandExist) {
    if (brandNew === brandExist) {
      reasons.push(`✓ نفس البراند والماركة (${brandNew.toUpperCase()})`);
      baseScore += 20;
    } else {
      // Different brand penalizes
      baseScore -= 20;
    }
  }

  // 5. Specs / Capacity / Power Comparison
  const specsNew = extractSpecs(newItem.name);
  const specsExist = extractSpecs(existingItem.name);
  
  if (specsNew.length > 0 && specsExist.length > 0) {
    const commonSpecs = specsNew.filter(s => specsExist.includes(s));
    if (commonSpecs.length > 0) {
      reasons.push(`✓ السعة / القدرة متطابقة (${commonSpecs.join(', ').toUpperCase()})`);
      baseScore += 20;
    } else {
      // Conflict in specs (e.g., 25W vs 65W, 128GB vs 256GB)
      baseScore -= 25;
    }
  }

  // 6. Color Comparison
  const colorNew = extractColor(newItem.name);
  const colorExist = extractColor(existingItem.name);
  
  if (colorNew && colorExist) {
    if (colorNew === colorExist) {
      reasons.push(`✓ اللون متطابق (${colorNew})`);
      baseScore += 10;
    } else {
      // Conflict in colors (e.g. Black vs White)
      baseScore -= 15;
    }
  }

  // 7. Model Tokens Comparison
  const modelsNew = extractModelTokens(newItem.name);
  const modelsExist = extractModelTokens(existingItem.name);
  if (modelsNew.length > 0 && modelsExist.length > 0) {
    const commonModels = modelsNew.filter(m => modelsExist.includes(m));
    if (commonModels.length > 0) {
      reasons.push(`✓ الموديل متطابق (${commonModels.join(', ')})`);
      baseScore += 15;
    }
  }

  // 8. Token Overlap Similarity (handles word order & language mapping)
  const tSim = tokenSetSimilarity(newItem.name, existingItem.name);
  const lSim = levenshteinSimilarity(normNewName, normExistName);
  
  const textSimilarityScore = (tSim * 0.6 + lSim * 0.4) * 45;
  baseScore += textSimilarityScore;

  if (tSim > 0.6) {
    reasons.push(`✓ تشابه عالي في الكلمات والمعنى (${Math.round(tSim * 100)}%)`);
  }

  // 9. Apply User Learning Decisions Boost/Penalty
  const learningModifier = getLearnedPairModifier(newItem.name, existingItem.name);
  if (learningModifier > 0) {
    reasons.push(`🧠 اقتراح محفّز من قراراتك السابقة (+${learningModifier}%)`);
    baseScore += learningModifier;
  } else if (learningModifier < 0) {
    baseScore += learningModifier;
  }

  // Clamp final score between 0 and 99 (100 reserved for exact match)
  const finalScore = Math.min(99, Math.max(0, Math.round(baseScore)));

  return {
    item: existingItem,
    overallScore: finalScore,
    reasons,
    matchedBrand: brandNew || brandExist || undefined,
    matchedColor: colorNew || colorExist || undefined,
    matchedSpecs: specsNew[0] || specsExist[0] || undefined
  };
}

/**
 * Searches across all existing items and returns candidate duplicate matches sorted by similarity score.
 */
export function findSimilarProducts(
  newItem: { name: string; barcode?: string; barcodes?: string[]; imageUrl?: string },
  items: Item[],
  minThreshold: number = 55
): SimilarityResult[] {
  if (!newItem.name || newItem.name.trim().length < 2) return [];

  const results: SimilarityResult[] = [];

  for (const existingItem of items) {
    const res = calculateProductSimilarity(newItem, existingItem);
    if (res.overallScore >= minThreshold) {
      results.push(res);
    }
  }

  // Sort descending by score
  return results.sort((a, b) => b.overallScore - a.overallScore);
}
