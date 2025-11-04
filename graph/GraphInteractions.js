export class GraphInteractions {
  constructor() {
    this.cleanupTooltipHandlers = null;
  }

  setupZoomAndPan(svg, contentGroup) {
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    function updateTransform() {
      contentGroup.setAttribute(
        "transform",
        `translate(${translateX}, ${translateY}) scale(${scale})`,
      );
    }

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const svgX = (mouseX - translateX) / scale;
      const svgY = (mouseY - translateY) / scale;
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(10, scale * zoomFactor));
      translateX = mouseX - svgX * newScale;
      translateY = mouseY - svgY * newScale;
      scale = newScale;
      updateTransform();
    });

    svg.addEventListener("mousedown", (e) => {
      if (e.target === svg || e.target === contentGroup) {
        isPanning = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        svg.style.cursor = "grabbing";
      }
    });

    svg.addEventListener("mousemove", (e) => {
      if (isPanning) {
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        updateTransform();
      }
    });

    svg.addEventListener("mouseup", () => {
      isPanning = false;
      svg.style.cursor = "grab";
    });

    svg.addEventListener("mouseleave", () => {
      isPanning = false;
      svg.style.cursor = "grab";
    });
  }

  setupPersistentTooltips(svg) {
    this.clearAllTooltips();

    let persistentTooltip = null;

    const show = (text, x, y) => {
      hide();

      persistentTooltip = document.createElement("div");
      persistentTooltip.className = "persistent-tooltip";
      persistentTooltip.style.cssText = `
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        background: var(--paper);
        border: 2px solid var(--ink);
        padding: 8px 12px;
        font-family: monospace;
        font-size: 12px;
        white-space: pre-wrap;
        max-width: 400px;
        z-index: 1000;
        pointer-events: auto;
        box-shadow: 4px 4px 0 rgba(0,0,0,0.1);
        user-select: text;
      `;
      persistentTooltip.textContent = text;
      document.body.appendChild(persistentTooltip);

      const rect = persistentTooltip.getBoundingClientRect();
      if (rect.right > window.innerWidth - 10) {
        persistentTooltip.style.left = `${x - rect.width - 20}px`;
      }
      if (rect.bottom > window.innerHeight - 10) {
        persistentTooltip.style.top = `${y - rect.height - 20}px`;
      }
    };

    const hide = () => {
      if (persistentTooltip) {
        persistentTooltip.remove();
        persistentTooltip = null;
      }
    };

    const keyHandler = (e) => {
      if (e.key === "Escape") hide();
    };

    const clickHandler = (e) => {
      if (e.target === svg) hide();
    };

    document.addEventListener("keydown", keyHandler);
    svg.addEventListener("click", clickHandler);

    this.cleanupTooltipHandlers = () => {
      hide();
      document.removeEventListener("keydown", keyHandler);
      svg.removeEventListener("click", clickHandler);
    };

    return show;
  }

  clearAllTooltips() {
    document.querySelectorAll(".persistent-tooltip").forEach((el) => el.remove());

    if (this.cleanupTooltipHandlers) {
      this.cleanupTooltipHandlers();
      this.cleanupTooltipHandlers = null;
    }
  }
}
