// A local, audio-reactive light sculpture. No images or external rendering services.
(() => {
  class KadyVisual {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas?.getContext("2d");
      if (!this.ctx) return;
      this.state = "idle";
      this.targetLevel = 0;
      this.level = 0;
      this.width = 0;
      this.height = 0;
      this.lastDraw = 0;
      this.dirty = true;
      this.motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.motionPreference.addEventListener("change", () => { this.dirty = true; });
      this.themeObserver = new MutationObserver(() => { this.dirty = true; });
      this.themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme"]});
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();
      this.tick = (time) => {
        if (this.destroyed) return;
        this.frame = requestAnimationFrame(this.tick);
        if (document.hidden || !this.canvas.clientWidth || time - this.lastDraw < 33) return;
        const reduced = this.motionPreference.matches;
        if (reduced && !this.dirty) return;
        this.lastDraw = time;
        this.dirty = false;
        this.level += (this.targetLevel - this.level) * 0.15;
        this.draw(reduced ? 0 : time / 1000);
      };
      this.frame = requestAnimationFrame(this.tick);
    }

    resize() {
      const bounds = this.canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      this.width = bounds.width;
      this.height = bounds.height;
      this.canvas.width = Math.round(bounds.width * ratio);
      this.canvas.height = Math.round(bounds.height * ratio);
      this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      this.dirty = true;
    }

    setState(state) {
      if (this.state === state) return;
      this.state = state;
      this.targetLevel = 0;
      this.dirty = true;
    }

    setLevel(level) { this.targetLevel = Math.max(0, Math.min(1, level)); }

    draw(time) {
      const ctx = this.ctx;
      const light = document.documentElement.dataset.theme === "light";
      const talking = this.state === "speaking";
      const hearing = this.state === "hearing";
      const thinking = this.state === "thinking";
      const engaged = this.state !== "idle" && this.state !== "error";
      const energy = talking ? 0.22 + this.level * 0.78 : hearing ? this.level * 0.7 : 0.04;
      const radius = Math.min(this.width * 0.255, this.height * 0.335);
      const x = this.width / 2;
      const y = this.height * 0.475 + Math.sin(time * 0.75) * 3;
      const breathe = 1 + Math.sin(time * 1.1) * 0.018 + energy * 0.04;
      const delta = Math.max(0, Math.min(0.05, time - (this.previousTime ?? time)));
      this.previousTime = time;
      this.rotation = (this.rotation || 0) + delta * (thinking ? 0.42 : talking ? 0.23 : 0.10);
      const rotation = this.rotation;
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(breathe, breathe);

      const halo = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 1.55);
      halo.addColorStop(0, `rgba(133,104,255,${light ? 0.13 : 0.20})`);
      halo.addColorStop(0.5, `rgba(77,209,217,${0.025 + energy * 0.03})`);
      halo.addColorStop(1, "rgba(98,100,240,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(-radius * 1.6, -radius * 1.6, radius * 3.2, radius * 3.2);

      // Thin inclined orbits make the silhouette open and asymmetric.
      for (let orbit = 0; orbit < 2; orbit++) {
        ctx.save();
        ctx.rotate(orbit === 0 ? -0.38 : 0.56);
        ctx.strokeStyle = orbit === 0 ? "rgba(119,135,240,.17)" : "rgba(54,193,197,.13)";
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius * 1.34, radius * (0.41 + orbit * 0.12), 0, 0, Math.PI * 2);
        ctx.stroke();
        const angle = rotation * 1.1 + orbit * Math.PI;
        const dotX = Math.cos(angle) * radius * 1.34;
        const dotY = Math.sin(angle) * radius * (0.41 + orbit * 0.12);
        ctx.fillStyle = orbit === 0 ? "#b8acff" : "#7de2df";
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = engaged ? 14 : 7;
        ctx.beginPath();
        ctx.arc(dotX, dotY, engaged ? 2.4 : 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const body = ctx.createRadialGradient(-radius * 0.35, -radius * 0.45, radius * 0.04, 0, 0, radius);
      body.addColorStop(0, light ? "rgba(222,212,255,.87)" : "rgba(167,137,247,.65)");
      body.addColorStop(0.45, light ? "rgba(148,133,232,.58)" : "rgba(78,63,154,.64)");
      body.addColorStop(0.8, light ? "rgba(86,163,187,.33)" : "rgba(21,119,135,.50)");
      body.addColorStop(1, light ? "rgba(96,114,177,.10)" : "rgba(37,43,92,.20)");
      ctx.fillStyle = body;
      ctx.beginPath();
      for (let point = 0; point <= 120; point++) {
        const a = point / 120 * Math.PI * 2;
        const distortion = Math.sin(a * 3 + time * 0.6) * 0.025 + Math.cos(a * 5 - time) * energy * 0.035;
        const r = radius * (0.94 + distortion);
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        point ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();

      // A rotating bundle of latitude filaments, distorted by the current voice level.
      for (let band = 0; band < 13; band++) {
        const latitude = (band / 12 - 0.5) * 1.78;
        const ringRadius = Math.sqrt(1 - latitude * latitude) * radius;
        const ink = ctx.createLinearGradient(-radius, -radius, radius, radius);
        ink.addColorStop(0, light ? "rgba(129,99,226,.72)" : "rgba(190,161,255,.78)");
        ink.addColorStop(0.45, light ? "rgba(193,176,249,.88)" : "rgba(226,215,255,.85)");
        ink.addColorStop(1, light ? "rgba(28,166,166,.78)" : "rgba(92,239,222,.79)");
        ctx.strokeStyle = ink;
        ctx.lineWidth = band % 3 === 0 ? 1.35 : 0.65;
        ctx.shadowColor = band % 2 ? "rgba(105,216,221,.45)" : "rgba(166,126,255,.45)";
        ctx.shadowBlur = talking ? 7 + energy * 7 : 4;
        ctx.beginPath();
        for (let point = 0; point <= 96; point++) {
          const angle = point / 96 * Math.PI * 2;
          const wave = Math.sin(angle * 3 + time * (talking ? 3.2 : 1.2) + band * 0.5);
          const r = ringRadius * (1 + wave * (0.018 + energy * 0.10));
          const px = Math.cos(angle + rotation) * r;
          const pz = Math.sin(angle + rotation) * r;
          const py = latitude * radius + wave * energy * radius * 0.045;
          const tiltedY = py * 0.83 - pz * 0.56;
          const depth = py * 0.56 + pz * 0.83;
          const perspective = 1 + depth / (radius * 6);
          const tilt = -0.38 + Math.sin(time * 0.3) * 0.10;
          const finalX = (px * Math.cos(tilt) - tiltedY * Math.sin(tilt)) * perspective;
          const finalY = (px * Math.sin(tilt) + tiltedY * Math.cos(tilt)) * perspective;
          point ? ctx.lineTo(finalX, finalY) : ctx.moveTo(finalX, finalY);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      const glow = ctx.createRadialGradient(radius * 0.20, radius * 0.10, 0, radius * 0.20, radius * 0.10, radius * 0.75);
      glow.addColorStop(0, `rgba(177,255,243,${light ? 0.32 : 0.34 + energy * 0.14})`);
      glow.addColorStop(0.42, "rgba(78,231,213,.12)");
      glow.addColorStop(1, "rgba(78,231,213,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();

      ctx.save();
      ctx.translate(x, this.height * 0.91);
      ctx.scale(1, 0.12);
      // The ground reflection uses its own local gradient after the squash transform.
      const reflection = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 0.78);
      reflection.addColorStop(0, light ? "rgba(108,92,190,.19)" : "rgba(108,92,190,.17)");
      reflection.addColorStop(1, "rgba(108,92,190,0)");
      ctx.fillStyle = reflection;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }

    destroy() {
      this.destroyed = true;
      cancelAnimationFrame(this.frame);
      this.resizeObserver?.disconnect();
      this.themeObserver?.disconnect();
    }
  }
  window.KadyVisual = KadyVisual;
})();
