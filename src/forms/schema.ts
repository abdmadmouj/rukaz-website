/**
 * The introduction forms, shared by the page and the server so both apply exactly the
 * same rules. The server never trusts the page: it re-validates everything with this file.
 */
export const AUDIENCES = ['diagnostic', 'group', 'founder', 'investor', 'sponsor', 'talent'] as const;
export type Audience = (typeof AUDIENCES)[number];

export type FieldKind = 'text' | 'email' | 'url' | 'textarea' | 'select' | 'country' | 'checkbox';
export interface FieldDef {
  name: string;
  kind: FieldKind;
  required: boolean;
  min?: number;
  max?: number;
  options?: readonly string[];
  autoComplete?: string;
  wide?: boolean;
}

export const COUNTRIES = ['SA', 'AE', 'QA', 'KW', 'BH', 'OM', 'JO', 'EG', 'LB', 'IQ', 'MA', 'TR', 'GB', 'US', 'other'] as const;
const TIMING = ['now', 'quarter', 'half-year', 'exploring'] as const;

const head = (companyRequired: boolean): FieldDef[] => [
  { name: 'fullName', kind: 'text', required: true, max: 120, autoComplete: 'name' },
  { name: 'email', kind: 'email', required: true, max: 200, autoComplete: 'email' },
  { name: 'company', kind: 'text', required: companyRequired, max: 160, autoComplete: 'organization' },
  { name: 'country', kind: 'country', required: true, options: COUNTRIES, autoComplete: 'country' },
];

const BY_AUDIENCE: Record<Audience, FieldDef[]> = {
  diagnostic: [
    { name: 'forWho', kind: 'select', required: true, options: ['group', 'founder'] },
    { name: 'timing', kind: 'select', required: true, options: TIMING },
    { name: 'focus', kind: 'textarea', required: true, min: 10, max: 1200, wide: true },
  ],
  group: [
    { name: 'sector', kind: 'text', required: true, max: 160 },
    { name: 'role', kind: 'select', required: true, options: ['decide', 'recommend', 'exploring'] },
    { name: 'asset', kind: 'textarea', required: true, min: 10, max: 1200, wide: true },
    { name: 'timing', kind: 'select', required: true, options: TIMING },
    { name: 'callTimes', kind: 'text', required: false, max: 200 },
  ],
  founder: [
    { name: 'stage', kind: 'select', required: true, options: ['idea', 'prototype', 'early-revenue', 'growing'] },
    { name: 'building', kind: 'textarea', required: true, min: 10, max: 1200, wide: true },
    { name: 'problem', kind: 'textarea', required: true, min: 10, max: 1200, wide: true },
  ],
  investor: [
    { name: 'investorType', kind: 'select', required: true, options: ['angel', 'family-office', 'venture-fund', 'corporate', 'institution', 'other'] },
    { name: 'investFocus', kind: 'text', required: true, max: 300, wide: true },
    { name: 'collaboration', kind: 'select', required: true, options: ['co-invest', 'back-studio-companies', 'strategic', 'exploring'] },
  ],
  sponsor: [
    { name: 'goal', kind: 'textarea', required: true, min: 10, max: 1200, wide: true },
    { name: 'cohortSize', kind: 'select', required: true, options: ['under-10', '10-25', '25-50', 'over-50'] },
    { name: 'timing', kind: 'select', required: true, options: TIMING },
  ],
  talent: [
    { name: 'discipline', kind: 'select', required: true, options: ['engineering', 'product', 'design', 'growth', 'operations', 'finance', 'other'] },
    { name: 'experience', kind: 'textarea', required: true, min: 10, max: 1200, wide: true },
    { name: 'profile', kind: 'url', required: false, max: 300, autoComplete: 'url', wide: true },
  ],
};

const TAIL: FieldDef[] = [
  { name: 'intro', kind: 'textarea', required: true, min: 20, max: 1500, wide: true },
  { name: 'consent', kind: 'checkbox', required: true, wide: true },
];

export function fieldsFor(a: Audience): FieldDef[] {
  return [...head(a === 'group' || a === 'sponsor'), ...BY_AUDIENCE[a], ...TAIL];
}

export const isAudience = (v: unknown): v is Audience => typeof v === 'string' && (AUDIENCES as readonly string[]).includes(v);

export type ErrorCode = 'required' | 'email' | 'tooLong' | 'tooShort' | 'url' | 'consent' | 'choice';
export type Values = Record<string, string | boolean | undefined>;

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
/** characters that have no place in a form answer (control characters except tab and newline) */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/;

export function validateField(def: FieldDef, value: unknown, all: Values): ErrorCode | null {
  if (def.kind === 'checkbox') return value === true || value === 'true' || value === 'on' ? null : def.required ? 'consent' : null;
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v) return def.required ? 'required' : null;
  if (CONTROL.test(v)) return 'choice';
  if (def.max && v.length > def.max) return 'tooLong';
  if (def.min && v.length < def.min) return 'tooShort';
  if (def.kind === 'email' && !EMAIL.test(v)) return 'email';
  if (def.kind !== 'textarea' && /[\r\n]/.test(v)) return 'choice';
  if (def.kind === 'url') {
    try {
      const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
      if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.') || u.username || u.password) return 'url';
    } catch {
      return 'url';
    }
  }
  if ((def.kind === 'select' || def.kind === 'country') && def.options && !def.options.includes(v)) return 'choice';
  if (def.kind === 'country' && v === 'other') {
    const other = typeof all.countryOther === 'string' ? all.countryOther.trim() : '';
    if (!other) return 'required';
    if (other.length > 80 || /[\r\n]/.test(other) || CONTROL.test(other)) return 'tooLong';
  }
  return null;
}

export function validate(a: Audience, values: Values) {
  const errors: Record<string, ErrorCode> = {};
  for (const def of fieldsFor(a)) {
    const e = validateField(def, values[def.name], values);
    if (e) errors[def.name] = e;
  }
  return errors;
}

/** keep only known fields, as trimmed strings (the server stores and sends nothing else) */
export function clean(a: Audience, values: Values) {
  const out: Record<string, string> = {};
  for (const def of fieldsFor(a)) {
    const v = values[def.name];
    if (def.kind === 'checkbox') out[def.name] = v === true || v === 'true' || v === 'on' ? 'yes' : 'no';
    else if (typeof v === 'string' && v.trim()) out[def.name] = v.trim().slice(0, def.max ?? 2000);
  }
  if (values.country === 'other' && typeof values.countryOther === 'string') out.countryOther = values.countryOther.trim().slice(0, 80);
  return out;
}
