import { brand } from '../config/brand';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { clearDraft, downloadCopy, loadDraft, saveDraft } from '../forms/drafts';
import { fieldsFor, validate, validateField, type Audience, type ErrorCode, type FieldDef, type Values } from '../forms/schema';
import { useLanguage } from '../i18n/LanguageProvider';

const ENDPOINT = '/api/interest';
/** the single-file preview has no server: sending is shown as not connected */
declare const __PREVIEW__: boolean;
declare const __STATIC__: boolean;
const PREVIEW = typeof __PREVIEW__ !== 'undefined' && __PREVIEW__;
/** plain file hosting (GitHub Pages): introductions are emailed through a form service */
const STATIC = typeof __STATIC__ !== 'undefined' && __STATIC__;

/** send one introduction by email: Web3Forms when a key is set, otherwise FormSubmit */
async function sendByEmail(subject: string, rows: [string, string][], replyTo: string, honey: string): Promise<'sent' | 'failed'> {
  const fields = Object.fromEntries(rows);
  const key = brand.forms.web3formsKey;
  const res = key
    ? await fetch('https://api.web3forms.com/submit', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ access_key: key, subject, from_name: 'RUKAZ website', replyto: replyTo, botcheck: honey, ...fields }),
    })
    : await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(brand.forms.email)}`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ _subject: subject, _template: 'table', _captcha: 'false', _replyto: replyTo, _honey: honey, ...fields }),
    });
  let body: { success?: boolean | string } = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  return res.ok && (body.success === true || body.success === 'true') ? 'sent' : 'failed';
}
type Delivery = 'checking' | 'connected' | 'not-connected' | 'unknown';
type Note = { kind: 'error' | 'warning' | 'success' | 'info'; text: string } | null;

function Tag({ kind }: { kind: 'success' | 'error' | 'info' }) {
  return (
    <svg className="notice__tag" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {kind === 'success' ? <path d="M8 12.3l2.7 2.7L16 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        : kind === 'error' ? <path d="M12 7.5v5.5M12 16.4v.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          : <path d="M12 11v5.5M12 7.6v.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * One dialog for every audience. Drafts save on this device as you type; the page checks
 * whether online sending is set up before offering Send, and says so plainly if not.
 */
export function InterestDialog({ audience, onClose }: { audience: Audience | null; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const f = t.form;
  const ref = useRef<HTMLDialogElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const honeypot = useRef<HTMLInputElement>(null);
  const startedAt = useRef(0);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, ErrorCode>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [delivery, setDelivery] = useState<Delivery>('checking');
  const [note, setNote] = useState<Note>(null);
  const [status, setStatus] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [focusSummary, setFocusSummary] = useState(0);
  const titleId = useId();
  const introId = useId();
  const defs = useMemo(() => (audience ? fieldsFor(audience) : []), [audience]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (audience && !d.open) {
      const draft = loadDraft(audience);
      setValues(draft ?? {});
      setStatus(draft ? f.draftRestored : '');
      setErrors({});
      setTouched({});
      setState('idle');
      setNote(null);
      setShowSummary(false);
      startedAt.current = Date.now();
      setDelivery(PREVIEW ? 'not-connected' : STATIC ? 'connected' : 'checking');
      d.showModal();
      requestAnimationFrame(() => d.querySelector<HTMLElement>('input:not([tabindex="-1"]), select, textarea')?.focus());
      if (PREVIEW || STATIC) return;
      const ctrl = new AbortController();
      fetch(`${ENDPOINT}/status`, { headers: { accept: 'application/json' }, signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((j: { configured?: boolean }) => setDelivery(j.configured ? 'connected' : 'not-connected'))
        .catch(() => setDelivery('unknown'));
      return () => ctrl.abort();
    }
    if (!audience && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience]);

  useEffect(() => {
    if (!audience || state === 'sent') return;
    const id = window.setTimeout(() => saveDraft(audience, values), 600);
    return () => window.clearTimeout(id);
  }, [values, audience, state]);

  useEffect(() => {
    if (focusSummary) summaryRef.current?.focus();
  }, [focusSummary]);

  const change = useCallback((name: string, value: string | boolean) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      const def = defs.find((d) => d.name === name) ?? (name === 'countryOther' ? defs.find((d) => d.name === 'country') : undefined);
      if (def && (touched[def.name] || errors[def.name])) {
        const e = validateField(def, next[def.name], next);
        setErrors((old) => {
          const copy = { ...old };
          if (e) copy[def.name] = e; else delete copy[def.name];
          return copy;
        });
      }
      return next;
    });
  }, [defs, touched, errors]);

  const blur = (def: FieldDef) => {
    setTouched((p) => ({ ...p, [def.name]: true }));
    const e = validateField(def, values[def.name], values);
    setErrors((old) => {
      const copy = { ...old };
      if (e) copy[def.name] = e; else delete copy[def.name];
      return copy;
    });
  };

  const label = (name: string) => f.fields[name] ?? name;
  const rows = (): [string, string][] => defs.map((d) => {
    let v = values[d.name];
    if (d.kind === 'checkbox') v = v ? '✓' : '';
    else if (d.kind === 'select' && typeof v === 'string') v = f.options[d.name]?.[v] ?? v;
    else if (d.kind === 'country' && typeof v === 'string') v = v === 'other' ? String(values.countryOther ?? '') : f.options.country[v] ?? v;
    return [label(d.name), String(v ?? '')];
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!audience || state === 'sending') return;
    const found = validate(audience, values);
    setErrors(found);
    setTouched(Object.fromEntries(defs.map((d) => [d.name, true])));
    if (Object.keys(found).length) {
      setShowSummary(true);
      setNote(null);
      setFocusSummary((n) => n + 1);
      return;
    }
    setShowSummary(false);
    if (delivery === 'not-connected') {
      setNote({ kind: 'warning', text: `${f.notConnected} ${f.notConnectedDetail}` });
      return;
    }
    setState('sending');
    setNote(null);
    if (STATIC) {
      const honey = honeypot.current?.value ?? '';
      // bots fill the hidden field or answer in seconds: they get a quiet success, nothing is sent
      if (honey || Date.now() - startedAt.current < 3000) { setState('sent'); return; }
      try {
        const replyTo = typeof values.email === 'string' ? values.email : '';
        const result = await sendByEmail(`RUKAZ website: ${f.dialogTitle[audience]} (${lang.toUpperCase()})`, [...rows(), ["Language", lang === "ar" ? "Arabic" : "English"]], replyTo, honey);
        if (result === 'sent') { clearDraft(audience); setState('sent'); return; }
        setState('idle');
        setNote({ kind: 'error', text: f.deliveryFailed });
      } catch {
        setState('idle');
        setNote({ kind: 'error', text: f.network });
      }
      return;
    }
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ audience, lang, values, startedAt: startedAt.current, website: honeypot.current?.value ?? '' }),
      });
      let body: { ok?: boolean; code?: string; fields?: Record<string, ErrorCode> } = {};
      try { body = await res.json(); } catch { /* not JSON */ }
      if (res.ok && body.ok) {
        clearDraft(audience);
        setState('sent');
        return;
      }
      setState('idle');
      if (res.status === 400 && body.fields) {
        setErrors(body.fields);
        setShowSummary(true);
        setNote({ kind: 'error', text: f.invalid });
        setFocusSummary((n) => n + 1);
      } else if (res.status === 429) setNote({ kind: 'error', text: f.rateLimited });
      else if (res.status === 503 && body.code === 'not_configured') {
        setDelivery('not-connected');
        setNote({ kind: 'warning', text: `${f.notConnected} ${f.notConnectedDetail}` });
      } else if (body.code === 'rejected') setNote({ kind: 'error', text: f.rejected });
      else setNote({ kind: 'error', text: f.deliveryFailed });
    } catch {
      setState('idle');
      setNote({ kind: 'error', text: f.network });
    }
  };

  const errorList = Object.entries(errors);
  return (
    <dialog ref={ref} className="interest-dialog" aria-labelledby={titleId} aria-describedby={introId} onClose={onClose}
      onCancel={(e) => { if (state === 'sending') e.preventDefault(); }}
      onClick={(e) => { if (e.target === ref.current && state !== 'sending') ref.current?.close(); }}>
      {audience ? (
        <>
          <div className="dialog__head">
            <div>
              <h2 id={titleId}>{f.dialogTitle[audience]}</h2>
              <p id={introId}>{f.dialogIntro[audience]}</p>
            </div>
            <button type="button" className="dialog__close" aria-label={f.close} onClick={() => ref.current?.close()} disabled={state === 'sending'}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="dialog__body">
            {state === 'sent' ? (
              <div role="status">
                <div className="notice notice--success"><Tag kind="success" /><span><strong>{f.success}</strong> {f.successDetail}</span></div>
                <div className="form-actions"><button type="button" className="pill pill--primary" onClick={() => ref.current?.close()} autoFocus>{f.done}</button></div>
              </div>
            ) : (
              <form noValidate onSubmit={submit} aria-busy={state === 'sending'}>
                {delivery === 'checking' ? <p className="form-status" role="status">{f.checking}</p>
                  : delivery === 'not-connected' ? <div className="notice notice--warning" id="delivery-note" role="status"><Tag kind="error" /><span><strong>{f.notConnected}</strong> {f.notConnectedDetail}</span></div>
                    : delivery === 'unknown' ? <div className="notice notice--info" role="status"><Tag kind="info" /><span>{f.statusUnknown}</span></div> : null}
                {status ? <p className="form-status" role="status">{status}</p> : null}
                {showSummary && errorList.length ? (
                  <div className="notice notice--error" tabIndex={-1} ref={summaryRef} role="alert">
                    <Tag kind="error" />
                    <div>
                      <strong>{f.errorSummary(errorList.length)}</strong>
                      <ul>{errorList.map(([name, code]) => <li key={name}><a href={`#f-${name}`}>{label(name)}: {f.errors[code]}</a></li>)}</ul>
                    </div>
                  </div>
                ) : null}
                <div className="form-grid">
                  {defs.map((d) => (
                    <Field key={d.name} def={d} value={values[d.name]} otherValue={String(values.countryOther ?? '')}
                      error={touched[d.name] || showSummary ? errors[d.name] : undefined} onChange={change} onBlur={() => blur(d)} />
                  ))}
                </div>
                <div className="hp" aria-hidden="true"><label>Website<input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" /></label></div>
                {note ? <div className={`notice notice--${note.kind}`} role={note.kind === 'error' ? 'alert' : 'status'}><Tag kind={note.kind === 'success' ? 'success' : note.kind === 'info' ? 'info' : 'error'} /><span>{note.text}</span></div> : null}
                <div className="form-actions">
                  <button type="submit" className="pill pill--primary" disabled={state === 'sending' || delivery === 'not-connected' || delivery === 'checking'} aria-describedby={delivery === 'not-connected' ? 'delivery-note' : 'reply-note'}>
                    {state === 'sending' ? f.sending : f.send}
                  </button>
                  <button type="button" className="pill pill--secondary" onClick={() => setStatus(saveDraft(audience, values) ? f.draftSaved : '')}>{f.saveDraft}</button>
                  <span className="spacer" />
                  {delivery !== 'connected' && !PREVIEW ? <button type="button" className="link-button" onClick={() => downloadCopy(`rukaz-${audience}.txt`, rows())}>{f.download}</button> : null}
                  <button type="button" className="link-button" onClick={() => { clearDraft(audience); setValues({}); setErrors({}); setTouched({}); setStatus(''); setShowSummary(false); }}>{f.clearDraft}</button>
                </div>
                <p className="form-reply" id="reply-note">{f.reply}</p>
                {state === 'sending' ? <div className="loading-line" role="progressbar" aria-label={f.sending} /> : null}
              </form>
            )}
          </div>
        </>
      ) : null}
    </dialog>
  );
}

