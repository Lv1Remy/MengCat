# little-cat 极简小黑猫桌宠组件

零依赖、开箱即用的网页小黑猫：眼睛（白眼球+黑瞳孔分层）跟随鼠标、按下变 `> <`、随机眨眼、Q 弹动画、软边剪影。

## 快速选型

| 场景 | 用哪个 | 文件 |
|---|---|---|
| 普通网页 / Electron / 任何能跑 `<script>` 的地方（**推荐，最省事**） | Web Component | `little-cat.js`（单文件） |
| React / Vue 等组件化项目 | React 组件 | `react/LittleCat.tsx` + `react/littlecat.css` |

---

## 方式一：Web Component（推荐）

只需两行：

```html
<script src="little-cat.js"></script>
<little-cat size="200"></little-cat>
```

- `size` 属性：显示宽度（px），高度自动按 200:148 等比（猫底边贴容器底，缩放时底部不漂移）
- Shadow DOM 隔离，不会污染宿主页面样式
- 无任何外部依赖，不用构建工具
- 双击打开 `demo-standalone.html` 即可验证效果

## 方式二：React 组件

拷贝 `react/LittleCat.tsx` 和 `react/littlecat.css` 两个文件进项目（放同一目录），然后：

```tsx
import LittleCat from "./LittleCat";   // CSS 已在组件内 import

<LittleCat size={200} />
```

Electron 应用里直接当普通前端组件用即可。

---

## 行为说明

| 行为 | 触发 | 实现 |
|---|---|---|
| 眼神跟随 | 全局 mousemove | rAF 节流 + `cubic-bezier(0.34,1.56,0.64,1)` 弹簧过渡，白眼球先动、瞳孔跟上 |
| `> <` 表情 | mousedown / touchstart | 眼睛换成括号 polyline（尖角朝中间），松开后滞留 320ms |
| Q 弹按压 | mousedown | 整只猫 `scale(1.07,0.88)→(0.97,1.06)→(1,1)` 压扁回弹 |
| 眨眼 | 闲置 2.6~5s 随机 | WAAPI `scaleY 1→0.08→1`，170ms |
| 呼吸 | 常驻 | `scaleY 1↔1.028`，3.4s 循环 |
| 软边 | 常驻 | SVG `feGaussianBlur stdDeviation=0.4` |

## 自定义

改剪影/眼睛参数（两版都是源码顶部常量）：

- `BODY_PATH` / `<path d="...">` —— 外轮廓（宽墩身体+小三角耳+双耳间微拱平顶）
- `EYES` 里的 `whiteR` / `pupilR` —— 眼球/瞳孔大小
- `MAX_PUPIL_FOLLOW` —— 瞳孔跟随幅度（需小于 whiteR - pupilR）
- `BLINK_MIN` / `BLINK_VAR` —— 眨眼间隔
- `RELEASE_LINGER` —— 松手后 `> <` 滞留时长

## License

MIT
