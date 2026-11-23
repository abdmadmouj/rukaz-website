import type { Audience, Values } from './schema';

/** Drafts stay on this device only (localStorage), so nothing is lost if the tab closes. */
const key = (a: Audience) => `rukaz-draft-${a}`;

export function loadDraft(a: Audience): Values | null {
  try {
    const raw = window.localStorage.getItem(key(a));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.v !== 'object' || parsed.v === null) return null;
    // only plain strings and booleans come back
    const out: Values = {};
    for (const [k, v] of Object.entries(parsed.v as Record<string, unknown>)) if (typeof v === 'string' || typeof v === 'boolean') out[k] = v;
    return out;
  } catch {
    return null;
  }
}

/** saves when something is filled in; returns true if a draft is stored */
export function saveDraft(a: Audience, values: Values) {
  try {
    const filled = Object.entries(values).some(([k, v]) => k !== 'consent' && typeof v === 'string' && v.trim() !== '');
    if (!filled) {
      window.localStorage.removeItem(key(a));
      return false;
    }
    window.localStorage.setItem(key(a), JSON.stringify({ v: values, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearDraft(a: Audience) {
  try {
    window.localStorage.removeItem(key(a));
  } catch {
    /* storage unavailable */
  }
}

/** a plain-text copy of the answers, for when online sending is not available */
export function downloadCopy(filename: string, rows: [string, string][]) {
  const text = rows.map(([label, value]) => `${label}\n${value || '-'}\n`).join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
