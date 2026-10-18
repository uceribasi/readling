/** Shared Tailwind class strings so screens stay visually consistent. */
export const ui = {
  primaryButton:
    'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50',
  secondaryButton:
    'inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:bg-stone-800',
  ghostButton:
    'inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-sm text-stone-500 transition hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100',
  input:
    'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100',
  label: 'mb-1 block text-sm font-medium text-stone-700 dark:text-stone-300',
  card: 'rounded-xl border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900',
  muted: 'text-sm text-stone-500 dark:text-stone-400',
  pageTitle: 'text-2xl font-semibold tracking-tight text-stone-900 dark:text-stone-50',
}
