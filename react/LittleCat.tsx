import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import "./littlecat.css";

interface LittleCatProps {
  /** 显示尺寸（px，宽高按 viewBox 200:148 等比，猫底边贴容器底） */
  size?: number;
  className?: string;
}

/** 瞳孔在白眼球内可移动的最大 viewBox 单位（小于白眼球半径-瞳孔半径） */
const MAX_PUPIL_FOLLOW = 6;
/** 闲置多久后开始眨眼（毫秒，取随机区间） */
const BLINK_MIN = 2600;
const BLINK_VAR = 2400;
/** 松开后眼睛多滞留一会儿再变回月牙（让短点击也能"反应"到 ><） */
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

/* 眼睛在 viewBox 里的基准位置 */
const LEFT_EYE = { cx: 72, cy: 92, whiteR: 19, pupilR: 11 };
const RIGHT_EYE = { cx: 128, cy: 92, whiteR: 19, pupilR: 11 };

/* 弹簧缓动 */
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * Q 弹压扁回弹（WAAPI）。
 * from 传入当前实时 transform（动画/过渡中的插值态），从该状态无缝接续；
 * 播放前取消旧动画 —— 上一个弹跳没播完就再次触发时不会叠加/突跳。
 */
function squishBounce(el: HTMLDivElement, from?: string) {
  const start = from || getComputedStyle(el).transform;
  el.getAnimations().forEach((a) => a.cancel());
  el.animate(
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

/**
 * LittleCat —— 极简黑色猫头剪影（参考图风格）
 *
 * 行为：
 *  - 眼睛跟着鼠标走（弹簧式跟随，越近越"认真看"）
 *  - 点击：按下眼睛变 > <；松手时若没有拖拽（鼠标未移动），整只猫 Q 弹地一压一弹
 *  - 长按向上拖拽：把猫拉长（阻力渐增，越拉越拉不动），底部固定，
 *    拖拽期间眼睛保持 > <，松手后 Q 弹甩回
 *  - 长按左右拖拽：斜切变形（skewX，底边固定不动，上半身侧移），
 *    松手后左右回摆衰减，模拟真实弹性
 *  - 闲置每 2.6~5 秒自然眨一次眼
 *  - 持续轻微呼吸，按下时大幅 squish + overshoot 弹回
 *  - 软边：SVG 滤镜给剪影加一点点高斯模糊，模拟参考图手绘的柔边
 *  - 眼睛结构：白色眼球（底色）+ 黑色瞳孔（跟随），瞳孔被限制在白眼球内部
 *
 * 零外部依赖，可直接拷进任何 React/Electron/Web 项目。
 */
export default function LittleCat({ size = 280, className = "" }: LittleCatProps) {
  const [pressed, setPressed] = useState(false);
  const [follow, setFollow] = useState({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<HTMLDivElement>(null);
  const leftBlinkRef = useRef<SVGGElement>(null);
  const rightBlinkRef = useRef<SVGGElement>(null);
  const rafRef = useRef<number | null>(null);
  const blinkTimerRef = useRef<number | undefined>(undefined);
  const pressedRef = useRef(false);
  const lingerRef = useRef<number | undefined>(undefined);
  /** 拖拽拉长状态（不进 state，直接操作 DOM 避免频繁重渲染） */
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const draggingRef = useRef(false);
  /** 松手时的变形量（供回弹动画取当前状态） */
  const lastStretchRef = useRef(0);
  const lastLeanRef = useRef(0);

  /* ============ 眼神追踪：弹簧式跟随（白眼球平移，瞳孔相对眼球再追一点） ============ */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const el = containerRef.current;
        if (!el) return;
        // 按住/拖拽期间眼睛保持 ><，不跟随指针
        if (pressedRef.current) return;
        const r = el.getBoundingClientRect();
        // 眼睛大致在猫头垂直中心略偏上
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height * 0.62; // 眼睛在 92/148 ≈ 62% 高度处
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy) || 1;
        // 距离越近眼神越"到位"
        const reach = Math.min(dist / 220, 1);
        setFollow({
          x: (dx / dist) * MAX_PUPIL_FOLLOW * reach,
          y: (dy / dist) * MAX_PUPIL_FOLLOW * reach,
        });
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* ============ 周期性眨眼（用 WAAPI 每次都能干净重启） ============ */
  useEffect(() => {
    let cancelled = false;
    const doBlink = (g: SVGGElement | null) => {
      g?.animate(
        [
          { transform: "scaleY(1)" },
          { transform: "scaleY(0.08)", offset: 0.45 },
          { transform: "scaleY(0.08)", offset: 0.55 },
          { transform: "scaleY(1)" },
        ],
        { duration: 170, easing: "ease-in-out" }
      );
    };
    const schedule = () => {
      blinkTimerRef.current = window.setTimeout(() => {
        if (cancelled) return;
        doBlink(leftBlinkRef.current);
        doBlink(rightBlinkRef.current);
        schedule();
      }, BLINK_MIN + Math.random() * BLINK_VAR);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(blinkTimerRef.current);
    };
  }, []);

  /* ============ 入场：Q 弹一下 ============ */
  useEffect(() => {
    if (pressRef.current) squishBounce(pressRef.current);
  }, []);

  /* ============ 拖拽核心：向上拉拉长、左右拉倾斜（阻力渐增），底部固定 ============ */
  const applyDrag = useCallback((clientX: number, clientY: number) => {
    const el = pressRef.current;
    if (!el) return;
    // 往上拖 = 拉长（提着猫头往上拽）；左右拖 = 倾斜甩头
    const dy = dragStartYRef.current - clientY;
    const dx = clientX - dragStartXRef.current;
    if (
      !draggingRef.current &&
      (dy > DRAG_THRESHOLD || Math.abs(dx) > DRAG_THRESHOLD)
    ) {
      draggingRef.current = true;
      // 平滑接管过渡已在 onDown 时挂好，这里无需额外处理
    }
    if (draggingRef.current) {
      const d = Math.max(0, dy);
      // 阻力曲线：位移越大每像素增益越小，拉的越长越拉不动
      const s = (MAX_STRETCH * d) / (d + STRETCH_RESIST);
      // 斜切角：同样阻力渐增（skewX + 底部 origin：底边不旋转，上半身侧移）
      const ad = Math.abs(dx);
      const ang = (MAX_LEAN * ad) / (ad + LEAN_RESIST) * (dx >= 0 ? 1 : -1);
      lastStretchRef.current = s;
      lastLeanRef.current = ang;
      // 纵向拉高、横向按体积守恒变细；正角=向右歪，CSS skewX 正角使顶部左移故取负
      el.style.transform = `skewX(${-ang}deg) scale(${1 / Math.sqrt(1 + s)}, ${1 + s})`;
    }
  }, []);

  const onDragMouseMove = useCallback(
    (ev: MouseEvent) => applyDrag(ev.clientX, ev.clientY),
    [applyDrag]
  );
  const onDragTouchMove = useCallback(
    (ev: TouchEvent) => {
      if (ev.cancelable) ev.preventDefault(); // 防止页面跟着滚
      applyDrag(ev.touches[0].clientX, ev.touches[0].clientY);
    },
    [applyDrag]
  );

  /* ============ 松手：左右回摆衰减 + 压扁↔拉高震荡，眼睛滞留 >< ============ */
  const onUp = useCallback(() => {
    window.removeEventListener("mousemove", onDragMouseMove);
    window.removeEventListener("touchmove", onDragTouchMove);
    window.removeEventListener("mouseup", onUp);
    window.removeEventListener("touchend", onUp);
    if (!pressedRef.current) return;
    pressedRef.current = false;
    const el = pressRef.current;
    // 先取实时形态（含过渡/旧动画插值），再清过渡 —— 之后的新动画从该状态无缝接续
    const cur = el ? getComputedStyle(el).transform : null;
    if (el) el.style.transition = ""; // 拖拽的平滑接管过渡用完即清，不影响后续动画
    if (draggingRef.current && el) {
      // 拖拽后松手：从当前状态多段 Q 弹甩回 —— 左右斜切回摆衰减 + 纵向震荡
      // （正角=向右歪；skewX 参数取负，见 applyDrag）
      const a = lastLeanRef.current;
      const s = lastStretchRef.current;
      el.getAnimations().forEach((an) => an.cancel()); // 上一次回摆没播完时不叠加
      el.style.transform = "";
      el.animate(
        [
          {
            transform: cur && cur !== "none" ? cur : "skewX(0deg) scale(1, 1)",
            easing: "cubic-bezier(0.2, 0.8, 0.35, 1)",
          },
          // 第一摆：甩向反方向，纵向先被压扁（落地感）
          {
            transform: `skewX(${a * 0.62}deg) scale(${1 + s * 0.22}, ${1 - Math.min(s * 0.3, 0.26)})`,
            offset: 0.2,
            easing: "ease-in-out",
          },
          // 第二摆：弹回原方向，幅度衰减，纵向拉高
          {
            transform: `skewX(${-a * 0.36}deg) scale(${1 - s * 0.12}, ${1 + s * 0.2})`,
            offset: 0.44,
            easing: "ease-in-out",
          },
          // 第三摆：更小幅度
          {
            transform: `skewX(${a * 0.17}deg) scale(${1 + s * 0.07}, ${1 - s * 0.1})`,
            offset: 0.65,
            easing: "ease-in-out",
          },
          // 尾摆：几乎归位
          {
            transform: `skewX(${-a * 0.06}deg) scale(1, 1)`,
            offset: 0.84,
            easing: "ease-in-out",
          },
          { transform: "skewX(0deg) scale(1, 1)" },
        ],
        { duration: 950 }
      );
    } else if (el) {
      // 纯点击（没拖拽、鼠标没动）：松手这一刻 Q 弹一下（从当前形态无缝接续）
      squishBounce(el, cur || undefined);
    }
    draggingRef.current = false;
    lingerRef.current = window.setTimeout(() => {
      setPressed(false);
      lingerRef.current = undefined;
    }, RELEASE_LINGER);
  }, [onDragMouseMove, onDragTouchMove]);

  /* ============ 按下：只记录起点 + 眼睛变 ><（弹跳延迟到松手时） ============ */
  const onDown = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      e.preventDefault();
      if (lingerRef.current) {
        clearTimeout(lingerRef.current);
        lingerRef.current = undefined;
      }
      pressedRef.current = true;
      draggingRef.current = false;
      lastStretchRef.current = 0;
      lastLeanRef.current = 0;
      const pt = "touches" in e ? e.touches[0] : e;
      dragStartXRef.current = pt.clientX;
      dragStartYRef.current = pt.clientY;
      const el = pressRef.current;
      if (el) {
        // 掐掉上一次没播完的弹跳/回摆，挂短过渡让猫从当前形态平滑收形，
        // 不再出现"半路掐断动画 → 跳回基础形态"的卡顿
        el.getAnimations().forEach((a) => a.cancel());
        el.style.transition = "transform 0.13s ease-out";
        el.style.transform = "";
      }
      setPressed(true);
      // 按下不播弹跳动画（延迟到松手时），只切换眼睛为 ><
      // 拖拽时指针会移出猫身范围，监听挂在 window 上
      window.addEventListener("mousemove", onDragMouseMove);
      window.addEventListener("touchmove", onDragTouchMove, { passive: false });
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchend", onUp);
    },
    [onDragMouseMove, onDragTouchMove, onUp]
  );

  /** 单只眼睛：白眼球 + 黑瞳孔（瞳孔跟随） */
  const renderEye = (
    blinkRef: React.RefObject<SVGGElement>,
    cfg: typeof LEFT_EYE,
    side: "L" | "R"
  ) => {
    // >< 括号位置（仅在按下时用，尖角朝中间挤）
    const bracketPoints =
      side === "L"
        ? "63,82 85,92 63,102"    // 左眼：> 尖角朝右（朝中间）
        : "137,82 115,92 137,102"; // 右眼：< 尖角朝左（朝中间）

    return (
      <g
        className="lcat__eye lcat__eye--bottom"
        style={{ transform: `translate(${follow.x}px, ${follow.y}px)` }}
      >
        <g
          ref={blinkRef}
          className="lcat__blink"
          style={{ transformOrigin: `${cfg.cx}px ${cfg.cy}px` }}
        >
          <g
            className="lcat__shape"
            key={pressed ? "b" : "c"}
            style={{ transformOrigin: `${cfg.cx}px ${cfg.cy}px` }}
          >
            {pressed ? (
              <polyline
                className="lcat__bracket"
                points={bracketPoints}
                fill="none"
                stroke="#fff"
                strokeWidth="6.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <>
                {/* 白眼球（底色） */}
                <circle
                  className="lcat__white"
                  cx={cfg.cx}
                  cy={cfg.cy}
                  r={cfg.whiteR}
                  fill="#fff"
                />
                {/* 黑瞳孔（跟随鼠标） */}
                <circle
                  className="lcat__pupil"
                  cx={cfg.cx + follow.x * 0.6}
                  cy={cfg.cy + follow.y * 0.6}
                  r={cfg.pupilR}
                  fill="#0a0a0a"
                />
              </>
            )}
          </g>
        </g>
      </g>
    );
  };

  return (
    // 拖拽时指针会移出猫身，所以 onMouseLeave 只在非拖拽时算松手
    <div
      ref={containerRef}
      className={`lcat ${className}`}
      style={{ width: size, height: (size * 148) / 200 }}
      onMouseDown={onDown}
      onMouseUp={onUp}
      onMouseLeave={() => {
        if (!draggingRef.current) onUp();
      }}
      onTouchStart={onDown}
      onTouchEnd={onUp}
    >
      <div className="lcat__breathe">
        <div className="lcat__press" ref={pressRef}>
          <svg
            viewBox="0 0 200 148"
            width="100%"
            height="100%"
            xmlns="http://www.w3.org/2000/svg"
            className="lcat__svg"
            aria-label="小黑猫"
          >
            <defs>
              {/* 软边滤镜：参考图手绘的羽化效果，剪影轮廓不再锐利 */}
              <filter
                id="lcat-soft-edge"
                x="-5%"
                y="-5%"
                width="110%"
                height="110%"
                filterUnits="objectBoundingBox"
              >
                <feGaussianBlur stdDeviation="0.4" />
              </filter>
              {/* 眼睛内部柔和阴影：让白眼球边缘有一点点过渡，更像画的 */}
              <filter
                id="lcat-eye-soft"
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
                filterUnits="objectBoundingBox"
              >
                <feGaussianBlur stdDeviation="0.35" />
              </filter>
            </defs>

            {/* 剪影：宽墩身体 + 缩小三角耳 + 双耳之间一块平顶（参考图红箭头位置） */}
            <path
              className="lcat__body"
              d="
                M 4 148
                L 196 148
                Q 190 110 172 60
                Q 165 35  150 18
                Q 142 12  134 18
                Q 128 26  122 36
                Q 100 26  78 36
                Q 72 26   66 18
                Q 58 12   50 18
                Q 35 35   28 60
                Q 10 110  4 148
                Z
              "
              fill="#0a0a0a"
              filter="url(#lcat-soft-edge)"
            />

            {/* 左右眼（白眼球+黑瞳孔独立，按下变 ><） */}
            {renderEye(leftBlinkRef, LEFT_EYE, "L")}
            {renderEye(rightBlinkRef, RIGHT_EYE, "R")}
          </svg>
        </div>
      </div>
    </div>
  );
}
