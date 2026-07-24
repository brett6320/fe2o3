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
 * Resolve once the required style assets are ready, so the app never renders
 * unstyled (the inline #app-loading spinner shows until then). Waits for every
 * stylesheet <link> to load plus web fonts, bounded by a safety timeout so a
 * stuck asset can't hide the app forever.
 */
function whenStylesReady(): Promise<unknown> {
  const links = Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).map((link) =>
    link.sheet
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          link.addEventListener('load', () => resolve(), { once: true });
          link.addEventListener('error', () => resolve(), { once: true });
        }),
  );
  const fonts = document.fonts?.ready ?? Promise.resolve();
  const ready = Promise.all([fonts, ...links]);
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
