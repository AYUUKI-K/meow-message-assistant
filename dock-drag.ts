type DockDragOptions = {
  controls: HTMLElement[];
  enabled: () => boolean;
  onMove: (dx: number, dy: number, origin: DOMRect) => void;
  onEnd: () => void;
  host: HTMLElement;
  verticalOnly?: () => boolean;
  touchHoldMs?: (control: HTMLElement) => number;
};

export function bindDockDrag({ controls, enabled, onMove, onEnd, host, verticalOnly = () => false, touchHoldMs = () => 0 }: DockDragOptions) {
  const removers: (() => void)[] = [];
  let active: { control: HTMLElement; id: number; x: number; y: number; rect: DOMRect; hitRect: DOMRect;
    moved: boolean; cancelled: boolean; threshold: number; started: number; hold: number } | null = null;
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
        rect: host.getBoundingClientRect(), hitRect: control.getBoundingClientRect(), moved: false, cancelled: false,
        threshold: event.pointerType === 'touch' ? 12 : 7, started: Date.now(),
        hold: event.pointerType === 'touch' ? touchHoldMs(control) : 0 };
      control.setPointerCapture(event.pointerId);
    }) as EventListener);
    listen('pointermove', ((event: PointerEvent) => {
      if (!active || event.pointerId !== active.id || active.cancelled) return;
      const dx = event.clientX - active.x, dy = event.clientY - active.y;
      if (!active.moved && Math.hypot(dx, dy) < active.threshold) return;
      if (!active.moved && ((verticalOnly() && Math.abs(dx) > Math.abs(dy)) || Date.now() - active.started < active.hold)) {
        active.cancelled = true;
        return;
      }
      active.moved = true;
      onMove(dx, dy, active.rect);
    }) as EventListener);
    const finish = ((event: PointerEvent) => {
      if (!active || event.pointerId !== active.id) return;
      const gesture = active;
      active = null;
      const rect = gesture.hitRect;
      const outside = event.clientX < rect.left - 4 || event.clientX > rect.right + 4 ||
        event.clientY < rect.top - 4 || event.clientY > rect.bottom + 4;
      if (gesture.moved || gesture.cancelled || event.type !== 'pointerup' || outside) {
        suppressed.set(control, Date.now() + 500);
      }
      if (gesture.moved) onEnd();
      if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
    }) as EventListener;
    listen('pointerup', finish);
    listen('pointercancel', finish);
    listen('lostpointercapture', finish);
    listen('click', ((event: MouseEvent) => {
      if (Date.now() < (suppressed.get(control) ?? 0)) {
        event.preventDefault(); event.stopImmediatePropagation(); suppressed.delete(control);
      }
    }) as EventListener, { capture: true });
    listen('keydown', ((event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') suppressed.delete(control);
    }) as EventListener);
  }
  return () => {
    const gesture = active;
    active = null;
    if (gesture?.control.hasPointerCapture(gesture.id)) gesture.control.releasePointerCapture(gesture.id);
    removers.forEach(remove => remove());
  };
}
