type AutoReaderOptions = {
  page: Window;
  target: () => HTMLElement | null;
  onEnd: () => Promise<boolean>;
  onChange: (running: boolean, speed: number) => void;
};

/** 按时间滚动，保留不足一像素的位移；暂停后不保留动画或后台定时器。 */
export function createAutoReader({ page, target, onEnd, onChange }: AutoReaderOptions) {
  let running = false, speed = 24, frame = 0, previous = 0, fraction = 0, generation = 0;
  let lastTarget: HTMLElement | null = null;
  try {
    const saved = Number(page.localStorage.getItem('meow-reading-speed'));
    if ([16, 24, 40, 64].includes(saved)) speed = saved;
  } catch (_) { /* 可选偏好 */ }
  const pause = () => {
    const wasActive = running || frame !== 0;
    running = false;
    generation++;
    page.cancelAnimationFrame(frame);
    frame = previous = fraction = 0;
    lastTarget = null;
    if (wasActive) onChange(running, speed);
  };
  const tick = async (time: number) => {
    frame = 0;
    if (!running) return;
    const element = target();
    if (!element || !element.isConnected || page.document.hidden) { pause(); return; }
    if (element !== lastTarget) { previous = 0; fraction = 0; lastTarget = element; }
    const elapsed = previous ? Math.min(100, time - previous) : 0;
    previous = time;
    const bottom = element.scrollHeight - element.clientHeight;
    if (element.scrollTop >= bottom - 1) {
      const token = generation;
      let next = false;
      try { next = await onEnd(); } catch (_) { /* 停在当前阅读位置 */ }
      if (!running || token !== generation) return;
      if (!next) { pause(); return; }
      previous = fraction = 0;
    } else {
      fraction += speed * elapsed / 1000;
      const pixels = Math.floor(fraction);
      if (pixels) {
        element.scrollTop += pixels;
        fraction -= pixels;
      }
    }
    if (running) frame = page.requestAnimationFrame(tick);
  };
  return {
    pause,
    get running() { return running; },
    get speed() { return speed; },
    start() {
      if (running || !target()) return;
      running = true;
      previous = fraction = 0;
      generation++;
      onChange(running, speed);
      frame = page.requestAnimationFrame(tick);
    },
    setSpeed(value: number) {
      if (![16, 24, 40, 64].includes(value)) return;
      speed = value;
      try { page.localStorage.setItem('meow-reading-speed', String(speed)); } catch (_) { /* 可选偏好 */ }
      onChange(running, speed);
    },
  };
}
