import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ar } from '../src/content/ar';
import { en } from '../src/content/en';
import { render } from '../src/prerender';

test('the page is real HTML before any script runs, in both languages', () => {
  for (const [lang, t] of [['en', en], ['ar', ar]] as const) {
    const { html } = render(lang);
    for (const h of [t.hero.line1, t.who.title, t.ways.title, t.process.title, t.terms.title, t.contact.title]) {
      assert.ok(html.includes(h.replace(/&/g, '&amp;').replace(/'/g, '&#x27;')), `${lang}: "${h}" is in the HTML`);
    }
    for (const s of t.process.steps) assert.ok(html.includes(s.title), `${lang}: gate "${s.title}"`);
    assert.ok(!/visibility:\s*hidden/.test(html), `${lang}: nothing is hidden from screen readers`);
  }
});
