import { Debt } from '../types';

const NORM_NAME_CACHE = new Map<string, string>();
const NORM_PHONE_CACHE = new Map<string, string>();
const MAX_CACHE_SIZE = 3000;

/**
 * Normalizes Arabic name for orthographic comparison (memoized)
 */
export function normalizeArabicName(name: string): string {
  if (!name) return '';
  const cached = NORM_NAME_CACHE.get(name);
  if (cached !== undefined) return cached;

  let str = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .trim();

  // 1. Remove Arabic diacritics (tashkeel) and tatweel
  str = str.replace(/[\u064B-\u0652\u0670\u0640]/g, '');

  // 2. Normalize letter variations
  str = str.replace(/[أإآٱ]/g, 'ا');
  str = str.replace(/ة/g, 'ه');
  str = str.replace(/ى/g, 'ي');
  str = str.replace(/ؤ/g, 'و');
  str = str.replace(/ئ/g, 'ي');
  str = str.replace(/گ/g, 'ك');
  str = str.replace(/پ/g, 'ب');
  str = str.replace(/ڤ/g, 'ف');

  // 3. Remove punctuation, symbols, brackets
  str = str.replace(/[^\w\s\u0600-\u06FF]/g, ' ');

  // 4. Normalize definite article "ال" on long tokens and strip unambiguous honorifics
  const tokens = str.split(/\s+/).filter(Boolean);
  const honorifics = new Set(['سي', 'السي', 'خويا', 'مدام', 'حريف', 'زبون', 'جاري']);
  const filteredTokens: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    let tok = tokens[i];
    if (tok.startsWith('ال') && tok.length > 4) {
      tok = tok.slice(2);
    }
    if (!honorifics.has(tok)) {
      filteredTokens.push(tok);
    }
  }

  // Fallback: if all tokens were honorifics (e.g. customer named "السي"), keep original tokens
  const finalTokens = filteredTokens.length > 0 ? filteredTokens : tokens;
  const result = finalTokens.join(' ').trim();

  if (NORM_NAME_CACHE.size >= MAX_CACHE_SIZE) {
    NORM_NAME_CACHE.clear();
  }
  NORM_NAME_CACHE.set(name, result);
  return result;
}

/**
 * Normalizes phone numbers (handles Tunisian +216 / 00216 or spaces) (memoized)
 */
export function normalizePhoneNumber(phone?: string): string {
  if (!phone) return '';
  const cached = NORM_PHONE_CACHE.get(phone);
  if (cached !== undefined) return cached;

  const digits = phone.replace(/\D/g, '');
  let result = '';
  if (digits) {
    if (digits.startsWith('216') && digits.length === 11) {
      result = digits.slice(3);
    } else if (digits.startsWith('00216') && digits.length === 13) {
      result = digits.slice(5);
    } else if (digits.length >= 8) {
      result = digits.slice(-8);
    } else {
      result = digits;
    }
  }

  if (NORM_PHONE_CACHE.size >= MAX_CACHE_SIZE) {
    NORM_PHONE_CACHE.clear();
  }
  NORM_PHONE_CACHE.set(phone, result);
  return result;
}

/**
 * Levenshtein Distance & Similarity (0.0 to 1.0) using O(min(m, n)) space and optional length early-exit
 */
