type DockDragOptions = {
  controls: HTMLElement[];
  enabled: () => boolean;
  onMove: (dx: number, dy: number, origin: DOMRect) => void;
  onEnd: () => void;
  host: HTMLElement;
};

export function bindDockDrag({ controls, enabled, onMove, onEnd, host }: DockDragOptions) {
  const removers: (() => void)[] = [];
  let active: { control: HTMLElement; id: number; x: number; y: number; rect: DOMRect; moved: boolean; threshold: number } | null = null;
  const suppressed = new WeakMap<HTMLElement, number>();
  for (const control of controls) {
    const listen = (type: string, handler: EventListener, options?: AddEventListenerOptions) => {
      control.addEventListener(type, handler, options);
      removers.push(() => control.removeEventListener(type, handler, options));
    };
    listen('pointerdown', ((event: PointerEvent) => {
      if (!enabled() || active || !event.isPrimary || event.button !== 0) return;
      suppressed.delete(control);
      active = { control, id: event.pointerId, x: event.clientX, y: event.clientY,
        rect: host.getBoundingClientRect(), moved: false, threshold: event.pointerType === 'touch' ? 10 : 7 };
      control.setPointerCapture(event.pointerId);
    }) as EventListener);
    listen('pointermove', ((event: PointerEvent) => {
      if (!active || event.pointerId !== active.id) return;
      const dx = event.clientX - active.x, dy = event.clientY - active.y;
      if (!active.moved && Math.hypot(dx, dy) < active.threshold) return;
      active.moved = true;
      onMove(dx, dy, active.rect);
    }) as EventListener);
    const finish = ((event: PointerEvent) => {
      if (!active || event.pointerId !== active.id) return;
      const gesture = active;
      active = null;
      if (gesture.moved) {
        suppressed.set(control, Date.now() + 500);
        onEnd();
      }
      if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
    }) as EventListener;
    listen('pointerup', finish);
    listen('pointercancel', finish);
    listen('lostpointercapture', finish);
    listen('click', ((event: MouseEvent) => {
      if (event.detail && Date.now() < (suppressed.get(control) ?? 0)) {
        event.preventDefault(); event.stopImmediatePropagation(); suppressed.delete(control);
      }
    }) as EventListener, { capture: true });
  }
  return () => {
    const gesture = active;
    active = null;
    if (gesture?.control.hasPointerCapture(gesture.id)) gesture.control.releasePointerCapture(gesture.id);
    removers.forEach(remove => remove());
  };
}
