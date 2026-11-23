import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ar } from '../src/content/ar';
import { en } from '../src/content/en';
import { AUDIENCES, clean, fieldsFor, validate } from '../src/forms/schema';

const base = { fullName: 'Lina Haddad', email: 'lina@example.com', company: 'Haddad Group', country: 'JO', intro: 'We would like to explore a new venture.', consent: true };

test('a complete group introduction passes; missing fields are named', () => {
  const ok = validate('group', { ...base, sector: 'Retail', role: 'decide', asset: 'A chain of stores we want to take online.', timing: 'quarter' });
  assert.deepEqual(ok, {});
  const bad = validate('group', { fullName: 'x' });
  assert.equal(bad.email, 'required');
  assert.equal(bad.company, 'required');
  assert.equal(bad.consent, 'consent');
});

test('header injection, control characters and bad choices are refused', () => {
  const v = { ...base, forWho: 'group', timing: 'now', focus: 'Our margins and the sales team.' };
  assert.deepEqual(validate('diagnostic', v), {});
  assert.equal(validate('diagnostic', { ...v, fullName: 'Lina\r\nBcc: x@y.z' }).fullName, 'choice');
  assert.equal(validate('diagnostic', { ...v, email: 'a@b.c\nbcc:x@y.z' }).email, 'email');
  assert.equal(validate('diagnostic', { ...v, timing: 'yesterday' }).timing, 'choice');
  assert.equal(validate('diagnostic', { ...v, intro: 'short' }).intro, 'tooShort');
  assert.equal(validate('talent', { ...base, discipline: 'design', experience: 'Ten years of design.', profile: 'javascript:alert(1)' }).profile, 'url');
});

test('clean keeps only known fields', () => {
  const out = clean('founder', { ...base, stage: 'growing', building: 'A logistics app.', problem: 'Late deliveries.', admin: 'true', __proto__x: 'y' } as never);
  assert.equal('admin' in out, false);
  assert.equal(out.consent, 'yes');
});

test('every field and option has an English and an Arabic label', () => {
  for (const a of AUDIENCES) {
    assert.ok(en.form.dialogTitle[a] && ar.form.dialogTitle[a], a);
    for (const f of fieldsFor(a)) {
      assert.ok(en.form.fields[f.name], `en ${f.name}`);
      assert.ok(ar.form.fields[f.name], `ar ${f.name}`);
      if (f.kind === 'select') for (const o of f.options!) {
        assert.ok(en.form.options[f.name]?.[o], `en ${f.name}.${o}`);
        assert.ok(ar.form.options[f.name]?.[o], `ar ${f.name}.${o}`);
      }
    }
  }
});

test('the new slogan is used, the old one is gone', () => {
  assert.match(en.meta.title, /Value, brought to the surface\./);
  assert.equal(en.connect.title.join(' '), 'Value, brought to the surface.');
  assert.equal(ar.connect.title.join(' '), 'قيمة نُخرجها إلى السطح.');
  assert.doesNotMatch(JSON.stringify(en), /found and built/);
  assert.equal(en.team.published, false);
});
