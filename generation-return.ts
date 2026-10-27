type Output = { id: number; text: string; swipe: number };
type Options = {
  page: Window; identity: () => string; enabled: () => boolean;
  output: (id?: number) => Output | null; returnTo: (id: number) => boolean;
};

/** Prefer message receipt and final rendering; generation end is only a fallback. */
export function createGenerationReturn({ page, identity, enabled, output, returnTo }: Options) {
  let active: { key: string; before: Output | null } | null = null;
  let pending: { key: string; id: number; attempts: number } | null = null;
  let delivered = '';
  let blocked = false;
  let timer = 0;
  const signature = (key: string, message: Output) => JSON.stringify([key, message.id, message.text, message.swipe]);
  const cancel = () => {
    active = pending = null;
    blocked = false;
    page.clearTimeout(timer); timer = 0;
  };
  const execute = () => {
    timer = 0;
    const request = pending;
    if (!request) return;
    if (blocked || !enabled() || request.key !== identity()) { pending = null; return; }
    const message = output(request.id);
    if (message?.text.trim()) {
      const key = signature(request.key, message);
      if (key === delivered) { pending = null; return; }
      if (returnTo(message.id)) { delivered = key; pending = null; return; }
    }
    // The event can precede DOM insertion, especially with non-streaming output.
    if (++request.attempts < 4) timer = page.setTimeout(execute, 100);
    else pending = null;
  };
  const queue = (id: number) => {
    if (!enabled() || blocked || !Number.isSafeInteger(id) || id < 0) return;
    page.clearTimeout(timer);
    pending = { key: identity(), id, attempts: 0 };
    timer = page.setTimeout(execute, 100);
  };
  return {
    start(type?: string, _options?: unknown, dryRun?: boolean) {
      cancel(); delivered = '';
      blocked = !!dryRun || type === 'quiet' || type === 'impersonate';
      if (!blocked) active = { key: identity(), before: output() };
    },
    received(id?: number, type?: string) {
      if (type === 'first_message' || type === 'quiet' || type === 'impersonate') return;
      // MESSAGE_RECEIVED carries an actual index; GENERATION_ENDED may carry chat.length.
      const target = typeof id === 'number' ? id : output()?.id;
      if (target !== undefined) queue(target);
    },
    rendered(id: number) {
      if (pending?.id === id && pending.key === identity()) queue(id);
    },
    complete() {
      const run = active;
      active = null;
      if (pending || !run || blocked || !enabled() || run.key !== identity()) return;
      const after = output();
      if (!after || !after.text.trim() || (run.before?.id === after.id && run.before.text === after.text && run.before.swipe === after.swipe)) return;
      if (signature(run.key, after) !== delivered) queue(after.id);
    },
    stop() { cancel(); blocked = true; },
    cancel,
  };
}
