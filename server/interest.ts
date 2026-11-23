import { createHmac, randomUUID } from 'node:crypto';
import { clean, isAudience, validate, type Values } from '../src/forms/schema';
import { escapeHtml, oneLine, type RateStore } from './security';

export interface InterestConfig {
  /** where accepted introductions are sent (e.g. an automation or CRM inbox); unset = not configured */
  webhookUrl?: string;
  /** shared secret: every delivery is signed (x-rukaz-signature: sha256=<hex>) */
  webhookSecret?: string;
  /** origins allowed to post, e.g. https://rukaz.com */
  allowedOrigins: string[];
  rate: RateStore;
  /** minimum seconds between opening the form and sending (bots are faster) */
  minFillSeconds: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface Result { status: number; body: Record<string, unknown> }

export const MAX_BODY_BYTES = 16 * 1024;

export const isConfigured = (c: InterestConfig) => !!(c.webhookUrl && c.webhookSecret && /^https:\/\//.test(c.webhookUrl));

/**
 * Handle one submission. Order matters: cheap checks first, nothing is stored or sent
 * unless every check passes, and the reply never reveals configuration or internals.
 */
export async function handleInterest(raw: string, meta: { ip: string; origin?: string; contentType?: string }, c: InterestConfig): Promise<Result> {
  if (!meta.contentType?.toLowerCase().startsWith('application/json')) return { status: 415, body: { ok: false, code: 'unsupported' } };
  if (!meta.origin || !c.allowedOrigins.includes(meta.origin)) return { status: 403, body: { ok: false, code: 'rejected' } };
  if (c.rate.hit(`ip:${meta.ip}`, 10 * 60_000) > 5 || c.rate.hit('all', 60_000) > 60) return { status: 429, body: { ok: false, code: 'rate_limited' } };
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { status: 413, body: { ok: false, code: 'too_large' } };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 400, body: { ok: false, code: 'bad_json' } };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { status: 400, body: { ok: false, code: 'bad_json' } };
  const d = data as Record<string, unknown>;
  if (!isAudience(d.audience)) return { status: 400, body: { ok: false, code: 'rejected' } };
  const lang = d.lang === 'ar' ? 'ar' : 'en';
  // the honeypot and the fill time: answer as if it worked, so bots learn nothing
  const now = (c.now ?? Date.now)();
  const started = typeof d.startedAt === 'number' ? d.startedAt : 0;
  if ((typeof d.website === 'string' && d.website.trim() !== '') || now - started < c.minFillSeconds * 1000 || now - started > 24 * 3600_000) {
    return { status: 200, body: { ok: true } };
  }
  const values: Values = {};
  if (d.values && typeof d.values === 'object' && !Array.isArray(d.values)) {
    for (const [k, v] of Object.entries(d.values as Record<string, unknown>)) if (typeof v === 'string' || typeof v === 'boolean') values[k] = v;
  }
  const fields = validate(d.audience, values);
  if (Object.keys(fields).length) return { status: 400, body: { ok: false, code: 'invalid', fields } };
  if (!isConfigured(c)) return { status: 503, body: { ok: false, code: 'not_configured' } };

  const answers = clean(d.audience, values);
  const id = randomUUID();
  const payload = JSON.stringify({
    id,
    receivedAt: new Date(now).toISOString(),
    audience: d.audience,
    lang,
    subject: oneLine(`RUKAZ introduction: ${d.audience}, ${answers.fullName ?? ''}${answers.company ? `, ${answers.company}` : ''}`),
    answers,
    html: Object.entries(answers).map(([k, v]) => `<p><strong>${escapeHtml(k)}</strong><br>${escapeHtml(v).replace(/\n/g, '<br>')}</p>`).join(''),
  });
  const signature = createHmac('sha256', c.webhookSecret!).update(payload).digest('hex');
  try {
    const res = await (c.fetchImpl ?? fetch)(c.webhookUrl!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rukaz-signature': `sha256=${signature}`, 'x-rukaz-id': id },
      body: payload,
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { status: 502, body: { ok: false, code: 'delivery_failed' } };
  } catch {
    return { status: 502, body: { ok: false, code: 'delivery_failed' } };
  }
  return { status: 200, body: { ok: true } };
}