function Field({ def, value, otherValue, error, onChange, onBlur }: {
  def: FieldDef; value: Values[string]; otherValue: string; error?: ErrorCode;
  onChange: (name: string, v: string | boolean) => void; onBlur: () => void;
}) {
  const { t } = useLanguage();
  const f = t.form;
  const id = `f-${def.name}`, errId = `${id}-error`, hintId = `${id}-hint`;
  const label = f.fields[def.name] ?? def.name;
  const hint = def.name === 'intro' ? f.fields.introHint : def.name === 'profile' ? f.fields.profileHint : '';
  const describedBy = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  const str = typeof value === 'string' ? value : '';
  const common = { id, name: def.name, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, 'aria-required': def.required || undefined, onBlur };
  if (def.kind === 'checkbox') {
    return (
      <div className="field field--wide">
        <label className="check" htmlFor={id}>
          <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(def.name, e.target.checked)} />
          <span>{label}</span>
        </label>
        {error ? <p className="field__error" id={errId}>{f.errors[error]}</p> : null}
      </div>
    );
  }
  const opts = def.kind === 'country' ? f.options.country : f.options[def.name];
  return (
    <div className={`field${def.wide ? ' field--wide' : ''}`}>
      <label className="field__label" htmlFor={id}><span>{label}</span><span className="field__req">{def.required ? f.required : f.optional}</span></label>
      {def.kind === 'textarea' ? (
        <textarea {...common} className="textarea" value={str} maxLength={(def.max ?? 2000) + 200} onChange={(e) => onChange(def.name, e.target.value)} />
      ) : def.kind === 'select' || def.kind === 'country' ? (
        <select {...common} className="select" value={str} autoComplete={def.kind === 'country' ? 'off' : undefined} onChange={(e) => onChange(def.name, e.target.value)}>
          <option value="">{f.choose}</option>
          {def.options!.map((o) => <option key={o} value={o}>{opts?.[o] ?? o}</option>)}
        </select>
      ) : (
        <input {...common} className="input" type={def.kind === 'email' ? 'email' : def.kind === 'url' ? 'url' : 'text'} inputMode={def.kind === 'email' ? 'email' : def.kind === 'url' ? 'url' : undefined}
          autoComplete={def.autoComplete} dir={def.kind === 'email' || def.kind === 'url' ? 'ltr' : undefined} value={str} maxLength={(def.max ?? 300) + 50} onChange={(e) => onChange(def.name, e.target.value)} />
      )}
      {def.kind === 'country' && str === 'other' ? (
        <div style={{ marginBlockStart: 10 }}>
          <label className="field__label" htmlFor="f-countryOther"><span>{f.fields.countryOther}</span></label>
          <input id="f-countryOther" className="input" value={otherValue} maxLength={120} autoComplete="country-name" onChange={(e) => onChange('countryOther', e.target.value)} onBlur={onBlur} />
        </div>
      ) : null}
      {hint ? <p className="field__hint" id={hintId}>{hint}</p> : null}
      {def.kind === 'textarea' && def.max ? <p className="field__count">{f.chars(str.length, def.max)}</p> : null}
      {error ? <p className="field__error" id={errId}>{f.errors[error]}</p> : null}
    </div>
  );
}
