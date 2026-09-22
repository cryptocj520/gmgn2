import {
  PANEL_SIZE_LEVELS,
  normalizePanelPosition,
  normalizePanelSize,
} from "../../shared/panel-preferences.js";

const VIEWPORT_MARGIN = 12;
const KEYBOARD_STEP = 16;

export class PanelLayoutController {
  constructor({ panel, dragHandle, shrinkButton, growButton, onChange }) {
    this.panel = panel;
    this.dragHandle = dragHandle;
    this.shrinkButton = shrinkButton;
    this.growButton = growButton;
    this.onChange = onChange;
    this.size = PANEL_SIZE_LEVELS[0];
    this.position = null;
    this.drag = null;
    this.frame = 0;

    this.handlePointerDown = (event) => this.onPointerDown(event);
    this.handlePointerMove = (event) => this.onPointerMove(event);
    this.handlePointerUp = (event) => this.onPointerUp(event);
    this.handleKeyDown = (event) => this.onKeyDown(event);
    this.handleResize = () => this.scheduleClamp();

    dragHandle.addEventListener("pointerdown", this.handlePointerDown);
    dragHandle.addEventListener("pointermove", this.handlePointerMove);
    dragHandle.addEventListener("pointerup", this.handlePointerUp);
    dragHandle.addEventListener("pointercancel", this.handlePointerUp);
    dragHandle.addEventListener("keydown", this.handleKeyDown);
    shrinkButton.addEventListener("click", () => this.stepSize(-1));
    growButton.addEventListener("click", () => this.stepSize(1));
    window.addEventListener("resize", this.handleResize);
  }

  apply(settings = {}) {
    this.size = normalizePanelSize(settings.panelSize);
    this.panel.dataset.size = this.size;
    this.updateButtons();
    if (this.drag) return;
    this.position = normalizePanelPosition(settings.panelPosition);
    this.scheduleClamp();
  }

  stepSize(delta) {
    const currentIndex = PANEL_SIZE_LEVELS.indexOf(this.size);
    const nextIndex = Math.max(0, Math.min(PANEL_SIZE_LEVELS.length - 1, currentIndex + delta));
    const nextSize = PANEL_SIZE_LEVELS[nextIndex];
    if (nextSize === this.size) return;

    this.size = nextSize;
    this.panel.dataset.size = nextSize;
    this.updateButtons();
    this.scheduleClamp(() => this.persist({ panelSize: nextSize, panelPosition: this.position }));
  }

  onPointerDown(event) {
    if (event.button !== 0 || event.target.closest("button, a, input, select, label")) return;
    const rect = this.panel.getBoundingClientRect();
    this.position = { x: rect.left, y: rect.top };
    this.drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    this.applyPosition(this.position);
    this.panel.classList.add("dragging");
    this.dragHandle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.position = this.clampPosition({
      x: event.clientX - this.drag.offsetX,
      y: event.clientY - this.drag.offsetY,
    });
    this.applyPosition(this.position);
  }

  onPointerUp(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    this.panel.classList.remove("dragging");
    if (this.dragHandle.hasPointerCapture(event.pointerId)) {
      this.dragHandle.releasePointerCapture(event.pointerId);
    }
    this.persist({ panelPosition: this.position });
  }

  onKeyDown(event) {
    if (event.target !== this.dragHandle || !event.key.startsWith("Arrow")) return;
    const directions = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const [horizontal, vertical] = directions[event.key] || [0, 0];
    const rect = this.panel.getBoundingClientRect();
    const step = event.shiftKey ? KEYBOARD_STEP * 3 : KEYBOARD_STEP;
    this.position = this.clampPosition({
      x: rect.left + horizontal * step,
      y: rect.top + vertical * step,
    });
    this.applyPosition(this.position);
    this.persist({ panelPosition: this.position });
    event.preventDefault();
  }

  scheduleClamp(afterClamp) {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      if (this.position) {
        this.position = this.clampPosition(this.position);
        this.applyPosition(this.position);
      } else {
        this.applyPosition(null);
      }
      afterClamp?.();
    });
  }

  clampPosition(position) {
    const rect = this.panel.getBoundingClientRect();
    const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    return {
      x: Math.round(Math.min(maxX, Math.max(VIEWPORT_MARGIN, position.x))),
      y: Math.round(Math.min(maxY, Math.max(VIEWPORT_MARGIN, position.y))),
    };
  }

  applyPosition(position) {
    if (!position) {
      this.panel.style.removeProperty("left");
      this.panel.style.removeProperty("top");
      this.panel.style.removeProperty("right");
      return;
    }
    this.panel.style.left = `${position.x}px`;
    this.panel.style.top = `${position.y}px`;
    this.panel.style.right = "auto";
  }

  updateButtons() {
    const index = PANEL_SIZE_LEVELS.indexOf(this.size);
    this.shrinkButton.disabled = index === 0;
    this.growButton.disabled = index === PANEL_SIZE_LEVELS.length - 1;
    this.shrinkButton.setAttribute("aria-label", `缩小面板，当前${sizeLabel(this.size)}`);
    this.growButton.setAttribute("aria-label", `放大面板，当前${sizeLabel(this.size)}`);
  }

  persist(patch) {
    Promise.resolve(this.onChange(patch)).catch(() => undefined);
  }
}

function sizeLabel(size) {
  return { small: "小尺寸", medium: "中尺寸", large: "大尺寸" }[size] || "小尺寸";
}
