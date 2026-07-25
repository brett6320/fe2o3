import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OrgProvider } from './lib/org-context';
import { ThemeProvider } from './lib/theme';
import { router } from './router';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000 },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');

/**
 * Resolve once the app stylesheet is genuinely *applied* (not merely when a
 * <link> fires load), so the app never renders unstyled — the inline
 * #app-loading spinner shows until then.
 *
 * We poll for a CSS custom property that only index.css defines (`--background`)
 * to resolve on :root. This is race-free and works whether the CSS is a
 * render-blocking <link> or JS-injected (dev), unlike a link load/`.sheet`
 * check which can win the race or miss an injected stylesheet. Bounded by a
 * safety timeout so a missing/404'd stylesheet can't hide the app forever.
 */
function whenStylesReady(): Promise<unknown> {
  const cssApplied = () =>
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim() !== '';
  const cssReady = new Promise<void>((resolve) => {
    const tick = () => {
      if (cssApplied()) resolve();
      else requestAnimationFrame(tick);
    };
    tick();
  });
  const fonts = document.fonts?.ready ?? Promise.resolve();
  const ready = Promise.all([cssReady, fonts]);
  const safety = new Promise((resolve) => setTimeout(resolve, 5000));
  return Promise.race([ready, safety]);
}

whenStylesReady().then(() => {
  // React clears #root on mount, removing the inline loader.
  createRoot(rootEl).render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <OrgProvider>
            <RouterProvider router={router} />
          </OrgProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
});
