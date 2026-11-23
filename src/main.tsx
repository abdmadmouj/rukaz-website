import { createRoot, hydrateRoot } from 'react-dom/client';
import { RukazSite } from './components/RukazSite';
import './styles/site.css';
import { applyTheme, savedTheme } from './theme/theme';

// the visitor's light or dark choice, before the page comes to life
applyTheme(savedTheme(), false);

// a reload starts the story from the top (the sculpture is built for the opening), unless the
// address points at a section (#process and the like)
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
if (!location.hash) window.scrollTo(0, 0);

const root = document.getElementById('root')!;
// the live site ships the page pre-rendered (readable before any script runs); bring it to life
if (root.firstElementChild) hydrateRoot(root, <RukazSite />);
else createRoot(root).render(<RukazSite />);
