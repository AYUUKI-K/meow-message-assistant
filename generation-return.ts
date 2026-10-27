type Output = { id: number; text: string; swipe: number };
type Options = {
  page: Window; identity: () => string; enabled: () => boolean;
  output: () => Output | null; returnTo: (id: number) => void;
};

/** Return once after a real, completed output; cancelled or quiet runs never move the page. */
export function createGenerationReturn({ page, identity, enabled, output, returnTo }: Options) {
  let active: { key: string; before: Output | null } | null = null;
  let timer = 0;
  const cancel = () => { active = null; page.clearTimeout(timer); timer = 0; };
  return {
    start(type?: string, _options?: unknown, dryRun?: boolean) {
      cancel();
      if (dryRun || type === 'quiet' || type === 'impersonate') return;
      active = { key: identity(), before: output() };
    },
    complete() {
      const run = active;
      active = null;
      if (!run || !enabled() || run.key !== identity()) return;
      const after = output();
      if (!after || !after.text.trim() || (run.before?.id === after.id && run.before.text === after.text && run.before.swipe === after.swipe)) return;
      page.clearTimeout(timer);
      timer = page.setTimeout(() => {
        timer = 0;
        if (enabled() && run.key === identity() && output()?.id === after.id) returnTo(after.id);
      }, 250);
    },
    cancel,
  };
}
