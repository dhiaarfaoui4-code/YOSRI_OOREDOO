import { Debt } from '../types';

/**
 * Normalizes Arabic name for fuzzy comparison and duplicate detection
 */
export function normalizeArabicName(name: string): string {
  if (!name) return '';
  let str = name.toLowerCase().trim();

  // 1. Remove Arabic diacritics (tashkeel)
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

  // 4. Remove conversational honorific prefixes at start of words (e.g. سي، عم، خويا، السيد، مدام)
  const tokens = str.split(/\s+/).filter(Boolean);
  const filteredTokens = tokens.map(tok => {
    // Remove "ال" prefix from tokens longer than 4 chars (e.g. "الطرابلسي" -> "طرابلسي", "الشريف" -> "شريف")
    if (tok.startsWith('ال') && tok.length > 4) {
      return tok.slice(2);
    }
    return tok;
  }).filter(tok => {
    const honorifics = ['سي', 'السي', 'عم', 'العم', 'خويا', 'سيد', 'السيد', 'مدام', 'حريف', 'زبون', 'جاري'];
    return !honorifics.includes(tok);
  });

  return filteredTokens.join(' ').trim();
}

/**
 * Normalizes phone numbers (handles Tunisian +216 / 00216 or spaces)
 */
export function normalizePhoneNumber(phone?: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  // If starts with 216 and has 11 digits, extract last 8
  if (digits.startsWith('216') && digits.length === 11) {
    return digits.slice(3);
  }
  if (digits.startsWith('00216') && digits.length === 13) {
    return digits.slice(5);
  }
  // Return last 8 digits if >= 8 digits
  if (digits.length >= 8) {
    return digits.slice(-8);
  }
  return digits;
}

/**
 * Levenshtein Distance & Similarity (0.0 to 1.0)
 */
