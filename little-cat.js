/**
 * <little-cat> —— 极简小黑猫桌宠（零依赖 Web Component）
 *
 * 用法（任意 HTML 页面，无需构建工具）：
 *   <script src="little-cat.js"></script>
 *   <little-cat size="200"></little-cat>
 *
 * 属性：
 *   size  显示宽度 px，默认 200（高度按 200:148 自动等比，猫底边贴容器底）
 *
 * 行为：
 *   - 眼睛（白眼球+黑瞳孔分层）弹簧式跟随鼠标
 *   - 点击：按下眼睛变 > <；松手时若没有拖拽（鼠标未移动），整只猫 Q 弹压扁回弹
 *   - 长按向上拖拽：把猫拉长（阻力渐增，越拉越拉不动），底部固定，
 *     拖拽期间眼睛保持 > <；松手后 Q 弹甩回
 *   - 长按左右拖拽：斜切变形（skewX，底边固定不动，上半身侧移），
 *     松手后左右回摆衰减，模拟真实弹性
 *   - 闲置 SLEEP_AFTER 毫秒：进入睡眠 —— 眼睛变 - -，右耳旁冒 Z 缓慢飘出，呼吸变慢；
 *     任意鼠标/键盘活动立即醒来（Q 弹一下）
 *   - 闲置 2.6~5s 随机眨眼；持续轻微呼吸
 *   - SVG 高斯模糊软边 + 宽墩剪影 + 小三角耳 + 双耳间平顶微拱
 *
 * 注：默认 60000ms（1 分钟），开发阶段可临时改 5000 快速验证睡觉效果。
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
  /* 左右拖拽最大斜切角（度，skewX：底边不动，顶部侧移） */
  const MAX_LEAN = 24;
  /* 斜切阻力系数：越大越甩不动 */
  const LEAN_RESIST = 220;
  /* 闲置多久后进入睡眠（毫秒） */
  const SLEEP_AFTER = 60000;
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
    .press { width: 100%; height: 100%; transform-origin: 50% 100%; }
    svg { display: block; overflow: visible; width: 100%; height: 100%; }
    .eye { transition: transform 0.36s cubic-bezier(0.34,1.56,0.64,1); }
    .shape { transform-box: view-box;
             animation: shape-pop 0.42s cubic-bezier(0.34,1.56,0.64,1); }
    @keyframes breathe { 0%,100% { transform: scaleY(1); } 50% { transform: scaleY(1.028); } }
    @keyframes shape-pop { 0% { transform: scale(0.5); } 60% { transform: scale(1.14); } 100% { transform: scale(1); } }

    /* ---------- 睡眠：Z 冒泡（从右耳下方红框位置垂直向上小飘，缓慢） ---------- */
    /* 动画只在入睡时挂上：入睡瞬间从 0% 重新开始，Z 依次"冒出来"，
       而不是入睡前就已在循环中途 */
    .zzs { opacity: 0; pointer-events: none; }
    :host(.lc-sleeping) .zzs { opacity: 1; }
    .zz { font: 700 24px/1 system-ui, -apple-system, sans-serif; fill: #0a0a0a;
          opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }
    /* 每 3s 冒出一颗新 Z：每颗存活 6s、错开 0/3/6s，
       任意时刻两颗在空中错开飘；上飘 50px 让相邻 Z
       纵向间距 > 字号(24px)，不叠在一起 */
    :host(.lc-sleeping) .zz { animation: zz-float 6s ease-in-out infinite; }
    :host(.lc-sleeping) .zz--2 { animation-delay: 3s; }
    :host(.lc-sleeping) .zz--3 { animation-delay: 6s; }
    @keyframes zz-float {
      0%   { opacity: 0; transform: translate(0, 0) scale(0.75); }
      30%  { opacity: 0.9; }
      100% { opacity: 0; transform: translate(0, -50px) scale(1.1); }
    }
    /* 睡着后呼吸放缓 */
    :host(.lc-sleeping) .breathe { animation-duration: 5.6s; }
  `;

  /* 弹簧缓动 */
  const SPRING = "cubic-bezier(0.34,1.56,0.64,1)";

  /**
   * Q 弹压扁回弹（WAAPI）。
   * from 传入当前实时 transform（动画/过渡中的插值态），从该状态无缝接续；
   * 播放前取消旧动画 —— 上一个弹跳没播完就再次触发时不会叠加/突跳。
   */
  function bounce(p, from) {
    const start = from || getComputedStyle(p).transform;
    p.getAnimations().forEach((a) => a.cancel());
    p.animate(
      [
        { transform: start && start !== "none" ? start : "scale(1, 1)", easing: SPRING },
        { transform: "scale(1.07, 0.88)", offset: 0.28, easing: SPRING },
        { transform: "scale(0.97, 1.06)", offset: 0.58, easing: SPRING },
        { transform: "scale(1.01, 0.995)", offset: 0.8, easing: SPRING },
        { transform: "scale(1, 1)" },
      ],
      { duration: 550 }
    );
  }

  /** 按下时的 >< 括号 */
  function bracketHTML(side) {
    const c = EYES[side];
    return `<polyline points="${c.bracket}" fill="none" stroke="#fff" stroke-width="6.5"
           stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  /** 睡眠时的 - - 横线眼 */
  function sleepHTML(side) {
    const c = EYES[side];
    return `<line x1="${c.cx - 11}" y1="${c.cy}" x2="${c.cx + 11}" y2="${c.cy}"
          stroke="#fff" stroke-width="6.5" stroke-linecap="round"/>`;
  }

  /** 正常状态的白眼球 + 黑瞳孔 */
  function circlesHTML(side, fx, fy) {
    const c = EYES[side];
    return `<circle cx="${c.cx}" cy="${c.cy}" r="${c.whiteR}" fill="#fff"/>
         <circle cx="${c.cx + fx * 0.6}" cy="${c.cy + fy * 0.6}" r="${c.pupilR}" fill="#0a0a0a"/>`;
  }

  /** 生成单只眼睛的 SVG group HTML（只在初次构建 / 尺寸变化时用） */
  function eyeHTML(side, state, fx, fy) {
    const c = EYES[side];
    const inner =
      state === "pressed" ? bracketHTML(side) :
      state === "sleep"   ? sleepHTML(side) :
                            circlesHTML(side, fx, fy);
    return `
      <g class="eye" data-eye="${side}" style="transform: translate(${fx}px, ${fy}px)">
        <g class="blink" data-blink="${side}" style="transform-origin: ${c.cx}px ${c.cy}px">
          <g class="shape" data-shape="${side}" data-state="${state}"
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
      this._sleeping = false;
      this._lastActive = Date.now();
      this._sleepCheck = null;
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
      this._startIdleWatch();
    }

    disconnectedCallback() {
      this._cancelled = true;
      clearTimeout(this._blinkTimer);
      clearTimeout(this._linger);
      clearInterval(this._sleepCheck);
      if (this._raf) cancelAnimationFrame(this._raf);
      window.removeEventListener("mousemove", this._onMoveBound);
      window.removeEventListener("keydown", this._onKeyBound);
    }

    attributeChangedCallback() {
      if (this.shadowRoot.innerHTML) this._build();
    }

    get size() { return Number(this.getAttribute("size")) || 200; }

    /* ---------- 构建 DOM ---------- */
    _build() {
      const size = this.size;
      // 高度比例 = viewBox 高 148 / 宽 200：黑底边 y=148 恰好贴住容器底，
      // 这样 transform-origin 50% 100% 缩放时黑色部分底部不会上漂
      const height = Math.round((size * 148) / 200);
      const f = this._follow;
      this.shadowRoot.innerHTML = `
        <style>${CSS}</style>
        <div class="breathe" style="width:${size}px;height:${height}px">
          <div class="press" data-press>
            <svg viewBox="0 0 200 148" xmlns="http://www.w3.org/2000/svg" aria-label="小黑猫">
              <defs>
                <filter id="lc-soft" x="-5%" y="-5%" width="110%" height="110%">
                  <feGaussianBlur stdDeviation="0.4"/>
                </filter>
              </defs>
              <path d="${BODY_PATH}" fill="#0a0a0a" filter="url(#lc-soft)"/>
              ${eyeHTML("L", this._eyeState(), f.x, f.y)}
              ${eyeHTML("R", this._eyeState(), f.x, f.y)}
              <g class="zzs" aria-hidden="true">
                <text class="zz" x="164" y="35">Z</text>
                <text class="zz zz--2" x="164" y="35">Z</text>
                <text class="zz zz--3" x="164" y="35">Z</text>
              </g>
            </svg>
          </div>
        </div>`;

      // 入场：Q 弹一下
      bounce(this.shadowRoot.querySelector("[data-press]"));

      /* ---------- 点击（松手时弹）/ 长按拖拽拉长松手甩回 ---------- */
      const root = this.shadowRoot;
      let startX = 0;       // 按下时指针 X
      let startY = 0;       // 按下时指针 Y
      let dragging = false; // 是否已进入拖拽变形模式
      let lastS = 0;        // 松手时的纵向拉伸量（0~MAX_STRETCH）
      let lastAng = 0;      // 松手时的倾斜角（度，带符号）

      /** 阻力曲线：位移越大每像素增益越小，拉的越长越拉不动 */
      const stretchOf = (d) => MAX_STRETCH * (d / (d + STRETCH_RESIST));
      const leanOf = (d) => MAX_LEAN * (d / (d + LEAN_RESIST));

      /** 底部固定的变形：向上拉 → 拉高+变细（体积守恒）；左右拉 → 斜切
       *  （skewX + 底部 origin：底边不旋转不位移，只是上半身侧移） */
      const applyStretch = (p, dx, dy) => {
        lastS = stretchOf(Math.max(0, dy));
        lastAng = dx >= 0 ? leanOf(dx) : -leanOf(-dx);
        // 正角=向右歪：CSS skewX 正角使顶部左移，所以取负
        p.style.transform =
          `skewX(${-lastAng}deg) scale(${1 / Math.sqrt(1 + lastS)}, ${1 + lastS})`;
      };

      const onDragMove = (ev) => {
        if (!this._pressed) return;
        const t = ev.touches ? ev.touches[0] : ev;
        // 往上拖 = 拉长（提着猫头往上拽）；左右拖 = 倾斜甩头
        const dy = startY - t.clientY;
        const dx = t.clientX - startX;
        if (!dragging && (dy > DRAG_THRESHOLD || Math.abs(dx) > DRAG_THRESHOLD)) {
          dragging = true;
          // 平滑接管过渡已在 down 时挂好，这里无需额外处理
        }
        if (dragging) {
          if (ev.cancelable) ev.preventDefault(); // 触屏上防止页面跟着滚
          const p = root.querySelector("[data-press]");
          if (p) applyStretch(p, dx, dy);
        }
      };

      /** 指针移出窗口（relatedTarget 为空）或窗口失焦：自动当松手处理，
       *  否则窗口外的 mouseup 收不到，猫会卡在拉伸状态 */
      const outOfWindow = (ev) => {
        if (!this._pressed) return;
        if (ev.type === "mouseout" && ev.relatedTarget) return; // 只是移到了窗口内其他元素上
        up();
      };

      const down = (e) => {
        e.preventDefault();
        this._lastActive = Date.now();
        if (this._sleeping) this._setSleep(false);
        clearTimeout(this._linger);
        this._pressed = true;
        dragging = false;
        lastS = 0;
        lastAng = 0;
        const t = e.touches ? e.touches[0] : e;
        startX = t.clientX;
        startY = t.clientY;
        const p = root.querySelector("[data-press]");
        if (p) {
          // 掐掉上一次没播完的弹跳/回摆，挂短过渡让猫从当前形态平滑收形，
          // 不再出现"半路掐断动画 → 跳回基础形态"的卡顿
          p.getAnimations().forEach((a) => a.cancel());
          p.style.transition = "transform 0.13s ease-out";
          p.style.transform = "";
        }
        // 按下不播动画（弹跳延迟到松手时），只记录起点、切换眼睛为 ><
        window.addEventListener("mousemove", onDragMove);
        window.addEventListener("touchmove", onDragMove, { passive: false });
        window.addEventListener("mouseup", up);
        window.addEventListener("touchend", up);
        document.addEventListener("mouseout", outOfWindow);
        window.addEventListener("blur", outOfWindow);
        this._renderEyes();
      };

      const up = () => {
        window.removeEventListener("mousemove", onDragMove);
        window.removeEventListener("touchmove", onDragMove);
        window.removeEventListener("mouseup", up);
        window.removeEventListener("touchend", up);
        document.removeEventListener("mouseout", outOfWindow);
        window.removeEventListener("blur", outOfWindow);
        if (!this._pressed) return;
        this._pressed = false;
        const p = root.querySelector("[data-press]");
        // 先取实时形态（含过渡/旧动画插值），再清过渡 —— 之后的新动画从该状态无缝接续
        const cur = p ? getComputedStyle(p).transform : null;
        if (p) p.style.transition = ""; // 拖拽的平滑接管过渡用完即清，不影响后续动画
        if (dragging && p) {
          // 拖拽后松手：从当前状态多段 Q 弹甩回 —— 左右斜切回摆衰减 + 压扁↔拉高震荡
          // （正角=向右歪；skewX 参数取负，见 applyStretch）
          const a = lastAng, s = lastS;
          p.getAnimations().forEach((an) => an.cancel()); // 上一次回摆没播完时不叠加
          p.style.transform = "";
          p.animate(
            [
              { transform: cur && cur !== "none" ? cur : "skewX(0deg) scale(1, 1)",
                easing: "cubic-bezier(0.2, 0.8, 0.35, 1)" },
              // 第一摆：甩向反方向，纵向先被压扁（落地感）
              { transform: `skewX(${a * 0.62}deg) scale(${1 + s * 0.22}, ${1 - Math.min(s * 0.3, 0.26)})`,
                offset: 0.2, easing: "ease-in-out" },
              // 第二摆：弹回原方向，幅度衰减，纵向拉高
              { transform: `skewX(${-a * 0.36}deg) scale(${1 - s * 0.12}, ${1 + s * 0.2})`,
                offset: 0.44, easing: "ease-in-out" },
              // 第三摆：更小幅度
              { transform: `skewX(${a * 0.17}deg) scale(${1 + s * 0.07}, ${1 - s * 0.1})`,
                offset: 0.65, easing: "ease-in-out" },
              // 尾摆：几乎归位
              { transform: `skewX(${-a * 0.06}deg) scale(1, 1)`,
                offset: 0.84, easing: "ease-in-out" },
              { transform: "skewX(0deg) scale(1, 1)" },
            ],
            { duration: 950 }
          );
        } else if (p) {
          // 纯点击（没拖拽、鼠标没动）：松手这一刻弹一下（从当前形态无缝接续）
          bounce(p, cur);
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
        // 任何鼠标移动都算"在用电脑"：刷新活动时间，睡着则立即醒
        this._lastActive = Date.now();
        if (this._sleeping) this._setSleep(false);
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => {
          this._raf = null;
          const r = this.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height * 0.62;
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
      this._onKeyBound = () => {
        this._lastActive = Date.now();
        if (this._sleeping) this._setSleep(false);
      };
      window.addEventListener("mousemove", this._onMoveBound);
      window.addEventListener("keydown", this._onKeyBound);
    }

    /* ---------- 睡眠：闲置 1 分钟打瞌睡，任意活动醒来 ---------- */
    _startIdleWatch() {
      this._lastActive = Date.now();
      clearInterval(this._sleepCheck);
      this._sleepCheck = setInterval(() => {
        if (this._cancelled || this._pressed) return;
        if (
          !this._sleeping &&
          Date.now() - this._lastActive >= SLEEP_AFTER
        ) {
          this._setSleep(true);
        }
      }, 1000);
    }

    _setSleep(on) {
      if (this._sleeping === on) return;
      this._sleeping = on;
      this.classList.toggle("lc-sleeping", on);
      if (on) {
        this._follow = { x: 0, y: 0 }; // 睡着眼神归位
      }
      this._renderEyes();
      if (!on) {
        // 醒来：Q 弹一下打个招呼
        const p = this.shadowRoot.querySelector("[data-press]");
        if (p) bounce(p);
      }
    }

    /** 眼睛当前形态：按下 > < / 睡眠 - - / 正常圆眼 */
    _eyeState() {
      return this._pressed ? "pressed" : this._sleeping ? "sleep" : "normal";
    }

    /* ---------- 只更新眼睛（不重建 DOM，避免重放 shape-pop 让眼睛变小） ---------- */
    _renderEyes() {
      const f = this._follow;
      const state = this._eyeState();
      const root = this.shadowRoot;
      for (const side of ["L", "R"]) {
        const eye = root.querySelector(`[data-eye="${side}"]`);
        if (!eye) continue;
        // 1) 眼球整体跟随：只改 transform，CSS transition 平滑过渡
        eye.style.transform = `translate(${f.x}px, ${f.y}px)`;

        const shape = eye.querySelector("[data-shape]");
        if (shape.dataset.state !== state) {
          // 2) 形态切换（圆眼 <-> >< <-> - -）：换内容并主动重放弹入动画
          shape.dataset.state = state;
          shape.innerHTML =
            state === "pressed" ? bracketHTML(side) :
            state === "sleep"   ? sleepHTML(side) :
                                  circlesHTML(side, f.x, f.y);
          shape.style.animation = "none";
          void shape.getBoundingClientRect(); // 强制 reflow，确保动画重启
          shape.style.animation = "";
        } else if (state === "normal") {
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
        if (!this._sleeping) {
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
        }
        this._blinkTimer = setTimeout(tick, BLINK_MIN + Math.random() * BLINK_VAR);
      };
      this._blinkTimer = setTimeout(tick, BLINK_MIN + Math.random() * BLINK_VAR);
    }
  }

  customElements.define("little-cat", LittleCat);
})();
