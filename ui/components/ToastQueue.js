/**
 * Toast notification system
 */

import { APP_CONFIG } from "../../config.js";

export class ToastQueue {
  constructor() {
    this.container = null;
    this.timers = [];
  }

  show(message, tone = "neutral") {
    const container = this.ensureContainer();
    const toast = document.createElement("div");
    toast.className = `copy-toast copy-toast-${tone}`;
    toast.textContent = message;

    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("visible");
    });

    const timeout = setTimeout(() => {
      toast.classList.remove("visible");
      setTimeout(() => {
        toast.remove();
      }, 220);
    }, APP_CONFIG.FEEDBACK.TOAST_DURATION);

    this.timers.push(timeout);
    if (this.timers.length > APP_CONFIG.FEEDBACK.MAX_TOASTS) {
      const removedTimeout = this.timers.shift();
      if (removedTimeout) {
        clearTimeout(removedTimeout);
      }
    }
  }

  ensureContainer() {
    if (this.container && document.body.contains(this.container)) {
      return this.container;
    }
    const container = document.createElement("div");
    container.className = "copy-toast-container";
    document.body.appendChild(container);
    this.container = container;
    return container;
  }
}