export function calculateLevenshteinSimilarity(s1: string, s2: string, minSimilarity = 0): number {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  let a = s1;
  let b = s2;
  if (a.length > b.length) {
    a = s2;
    b = s1;
  }

  const lenA = a.length;
  const lenB = b.length;

  if (minSimilarity > 0 && (lenB - lenA) / lenB > (1 - minSimilarity + 1e-6)) {
    return 0.0;
  }

  let prev = new Array<number>(lenA + 1);
  let curr = new Array<number>(lenA + 1);

  for (let i = 0; i <= lenA; i++) {
    prev[i] = i;
  }

  for (let j = 1; j <= lenB; j++) {
    curr[0] = j;
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= lenA; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      const del = prev[i] + 1;
      const ins = curr[i - 1] + 1;
      const sub = prev[i - 1] + cost;
      curr[i] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  const distance = prev[lenA];
  return Math.max(0, 1 - distance / lenB);
}

/**
 * Token Set Similarity (strict exact normalized token Jaccard similarity)
 */
export function calculateTokenSimilarity(s1: string, s2: string): number {
  const norm1 = normalizeArabicName(s1);
  const norm2 = normalizeArabicName(s2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;

  const tokens1 = norm1.split(' ').filter(Boolean);
  const tokens2 = norm2.split(' ').filter(Boolean);
  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  let intersection = 0;
  set1.forEach(t => {
    if (set2.has(t)) intersection++;
  });
  const union = new Set([...set1, ...set2]).size;
  return intersection / union;
}

export interface CustomerMatchScore {
  score: number; // 0 to 100
  isExact: boolean;
  matchType: 'phone' | 'exact_name' | 'token_overlap' | 'fuzzy_name' | 'substring';
  reason: string;
}

interface NormalizedProfile {
  rawLower: string;
  normName: string;
  compactName: string;
  tokens: string[];
  sortedTokensKey: string;
  normPhone: string;
}

function buildNormalizedProfile(name: string, phone?: string): NormalizedProfile {
  const rawLower = (name || '').trim().toLowerCase();
  const normName = normalizeArabicName(name);
  const tokens = normName ? normName.split(' ').filter(Boolean) : [];
  const compactName = tokens.join('');
  const sortedTokensKey = tokens.length >= 2 ? [...tokens].sort().join('\0') : '';
  const normPhone = normalizePhoneNumber(phone);
  return { rawLower, normName, compactName, tokens, sortedTokensKey, normPhone };
}

function assessNormalizedProfiles(
  p1: NormalizedProfile,
  p2: NormalizedProfile,
  allowPartialSuggestion: boolean
): CustomerMatchScore {
  // 0. Conflicting valid phones => definitely different people
  if (p1.normPhone.length >= 8 && p2.normPhone.length >= 8 && p1.normPhone !== p2.normPhone) {
    return {
      score: 0,
      isExact: false,
      matchType: 'phone',
      reason: 'أرقام هواتف مختلفة'
    };
  }

  // 1. Exact Phone Match
  if (p1.normPhone.length >= 8 && p2.normPhone.length >= 8 && p1.normPhone === p2.normPhone) {
    return {
      score: 100,
      isExact: true,
      matchType: 'phone',
      reason: 'مطابقة تامة في رقم الهاتف 📞'
    };
  }

  // 2. Exact Raw String Match
  if (p1.rawLower && p1.rawLower === p2.rawLower) {
    return {
      score: 100,
      isExact: true,
      matchType: 'exact_name',
      reason: 'تطابق تام في الاسم'
    };
  }

  const norm1 = p1.normName;
  const norm2 = p2.normName;
  if (!norm1 || !norm2) {
    // Partial phone match when searching/typing phone without name
    if (allowPartialSuggestion && p1.normPhone.length >= 4 && p2.normPhone.includes(p1.normPhone)) {
      return {
        score: 75,
        isExact: false,
        matchType: 'phone',
        reason: 'تطابق جزئي في رقم الهاتف 📞'
      };
    }
    return { score: 0, isExact: false, matchType: 'fuzzy_name', reason: 'اسم فارغ' };
  }

  // 3. Exact Normalized Name Match (same words, ignoring hamza/taa/yaa/diacritics/ال)
  if (norm1 === norm2) {
    return {
      score: 98,
      isExact: true,
      matchType: 'exact_name',
      reason: 'تطابق تام في الاسم مع اختلاف بسيط في الحروف'
    };
  }

  // 4. Compound Spacing Match (e.g. "عبد الله الطرابلسي" vs "عبدالله الطرابلسي")
  if (p1.compactName.length >= 5 && p1.compactName === p2.compactName) {
    return {
      score: 96,
      isExact: true,
      matchType: 'exact_name',
      reason: 'تطابق الاسم مع اختلاف المسافات'
    };
  }

  // 5. Inverted Word Order of Exact Same Tokens (e.g. "الطرابلسي أحمد" vs "أحمد الطرابلسي")
  if (p1.sortedTokensKey && p1.sortedTokensKey === p2.sortedTokensKey) {
    return {
      score: 95,
      isExact: true,
      matchType: 'token_overlap',
      reason: 'نفس الاسم الكامل بترتيب كلمات معكوس'
    };
  }

  // Suggestions-only matching (used for autocomplete chips while typing, NEVER for auto-grouping)
  if (allowPartialSuggestion) {
    // Partial phone match alongside name
    if (p1.normPhone.length >= 4 && p2.normPhone.includes(p1.normPhone)) {
      return {
        score: 78,
        isExact: false,
        matchType: 'phone',
        reason: 'تطابق جزئي في رقم الهاتف 📞'
      };
    }

    // Prefix / Substring match for typing suggestions (capped below 85 so it suggests without falsely claiming exact identity)
    if (norm1.length >= 2 && norm2.includes(norm1)) {
      const ratio = norm1.length / norm2.length;
      const subScore = Math.round(52 + ratio * 26); // 52..78
      return {
        score: subScore,
        isExact: false,
        matchType: 'substring',
        reason: 'اسم يطابق بداية أو جزء من الاسم المسجل'
      };
    }

    // Multi-word partial token match (all typed words appear in the customer's name)
    if (p1.tokens.length >= 1 && p2.tokens.length >= 2) {
      let matchedTokens = 0;
      for (let i = 0; i < p1.tokens.length; i++) {
        const t = p1.tokens[i];
        if (t.length >= 2 && p2.tokens.some(t2 => t2 === t || t2.startsWith(t))) {
          matchedTokens++;
        }
      }
      if (matchedTokens === p1.tokens.length) {
        return {
          score: 74,
          isExact: false,
          matchType: 'token_overlap',
          reason: 'يطابق كلمات من اسم الحريف'
        };
      }
    }
  }

  return {
    score: 0,
    isExact: false,
    matchType: 'fuzzy_name',
    reason: 'أسماء مختلفة'
  };
}

/**
 * Comprehensive similarity assessment between two customer profiles
 */
export function assessCustomerSimilarity(
  name1: string,
  phone1: string | undefined,
  name2: string,
  phone2: string | undefined
): CustomerMatchScore {
  const p1 = buildNormalizedProfile(name1, phone1);
  const p2 = buildNormalizedProfile(name2, phone2);
  return assessNormalizedProfiles(p1, p2, true);
}

export interface CustomerDebtGroup {
  id: string; // Deterministic unique group key
  canonicalName: string; // Preferred best display name
  allNames: string[]; // All unique names found across debts
  phone?: string;
  debts: Debt[];
  openDebts: Debt[];
  paidDebts: Debt[];
  totalAmount: number;
  totalPaid: number;
  totalRemaining: number;
  oldestDate: string;
  latestDate: string;
  oldestOpenDate?: string;
  latestOpenDate?: string;
  oldestOpenTs?: number;
  latestOpenTs?: number;
}

export type DebtSortOption =
  | 'highest_amount'
  | 'lowest_amount'
  | 'newest'
  | 'oldest'
  | 'most_debts'
  | 'name_asc';

function roundTND3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

function parseDebtTimestamp(dateStr?: string): number {
  if (!dateStr) return 0;
  const ts = new Date(dateStr).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

interface InternalGroup {
  group: CustomerDebtGroup;
  normPhone: string;
  aliasSet: Set<string>;
}

function addToBucket(map: Map<string, InternalGroup[]>, key: string, ig: InternalGroup) {
  if (!key) return;
  const list = map.get(key);
  if (list) {
    if (!list.includes(ig)) list.push(ig);
  } else {
    map.set(key, [ig]);
  }
}

function findNonConflictingGroup(
  candidates: InternalGroup[] | undefined,
  normPhone: string
): InternalGroup | undefined {
  if (!candidates || candidates.length === 0) return undefined;

  // Prefer group with matching phone if input has phone
  if (normPhone.length >= 8) {
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].normPhone === normPhone) return candidates[i];
    }
    // Otherwise match a group that doesn't have a conflicting phone
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i].normPhone.length < 8) return candidates[i];
    }
    return undefined;
  }

  // Input has no phone: prefer a group without phone first, else the first matching name group
  for (let i = 0; i < candidates.length; i++) {
    if (candidates[i].normPhone.length < 8) return candidates[i];
  }
  return candidates[0];
}