export function calculateLevenshteinSimilarity(s1: string, s2: string): number {
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
 * Token Set Similarity (Jaccard similarity on normalized tokens)
 */
export function calculateTokenSimilarity(s1: string, s2: string): number {
  const norm1 = normalizeArabicName(s1);
  const norm2 = normalizeArabicName(s2);
  if (!norm1 || !norm2) return 0;
  if (norm1 === norm2) return 1.0;

  const tokens1 = new Set(norm1.split(' ').filter(Boolean));
  const tokens2 = new Set(norm2.split(' ').filter(Boolean));

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  let intersection = 0;
  tokens1.forEach(t => {
    if (tokens2.has(t)) {
      intersection++;
    } else {
      // Check partial token similarity (e.g. typos in single token)
      for (const t2 of tokens2) {
        if (calculateLevenshteinSimilarity(t, t2) >= 0.8) {
          intersection += 0.85;
          break;
        }
      }
    }
  });

  const union = new Set([...tokens1, ...tokens2]).size;
  return Math.min(1.0, intersection / union);
}

export interface CustomerMatchScore {
  score: number; // 0 to 100
  isExact: boolean;
  matchType: 'phone' | 'exact_name' | 'token_overlap' | 'fuzzy_name' | 'substring';
  reason: string;
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
  const normPhone1 = normalizePhoneNumber(phone1);
  const normPhone2 = normalizePhoneNumber(phone2);

  // 1. Phone Match: If both have valid phone numbers and they match -> 100% same person!
  if (normPhone1 && normPhone2 && normPhone1.length >= 8 && normPhone1 === normPhone2) {
    return {
      score: 100,
      isExact: true,
      matchType: 'phone',
      reason: 'مطابقة تامة في رقم الهاتف 📞'
    };
  }

  const raw1 = name1.trim().toLowerCase();
  const raw2 = name2.trim().toLowerCase();

  // 2. Exact Raw String Match
  if (raw1 === raw2 && raw1.length > 0) {
    return {
      score: 100,
      isExact: true,
      matchType: 'exact_name',
      reason: 'تطابق تام في الاسم'
    };
  }

  const norm1 = normalizeArabicName(name1);
  const norm2 = normalizeArabicName(name2);

  if (!norm1 || !norm2) {
    return { score: 0, isExact: false, matchType: 'fuzzy_name', reason: 'اسم فارغ' };
  }

  // 3. Exact Normalized Name Match
  if (norm1 === norm2) {
    return {
      score: 98,
      isExact: true,
      matchType: 'exact_name',
      reason: 'تطابق تام بعد إزالة أل التعريف والتشكيل'
    };
  }

  // 4. Substring / Containment (e.g. "محمد علي صفاقس" contains "محمد علي" or "أحمد شريف" vs "أحمد")
  if (norm1.length >= 4 && norm2.length >= 4) {
    if (norm1.includes(norm2) || norm2.includes(norm1)) {
      const minLen = Math.min(norm1.length, norm2.length);
      const maxLen = Math.max(norm1.length, norm2.length);
      const subScore = Math.round(75 + (minLen / maxLen) * 20);
      return {
        score: subScore,
        isExact: false,
        matchType: 'substring',
        reason: 'اسم مركب أو مضاف إليه لقب'
      };
    }
  }

  // 5. Token Similarity (Handles inverted word order: "أحمد بن علي" / "علي أحمد")
  const tokenSim = calculateTokenSimilarity(name1, name2);
  const levSim = calculateLevenshteinSimilarity(norm1, norm2);

  const combined = tokenSim * 0.65 + levSim * 0.35;
  const score = Math.round(combined * 100);

  if (score >= 80) {
    return {
      score,
      isExact: false,
      matchType: 'token_overlap',
      reason: 'تشابه كبير جداً في كلمات الاسم'
    };
  } else if (score >= 60) {
    return {
      score,
      isExact: false,
      matchType: 'fuzzy_name',
      reason: 'تقارب في طريقة النطق والكتابة'
    };
  }

  return {
    score,
    isExact: false,
    matchType: 'fuzzy_name',
    reason: 'تشابه ضعيف'
  };
}

export interface CustomerDebtGroup {
  id: string; // Unique group key
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
}

/**
 * Groups debts by customer smartly using fuzzy clustering and phone matching
 */
export function groupDebtsByCustomer(debts: Debt[]): CustomerDebtGroup[] {
  if (!debts || debts.length === 0) return [];

  const groups: CustomerDebtGroup[] = [];

  for (const debt of debts) {
    const custName = (debt.customerName || '').trim();
    if (!custName) continue;

    let matchedGroup: CustomerDebtGroup | null = null;
    let highestScore = 0;

    for (const group of groups) {
      // Check match against group's canonical name and all existing alias names in group
      for (const existingName of group.allNames) {
        const match = assessCustomerSimilarity(custName, debt.customerPhone, existingName, group.phone);
        if (match.score >= 70 && match.score > highestScore) {
          highestScore = match.score;
          matchedGroup = group;
        }
      }
    }

    if (matchedGroup && highestScore >= 70) {
      // Add debt to existing group
      matchedGroup.debts.push(debt);
      if (!matchedGroup.allNames.includes(custName)) {
        matchedGroup.allNames.push(custName);
      }
      // Upgrade phone if not present
      if (!matchedGroup.phone && debt.customerPhone) {
        matchedGroup.phone = debt.customerPhone;
      }
      // Upgrade canonical name if current name is longer/more detailed
      if (custName.length > matchedGroup.canonicalName.length && !matchedGroup.canonicalName.includes(' ')) {
        matchedGroup.canonicalName = custName;
      }
    } else {
      // Create new group
      groups.push({
        id: 'cust_' + Math.random().toString(36).slice(2, 9),
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
      });
    }
  }

  // Compute calculated metrics for each group
  for (const group of groups) {
    group.openDebts = group.debts.filter(d => (d.status === 'open' || (d.amount - d.paid) > 0.001));
    group.paidDebts = group.debts.filter(d => (d.status === 'paid' || (d.amount - d.paid) <= 0.001));

    group.totalAmount = group.debts.reduce((sum, d) => sum + (d.amount || 0), 0);
    group.totalPaid = group.debts.reduce((sum, d) => sum + (d.paid || 0), 0);
    group.totalRemaining = Math.max(0, group.totalAmount - group.totalPaid);

    // Sort dates
    const timestamps = group.debts.map(d => new Date(d.date).getTime()).filter(t => !isNaN(t));
    if (timestamps.length > 0) {
      group.oldestDate = new Date(Math.min(...timestamps)).toISOString();
      group.latestDate = new Date(Math.max(...timestamps)).toISOString();
    }

    // Sort open debts oldest first (for sequential payment)
    group.openDebts.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // Sort groups by total remaining debt descending, then by latest date
  return groups.sort((a, b) => {
    if (b.totalRemaining !== a.totalRemaining) {
      return b.totalRemaining - a.totalRemaining;
    }
    return new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime();
  });
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
  const suggestions: CustomerSuggestion[] = [];

  for (const g of groups) {
    let bestScore = 0;
    let bestReason = '';

    for (const name of g.allNames) {
      const match = assessCustomerSimilarity(trimmedName, trimmedPhone, name, g.phone);
      if (match.score > bestScore) {
        bestScore = match.score;
        bestReason = match.reason;
      }
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
