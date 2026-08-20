/**
 * <little-cat> —— 极简小黑猫桌宠（零依赖 Web Component）
 *
 * 用法（任意 HTML 页面，无需构建工具）：
 *   <script src="little-cat.js"></script>
 *   <little-cat size="200"></little-cat>
 *
 * 属性：
 *   size  显示宽度 px，默认 200（高度按 200:175 自动等比）
 *
 * 行为：
 *   - 眼睛（白眼球+黑瞳孔分层）弹簧式跟随鼠标
 *   - 点击：眼睛变 > <（尖角朝中间）+ 整只猫 Q 弹压扁回弹
 *   - 长按向上拖拽：把猫拉长（阻力渐增，越拉越拉不动），底部固定，
 *     拖拽期间眼睛保持 > <；松手后 Q 弹甩回
 *   - 闲置 2.6~5s 随机眨眼；持续轻微呼吸
 *   - SVG 高斯模糊软边 + 宽墩剪影 + 小三角耳 + 双耳间平顶微拱
 *
 * MIT License
 */
(() => {
  "use strict";

  /* ---------- 常量（与 React 版一致） ---------- */
  const MAX_PUPIL_FOLLOW = 6;
  const BLINK_MIN = 2600;
  const BLINK_VAR = 2400;
  const RELEASE_LINGER = 320;
  /* 长按拖拽拉长：超过该竖直位移才进入拖拽模式 */
  const DRAG_THRESHOLD = 8;
  /* 最大拉长量（scaleY 最高 1 + MAX_STRETCH） */
  const MAX_STRETCH = 0.9;
  /* 阻力系数：越大越拉不动（位移收益递减，渐近 MAX_STRETCH） */
  const STRETCH_RESIST = 260;
  const EYES = {
    L: { cx: 72, cy: 92, whiteR: 19, pupilR: 11, bracket: "63,82 85,92 63,102" },
    R: { cx: 128, cy: 92, whiteR: 19, pupilR: 11, bracket: "137,82 115,92 137,102" },
  };
  const BODY_PATH = `M 4 148 L 196 148
    Q 190 110 172 60 Q 165 35 150 18 Q 142 12 134 18 Q 128 26 122 36
    Q 100 26 78 36 Q 72 26 66 18 Q 58 12 50 18 Q 35 35 28 60
    Q 10 110 4 148 Z`;

  /* ---------- 组件内样式（Shadow DOM 隔离） ---------- */
  const CSS = `
    :host { display: inline-block; cursor: pointer; user-select: none;
            -webkit-tap-highlight-color: transparent; }
    .breathe { width: 100%; height: 100%; transform-origin: 50% 100%;
               animation: breathe 3.4s ease-in-out infinite; }
    .press { width: 100%; height: 100%; transform-origin: 50% 100%;
             animation: press 0.55s cubic-bezier(0.34,1.56,0.64,1); }
    svg { display: block; overflow: visible; width: 100%; height: 100%; }
    .eye { transition: transform 0.36s cubic-bezier(0.34,1.56,0.64,1); }
    .shape { transform-box: view-box;
             animation: shape-pop 0.42s cubic-bezier(0.34,1.56,0.64,1); }
    @keyframes breathe { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(1.028); } }
    @keyframes press { 0% { transform: scale(1,1); } 28% { transform: scale(1.07,0.88); }
                       58% { transform: scale(0.97,1.06); } 80% { transform: scale(1.01,0.995); }
                       100% { transform: scale(1,1); } }
    @keyframes shape-pop { 0% { transform: scale(0.5); } 60% { transform: scale(1.14); } 100% { transform: scale(1); } }
  `;

  /** 按下时的 >< 括号 */
  function bracketHTML(side) {
    const c = EYES[side];
    return `<polyline points="${c.bracket}" fill="none" stroke="#fff" stroke-width="6.5"
           stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  /** 正常状态的白眼球 + 黑瞳孔 */
  function circlesHTML(side, fx, fy) {
    const c = EYES[side];
    return `<circle cx="${c.cx}" cy="${c.cy}" r="${c.whiteR}" fill="#fff"/>
         <circle cx="${c.cx + fx * 0.6}" cy="${c.cy + fy * 0.6}" r="${c.pupilR}" fill="#0a0a0a"/>`;
  }

  /** 生成单只眼睛的 SVG group HTML（只在初次构建 / 尺寸变化时用） */
  function eyeHTML(side, pressed, fx, fy) {
    const c = EYES[side];
    const inner = pressed ? bracketHTML(side) : circlesHTML(side, fx, fy);
    return `
      <g class="eye" data-eye="${side}" style="transform: translate(${fx}px, ${fy}px)">
        <g class="blink" data-blink="${side}" style="transform-origin: ${c.cx}px ${c.cy}px">
          <g class="shape" data-shape="${side}" data-pressed="${pressed ? 1 : 0}"
             style="transform-origin: ${c.cx}px ${c.cy}px; transform-box: view-box">${inner}</g>
        </g>
      </g>`;
  }

  class LittleCat extends HTMLElement {
    static get observedAttributes() {
      return ["size"];
    }

    constructor() {
      super();
      this._follow = { x: 0, y: 0 };
      this._pressed = false;
      this._raf = null;
      this._linger = null;
      this._blinkTimer = null;
      this._cancelled = false;
      this.attachShadow({ mode: "open" });
    }

    connectedCallback() {
      this._build();
      this._bindTracking();
      this._scheduleBlink();
    }

    disconnectedCallback() {
      this._cancelled = true;
      clearTimeout(this._blinkTimer);
      clearTimeout(this._linger);
      if (this._raf) cancelAnimationFrame(this._raf);
      window.removeEventListener("mousemove", this._onMoveBound);
    }

    attributeChangedCallback() {
      if (this.shadowRoot.innerHTML) this._build();
    }

    get size() { return Number(this.getAttribute("size")) || 200; }

    /* ---------- 构建 DOM ---------- */
    _build() {
      const size = this.size;
      const height = Math.round((size * 175) / 200);
      const f = this._follow;
      this.shadowRoot.innerHTML = `
        <style>${CSS}</style>
        <div class="breathe" style="width:${size}px;height:${height}px">
          <div class="press" data-press>
            <svg viewBox="0 0 200 175" xmlns="http://www.w3.org/2000/svg" aria-label="小黑猫">
              <defs>
                <filter id="lc-soft" x="-5%" y="-5%" width="110%" height="110%">
                  <feGaussianBlur stdDeviation="0.4"/>
                </filter>
              </defs>
              <path d="${BODY_PATH}" fill="#0a0a0a" filter="url(#lc-soft)"/>
              ${eyeHTML("L", this._pressed, f.x, f.y)}
              ${eyeHTML("R", this._pressed, f.x, f.y)}
            </svg>
          </div>
        </div>`;

      /* ---------- 点击 Q 弹 / 长按拖拽拉长松手甩回 ---------- */
      const root = this.shadowRoot;
      let startY = 0;        // 按下时指针 Y
      let dragging = false;  // 是否已进入拉长模式

      /** 阻力曲线：位移越大每像素增益越小，拉的越长越拉不动 */
      const stretchOf = (dy) => MAX_STRETCH * (dy / (dy + STRETCH_RESIST));

      /** 底部固定的拉长：纵向拉高、横向按体积守恒变细 */
      const applyStretch = (p, dy) => {
        const s = stretchOf(Math.max(0, dy));
        p.style.transform = `scale(${1 / Math.sqrt(1 + s)}, ${1 + s})`;
      };

      const onDragMove = (ev) => {
        if (!this._pressed) return;
        const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
        // 往上拖 = 拉长（提着猫头往上拽）
        const dy = startY - y;
        if (!dragging && dy > DRAG_THRESHOLD) {
          dragging = true;
          // 从点击弹跳切换为拉长：停掉 press 动画（下次按下会重启）
          const p = root.querySelector("[data-press]");
          if (p) p.style.animation = "none";
        }
        if (dragging) {
          if (ev.cancelable) ev.preventDefault(); // 触屏上防止页面跟着滚
          const p = root.querySelector("[data-press]");
          if (p) applyStretch(p, dy);
        }
      };

      const down = (e) => {
        e.preventDefault();
        clearTimeout(this._linger);
        this._pressed = true;
        dragging = false;
        startY = e.touches ? e.touches[0].clientY : e.clientY;
        // 先按普通点击处理：重启 press 动画（若随后拖拽会切换为拉长）
        const p = root.querySelector("[data-press]");
        p.style.animation = "none"; void p.offsetWidth; p.style.animation = "";
        window.addEventListener("mousemove", onDragMove);
        window.addEventListener("touchmove", onDragMove, { passive: false });
        window.addEventListener("mouseup", up);
        window.addEventListener("touchend", up);
        this._renderEyes();
      };

      const up = () => {
        window.removeEventListener("mousemove", onDragMove);
        window.removeEventListener("touchmove", onDragMove);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("touchend", up);
        if (!this._pressed) return;
        this._pressed = false;
        const p = root.querySelector("[data-press]");
        if (dragging && p) {
          // 拉长后松手：从当前状态多段 Q 弹甩回（压扁↔拉高来回衰减）
          const from = getComputedStyle(p).transform;
          p.style.transform = "";
          p.animate(
            [
              { transform: from, easing: "cubic-bezier(0.2, 0.8, 0.35, 1)" },
              { transform: "scale(1.08, 0.74)", offset: 0.2, easing: "ease-in-out" },
              { transform: "scale(0.95, 1.14)", offset: 0.45, easing: "ease-in-out" },
              { transform: "scale(1.03, 0.97)", offset: 0.68, easing: "ease-in-out" },
              { transform: "scale(0.995, 1.01)", offset: 0.85, easing: "ease-in-out" },
              { transform: "scale(1, 1)" },
            ],
            { duration: 800 }
          );
        }
        dragging = false;
        // 滞留一会儿再变回圆眼，让短点击也能看清 ><（拉长甩回给更长的滞留）
        clearTimeout(this._linger);
        this._linger = setTimeout(() => this._renderEyes(), RELEASE_LINGER);
      };
      this.onmousedown = down;
      this.onmouseup = up;
      // 拖拽时指针会移出猫身范围，mouseleave 只在非拖拽时算松手
      this.onmouseleave = () => { if (!dragging) up(); };
      this.ontouchstart = down;
      this.ontouchend = up;
    }

    /* ---------- 眼神追踪 ---------- */
    _bindTracking() {
      this._onMoveBound = (e) => {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
          this._raf = null;
          const r = this.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height * 0.52;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;
          const dist = Math.hypot(dx, dy) || 1;
          const reach = Math.min(dist / 220, 1);
          this._follow = {
            x: (dx / dist) * MAX_PUPIL_FOLLOW * reach,
            y: (dy / dist) * MAX_PUPIL_FOLLOW * reach,
          };
          if (!this._pressed) this._renderEyes();
        });
      };
      window.addEventListener("mousemove", this._onMoveBound);
    }

    /* ---------- 只更新眼睛（不重建 DOM，避免重放 shape-pop 让眼睛变小） ---------- */
    _renderEyes() {
      const f = this._follow;
      const root = this.shadowRoot;
      for (const side of ["L", "R"]) {
        const eye = root.querySelector(`[data-eye="${side}"]`);
        if (!eye) continue;
        // 1) 眼球整体跟随：只改 transform，CSS transition 平滑过渡
        eye.style.transform = `translate(${f.x}px, ${f.y}px)`;

        const shape = eye.querySelector("[data-shape]");
        const shapePressed = shape.dataset.pressed === "1";
        if (this._pressed !== shapePressed) {
          // 2) 形状切换（圆眼 <-> ><）：换内容并主动重放弹入动画
          shape.dataset.pressed = this._pressed ? "1" : "0";
          shape.innerHTML = this._pressed
            ? bracketHTML(side)
            : circlesHTML(side, f.x, f.y);
          shape.style.animation = "none";
          void shape.getBoundingClientRect(); // 强制 reflow，确保动画重启
          shape.style.animation = "";
        } else if (!this._pressed) {
          // 3) 仅更新瞳孔位置（改属性，不触发任何动画重启）
          const pupil = shape.querySelectorAll("circle")[1];
          if (pupil) {
            const c = EYES[side];
            pupil.setAttribute("cx", String(c.cx + f.x * 0.6));
            pupil.setAttribute("cy", String(c.cy + f.y * 0.6));
          }
        }
      }
    }

    /* ---------- 周期性眨眼（WAAPI） ---------- */
    _scheduleBlink() {
      const tick = () => {
        if (this._cancelled) return;
        for (const side of ["L", "R"]) {
          this.shadowRoot
            .querySelector(`[data-blink="${side}"]`)
            ?.animate(
              [
                { transform: "scaleY(1)" },
                { transform: "scaleY(0.08)", offset: 0.45 },
                { transform: "scaleY(0.08)", offset: 0.55 },
                { transform: "scaleY(1)" },
              ],
              { duration: 170, easing: "ease-in-out" }
            );
        }
        this._blinkTimer = setTimeout(tick, BLINK_MIN + Math.random() * BLINK_VAR);
      };
      this._blinkTimer = setTimeout(tick, BLINK_MIN + Math.random() * BLINK_VAR);
    }
  }

  customElements.define("little-cat", LittleCat);
})();