/**
 * Groups debts by customer with strict high-precision rules (O(N), zero false merges):
 * - Same valid 8+ digit phone number
 * - Exact raw name, exact normalized Arabic spelling, compound spacing, or exact reordered words
 * - Never merges conflicting phone numbers or merely similar/partial names (e.g. حسن vs حسين, أحمد vs أحمد الطرابلسي)
 */
export function groupDebtsByCustomer(debts: Debt[]): CustomerDebtGroup[] {
  if (!debts || debts.length === 0) return [];

  const internalGroups: InternalGroup[] = [];
  const phoneToGroup = new Map<string, InternalGroup>();
  const rawToGroups = new Map<string, InternalGroup[]>();
  const normToGroups = new Map<string, InternalGroup[]>();
  const compactToGroups = new Map<string, InternalGroup[]>();
  const sortedTokensToGroups = new Map<string, InternalGroup[]>();
  const usedIds = new Set<string>();

  for (let i = 0; i < debts.length; i++) {
    const debt = debts[i];
    const custName = (debt.customerName || '').trim();
    if (!custName) continue;

    const profile = buildNormalizedProfile(custName, debt.customerPhone);
    let matched: InternalGroup | undefined;

    // 1. Exact phone match
    if (profile.normPhone.length >= 8) {
      matched = phoneToGroup.get(profile.normPhone);
    }

    // 2. Exact raw name match (respecting phone conflict guard)
    if (!matched && profile.rawLower) {
      matched = findNonConflictingGroup(rawToGroups.get(profile.rawLower), profile.normPhone);
    }

    // 3. Exact normalized Arabic name match (respecting phone conflict guard)
    if (!matched && profile.normName) {
      matched = findNonConflictingGroup(normToGroups.get(profile.normName), profile.normPhone);
    }

    // 4. Compound spacing match e.g. "عبدالله" vs "عبد الله" (respecting phone conflict guard)
    if (!matched && profile.compactName.length >= 5) {
      matched = findNonConflictingGroup(compactToGroups.get(profile.compactName), profile.normPhone);
    }

    // 5. Inverted word-order match of exact same tokens (respecting phone conflict guard)
    if (!matched && profile.sortedTokensKey) {
      matched = findNonConflictingGroup(sortedTokensToGroups.get(profile.sortedTokensKey), profile.normPhone);
    }

    if (matched) {
      const g = matched.group;
      g.debts.push(debt);

      if (!matched.aliasSet.has(custName)) {
        matched.aliasSet.add(custName);
        g.allNames.push(custName);
        addToBucket(rawToGroups, profile.rawLower, matched);
        addToBucket(normToGroups, profile.normName, matched);
        if (profile.compactName.length >= 5) addToBucket(compactToGroups, profile.compactName, matched);
        if (profile.sortedTokensKey) addToBucket(sortedTokensToGroups, profile.sortedTokensKey, matched);
      }

      if (!g.phone && debt.customerPhone) {
        g.phone = debt.customerPhone;
        matched.normPhone = profile.normPhone;
        if (profile.normPhone.length >= 8 && !phoneToGroup.has(profile.normPhone)) {
          phoneToGroup.set(profile.normPhone, matched);
        }
      }

      // Prefer the more complete/longer name as display name when same customer had a shorter alias via phone
      if (custName.length > g.canonicalName.length && (custName.includes(' ') || !g.canonicalName.includes(' '))) {
        g.canonicalName = custName;
      }
    } else {
      let baseId = debt.id
        ? `cust_${debt.id}`
        : profile.normPhone
          ? `cust_p_${profile.normPhone}`
          : `cust_n_${profile.normName || i}`;
      while (usedIds.has(baseId)) {
        baseId = `${baseId}_${i}`;
      }
      usedIds.add(baseId);

      const newGroup: CustomerDebtGroup = {
        id: baseId,
        canonicalName: custName,
        allNames: [custName],
        phone: debt.customerPhone || undefined,
        debts: [debt],
        openDebts: [],
        paidDebts: [],
        totalAmount: 0,
        totalPaid: 0,
        totalRemaining: 0,
        oldestDate: debt.date || new Date().toISOString(),
        latestDate: debt.date || new Date().toISOString()
      };

      const ig: InternalGroup = {
        group: newGroup,
        normPhone: profile.normPhone,
        aliasSet: new Set([custName])
      };

      internalGroups.push(ig);
      if (profile.normPhone.length >= 8) phoneToGroup.set(profile.normPhone, ig);
      addToBucket(rawToGroups, profile.rawLower, ig);
      addToBucket(normToGroups, profile.normName, ig);
      if (profile.compactName.length >= 5) addToBucket(compactToGroups, profile.compactName, ig);
      if (profile.sortedTokensKey) addToBucket(sortedTokensToGroups, profile.sortedTokensKey, ig);
    }
  }

  const groups: CustomerDebtGroup[] = new Array(internalGroups.length);
  const latestTimestamps = new Map<CustomerDebtGroup, number>();

  for (let i = 0; i < internalGroups.length; i++) {
    const group = internalGroups[i].group;
    let totalAmount = 0;
    let totalPaid = 0;
    let minTs = Infinity;
    let maxTs = -Infinity;
    let minOpenTs = Infinity;
    let maxOpenTs = -Infinity;

    const openWithTs: { debt: Debt; ts: number }[] = [];
    const paidWithTs: { debt: Debt; ts: number }[] = [];

    for (let j = 0; j < group.debts.length; j++) {
      const d = group.debts[j];
      const amt = d.amount || 0;
      const paid = d.paid || 0;
      totalAmount += amt;
      totalPaid += paid;

      const ts = parseDebtTimestamp(d.date);
      const isOpen = d.status === 'open' || (amt - paid) > 0.001;

      if (isOpen) {
        openWithTs.push({ debt: d, ts });
        if (ts > 0) {
          if (ts < minOpenTs) minOpenTs = ts;
          if (ts > maxOpenTs) maxOpenTs = ts;
        }
      } else {
        paidWithTs.push({ debt: d, ts });
      }

      if (ts > 0) {
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
    }

    // Keep openDebts strictly oldest-first (FIFO) for partial payment distribution
    openWithTs.sort((a, b) => a.ts - b.ts);
    group.openDebts = openWithTs.map(x => x.debt);

    // Sort paidDebts newest-first
    paidWithTs.sort((a, b) => b.ts - a.ts);
    group.paidDebts = paidWithTs.map(x => x.debt);

    // Display order in expanded customer card: open debts first (newest first), then paid debts (newest first)
    const openNewestFirst = [...openWithTs].sort((a, b) => b.ts - a.ts).map(x => x.debt);
    group.debts = [...openNewestFirst, ...group.paidDebts];

    group.totalAmount = roundTND3(totalAmount);
    group.totalPaid = roundTND3(totalPaid);
    group.totalRemaining = Math.max(0, roundTND3(totalAmount - totalPaid));

    if (minTs !== Infinity) {
      group.oldestDate = new Date(minTs).toISOString();
      group.latestDate = new Date(maxTs).toISOString();
      latestTimestamps.set(group, maxTs);
    } else {
      latestTimestamps.set(group, parseDebtTimestamp(group.latestDate));
    }

    if (minOpenTs !== Infinity) {
      group.oldestOpenDate = new Date(minOpenTs).toISOString();
      group.latestOpenDate = new Date(maxOpenTs).toISOString();
      group.oldestOpenTs = minOpenTs;
      group.latestOpenTs = maxOpenTs;
    } else {
      group.oldestOpenDate = group.oldestDate;
      group.latestOpenDate = group.latestDate;
      group.oldestOpenTs = minTs !== Infinity ? minTs : parseDebtTimestamp(group.oldestDate);
      group.latestOpenTs = maxTs !== -Infinity ? maxTs : parseDebtTimestamp(group.latestDate);
    }

    groups[i] = group;
  }

  return groups.sort((a, b) => {
    if (b.totalRemaining !== a.totalRemaining) {
      return b.totalRemaining - a.totalRemaining;
    }
    return (latestTimestamps.get(b) || 0) - (latestTimestamps.get(a) || 0);
  });
}

/**
 * Sorts customer debt groups according to the chosen criterion with deterministic tie-breakers
 */
export function sortCustomerDebtGroups(
  groups: CustomerDebtGroup[],
  sortBy: DebtSortOption
): CustomerDebtGroup[] {
  if (groups.length <= 1) return groups;
  const copy = [...groups];

  copy.sort((a, b) => {
    const aLatest = a.latestOpenTs ?? parseDebtTimestamp(a.latestDate);
    const bLatest = b.latestOpenTs ?? parseDebtTimestamp(b.latestDate);
    const aOldest = a.oldestOpenTs ?? parseDebtTimestamp(a.oldestDate);
    const bOldest = b.oldestOpenTs ?? parseDebtTimestamp(b.oldestDate);

    switch (sortBy) {
      case 'highest_amount': {
        if (b.totalRemaining !== a.totalRemaining) return b.totalRemaining - a.totalRemaining;
        return bLatest - aLatest;
      }
      case 'lowest_amount': {
        if (a.totalRemaining !== b.totalRemaining) return a.totalRemaining - b.totalRemaining;
        return aOldest - bOldest;
      }
      case 'newest': {
        if (bLatest !== aLatest) return bLatest - aLatest;
        return b.totalRemaining - a.totalRemaining;
      }
      case 'oldest': {
        if (aOldest !== bOldest) return aOldest - bOldest;
        return b.totalRemaining - a.totalRemaining;
      }
      case 'most_debts': {
        if (b.openDebts.length !== a.openDebts.length) return b.openDebts.length - a.openDebts.length;
        if (b.totalRemaining !== a.totalRemaining) return b.totalRemaining - a.totalRemaining;
        return bLatest - aLatest;
      }
      case 'name_asc': {
        const cmp = a.canonicalName.localeCompare(b.canonicalName, 'ar', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return b.totalRemaining - a.totalRemaining;
      }
      default:
        return b.totalRemaining - a.totalRemaining;
    }
  });

  return copy;
}

/**
 * Sorts individual debts according to the chosen criterion with deterministic tie-breakers
 */
export function sortIndividualDebts(
  debtsList: Debt[],
  sortBy: DebtSortOption
): Debt[] {
  if (debtsList.length <= 1) return debtsList;
  const copy = [...debtsList];

  copy.sort((a, b) => {
    const aRem = Math.max(0, roundTND3((a.amount || 0) - (a.paid || 0)));
    const bRem = Math.max(0, roundTND3((b.amount || 0) - (b.paid || 0)));
    const aTs = parseDebtTimestamp(a.date);
    const bTs = parseDebtTimestamp(b.date);

    switch (sortBy) {
      case 'highest_amount': {
        if (bRem !== aRem) return bRem - aRem;
        return bTs - aTs;
      }
      case 'lowest_amount': {
        if (aRem !== bRem) return aRem - bRem;
        return aTs - bTs;
      }
      case 'oldest': {
        if (aTs !== bTs) return aTs - bTs;
        return bRem - aRem;
      }
      case 'name_asc': {
        const cmp = (a.customerName || '').localeCompare(b.customerName || '', 'ar', { sensitivity: 'base' });
        if (cmp !== 0) return cmp;
        return bRem - aRem;
      }
      case 'most_debts':
      case 'newest':
      default: {
        if (bTs !== aTs) return bTs - aTs;
        return bRem - aRem;
      }
    }
  });

  return copy;
}

export interface CustomerSuggestion {
  canonicalName: string;
  phone?: string;
  totalRemaining: number;
  openDebtsCount: number;
  score: number;
  reason: string;
  allNames: string[];
}

/**
 * Fast suggestions lookup directly against pre-grouped CustomerDebtGroup[] (no re-clustering)
 */
export function findCustomerSuggestionsFromGroups(
  inputName: string,
  inputPhone: string | undefined,
  groups: CustomerDebtGroup[],
  minScore: number = 50
): CustomerSuggestion[] {
  const trimmedName = (inputName || '').trim();
  const trimmedPhone = (inputPhone || '').trim();

  if (!trimmedName && !trimmedPhone) return [];
  if (!groups || groups.length === 0) return [];

  const inputProfile = buildNormalizedProfile(trimmedName, trimmedPhone);
  const suggestions: CustomerSuggestion[] = [];

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const groupPhoneNorm = normalizePhoneNumber(g.phone);

    // Hard block if both have full 8+ digit phone numbers and they are different
    if (inputProfile.normPhone.length >= 8 && groupPhoneNorm.length >= 8 && inputProfile.normPhone !== groupPhoneNorm) {
      continue;
    }

    let bestScore = 0;
    let bestReason = '';

    // Exact phone match
    if (inputProfile.normPhone.length >= 8 && groupPhoneNorm.length >= 8 && inputProfile.normPhone === groupPhoneNorm) {
      bestScore = 100;
      bestReason = 'مطابقة تامة في رقم الهاتف 📞';
    } else if (trimmedName) {
      for (let j = 0; j < g.allNames.length; j++) {
        const nameProfile = buildNormalizedProfile(g.allNames[j], g.phone);
        const match = assessNormalizedProfiles(inputProfile, nameProfile, true);
        if (match.score > bestScore) {
          bestScore = match.score;
          bestReason = match.reason;
          if (bestScore === 100) break;
        }
      }
    } else if (inputProfile.normPhone.length >= 4 && groupPhoneNorm.includes(inputProfile.normPhone)) {
      bestScore = 75;
      bestReason = 'تطابق جزئي في رقم الهاتف 📞';
    }

    if (bestScore >= minScore) {
      suggestions.push({
        canonicalName: g.canonicalName,
        phone: g.phone,
        totalRemaining: g.totalRemaining,
        openDebtsCount: g.openDebts.length,
        score: bestScore,
        reason: bestReason,
        allNames: g.allNames
      });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, 5);
}

/**
 * Finds customer suggestions for input name & phone from existing debt records
 */
export function findCustomerSuggestions(
  inputName: string,
  inputPhone: string | undefined,
  debts: Debt[],
  minScore: number = 50
): CustomerSuggestion[] {
  const trimmedName = (inputName || '').trim();
  const trimmedPhone = (inputPhone || '').trim();

  if (!trimmedName && !trimmedPhone) return [];

  const groups = groupDebtsByCustomer(debts);
  return findCustomerSuggestionsFromGroups(trimmedName, trimmedPhone, groups, minScore);
}

