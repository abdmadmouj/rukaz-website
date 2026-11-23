import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { handleInterest, type InterestConfig } from '../server/interest';
import { MemoryRateStore, securityHeaders } from '../server/security';

const ORIGIN = 'https://rukaz.example';
const now = 1_800_000_000_000;
const valid = {
  audience: 'founder', lang: 'en', startedAt: now - 30_000, website: '',
  values: { fullName: 'Omar', email: 'omar@example.com', country: 'SA', stage: 'growing', building: 'A payments product.', problem: 'Small shops get paid late.', intro: 'We have customers and want operators.', consent: true },
};
function config(over: Partial<InterestConfig> = {}) {
  const sent: { url: string; init: RequestInit }[] = [];
  const c: InterestConfig = {
    webhookUrl: 'https://hooks.example/in', webhookSecret: 's3cret', allowedOrigins: [ORIGIN], rate: new MemoryRateStore(), minFillSeconds: 3, now: () => now,
    fetchImpl: (async (url: string, init: RequestInit) => { sent.push({ url, init }); return new Response('ok'); }) as typeof fetch,
    ...over,
  };
  return { c, sent };
}
const meta = (ip = '1.1.1.1') => ({ ip, origin: ORIGIN, contentType: 'application/json' });

test('a valid introduction is delivered once, signed', async () => {
  const { c, sent } = config();
  const r = await handleInterest(JSON.stringify(valid), meta(), c);
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  const body = String(sent[0].init.body);
  const sig = (sent[0].init.headers as Record<string, string>)['x-rukaz-signature'];
  assert.equal(sig, `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`);
  assert.doesNotMatch(body, /<script/);
});

test('other origins, wrong content type and oversized bodies are refused', async () => {
  const { c, sent } = config();
  assert.equal((await handleInterest(JSON.stringify(valid), { ...meta(), origin: 'https://evil.example' }, c)).status, 403);
  assert.equal((await handleInterest(JSON.stringify(valid), { ...meta(), origin: undefined }, c)).status, 403);
  assert.equal((await handleInterest(JSON.stringify(valid), { ...meta(), contentType: 'text/plain' }, c)).status, 415);
  assert.equal((await handleInterest('x'.repeat(20_000), meta('2.2.2.2'), c)).status, 413);
  assert.equal(sent.length, 0);
});

test('bots get a quiet success and nothing is sent', async () => {
  const { c, sent } = config();
  assert.equal((await handleInterest(JSON.stringify({ ...valid, website: 'spam.example' }), meta(), c)).status, 200);
  assert.equal((await handleInterest(JSON.stringify({ ...valid, startedAt: now - 500 }), meta('3.3.3.3'), c)).status, 200);
  assert.equal(sent.length, 0);
});

test('invalid answers come back field by field; HTML in answers is escaped', async () => {
  const { c, sent } = config();
  const r = await handleInterest(JSON.stringify({ ...valid, values: { ...valid.values, email: 'nope' } }), meta(), c);
  assert.equal(r.status, 400);
  assert.equal((r.body.fields as Record<string, string>).email, 'email');
  await handleInterest(JSON.stringify({ ...valid, values: { ...valid.values, building: '<img src=x onerror=alert(1)>' } }), meta('4.4.4.4'), c);
  assert.match(JSON.parse(String(sent[0].init.body)).html, /&lt;img/);
});

test('rate limited after five tries in ten minutes', async () => {
  const { c } = config();
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await handleInterest(JSON.stringify(valid), meta('9.9.9.9'), c)).status);
  assert.deepEqual(codes.slice(5), [429, 429]);
});

test('not configured: nothing sent, and the reply says only that', async () => {
  const { c, sent } = config({ webhookUrl: undefined });
  const r = await handleInterest(JSON.stringify(valid), meta(), c);
  assert.deepEqual(r, { status: 503, body: { ok: false, code: 'not_configured' } });
  assert.equal(sent.length, 0);
  const plain = config({ webhookUrl: 'http://insecure.example' });
  assert.equal((await handleInterest(JSON.stringify(valid), meta(), plain.c)).status, 503, 'webhooks must be https');
});

test('security headers: strict CSP, no framing, HSTS in production', () => {
  const h = securityHeaders(true);
  assert.match(h['Content-Security-Policy'], /default-src 'self'/);
  assert.match(h['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(h['Content-Security-Policy'], /script-src[^;]*unsafe/);
  assert.ok(h['Strict-Transport-Security']);
  assert.equal(securityHeaders(false)['Strict-Transport-Security'], undefined);
});
