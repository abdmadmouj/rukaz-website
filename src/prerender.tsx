import { renderToString } from 'react-dom/server';
import { RukazSite } from './components/RukazSite';
import { ar } from './content/ar';
import { en } from './content/en';

/** the page as HTML, for search engines, link previews and reading before scripts run */
export function render(lang: 'en' | 'ar') {
  return { html: renderToString(<RukazSite lang={lang} />), meta: (lang === 'ar' ? ar : en).meta };
}
