import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from "react";
import "./littlecat.css";

interface LittleCatProps {
  /** 显示尺寸（px，宽高按 viewBox 200:175 等比） */
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

/* 眼睛在 viewBox 里的基准位置 */
const LEFT_EYE = { cx: 72, cy: 92, whiteR: 19, pupilR: 11 };
const RIGHT_EYE = { cx: 128, cy: 92, whiteR: 19, pupilR: 11 };

/**
 * LittleCat —— 极简黑色猫头剪影（参考图风格）
 *
 * 行为：
 *  - 眼睛跟着鼠标走（弹簧式跟随，越近越"认真看"）
 *  - 点击 / 按住：眼睛变成 > <，同时整只猫 Q 弹地一压一弹
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

  /* ============ 眼神追踪：弹簧式跟随（白眼球平移，瞳孔相对眼球再追一点） ============ */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const el = containerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        // 眼睛大致在猫头垂直中心略偏上
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height * 0.52;
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

  /* ============ 按下：快速压扁并保持，松开 Q 弹弹回 ============ */
  const onDown = useCallback(
    (e: ReactMouseEvent | ReactTouchEvent) => {
      e.preventDefault();
      if (lingerRef.current) {
        clearTimeout(lingerRef.current);
        lingerRef.current = undefined;
      }
      pressedRef.current = true;
      setPressed(true);
      // 快速压扁并保持（CSS transition 0.13s ease-out 平滑过渡）
      const el = pressRef.current;
      if (el) el.style.transform = "scale(1.07, 0.88)";
    },
    []
  );

  const onUp = useCallback(() => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    // 松开后 Q 弹弹回（WAAPI：从压扁状态 overshoot 回正）
    const el = pressRef.current;
    if (el) {
      el.style.transition = "none";
      el.animate(
        [
          { transform: "scale(1.07, 0.88)" },
          { transform: "scale(0.97, 1.06)", offset: 0.5 },
          { transform: "scale(1.01, 0.995)", offset: 0.75 },
          { transform: "scale(1, 1)" },
        ],
        { duration: 550, easing: "cubic-bezier(0.34,1.56,0.64,1)", fill: "forwards" }
      ).onfinish = () => {
        // 恢复默认 transition 和 transform，下次按下能正常过渡
        el.style.transition = "";
        el.style.transform = "";
      };
    }
    lingerRef.current = window.setTimeout(() => {
      setPressed(false);
      lingerRef.current = undefined;
    }, RELEASE_LINGER);
  }, []);

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
    <div
      ref={containerRef}
      className={`lcat ${className}`}
      style={{ width: size, height: (size * 175) / 200 }}
      onMouseDown={onDown}
      onMouseUp={onUp}
      onMouseLeave={onUp}
      onTouchStart={onDown}
      onTouchEnd={onUp}
    >
      <div className="lcat__breathe">
        <div className="lcat__press" ref={pressRef}>
          <svg
            viewBox="0 0 200 175"
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
