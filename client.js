/**
 * dsh-douyin-studio —— 设置页「抖音工作室」（浏览器半端，b13 收敛重做）
 * ============================================================================
 * b13 改了什么（从「仪表面板」改成「一个替人值守的助手」）：
 *   1. **一屏一个实心主按钮**：只有「回一条」是实底强调色。开值班 / 刷一批 /
 *      出二维码全部降为描边次级 —— 以前一屏同时有三个蓝按钮，谁都不突出。
 *   2. **颜色只承担语义**：绿=正常、琥珀=该看一眼、红=真坏了、蓝=能点。
 *      卡片顶部那六条彩色装饰线（蓝/青/紫/琥珀/绿/红）全删了，它们是噪音。
 *   3. **状态用「圆点 + 文字」**：不再彩字彩框。同一个绿以前同时表示
 *      「已登录」「盯私信开」「值得回」，现在只有圆点着色，文字中性。
 *   4. **新增「今天做了什么」**：回评 / 发布 / 出错三条来源合成一条时间线。
 *      以前它们是三张并排的小卡，用户得自己拼；现在一眼看完。
 *      顺手修了个真 bug：/errors 返回的是 {kind,text}，旧代码读 r.stage/r.message，
 *      所以「出错记录」永远只显示一个 error 加空白。
 *   5. **调试信息收进「诊断」**：CDP 端口、uid、build 号不再占一级界面。
 *   6. **空状态给下一步**：以前只陈述「还没刷过」，现在带按钮。
 *
 * b14：给「今天做了什么」加了「历史」开关 —— 默认只看今天，往日的不删，收在按钮后面。
 *      三个账本一次取够，切换是纯前端过滤，不新增接口。
 * b15：两个生命周期修：① 列表 key 不再用 Math.random() 兜底（会让整行被卸载重建，
 *      展开状态和输入内容一起丢）；② Ops 的「点第二下确认」计时器改成带清理的 ref，
 *      连点时不会互相踩。视觉上没有变化。
 * b16：**秒开**。收件箱不再让用户干等十几秒：服务端留一份上次的结果，打开就立刻给，
 *      同时在后台跑一轮；前端看到 `cache.refreshing` 就每 5 秒轮询一次，刷完自动换掉。
 *      副标题顺便显示「正在刷新 / 3 分钟前」，既回答「这是新的吗」，又不多占一行。
 *      「重新挑一遍」改成 fresh=1 —— 忽略缓存真跑一轮（发完消息也走这条）。
 *
 * ⚠️ 改完把 PANEL_BUILD +1；标题右边的 b<N> 对不上就是吃了缓存。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-douyin-studio',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const API = '/api/douyin-studio'
    const PANEL_BUILD = 37
    const { useState, useEffect, useRef, useCallback } = React

    /* CSS-GENERATED: 改样式请编辑 assets/panel.css，再跑 node tools/build-client.mjs */
    const CSS = "[data-dys]{--dys-fs:13px;--dys-r:12px;--dys-ink:currentColor;--dys-line:color-mix(in oklab,currentColor 13%,transparent);--dys-line2:color-mix(in oklab,currentColor 20%,transparent);--dys-fill:color-mix(in oklab,currentColor 4%,transparent);--dys-fill2:color-mix(in oklab,currentColor 7.5%,transparent);--dys-lead:color-mix(in oklab,currentColor 9.5%,transparent);--dys-raise:color-mix(in oklab,currentColor 14%,transparent);--dys-dim:.58;--dys-blue:#6f9ff0;--dys-on-accent:#0c1017;--dys-teal:#5fc3a4;--dys-violet:#a893e6;--dys-amber:#dbae6b;--dys-ok:#5fbf82;--dys-bad:#ef8175;box-sizing:border-box;width:100%;max-width:1220px;padding:2px 2px 12px;display:flex;flex-direction:column;gap:14px;font-size:var(--dys-fs);line-height:1.55;color:var(--dys-ink);font-variant-numeric:tabular-nums;}[data-dys] *{box-sizing:border-box;}[data-dys][data-theme=\"light\"]{--dys-dim:.62;--dys-fill:#ffffff;--dys-fill2:#f1f2f4;--dys-lead:#ffffff;--dys-raise:#ffffff;--dys-blue:#2f6fd0;--dys-on-accent:#ffffff;--dys-teal:#0f7a5c;--dys-violet:#5a45b0;--dys-amber:#9a6410;--dys-ok:#1c7d46;--dys-bad:#b83a24;}[data-dys-grid]{display:grid;grid-template-columns:minmax(0,1.06fr) minmax(0,.94fr);gap:14px;align-items:start;}[data-dys-grid][data-cols=\"1\"]{grid-template-columns:minmax(0,1fr);}[data-dys-col]{display:flex;flex-direction:column;gap:14px;min-width:0;}[data-dys-card]{position:relative;display:flex;flex-direction:column;gap:12px;min-width:0;padding:15px 17px 16px;border-radius:var(--dys-r);border:1px solid var(--dys-line);background:var(--dys-fill);}[data-dys-card][data-lead]{background:var(--dys-lead);border-color:var(--dys-line2);}[data-dys-card][data-kind=\"form\"]{padding:16px 18px 17px;gap:14px;}[data-dys-card][data-kind=\"metric\"]{padding:18px 18px 16px;gap:14px;}[data-dys-seg]{display:flex;gap:3px;flex-wrap:wrap;width:fit-content;max-width:100%;padding:3px;border-radius:12px;background:var(--dys-fill2);border:1px solid var(--dys-line);}[data-dys-seg][data-dys-seg2]{margin-top:-6px;background:transparent;border:0;padding:0 3px;}[data-dys-seg]>button{flex:0 0 auto;appearance:none;cursor:pointer;font:inherit;font-size:12px;line-height:1.5;padding:5px 12px;border:0;border-radius:9px;background:transparent;color:var(--dys-dim);white-space:nowrap;transition:color .12s ease,background .12s ease,box-shadow .12s ease;}[data-dys-seg]>button:hover{color:var(--dys-ink);background:color-mix(in oklab,var(--dys-ink) 5%,transparent);}[data-dys-seg]>button[data-on]{background:var(--dys-fill);color:var(--dys-ink);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.16),inset 0 0 0 1px var(--dys-line2);}[data-dys-seg] i{font-style:normal;font-size:10px;line-height:1;padding:2px 4px;margin-left:5px;border-radius:6px;background:color-mix(in oklab,var(--dys-blue) 15%,transparent);color:color-mix(in oklab,var(--dys-blue) 88%,currentColor);}[data-dys-view]{height:clamp(320px,46vh,480px);overflow:auto;border-radius:12px;display:grid;grid-template-columns:repeat(var(--dys-cols,1),minmax(0,1fr));align-content:start;gap:16px;scrollbar-width:thin;scrollbar-color:color-mix(in oklab,currentColor 22%,transparent) transparent;}[data-dys-view]>[data-dys-card][data-lead]{grid-column:1 / -1;}[data-dys-view]>*:only-child{min-height:100%;grid-column:1 / -1;align-self:start;}[data-dys-view][data-more]{-webkit-mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 22px),transparent 100%);mask-image:linear-gradient(to bottom,#000 0,#000 calc(100% - 22px),transparent 100%);}[data-dys-view]::-webkit-scrollbar{width:8px;}[data-dys-view]::-webkit-scrollbar-thumb{border-radius:999px;background:color-mix(in oklab,currentColor 16%,transparent);}[data-dys-view]::-webkit-scrollbar-thumb:hover{background:color-mix(in oklab,currentColor 26%,transparent);}[data-dys-view]::-webkit-scrollbar-track{background:transparent;}[data-dys-own]{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;background:var(--dys-fill2);border:1px solid var(--dys-line);}[data-dys-own][data-level=\"green\"]{border-color:color-mix(in oklab,var(--dys-ok) 50%,var(--dys-line));background:color-mix(in oklab,var(--dys-ok) 9%,var(--dys-fill2));}[data-dys-own][data-level=\"red\"]{border-color:color-mix(in oklab,var(--dys-bad) 50%,var(--dys-line));background:color-mix(in oklab,var(--dys-bad) 9%,var(--dys-fill2));}[data-dys-dot]{flex:0 0 9px;width:9px;height:9px;border-radius:50%;background:var(--dys-dim);}[data-dys-own][data-level=\"green\"] [data-dys-dot]{background:var(--dys-ok);box-shadow:0 0 0 3px color-mix(in oklab,var(--dys-ok) 22%,transparent);}[data-dys-own][data-level=\"red\"] [data-dys-dot]{background:var(--dys-bad);box-shadow:0 0 0 3px color-mix(in oklab,var(--dys-bad) 22%,transparent);}[data-dys-own]>div{flex:1 1 auto;min-width:0;}[data-dys-own] b{font-size:12px;font-weight:620;}[data-dys-own] span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}[data-dys-tabs]{display:flex;gap:2px;padding:2px;border-radius:10px;background:var(--dys-fill2);}[data-dys-tab]{flex:1 1 0;appearance:none;cursor:pointer;font:inherit;font-size:11.5px;line-height:1.5;padding:4px 6px;border:0;border-radius:8px;background:transparent;color:var(--dys-dim);display:flex;align-items:center;justify-content:center;gap:4px;}[data-dys-tab]:hover{color:var(--dys-ink);}[data-dys-tab][data-on]{background:var(--dys-fill);color:var(--dys-ink);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.14);}[data-dys-tab]>i{font-style:normal;font-size:10px;opacity:.5;}[data-dys-head]{display:flex;align-items:center;flex-wrap:wrap;gap:6px 8px;min-width:0;}[data-dys-title]{display:flex;align-items:center;gap:7px;flex:0 0 auto;white-space:nowrap;font-size:12.5px;font-weight:600;color:color-mix(in oklab,currentColor 86%,transparent);}[data-dys-card][data-lead] [data-dys-title]{font-size:13.5px;font-weight:650;color:var(--dys-ink);}[data-dys-sub]{font-size:11.5px;color:var(--dys-dim);font-weight:400;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}[data-dys-grow]{flex:1 1 0;min-width:0;}[data-dys-tools]{margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;min-width:0;max-width:100%;}[data-dys-ico]{width:22px;height:22px;border-radius:7px;flex:0 0 auto;display:grid;place-items:center;background:var(--dys-fill2);color:color-mix(in oklab,currentColor 62%,transparent);}[data-dys-card][data-lead] [data-dys-ico]{background:color-mix(in oklab,var(--dys-blue) 26%,transparent);color:var(--dys-blue);}[data-dys-svg]{display:block;flex:0 0 auto;}[data-dys-dim]{color:var(--dys-dim);}[data-dys-sm]{font-size:11.5px;}[data-dys-xs]{font-size:11px;}[data-dys-hero]{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:14px;align-items:center;padding:15px 17px;border-radius:var(--dys-r);border:1px solid var(--dys-line);background:radial-gradient(120% 150% at 10% 0%,color-mix(in oklab,var(--dys-blue) 14%,transparent),transparent 60%),var(--dys-fill);}[data-dys-ava]{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:16px;font-weight:650;background:color-mix(in oklab,var(--dys-blue) 22%,transparent);color:var(--dys-blue);}[data-dys-name]{font-size:15px;font-weight:650;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}[data-dys-pills]{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:5px;}[data-dys-stats]{display:flex;gap:18px;align-items:center;}[data-dys-stat]{display:flex;flex-direction:column;align-items:flex-end;gap:1px;min-width:52px;}[data-dys-stat] b{display:block;font-size:15px;font-weight:600;line-height:1.3;}[data-dys-stat] span{font-size:11px;color:var(--dys-dim);}[data-dys-herobar]{grid-column:1 / -1;display:flex;align-items:center;gap:10px;margin-top:-2px;padding-top:10px;border-top:1px solid var(--dys-line);}[data-dys-herobar]>span{font-size:10.5px;letter-spacing:.06em;color:var(--dys-dim);white-space:nowrap;}[data-dys-herobar]>i{flex:1 1 0;height:4px;border-radius:999px;background:var(--dys-fill2);overflow:hidden;}[data-dys-herobar]>i>b{display:block;height:100%;border-radius:999px;transition:width .3s ease;}[data-dys][data-cols=\"1\"] [data-dys-hero]{grid-template-columns:auto minmax(0,1fr);row-gap:12px;}[data-dys][data-cols=\"1\"] [data-dys-stats]{grid-column:1 / -1;flex-wrap:wrap;gap:14px 20px;}[data-dys][data-cols=\"1\"] [data-dys-stat]{align-items:flex-start;}[data-dys-pill]{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:1.7;color:color-mix(in oklab,currentColor 74%,transparent);white-space:nowrap;}[data-dys-pill]>i{width:6px;height:6px;border-radius:999px;flex:0 0 auto;background:color-mix(in oklab,currentColor 26%,transparent);}[data-dys-pill][data-tone=\"ok\"]>i{background:var(--dys-ok);}[data-dys-pill][data-tone=\"warn\"]>i{background:var(--dys-amber);}[data-dys-pill][data-tone=\"bad\"]>i{background:var(--dys-bad);}[data-dys-pill][data-tone=\"accent\"]>i{background:var(--dys-blue);}[data-dys-pill][data-strong]{color:var(--dys-ink);}[data-dys-tag]{display:inline-flex;align-items:center;padding:0 6px;border-radius:6px;font-size:10.5px;line-height:1.75;background:var(--dys-fill2);color:color-mix(in oklab,currentColor 66%,transparent);white-space:nowrap;}[data-dys-btn]{appearance:none;cursor:pointer;font:inherit;font-size:12px;line-height:1.5;padding:4px 11px;border-radius:9px;border:1px solid var(--dys-line2);background:transparent;color:var(--dys-ink);white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:5px;transition:background .12s ease,border-color .12s ease,transform .08s ease;}[data-dys-btn]:hover{background:var(--dys-fill2);}[data-dys-btn]:active{transform:translateY(.5px);}[data-dys-btn][data-primary]{border-color:transparent;background:var(--dys-blue);color:var(--dys-on-accent);font-weight:600;}[data-dys-btn][data-primary]:hover{background:color-mix(in oklab,var(--dys-blue) 86%,#000);}[data-dys-btn][data-armed]{border-color:var(--dys-bad);background:color-mix(in oklab,var(--dys-bad) 16%,transparent);color:var(--dys-bad);font-weight:600;}[data-dys-btn][data-ghost]{border-color:transparent;color:var(--dys-dim);padding:3px 7px;}[data-dys-pick]{display:grid;grid-template-columns:56px minmax(0,1fr) auto;gap:6px 10px;align-items:start;padding:9px 0;border-bottom:1px solid var(--dys-line);}[data-dys-pick]:last-child{border-bottom:0;}[data-dys-pick][data-nocover]{grid-template-columns:minmax(0,1fr) auto;padding-left:66px;}[data-dys-thumb]{width:56px;height:56px;border-radius:8px;object-fit:cover;display:block;background:var(--dys-fill2);grid-row:1 / span 2;}[data-dys-pickt]{font-size:12.5px;line-height:1.45;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}[data-dys-pickm]{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:4px;}[data-dys-pickacts]{display:flex;align-items:center;gap:8px;flex:0 0 auto;}[data-dys-pickacts] [data-dys-btn][data-ghost]{font-size:14px;line-height:1;padding:4px 8px;color:color-mix(in oklab,currentColor 70%,transparent);}[data-dys-btn][data-ghost]:hover{color:var(--dys-ink);background:var(--dys-fill2);}[data-dys-btn:disabled]{opacity:.4;cursor:default;}[data-dys-row]{display:flex;gap:7px;align-items:center;flex-wrap:wrap;}[data-dys-bar]{position:relative;height:4px;border-radius:999px;background:var(--dys-fill2);overflow:hidden;flex:1 1 auto;}[data-dys-bar]>i{position:absolute;inset:0 auto 0 0;border-radius:999px;background:var(--dys-ac,var(--dys-blue));}[data-dys-budgetrow]{display:grid;grid-template-columns:64px minmax(0,1fr) 62px;gap:10px;align-items:center;}[data-dys-budgetrow][data-full]>b{color:var(--dys-bad);}[data-dys-budgetrow]>b{font-weight:550;font-size:12px;text-align:right;}[data-dys-tabs]{display:flex;gap:2px;padding:2px;border-radius:10px;background:var(--dys-fill2);}[data-dys-tab]{flex:1 1 0;appearance:none;cursor:pointer;font:inherit;font-size:12px;padding:4px 6px;border-radius:8px;border:0;background:transparent;color:var(--dys-dim);white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:0;}[data-dys-tab]>span{overflow:hidden;text-overflow:ellipsis;}[data-dys-tab][data-on]{background:var(--dys-raise);color:var(--dys-ink);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.14);}[data-dys-tab]>i{font-style:normal;margin-left:5px;font-size:11px;opacity:.75;}[data-dys-auto]{display:flex;flex-direction:column;min-width:0;}[data-dys-autoblock]{border-bottom:1px solid var(--dys-line);padding:3px 0;}[data-dys-autoblock]:last-child{border-bottom:0;}[data-dys-autorow]{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:9px;align-items:center;padding:5px 0;}[data-dys-knobs]{display:flex;flex-wrap:wrap;gap:8px 18px;padding:2px 0 10px 31px;}[data-dys-knob]{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--dys-dim);min-width:0;}[data-dys-knob]>span{white-space:nowrap;}[data-dys-knob] [data-dys-in]{width:108px;}[data-dys-knob] select[data-dys-in]{width:auto;min-width:108px;}[data-dys-ico][data-accent]{background:color-mix(in oklab,var(--dys-blue) 24%,transparent);color:var(--dys-blue);}[data-dys-switch]{appearance:none;cursor:pointer;padding:0;position:relative;flex:0 0 auto;width:34px;height:19px;border-radius:999px;border:1px solid var(--dys-line2);background:var(--dys-fill2);transition:background .15s ease,border-color .15s ease;}[data-dys-switch]>i{position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:999px;background:color-mix(in oklab,currentColor 45%,transparent);transition:left .15s ease,background .15s ease;}[data-dys-switch][data-on]{background:var(--dys-blue);border-color:transparent;}[data-dys-switch][data-on]>i{left:17px;background:var(--dys-on-accent);}[data-dys-ibx]{display:flex;flex-direction:column;gap:2px;min-height:60px;}[data-dys-item]{display:grid;grid-template-columns:6px minmax(0,1fr);gap:9px;padding:8px 8px 8px 0;border-radius:10px;cursor:pointer;border:1px solid transparent;}[data-dys-item]:hover{background:var(--dys-fill2);}[data-dys-item][data-open]{background:var(--dys-fill2);border-color:var(--dys-line);}[data-dys-mark]{width:6px;height:6px;align-self:start;margin-top:6px;border-radius:999px;background:color-mix(in oklab,currentColor 18%,transparent);}[data-dys-item][data-worth=\"1\"] [data-dys-mark]{background:color-mix(in oklab,var(--dys-blue) 55%,transparent);}[data-dys-item][data-worth=\"2\"] [data-dys-mark]{background:var(--dys-blue);}[data-dys-itemtop]{display:flex;align-items:baseline;gap:7px;min-width:0;}[data-dys-itemtop]>b{font-weight:600;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:56%;}[data-dys-itemtop]>time{margin-left:auto;font-size:11px;color:var(--dys-dim);font-style:normal;flex:0 0 auto;}[data-dys-prev]{font-size:12px;color:color-mix(in oklab,currentColor 82%,transparent);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}[data-dys-why]{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px;}[data-dys-body]{display:flex;flex-direction:column;gap:9px;padding:4px 2px 6px 0;}[data-dys-hist]{display:flex;flex-direction:column;gap:3px;max-height:150px;overflow:auto;padding:7px 9px;border-radius:9px;background:var(--dys-fill2);}[data-dys-line]{display:flex;gap:7px;font-size:11.5px;}[data-dys-line]>span:first-child{flex:0 0 30px;color:var(--dys-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}[data-dys-ta]{width:100%;resize:vertical;min-height:56px;font:inherit;font-size:12.5px;line-height:1.5;padding:7px 9px;border-radius:9px;border:1px solid var(--dys-line2);background:color-mix(in oklab,currentColor 6%,transparent);color:var(--dys-ink);}[data-dys-ta]:focus{outline:none;border-color:color-mix(in oklab,var(--dys-blue) 62%,transparent);box-shadow:0 0 0 3px color-mix(in oklab,var(--dys-blue) 16%,transparent);}[data-dys-said]{padding:7px 9px;border-radius:9px;font-size:11.5px;color:var(--dys-ok);background:color-mix(in oklab,var(--dys-ok) 10%,transparent);}[data-dys-field][data-wide]{grid-column:1 / -1;}[data-dys-in][type=\"number\"]{appearance:auto;-moz-appearance:auto;padding-right:2px;}[data-dys-check]{display:inline-flex;align-items:center;gap:7px;font-size:12px;cursor:pointer;min-width:0;}[data-dys-check]>input{width:14px;height:14px;accent-color:var(--dys-blue);cursor:pointer;flex:0 0 auto;margin:0;}[data-dys-check]>span{color:color-mix(in oklab,currentColor 78%,transparent);}input[data-dys-in],select[data-dys-in]{appearance:none;font:inherit;font-size:12px;line-height:1.5;padding:3px 8px;border-radius:8px;border:1px solid var(--dys-line2);background:color-mix(in oklab,currentColor 6%,transparent);color:inherit;min-width:0;}input[data-dys-in]:focus,select[data-dys-in]:focus{outline:none;border-color:color-mix(in oklab,var(--dys-blue) 62%,transparent);box-shadow:0 0 0 3px color-mix(in oklab,var(--dys-blue) 16%,transparent);}input[data-dys-in]::placeholder{color:var(--dys-dim);}[data-dys-list]{display:flex;flex-direction:column;gap:1px;}[data-dys-li]{display:grid;grid-template-columns:6px minmax(0,1fr) auto;gap:9px;align-items:baseline;padding:5.5px 3px;font-size:12px;}[data-dys-li] + [data-dys-li]{border-top:1px solid var(--dys-line);}[data-dys-dot]{width:6px;height:6px;border-radius:999px;align-self:center;background:color-mix(in oklab,currentColor 22%,transparent);}[data-dys-dot][data-ok]{background:var(--dys-ok);}[data-dys-dot][data-bad]{background:var(--dys-bad);}[data-dys-dot][data-warn]{background:var(--dys-amber);}[data-dys-dot][data-accent]{background:var(--dys-blue);}[data-dys-li]>time{font-size:11px;color:var(--dys-dim);font-style:normal;}[data-dys-ell]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}[data-dys-li-main]{display:flex;gap:5px;align-items:baseline;min-width:0;}[data-dys-trend]{display:flex;align-items:flex-end;gap:12px;}[data-dys-trend] svg{flex:1 1 auto;height:44px;overflow:visible;}[data-dys-empty]{padding:12px 2px 4px;font-size:12px;color:var(--dys-dim);text-align:center;}[data-dys-empty]>div + div{margin-top:9px;}[data-dys-err]{font-size:11.5px;color:var(--dys-bad);}[data-dys-note]{font-size:11.5px;color:var(--dys-dim);}[data-dys-pre]{max-height:220px;overflow:auto;font-size:11px;line-height:1.45;padding:8px 10px;border-radius:9px;background:var(--dys-fill2);margin:0;white-space:pre-wrap;word-break:break-word;}[data-dys-skel]{height:44px;border-radius:9px;background:linear-gradient(90deg,var(--dys-fill2),var(--dys-fill),var(--dys-fill2));background-size:200% 100%;animation:dys-skel 1.3s ease-in-out infinite;}@keyframes dys-skel{0%{background-position:0 0}100%{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){[data-dys-skel]{animation:none;}}[data-dys-diag]{border:1px solid var(--dys-line);border-radius:12px;padding:9px 13px;font-size:11.5px;color:var(--dys-dim);}[data-dys-diag]>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:7px;}[data-dys-diag]>summary::-webkit-details-marker{display:none;}[data-dys-diag]>summary::before{content:'▸';font-size:10px;display:inline-block;transition:transform .12s ease;}[data-dys-diag][open]>summary::before{transform:rotate(90deg);}[data-dys-diag]>summary:hover{color:var(--dys-ink);}[data-dys-diagbody]{display:flex;flex-direction:column;gap:6px;margin-top:9px;padding-top:9px;border-top:1px solid var(--dys-line);}[data-dys-kv]{display:grid;grid-template-columns:88px minmax(0,1fr);gap:8px;font-size:11.5px;}[data-dys-kv]>span:first-child{color:var(--dys-dim);}[data-dys-kv]>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}[data-dys-field]{display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px;align-items:center;}[data-dys-formgrid]{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px 10px;}[data-dys-formgrid] [data-dys-field]{grid-template-columns:74px minmax(0,1fr);}[data-dys][data-cols=\"1\"] [data-dys-formgrid]{grid-template-columns:repeat(2,minmax(0,1fr));}[data-dys-flabel]{font-size:11.5px;color:var(--dys-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}[data-dys-group]{grid-column:1 / -1;margin:4px 0 -2px;padding-top:6px;border-top:1px dashed var(--dys-line);font-size:11px;font-weight:650;letter-spacing:.04em;color:var(--dys-dim);}[data-dys-col]>[data-dys-group]:first-child,[data-dys-formgrid]>[data-dys-group]:first-child{margin-top:0;padding-top:0;border-top:0;}[data-dys-formgrid]{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:7px 16px;align-items:start;}[data-dys-formgrid] [data-dys-field]{grid-template-columns:minmax(0,1fr);gap:3px;align-items:start;}[data-dys-field]>textarea{grid-column:2;min-height:48px;}[data-dys-link]{appearance:none;background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;text-align:left;border-bottom:1px dashed var(--dys-line2);}[data-dys-link]:hover{color:var(--dys-blue);border-bottom-color:var(--dys-blue);}[data-dys-stat] b{font-size:22px;font-weight:660;line-height:1.15;letter-spacing:-.02em;font-variant-numeric:tabular-nums;}[data-dys-stat][data-click]{cursor:pointer;border-radius:9px;padding:2px 7px;margin:-2px -7px;transition:background .12s ease;}[data-dys-stat][data-click]:hover{background:var(--dys-fill2);}[data-dys-stat][data-click]:focus-visible{outline:2px solid var(--dys-blue);outline-offset:2px;}[data-dys-next]{grid-column:1 / -1;display:flex;align-items:center;gap:9px;min-width:0;padding-top:8px;margin-top:-2px;border-top:1px dashed var(--dys-line);font-size:11.5px;}[data-dys-nextdot]{flex:0 0 7px;width:7px;height:7px;border-radius:50%;background:var(--dys-ok);}[data-dys-nextdot][data-level=\"warn\"]{background:var(--dys-amber);}[data-dys-nextdot][data-level=\"stop\"]{background:var(--dys-bad);}[data-dys-nexttxt]{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}[data-dys-ibx]{gap:0;}[data-dys-thead],[data-dys-tr]{display:grid;grid-template-columns:6px minmax(70px,1fr) minmax(0,2.2fr) minmax(0,1fr) 68px;gap:9px;align-items:center;}[data-dys-thead]{padding:2px 4px 6px;font-size:10.5px;letter-spacing:.04em;color:var(--dys-dim);border-bottom:1px solid var(--dys-line2);}[data-dys-thead]>span:last-child{text-align:right;}[data-dys-tr]{min-height:30px;padding:5px 4px;border-bottom:1px solid var(--dys-line);cursor:pointer;font-size:12px;}[data-dys-tr]:hover{background:var(--dys-fill2);}[data-dys-tr][data-open]{background:var(--dys-fill2);box-shadow:inset 2px 0 0 var(--dys-blue);}[data-dys-cell]{min-width:0;}[data-dys-tr]>b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:12px;}[data-dys-tr] [data-dys-prev]{-webkit-line-clamp:1;line-clamp:1;margin:0;}[data-dys-tr] [data-dys-why]{margin:0;overflow:hidden;white-space:nowrap;}[data-dys-tr]>time{font-size:11px;color:var(--dys-dim);text-align:right;white-space:nowrap;}[data-dys-tr][data-worth=\"2\"] [data-dys-mark]{background:var(--dys-blue);}[data-dys-log]{display:flex;flex-direction:column;max-height:210px;overflow:auto;}[data-dys-logrow]{display:flex;align-items:center;gap:8px;min-width:0;padding:5px 2px;font-size:11.5px;border-bottom:1px solid var(--dys-line);}[data-dys-logrow]:last-child{border-bottom:0;}[data-dys-logrow]>b{flex:0 0 56px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}[data-dys-logrow]>[data-dys-ell]{max-width:38%;}[data-dys-logtime]{flex:0 0 62px;color:var(--dys-dim);white-space:nowrap;}[data-dys-logrow] [data-dys-dot]{flex:0 0 6px;width:6px;height:6px;margin:0;}[data-dys-sep]{grid-column:1 / -1;display:flex;align-items:center;gap:8px;margin:6px 0 1px;padding:6px 9px;border-radius:9px;background:var(--dys-fill2);border:1px solid var(--dys-line);font-size:11px;font-weight:650;color:color-mix(in oklab,currentColor 78%,transparent);}[data-dys-sep]::before{content:'';width:3px;height:12px;border-radius:2px;background:var(--dys-blue);}[data-dys-pal]{position:fixed;inset:0;z-index:9999;display:grid;place-items:start center;padding-top:14vh;background:color-mix(in oklab,#000 42%,transparent);}[data-dys-palbox]{width:min(420px,92vw);display:flex;flex-direction:column;gap:2px;padding:10px;border-radius:14px;border:1px solid var(--dys-line2);background:var(--dys-raise);box-shadow:0 18px 50px rgba(0,0,0,.34);}[data-dys-paltitle]{padding:5px 9px 9px;font-size:11px;color:var(--dys-dim);}[data-dys-palitem]{appearance:none;border:0;background:transparent;color:var(--dys-ink);font:inherit;font-size:12.5px;text-align:left;padding:8px 10px;border-radius:9px;cursor:pointer;}[data-dys-palitem]:hover{background:var(--dys-fill2);}@media (max-width:720px){[data-dys-seg]{flex-wrap:nowrap;overflow-x:auto;max-width:100%;-webkit-mask-image:linear-gradient(90deg,#000 0,#000 92%,transparent 100%);mask-image:linear-gradient(90deg,#000 0,#000 92%,transparent 100%);}[data-dys-seg]>button{padding:5px 10px;}[data-dys-hero]{gap:10px;padding:12px 13px;}[data-dys-stats]{gap:12px;flex-wrap:wrap;}[data-dys-stat] b{font-size:20px;}[data-dys-thead],[data-dys-tr]{grid-template-columns:6px minmax(60px,.9fr) minmax(0,2fr) 62px;}[data-dys-thead]>span:nth-child(4),[data-dys-tr]>[data-dys-why]{display:none;}[data-dys-next]{flex-wrap:wrap;gap:6px;}[data-dys-logrow]>[data-dys-ell]{max-width:30%;}[data-dys-view]{height:clamp(300px,52vh,460px);}}[data-dys-funnel]{display:flex;flex-direction:column;gap:4px;padding:2px 0 6px;}[data-dys-fstep]{display:grid;grid-template-columns:78px minmax(0,1fr);gap:9px;align-items:center;font-size:11px;color:var(--dys-dim);}[data-dys-fstep]>i{height:6px;border-radius:999px;background:var(--dys-fill2);overflow:hidden;}[data-dys-fstep]>i>b{display:block;height:100%;border-radius:999px;background:var(--dys-blue);}[data-dys-fstep][data-i=\"1\"]>i>b{background:var(--dys-amber);}[data-dys-fstep][data-i=\"2\"]>i>b{background:var(--dys-ok);}"
    /* CSS-GENERATED-END */

    /* ── 数据 ─────────────────────────────────────────────────────────── */
    const TIMEOUT_MS = 260000
    const jfetch = async (p, opts) => {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), TIMEOUT_MS)
      try {
        const r = await fetch(API + p, {
          ...opts, signal: ctl.signal,
          headers: { 'content-type': 'application/json', ...(opts && opts.headers) },
        })
        const txt = await r.text()
        let body
        try { body = txt ? JSON.parse(txt) : {} } catch { body = { ok: false, error: '返回不是 JSON：' + txt.slice(0, 160) } }
        if (!r.ok && body && body.error == null) body.error = 'HTTP ' + r.status
        return body
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) }
      } finally { clearTimeout(t) }
    }
    const jget = (p) => jfetch(p)
    const jpost = (p, body) => jfetch(p, { method: 'POST', body: JSON.stringify(body || {}) })

    const pad2 = (x) => String(x).padStart(2, '0')
    const hhmm = (iso) => {
      if (!iso) return '—'
      const d = new Date(iso)
      if (Number.isNaN(+d)) return '—'
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    }
    const ago = (iso) => {
      if (!iso) return ''
      const ms = Date.now() - +new Date(iso)
      if (!Number.isFinite(ms) || ms < 0) return ''
      const m = Math.round(ms / 60000)
      if (m < 1) return '刚刚'
      if (m < 60) return m + ' 分钟前'
      const hr = Math.round(m / 60)
      if (hr < 24) return hr + ' 小时前'
      return Math.round(hr / 24) + ' 天前'
    }
    const Time = ({ at, when }) => (at ? h('time', { title: hhmm(at) }, when || ago(at) || hhmm(at)) : h('time', null, '—'))
    const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
    const short = (s, n) => {
      const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
      return t.length > n ? t.slice(0, n - 1) + '…' : t
    }
    /* 日志行的时间戳不一定是 ISO（可能是 "2026-11-02 12:00:00"），兜一层；
     * 跨天的补上「月/日」—— 否则昨天 23:41 会混在今天的 22:xx 中间，看着像乱序。 */
    const stamp = (at) => {
      const d = new Date(at)
      if (!Number.isNaN(+d)) {
        const n = new Date()
        const sameDay = d.getFullYear() === n.getFullYear()
          && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
        return (sameDay ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ')
          + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
      }
      const m = String(at || '').match(/(\d{2}:\d{2})/)
      return m ? m[1] : '—'
    }

    /** 一处集中拉取：键 = 路由（带查询串），值 = 结果。
     *  ⚠️ 三个坑都在这里堵掉（2026-11-03）：
     *    ① **乱序覆盖**：连点两次刷新时，先发的慢请求后到，会把新结果盖回旧的。
     *       给每个 key 记一个递增序号，写入前比对，过期的直接丢。
     *    ② **卸载后 setState**：面板关掉时还有请求在飞（/inbox 能跑十几秒），
     *       没有守卫就是往一个已经不在的组件里写状态。
     *    ③ **同键重复请求**：两个调用方同时要同一个 key，会起两条一样的请求。
     *       用一张 in-flight 表复用在途 promise。 */
    function useData() {
      const [state, setState] = useState({ data: {}, err: {}, loading: {} })
      const seq = useRef({})       // key → 最新一次请求的序号
      const inflight = useRef({})  // key → 正在飞的那个 promise
      const alive = useRef(true)
      useEffect(() => () => { alive.current = false }, [])

      const load = useCallback(async (keys) => {
        const list = (keys || []).filter(Boolean)
        if (!list.length) return
        const mine = {}
        for (const k of list) mine[k] = (seq.current[k] = (seq.current[k] || 0) + 1)

        if (alive.current) {
          setState((s) => {
            const loading = { ...s.loading }
            for (const k of list) loading[k] = true
            return { ...s, loading }
          })
        }

        const out = await Promise.allSettled(list.map((k) => {
          const flying = inflight.current[k]
          if (flying) return flying
          const p = jget(k).finally(() => {
            if (inflight.current[k] === p) delete inflight.current[k]
          })
          inflight.current[k] = p
          return p
        }))

        if (!alive.current) return
        setState((s) => {
          const data = { ...s.data }; const err = { ...s.err }; const loading = { ...s.loading }
          list.forEach((k, i) => {
            if (mine[k] !== seq.current[k]) return // 有更新的请求在路上了，这次的结果作废
            delete loading[k]
            const r = out[i]
            if (r.status === 'fulfilled') {
              const v = r.value || {}
              data[k] = v
              if (v.ok === false && v.error) err[k] = String(v.error)
              else delete err[k]
            } else err[k] = String((r.reason && r.reason.message) || r.reason)
          })
          return { data, err, loading }
        })
      }, [])

      /** 丢掉某个 key 的结果（比如 fresh=1 那种一次性请求，不该长期占内存） */
      const drop = useCallback((keys) => {
        setState((s) => {
          const data = { ...s.data }; const loading = { ...s.loading }
          for (const k of keys || []) { delete data[k]; delete loading[k] }
          return { ...s, data, loading }
        })
      }, [])

      return { ...state, load, drop }
    }

    /* ── 小件 ─────────────────────────────────────────────────────────── */
    /* ── 图标 ─────────────────────────────────────────────────────────────
     * 手写内联 SVG：这个文件没有构建、不能引外部图标库，也不该为一堆图标
     * 去拉 CDN（离线就全没了）。只用 stroke 路径，颜色跟 currentColor 走，
     * 所以深浅两套主题自动都对。 */
    const ICONS = {
      inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z'],
      pulse: ['M3 12h3.5l2-6 3.5 12 2.5-6H21'],
      bolt: ['M13 2 4 14h6l-1 8 9-12h-6z'],
      sliders: ['M4 7h9M17 7h3M4 17h3M11 17h9', 'M15 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3', 'M9 15.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 1 1 0-3'],
      gauge: ['M3.6 17a9 9 0 1 1 16.8 0', 'M12 12l4-3'],
      server: ['M3 4h18v6H3zM3 14h18v6H3z', 'M7 7h.01M7 17h.01'],
      film: ['M3 4h18v16H3z', 'M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4'],
      chart: ['M3 3v18h18', 'M7 14l4-4 3 3 5-6'],
      send: ['M22 2 11 13', 'M22 2l-7 20-4-9-9-4z'],
      share: ['M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7', 'M16 6l-4-4-4 4', 'M12 2v13'],
      upload: ['M12 17V4', 'M7 9l5-5 5 5', 'M4 20h16'],
      comment: ['M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-5A8 8 0 0 1 13 4a8 8 0 0 1 8 8z'],
      at: ['M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9', 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8'],
      refresh: ['M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5'],
      download: ['M12 4v11', 'M7 10l5 5 5-5', 'M4 20h16'],
      history: ['M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5', 'M12 8v4l3 2'],
      check: ['M4 12.5 9 17.5 20 6.5'],
      alert: ['M12 3 2.5 20h19z', 'M12 9v4M12 17h.01'],
      bot: ['M5 8h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M12 4v4', 'M9 13h.01M15 13h.01'],
    }
    const Ico = ({ name, size = 13, style }) => {
      const paths = ICONS[name]
      if (!paths) return null
      return h('svg', {
        'data-dys-svg': '', width: size, height: size, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false', style,
      }, paths.map((d, i) => h('path', { key: i, d })))
    }

    const Card = ({ title, sub, lead, tools, icon, kind, children }) =>
      h('section', { 'data-dys-card': '', 'data-kind': kind || 'list', 'data-lead': lead ? '' : undefined },
        (title || tools) ? h('div', { 'data-dys-head': '' },
          h('div', { 'data-dys-title': '' },
            icon ? h('span', { 'data-dys-ico': '' }, Ico({ name: icon, size: 13 })) : null,
            title),
          sub ? h('div', { 'data-dys-sub': '', 'data-dys-grow': '' }, sub) : h('div', { 'data-dys-grow': '' }),
          tools ? h('div', { 'data-dys-tools': '' }, tools) : null) : null,
        children)

    const Btn = ({ label, icon, onClick, busy, busyLabel, disabled, primary, ghost, armed, title }) =>
      h('button', {
        'data-dys-btn': '',
        'data-primary': primary ? '' : undefined,
        'data-ghost': ghost ? '' : undefined,
        'data-armed': armed ? '' : undefined,
        disabled: disabled || busy,
        title,
        onClick,
      },
        icon && !busy ? Ico({ name: icon, size: 12 }) : null,
        busy ? (busyLabel || '…') : label)

    /* 状态：圆点 + 文字。tone 只染圆点，文字永远中性 —— 这样一屏不会有六种彩字。 */
    const Pill = ({ tone, strong, children, title }) =>
      h('span', {
        'data-dys-pill': '', 'data-tone': tone, 'data-strong': strong ? '' : undefined, title,
      }, h('i'), children)

    const Tag = ({ children }) => h('span', { 'data-dys-tag': '' }, children)

    const Bar = ({ now, max, color }) => {
      const pct = max > 0 ? Math.min(100, Math.round((now / max) * 100)) : 0
      return h('div', { 'data-dys-bar': '', style: color ? { '--dys-ac': color } : undefined },
        h('i', { style: { width: pct + '%' } }))
    }
    const barTone = (now, max) =>
      (max > 0 && now >= max) ? 'var(--dys-bad)'
        : (max > 0 && now / max >= 0.8) ? 'var(--dys-amber)'
          : 'var(--dys-blue)'

    const Empty = ({ text, action }) =>
      h('div', { 'data-dys-empty': '' },
        h('div', null, text),
        action ? h('div', null, action) : null)

    const ErrLine = ({ text }) => (text ? h('div', { 'data-dys-err': '' }, '读不到：' + text) : null)

    /* ── 表单引擎：字段用描述表驱动 ────────────────────────────────────
     * 这样做的好处：加一个设置项 = 加一行对象，不是复制一段 JSX。
     * 面板已经十个卡了，再按老写法堆，client.js 会先撑不住。 */
    const Field = ({ f, v, onChange, onCommit }) => {
      const val = v == null ? '' : v
      const blur = (e) => { if (typeof onCommit === 'function') onCommit(f.k, e.target.value) }
      const ctl = f.type === 'bool'
        /* 开关：勾完立刻落盘（不等 blur）—— 勾选框没有"输完"这个动作 */
        ? h('label', { 'data-dys-check': '' },
          h('input', {
            type: 'checkbox', checked: Boolean(val),
            onChange: (e) => {
              onChange(f.k, e.target.checked)
              if (typeof onCommit === 'function') onCommit(f.k, e.target.checked)
            },
          }),
          h('span', null, Boolean(val) ? (f.on || '开') : (f.off || '关')))
        : f.type === 'select'
        ? h('select', { 'data-dys-in': '', value: val, onChange: (e) => onChange(f.k, e.target.value), onBlur: blur },
          f.options.map((o) => {
            const ov = typeof o === 'string' ? o : o.value
            const ol = typeof o === 'string' ? o : o.label
            return h('option', { key: ov, value: ov }, ol)
          }))
        : f.type === 'area'
          ? h('textarea', {
            'data-dys-ta': '', value: val, placeholder: f.ph || '',
            onChange: (e) => onChange(f.k, e.target.value), onBlur: blur,
          })
          : h('input', {
            'data-dys-in': '', value: val, placeholder: f.ph || '',
            /* 数字字段给真的 number 输入框：右侧能点上下箭头调，不用敲键盘
             * （主人说别人的插件都这样）。min/max 只是提示，后端还会再夹一次。 */
            ...(f.type === 'number'
              ? {
                type: 'number',
                step: f.step || 1,
                ...(f.min != null ? { min: f.min } : {}),
                ...(f.max != null ? { max: f.max } : {}),
              }
              : {}),
            onChange: (e) => onChange(f.k, e.target.value), onBlur: blur,
          })
      return h('label', { 'data-dys-field': '', 'data-wide': f.w === 2 ? '' : undefined },
        h('span', { 'data-dys-flabel': '', title: f.label }, f.label), ctl)
    }

    /* 分组：一行 13 个输入框是「表单墙」，扫一眼找不到北。小标题把它们切成三摞。 */
    const SETTING_FIELDS = [
      { g: '内容' },
      { k: 'ownerNick', label: '主人昵称', ph: '报平安发给它' },
      { k: 'ownerUid', label: '主人 uid', ph: '填了就不受「同一人每天2条」' },
      { k: 'keywords', label: '关键词', ph: '逗号分隔；填了会按词去搜' },
      { k: 'blockKeywords', label: '屏蔽词', ph: '命中就跳过' },
      /* 时效：没有这一层，第一轮会把几个月前的老评论翻出来回一遍。0 = 不限。 */
      { k: 'replyFreshHours', label: '只回多少小时内的评论', ph: '48（0 = 不限）', type: 'number', min: 0, max: 720 },
      { g: '刷视频' },
      { k: 'scanPerRound', label: '每轮看几个', ph: '10', type: 'number', min: 0, max: 50 },
      { k: 'scanGap', label: '每看完一条歇几秒', ph: '6', type: 'number', min: 0, max: 60 },
      { k: 'scanEveryMin', label: '两轮之间隔几分钟', ph: '240', type: 'number', min: 0, max: 1440, step: 10 },
      { k: 'minSec', label: '最短秒数', ph: '0 = 不限', type: 'number', min: 0, max: 600 },
      { k: 'maxSec', label: '最长秒数', ph: '0 = 不限', type: 'number', min: 0, max: 600 },
      { k: 'minDigg', label: '最低点赞', ph: '0 = 不限', type: 'number', min: 0, step: 100 },
      /* 自动刷：几点到几点之间铺开几轮。0 轮就是关。 */
      { k: 'scanRounds', label: '每天自己刷几轮', ph: '0 = 不自动刷', type: 'number', min: 0, max: 12 },
      { k: 'scanFrom', label: '从几点开始', ph: '9', type: 'number', min: 0, max: 23 },
      { k: 'scanTo', label: '到几点结束', ph: '22', type: 'number', min: 0, max: 23 },
      { g: '时间' },
      /* 顺序 = 两列网格的行顺序：**相邻两个必须是一对**。
       * 上一版把「静音从 / 静音到」拆到了两行，「静音到 / 谷时从」并排 ——
       * 看着像四个不相干的输入框，这就是那页"怪"的原因。 */
      { sep: '静音时段' },
      { k: 'quietFrom', label: '静音从', ph: 'HH:MM' },
      { k: 'quietTo', label: '静音到', ph: 'HH:MM' },
      /* 低峰可以配两段。它只决定「主动发布 / 自动刷视频」什么时候跑；
       * 回消息在 09:00–23:00 都照常（除非把下面的「高峰期也回消息」关掉）。 */
      { sep: '低峰一' },
      { k: 'activeFrom', label: '低峰一 · 从', ph: '00:30' },
      { k: 'activeTo', label: '低峰一 · 到', ph: '08:30' },
      { sep: '低峰二' },
      { k: 'active2From', label: '低峰二 · 从', ph: '留空 = 不设' },
      { k: 'active2To', label: '低峰二 · 到', ph: '留空 = 不设' },
      /* 两个出口分开数：私信分享几条、评论区 @ 几条。0 = 那条路不走。 */
      { k: 'sharePerDay', label: '每天私信发你几条', ph: '0 = 不发', type: 'number', min: 0, max: 10 },
      { k: 'atPerDay', label: '每天评论区 @ 你几条', ph: '0 = 不 @', type: 'number', min: 0, max: 10 },
      /* 这两个以前只在插件 config 里，改完还得重启；现在存了就把定时器重开一遍 */
      { k: 'dutyEveryMin', label: '回评论隔几分钟看一次', ph: '30', type: 'number', min: 5, max: 240, step: 5 },
      { k: 'watchEverySec', label: '盯私信隔几秒看一次', ph: '90', type: 'number', min: 30, max: 600, step: 10 },
      /* 两个开关放最后、各占整行：夹在时间输入框中间时，勾选框和输入框高度对不齐，
       * 那一行看着就是歪的。 */
      { k: 'peakReply', label: '高峰期也回消息', type: 'bool', w: 2,
        on: '开（便宜时多做，贵时不装死）', off: '关（只在低峰窗口里回）' },
      { k: 'notifyQuiet', label: '静音时段不叫你', type: 'bool', w: 2,
        on: '开（按时段静音）', off: '关（随时可以叫）' },
      { g: '说话' },
      { k: 'persona', label: '人设（你谁）', ph: '留空 = 通用口吻' },
      { k: 'botName', label: '自称（日报标题）', ph: '留空 = 「日报」' },
      { k: 'replyStyle', label: '说话语气', type: 'select', options: ['温和', '简短', '专业', '幽默'] },
    ]

    /* 18 个字段一次摊开就是两张屏。按 g 切成四页，一次只显示一页。 */
    const SETTING_GROUPS = SETTING_FIELDS.reduce((acc, f) => {
      if (f.g) acc.push({ name: f.g, fields: [] })
      else if (acc.length) acc[acc.length - 1].fields.push(f)
      return acc
    }, [])

    const SettingsCard = ({ data, err, loading, onSaved }) => {
      const [v, setV] = useState(null)
      const [grp, setGrp] = useState(SETTING_GROUPS[0] && SETTING_GROUPS[0].name)
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const src = data && data.settings
      const sig = src ? JSON.stringify(src) : ''
      useEffect(() => { if (src) setV(src) }, [sig]) // eslint-disable-line
      const set = (k, val) => { setV((o) => ({ ...(o || {}), [k]: val })); setNote('') }
      const save = async () => {
        setBusy(true); setNote('')
        try {
          const r = await jpost('/settings', { settings: v })
          if (r && r.ok) { setNote('已保存 · 立刻生效（定时器按新值重开了）'); onSaved && onSaved(r.settings) }
          else setNote('没存上：' + ((r && r.error) || '未知原因'))
        } catch (e) { setNote('没存上：' + String((e && e.message) || e)) }
        finally { setBusy(false) }
      }
      /* 改完失焦就存一次（哥哥要的「我自己改就方便」）。旧后端不认 patch ——
       * 认不出 patch 就会把整份设置 normalize 成默认值，所以先看服务端有没有这个能力。 */
      const canPatch = Boolean(data && data.patch)
      const saveField = async (k, val) => {
        if (!canPatch) { setV((o) => ({ ...(o || {}), [k]: val })); setNote('改好了，点右上「保存」'); return }
        setNote('存着呢…')
        try {
          const r = await jpost('/settings', { patch: { [k]: val } })
          setNote(r && r.ok ? '已保存 · 立刻生效' : '没存上：' + ((r && r.error) || ''))
          if (r && r.ok) onSaved && onSaved(r.settings)
        } catch (e) { setNote('没存上：' + String((e && e.message) || e)) }
      }
      /* 主人身份：点「查一下」才真去查 —— 拉会话、必要时抄一遍昵称表，只读不发消息。
       * 绿灯 = 这个号认到了（uid 在会话里，或昵称唯一对上）；红灯会带原因。 */
      const [own, setOwn] = useState(null)
      const [ownBusy, setOwnBusy] = useState(false)
      const checkOwner = async () => {
        if (!v) return
        setOwnBusy(true); setOwn(null)
        try {
          const r = await jpost('/owner/verify', { nick: v.ownerNick || '', uid: v.ownerUid || '' })
          setOwn(r || { level: 'red', why: '没拿到结果' })
        } catch (e) { setOwn({ level: 'red', why: String((e && e.message) || e) }) }
        finally { setOwnBusy(false) }
      }
      const ownNode = h('div', { 'data-dys-own': '', 'data-level': (own && own.level) || 'idle' },
        h('i', { 'data-dys-dot': '' }),
        h('div', null,
          h('b', null, own ? (own.level === 'green' ? '认到了' : '没认到') : '还没查'),
          h('span', { 'data-dys-xs': '', 'data-dys-dim': '' },
            own ? (own.why || '') : '查一下：它去会话和昵称表里找这个号，只读，不发消息')),
        h(Btn, { label: own ? '再查' : '查一下', icon: 'eye', busy: ownBusy, busyLabel: '查…', disabled: !v, onClick: checkOwner }))

      return h(Card, {
        title: '机器人设置', icon: 'sliders', kind: 'form',
        sub: '存了就会传给后台命令',
        tools: h('div', { 'data-dys-row': '' },
          note ? h('span', { 'data-dys-xs': '', 'data-dys-dim': '' }, note) : null,
          h(Btn, { label: '保存', icon: 'check', busy, busyLabel: '存…', disabled: !v, onClick: save })),
      },
        loading && !v
          ? h('div', { 'data-dys-col': '', style: { gap: '6px' } }, [0, 1, 2].map((i) => h('div', { key: i, 'data-dys-skel': '' })))
          : null,
        v ? ownNode : null,
        v
          ? h('div', { 'data-dys-tabs': '' },
            SETTING_GROUPS.map((g) => h('button', {
              key: g.name, type: 'button', 'data-dys-tab': '', 'data-on': grp === g.name ? '' : undefined,
              onClick: () => setGrp(g.name),
            }, g.name, h('i', null, g.fields.length + ' 项'))))
          : null,
        v
          ? h('div', { 'data-dys-formgrid': '' },
            (SETTING_GROUPS.find((g) => g.name === grp) || SETTING_GROUPS[0] || { fields: [] }).fields
              .map((f) => f.sep
                ? h('div', { key: 'sep-' + f.sep, 'data-dys-sep': '' }, f.sep)
                : h(Field, { key: f.k, f, v: v[f.k], onChange: set, onCommit: saveField })))
          : null,
        err ? h(ErrLine, { text: err }) : null,
        h('div', { 'data-dys-note': '' },
          '关键词非空时，刷视频会按你的词去搜；空着才回落到推荐流。谷时填 00:30 / 08:30 = 只在半夜动，两个都空着 = 不限制。'))
    }

    /* ── 自主执行 ────────────────────────────────────────────────────────
     * 这里**没有输入框**。回什么、发哪个、什么时候发，都是它自己定的；
     * 面板只负责定规矩：开不开、最多几条、内容从哪来。
     * 所以别在这里加"发给谁 / 说什么"——那是替它写作业，不是配置。 */
    const AUTO_ROWS = [
      {
        k: 'autoDm', icon: 'send', label: '回私信',
        desc: '有新私信时自己接一句；认不出是谁就先查名字，查不到就不发',
        knobs: [{ k: 'replyMaxPerRound', label: '每轮几条', type: 'number' }],
      },
      {
        k: 'autoComment', icon: 'comment', label: '回评论',
        desc: '值班时挑该接的评论回；每条都过「人 / 楼 / 次数 / 额度」四道闸',
        knobs: [{ k: 'replyMaxPerRound', label: '每轮几条', type: 'number' }],
      },
      {
        k: 'autoAt', icon: 'at', label: '回 @我',
        desc: '有人 @ 我就去评论区回一句；只在 7 天内、有明确落点的通知里挑，公开可见',
      },
      {
        k: 'autoPublish', icon: 'upload', label: '发作品',
        desc: '扫内容库，按文件名顺序发；发过的记在案，不会重复发',
        knobs: [
          { k: 'publishDir', label: '内容库目录', ph: 'D:\\抖音内容' },
          { k: 'publishPerDay', label: '每天几条', type: 'number' },
          {
            k: 'publishMode', label: '存成', type: 'select', options: [
              { value: 'draft', label: '草稿（推荐）' },
              { value: 'now', label: '直接发出去' },
            ],
          },
        ],
      },
      {
        k: 'autoReport', icon: 'bot', label: '报平安',
        desc: '到点给你发一条今天的账：回了多少、发了多少、还剩多少额度',
        knobs: [{ k: 'reportAt', label: '每天几点', ph: '21:30' }],
      },
    ]

    const Switch = ({ on, onClick, title }) =>
      h('button', {
        type: 'button', 'data-dys-switch': '', 'data-on': on ? '' : undefined,
        'aria-pressed': on ? 'true' : 'false', title, onClick,
      }, h('i'))

    /* 迷你字段：自己存一份草稿，**失焦才提交**。
     * 之前每敲一个字符就 POST 一次，服务端回写 → value 被覆盖 → 光标跳走，
     * 输 "21:30" 会变成 "2"。这类"输入框自己打架"的 bug 只在真打字时出现。 */
    const MiniField = ({ f, v, onCommit }) => {
      const sig = v == null ? '' : String(v)
      const [x, setX] = useState(sig)
      useEffect(() => { setX(sig) }, [sig])
      const ctl = f.type === 'select'
        ? h('select', {
          'data-dys-in': '', value: x,
          onChange: (e) => { setX(e.target.value); onCommit(e.target.value) },
        }, f.options.map((o) => h('option', { key: o.value, value: o.value }, o.label)))
        : h('input', {
          'data-dys-in': '', type: f.type === 'number' ? 'number' : 'text',
          value: x, placeholder: f.ph || '',
          onChange: (e) => setX(e.target.value),
          onBlur: () => { if (x !== sig) onCommit(x) },
        })
      return h('label', { 'data-dys-knob': '' }, h('span', null, f.label), ctl)
    }

    /* 一轮"会做什么"的文字（dry 用，也给真跑 0 件时解释原因） */
    const summarizeDry = (r) => [r.dm, r.at, r.publish, r.report].map((x) => {
      if (!x) return ''
      const n = (x.results && x.results.length) || (x.would ? 1 : 0)
      if (n) return (x === r.dm ? '私信会回 ' : x === r.at ? '会回 ' : '') + n + (x === r.dm ? ' 条' : x === r.at ? ' 条 @' : '')
      if (x.would && x.would.title) return '发布会发「' + x.would.title + '」'
      return x.skipped || x.note || x.error || ''
    }).filter(Boolean).join(' · ')

    const summarize = (r) => {
      if (!r) return ''
      if (r.ok === false) return '✗ ' + (r.error || '没成')
      if (r.skipped) return r.skipped
      if (r.dry) return summarizeDry(r) || '这一轮没什么可做的'
      const sent = (r.dm && r.dm.sent) || 0
      const ats = (r.at && r.at.sent) || 0
      const pub = r.publish && r.publish.ok ? 1 : 0
      const rep = r.report && r.report.ok ? 1 : 0
      const n = sent + ats + pub + rep
      const bits = [sent && '私信 ' + sent, ats && '@ ' + ats, pub && '发作品', rep && '报平安'].filter(Boolean)
      /* 0 件也要说清为什么，不然看着像"按钮没反应" */
      if (!n) return '这一轮什么也没做：' + (summarizeDry(r) || '没挑到该做的')
      return '这一轮做了 ' + n + ' 件' + (bits.length ? '（' + bits.join(' · ') + '）' : '')
    }

    const AUTOPILOT_CN = { dm: '私信', at: '回 @', publish: '发布', report: '报平安' }

    const AutopilotCard = ({ data, settings, err, loading, alive, onSaved, onRun }) => {
      const src = settings || {}
      const sig = JSON.stringify(src)
      const [v, setV] = useState(src)
      const [busy, setBusy] = useState(false)
      const [armed, setArmed] = useState(false)
      const [res, setRes] = useState(null)
      const [note, setNote] = useState('')
      const timer = useRef(0)
      useEffect(() => { setV(src) }, [sig]) // eslint-disable-line
      useEffect(() => () => clearTimeout(timer.current), [])

      const save = async (patch) => {
        const next = { ...(v || {}), ...(patch || {}) }
        setV(next); setBusy(true); setNote('')
        try {
          const r = await jpost('/settings', { settings: next })
          if (r && r.ok) { setNote('已存'); onSaved && onSaved(r.settings) }
          else setNote('没存上：' + ((r && r.error) || '未知原因'))
        } catch (e) { setNote('没存上：' + String((e && e.message) || e)) }
        finally { setBusy(false) }
      }

      /* 开关是"立刻生效"的：改完就落盘。回评论还牵着值班的启停，
       * 不然会出现"开关是开的，但值班没跑"——那比不开更让人困惑。 */
      const flip = async (row) => {
        const on = !v[row.k]
        await save({ [row.k]: on })
        if (row.k === 'autoComment') {
          try { await jpost('/duty', { action: on ? 'start' : 'stop', auto: on }) } catch { /* 值班起不来不该挡住保存 */ }
        }
        if (row.k === 'autoDm' || row.k === 'autoPublish' || row.k === 'autoAt') onRun && onRun()
      }

      /* 手动点「现在跑一轮」就是人的确认，不再要点两次 ——
       * 之前那套 armed 二次确认让人以为按钮坏了（2026-11-03 哥哥踩到）。 */
      const run = async (dry) => {
        clearTimeout(timer.current); setArmed(false)
        setBusy(true); setRes(null); setNote(dry ? '演练中…' : '跑着呢…')
        try {
          setRes(await jpost('/autopilot/run', dry ? { dry: true } : { confirm: true, manual: true }))
          setNote('')
        } catch (e) {
          setRes({ ok: false, error: String((e && e.message) || e) })
          setNote('')
        } finally { setBusy(false) }
        if (onRun) onRun()
      }

      const today = (data && data.today) || {}
      const log = (data && data.log) || []
      const onCount = AUTO_ROWS.filter((r) => v[r.k]).length

      return h(Card, {
        title: '自主执行', icon: 'bolt', kind: 'form',
        sub: onCount ? (onCount + ' 项开着 · 它自己判断') : '现在全关着，只看不动',
        tools: note ? h('span', { 'data-dys-xs': '', 'data-dys-dim': '' }, note) : null,
      },
        loading && !Object.keys(src).length
          ? h('div', { 'data-dys-col': '', style: { gap: '6px' } }, [0, 1, 2].map((i) => h('div', { key: i, 'data-dys-skel': '' })))
          : null,
        h('div', { 'data-dys-auto': '' },
          AUTO_ROWS.map((row) => {
            const on = Boolean(v[row.k])
            return h('div', { key: row.k, 'data-dys-autoblock': '' },
              h('div', { 'data-dys-autorow': '' },
                h('span', { 'data-dys-ico': '', 'data-accent': on ? '' : undefined }, Ico({ name: row.icon, size: 12 })),
                h('div', { 'data-dys-col': '', style: { gap: '1px', minWidth: 0 } },
                  h('div', { 'data-dys-sm': '', style: { fontWeight: 550 } }, row.label),
                  h('div', { 'data-dys-xs': '', 'data-dys-dim': '' }, row.desc)),
                h(Switch, { on, onClick: () => flip(row), title: on ? '关掉' : '打开' })),
              on && row.knobs && row.knobs.length
                ? h('div', { 'data-dys-knobs': '' },
                  row.knobs.map((f) => h(MiniField, {
                    key: f.k, f, v: v[f.k],
                    onCommit: (val) => save({ [f.k]: val }),
                  })))
                : null)
          })),
        v.autoReport && !v.ownerNick
          ? h('div', { 'data-dys-note': '' }, '还没填「主人昵称」—— 在上面「机器人设置」里填一次，它才知道发给谁')
          : null,
        h('div', { 'data-dys-row': '' },
          h(Btn, { label: '演练一轮', ghost: true, icon: 'pulse', busy, onClick: () => run(true), title: '只看它会怎么做，不真发' }),
          h(Btn, {
            label: '现在跑一轮', icon: 'bolt', busyLabel: '跑着呢…',
            primary: true, onClick: () => run(false),
            title: '立刻按上面的开关跑一轮（不等定时）',
          })),
        h('div', { 'data-dys-xs': '', 'data-dys-dim': '' },
          '受额度和静音时段限制；关掉就是只读。定时器每 5 分钟看一次。'),
        res ? h('div', {
          'data-dys-sm': '',
          style: {
            color: res.ok === false ? 'var(--dys-bad)' : 'var(--dys-ink)',
            background: 'var(--dys-fill)', borderRadius: '8px', padding: '7px 9px', lineHeight: 1.5,
          },
        }, summarize(res)) : null,
        res && res.ok && res.dm && res.dm.results && res.dm.results.length
          ? h('div', { 'data-dys-col': '', style: { gap: '3px' } },
            res.dm.results.slice(0, 3).map((x, i) => h('div', { key: i, 'data-dys-xs': '', 'data-dys-dim': '' },
              (x.nick || x.peer || '?') + ' · ' + (x.ok ? '回了：' + x.text : (x.skip || x.error || '跳过')))))
          : null,
        log.length
          ? h('div', { 'data-dys-xs': '', 'data-dys-dim': '', style: { marginTop: '2px' } }, '它最近自己做的')
          : null,
        log.length
          ? h('div', { 'data-dys-list': '' }, log.slice(0, 3).map((x, i) => h('div', { key: i, 'data-dys-li': '' },
            h('span', { 'data-dys-dot': '', 'data-ok': x.ok ? '' : undefined, 'data-bad': x.ok ? undefined : '' }),
            h('div', { 'data-dys-ell': '' },
              h('span', { 'data-dys-li-main': '' },
                h('span', { 'data-dys-dim': '', 'data-dys-xs': '' }, AUTOPILOT_CN[x.kind] || x.kind),
                h('b', { style: { fontWeight: 600 } }, short(x.who || '', 16))),
              x.text ? h('span', { 'data-dys-dim': '', 'data-dys-xs': '' }, ' · ' + short(x.text, 30)) : null),
            h('time', null, stamp(x.at)))))
          : null,
        today.publishLeft != null && v.autoPublish
          ? h('div', { 'data-dys-xs': '', 'data-dys-dim': '' }, '今天还能自己发 ' + today.publishLeft + ' 条')
          : null,
        err ? h(ErrLine, { text: err }) : null,
        /* /config 能通、只有这张卡读不到 —— 说明界面是新的、后台还是旧进程。
         * 不点破的话，用户会以为开关坏了（其实那条路由根本不存在）。 */
        err && alive
          ? h('div', { 'data-dys-note': '' }, '后台还是旧进程：这些开关现在存不上。重启一次 DSH 才会生效。')
          : null)
    }

    /* ── 头部：三个数回答「现在要不要动手」，不是粉丝/作品/获赞 ── */
    const stat = (v, label, onClick) => h('div', {
      'data-dys-stat': '', 'data-click': onClick ? '' : undefined,
      role: onClick ? 'button' : undefined, tabIndex: onClick ? 0 : undefined,
      title: onClick ? '点一下跳到那一区' : undefined,
      onClick, onKeyDown: onClick ? (e) => { if (e.key === 'Enter') onClick() } : undefined,
    },
      h('b', null, v == null || v === '' ? '—' : v),
      h('span', null, label))

    const Head = ({ status, budget, watch, kill, onRefresh, refreshing, schedule, onJump, onPause, onKill }) => {
      const u = (status && status.self && status.self.user) || {}
      const b = budget || {}
      const msgs = b.messages || {}
      const q = (status && status.quota) || {}
      const nick = u.nickname || '（读不到账号）'
      const watchOn = !!(watch && watch.running)
      /* 停损状态由服务端读 KILL 文件给出：面板不缓存、不猜，避免"按钮显示关着、其实还在发"。 */
      const killed = !!(kill && kill.killed)
      const killWhy = (kill && kill.info && kill.info.reason) || ''
      const logged = !!(status && status.ok)
      /* 看板只留一个主数字：今天还能发几条。旁边一条细进度条，
       * 扫一眼就知道离限流还有多远，不用去读小字。 */
      const usedMsgs = num(msgs.day)
      const capMsgs = num(msgs.max)
      const pct = capMsgs > 0 ? Math.min(100, Math.round(usedMsgs / capMsgs * 100)) : 0
      const tone = pct >= 90 ? 'var(--dys-bad)' : pct >= 70 ? 'var(--dys-amber)' : 'var(--dys-blue)'
      /* 看板数字由服务端的 heroView 算好：拿不到就是 null → 画「—」，绝不画成 0。 */
      const hero = (schedule && schedule.hero) || {}
      const next = (schedule && schedule.next) || {}
      const sum = (schedule && schedule.summary) || {}
      const health = (schedule && schedule.health) || {}
      const jump = (v) => (onJump ? () => onJump(v) : undefined)
      const lastTxt = hero.lastReply ? (hero.lastReply.ok ? '成功' : '失败') : null
      return h('div', { 'data-dys-hero': '' },
        h('div', { 'data-dys-ava': '' },
          (logged && u.nickname) ? String(u.nickname).slice(0, 1) : Ico({ name: 'bot', size: 19 })),
        h('div', { 'data-dys-col': '', style: { gap: '0px' } },
          h('div', { 'data-dys-name': '' }, nick),
          h('div', { 'data-dys-pills': '' },
            Pill({ tone: logged ? 'ok' : 'bad', strong: true, children: logged ? '已登录' : '没登上' }),
            Pill({ tone: watchOn ? 'ok' : undefined, children: watchOn ? '盯私信 开' : '盯私信 关' }),
            Pill({
              tone: num(msgs.max) > 0 && num(msgs.left) === 0 ? 'warn' : undefined,
              children: '今天还能发 ' + num(msgs.left) + ' 条（' + num(msgs.day) + '/' + (num(msgs.max) || '—') + '）',
            }),
            q.today != null
              ? Pill({ children: '回评 ' + num(q.today) + '/' + (num(q.todayLeft) + num(q.today) || '—') })
              : null,
            health.level && health.level !== 'ok'
              ? Pill({ tone: health.level === 'stop' ? 'bad' : 'warn', children: '连败 ' + (health.failures || 0) + ' 次' })
              : null,
            killed ? Pill({ tone: 'bad', strong: true, children: killWhy ? '已停损 · ' + short(killWhy, 12) : '已停损' }) : null)),
        h('div', { 'data-dys-stats': '' },
          stat(hero.pending, '待回', jump('reply')),
          stat(hero.quotaLeft, '额度剩', jump('today')),
          stat(lastTxt, '上一条回评', jump('reply')),
          h(Btn, {
            label: killed ? '解除停损' : '停损',
            icon: killed ? 'pulse' : 'alert',
            ghost: !killed,
            title: killed ? '确认安全后再解除：解除后所有写操作立刻恢复' : '一键停掉所有会发出去的动作（回评/私信/@/发布/删除）',
            onClick: () => onKill && onKill(!killed),
          }),
          h(Btn, { label: '刷新', icon: 'refresh', ghost: true, busy: refreshing, busyLabel: '读…', onClick: onRefresh })),
        h('div', { 'data-dys-herobar': '' },
          h('span', null, '今日消息'),
          h('i', null, h('b', { style: { width: pct + '%', background: tone, boxShadow: '0 0 12px -2px ' + tone } })),
          h('span', null, usedMsgs + ' / ' + (capMsgs || '—'))),
        h('div', { 'data-dys-next': '' },
          h('i', { 'data-dys-nextdot': '', 'data-level': health.level || 'ok' }),
          h('span', { 'data-dys-nexttxt': '' }, next.label || next.reason || '今天没有安排下一轮'),
          h('span', { 'data-dys-dim': '', 'data-dys-xs': '' },
            '今天 ' + (sum.ran || 0) + ' 轮 · 跳过 ' + (sum.skipped || 0)),
          h('span', { 'data-dys-grow': '' }),
          schedule && schedule.ok
            ? h(Btn, { label: schedule.paused ? '继续刷' : '暂停刷', ghost: true,
                onClick: () => onPause && onPause(!schedule.paused) })
            : null))
    }

    /* ── 额度 ── */
    const CH_CN = { comment: '回评论', dm: '私信', at: '回 @', own: '自己评论区', publish: '发布' }

    const Budget = ({ data, err, onReload, loading }) => {
      const per = (data && data.per) || {}
      const msgs = (data && data.messages) || {}
      const rows = ['comment', 'dm', 'at', 'own', 'publish']
      return h(Card, {
        title: '消息额度', icon: 'gauge', kind: 'metric', sub: '五个出口共用一个总闸',
        tools: h(Btn, { label: '刷新', icon: 'refresh', ghost: true, busy: loading, busyLabel: '读…', onClick: onReload }),
      },
        (data && data.broken)
          ? h('div', { 'data-dys-err': '' }, '额度账本坏了 —— 现在一律拒绝发送（fail-closed），不会误发。')
          : null,
        h('div', { 'data-dys-col': '', style: { gap: '7px' } },
          rows.map((k) => {
            const r = per[k] || {}
            const max = num(r.dayMax)
            const now = num(r.day)
            return h('div', {
              key: k, 'data-dys-budgetrow': '',
              'data-full': max > 0 && now >= max ? '' : undefined,
            },
              h('span', { 'data-dys-sm': '' }, CH_CN[k] || k),
              h(Bar, { now, max, color: barTone(now, max) }),
              h('b', null, now + '/' + (max || '—')))
          })),
        h('div', { 'data-dys-row': '', 'data-dys-sm': '', 'data-dys-dim': '' },
          h('span', null, '总闸 ' + num(msgs.day) + '/' + num(msgs.max) + ' 条'),
          h('span', null, '·'),
          h('span', null, '回评每小时 ≤6，私信 ≤5')),
        /* 评论还有一层细账（lib/ledger.mjs）：单视频每时段 ≤5、同一人 ≤2、同一楼 ≤1。
         * 那层防的是「同一个人被连着回三条」，和上面的总闸不是一回事，得让人看得见。 */
        h('div', { 'data-dys-xs': '', 'data-dys-dim': '' },
          '评论细账：同一视频每时段 ≤' + num(((data && data.ledger && data.ledger.limits) || {}).perAwemePerWindow || 5)
          + '，同一人 ≤' + num(((data && data.ledger && data.ledger.limits) || {}).perAuthorPerDay || 2)
          + '，同一楼 ≤' + num(((data && data.ledger && data.ledger.limits) || {}).perThreadPerDay || 1)),
        h(ErrLine, { text: err }))
    }

    /* ── 收件箱 ───────────────────────────────────────────────────────── */
    const TABS = [
      { k: 'dm', label: '私信', icon: 'send' },
      { k: 'at', label: '@我', icon: 'at' },
      { k: 'own', label: '自己评论区', icon: 'comment' },
    ]

    const itemTitle = (k, it) => {
      if (k === 'dm') return it.nick || ('uid ' + it.uid)
      if (k === 'at') return it.nick || it.type_name || ('@我 · ' + (it.type || ''))
      return (it.nick || '我') + ' 的评论'
    }
    const itemText = (k, it) => (k === 'dm' ? it.last_text : (it.content || it.text || ''))
    const itemAt = (k, it) => (k === 'dm' ? it.last_at : it.at)
    const worthLevel = (it) => (it.status === 'high' ? 2 : (it.worth ? 1 : 0))
    const whyText = (it) => (it.why || []).slice(0, 2)
    const blockText = (it) => (it.blocked || []).slice(0, 1)

    /* 表格式一行：类型/谁/说了什么/判定/时间 列对齐，一屏能扫 10+ 条。
     * 展开回复仍跨整行，不破坏原来的 Composer。 */
    const Item = ({ kind, it, open, onOpen, children }) =>
      h('div', {
        'data-dys-tr': '', 'data-open': open ? '' : undefined, 'data-worth': String(worthLevel(it)),
        onClick: onOpen,
      },
        h('div', { 'data-dys-mark': '' }),
        h('b', { 'data-dys-cell': '', title: itemTitle(kind, it) }, itemTitle(kind, it)),
        h('div', { 'data-dys-cell': '', 'data-dys-prev': '' },
          it.view ? it.view.preview : short(itemText(kind, it) || '（没有文字内容）', 120)),
        h('div', { 'data-dys-cell': '', 'data-dys-why': '' },
          whyText(it).map((w, i) => h(Tag, { key: 'w' + i }, w)),
          blockText(it).map((w, i) => h(Tag, { key: 'b' + i }, w))),
        h(Time, { at: itemAt(kind, it), when: it.view ? it.view.when : '' }),
        open ? h('div', { style: { gridColumn: '1 / -1' } }, children) : null)

    const Composer = ({ kind, it, onDone }) => {
      const [text, setText] = useState('')
      const [armed, setArmed] = useState(false)
      const [busy, setBusy] = useState(false)
      const [said, setSaid] = useState('')
      const [bad, setBad] = useState('')
      const timer = useRef(0)
      useEffect(() => () => clearTimeout(timer.current), [])

      const max = kind === 'dm' ? 300 : 500
      const hint = kind === 'dm' ? '私信' : (it.root_comment_id ? '回楼中楼' : '回评论')

      const send = async () => {
        if (!text.trim()) return
        if (!armed) {
          setArmed(true)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => setArmed(false), 5000)
          return
        }
        setBusy(true); setBad(''); setArmed(false)
        try {
          let r
          if (kind === 'dm') {
            r = await jpost('/dm/send', { uid: it.uid, nick: it.nick, sec_uid: it.sec_uid || '', text, confirm: true })
          } else {
            r = await jpost('/reply', {
              aweme: it.aweme_id, cid: it.cid, root: it.root_comment_id || it.cid,
              author: it.uid || '', text, confirm: true,
            })
          }
          if (r && r.ok) { setSaid('发出去了 · ' + hhmm(new Date().toISOString())); setText(''); onDone && onDone(r) }
          else setBad((r && (r.error || r.why)) || '没发出去')
        } catch (e) { setBad(String((e && e.message) || e)) }
        finally { setBusy(false) }
      }

      return h('div', { 'data-dys-body': '' },
        kind === 'dm' && Array.isArray(it.history) && it.history.length
          ? h('div', { 'data-dys-hist': '' },
            it.history.slice(-6).map((m, i) =>
              h('div', { key: i, 'data-dys-line': '' },
                h('span', null, m.from === 'me' ? '我说' : '他'),
                h('span', { 'data-dys-grow': '' }, short(m.text || '（' + (m.kind || '消息') + '）', 90)),
                h('time', { 'data-dys-xs': '', 'data-dys-dim': '' }, hhmm(m.at)))))
          : null,
        kind === 'at' && it.aweme_desc
          ? h('div', { 'data-dys-sm': '', 'data-dys-dim': '' }, '视频：' + it.aweme_desc)
          : null,
        kind === 'own' && it.text
          ? h('div', { 'data-dys-sm': '', 'data-dys-dim': '' }, '原作：' + it.aweme_desc + ' · 赞 ' + num(it.digg))
          : null,
        said ? h('div', { 'data-dys-said': '' }, said) : null,
        bad ? h('div', { 'data-dys-err': '' }, bad) : null,
        h('textarea', {
          'data-dys-ta': '', value: text, placeholder: hint + '说点什么呢…（' + max + ' 字以内）',
          onChange: (e) => { setText(e.target.value.slice(0, max)); setArmed(false) },
        }),
        h('div', { 'data-dys-row': '' },
          h(Btn, {
            label: armed ? '再点一次就发出去' : '回一条', primary: true, armed,
            busy, busyLabel: '发…', disabled: !text.trim(), onClick: send,
            title: armed ? '撤不回来' : '第一下只是待确认',
          }),
          h(Btn, { label: '清空', ghost: true, onClick: () => { setText(''); setArmed(false); setBad('') } }),
          h('span', { 'data-dys-xs': '', 'data-dys-dim': '', 'data-dys-grow': '', style: { textAlign: 'right' } },
            text.length + '/' + max)))
    }

    const Inbox = ({ data, err, loading, onReload, onAfterSend, onForce, forcing, onFeed }) => {
      const [tab, setTab] = useState('dm')
      const [open, setOpen] = useState('')
      const [all, setAll] = useState(false)
      const [skipped, setSkipped] = useState({})
      const pack = (data && data[tab]) || {}
      const items = Array.isArray(pack.items)
        ? pack.items.filter((it) => (all || it.worth) && !skipped[tab + ':' + (it.uid || it.cid || it.conv_id)])
        : []
      const counts = (data && data.counts) || {}
      const total = num(counts.dm) + num(counts.at) + num(counts.own)
      /* 服务端给的是「上次的结果 + 后台在刷」。refreshing 为真时自己轮询，
       * 刷完 refreshing 会变 false，轮询自然停 —— 不需要额外的重试上限。 */
      const cache = (data && data.cache) || null
      const refreshing = Boolean(cache && cache.refreshing)

      useEffect(() => {
        if (!refreshing) return
        const t = setTimeout(() => { onReload && onReload() }, 5000)
        return () => clearTimeout(t)
      }, [refreshing, cache && cache.at, onReload])

      /* 副标题兼职显示数据年龄：既回答了「这是新的吗」，又不额外占一行 */
      const cacheNote = cache
        ? (refreshing ? '正在刷新' : (ago(cache.at) || '刚更新'))
        : ''

      const emptyText = tab === 'dm'
        ? '没有需要回的私信（剩下的不是系统通知就是表情）'
        : tab === 'at' ? '最近没人 @ 我' : '自己作品下暂无新评论'

      return h(Card, {
        title: '收件箱', icon: 'inbox',
        sub: total ? (total + ' 条值得回' + (cacheNote ? ' · ' + cacheNote : '')) : '私信 / @我 / 自己评论区',
        lead: true,
        tools: h('div', { 'data-dys-row': '' },
          h(Btn, { label: all ? '只看值得回' : '看全部', ghost: true, onClick: () => setAll(!all) }),
          h(Btn, {
            label: '重新挑一遍', icon: 'refresh', ghost: true, busy: forcing, busyLabel: '刷…',
            onClick: onForce || onReload,
            title: '忽略缓存，真去跑一轮（要十几秒）',
          })),
      },
        /* 停损开着的时候，这张卡最重要的一句话不是"有几条值得回"，是"现在一条也发不出去"。
         * 放在最上面，免得人一条条点进去、每条都被拒一次。 */
        (data && data.kill && data.kill.on)
          ? h('div', { 'data-dys-note': '', style: { color: 'var(--dys-bad)', fontWeight: 550 } },
            '停损中：写操作全部被拒（' + String((data.kill.info && data.kill.info.reason) || '手动停损') + '）。到顶部按「解除停损」再回。')
          : null,
        h('div', { 'data-dys-tabs': '' },
          TABS.map((t) => h('button', {
            key: t.k, 'data-dys-tab': '', 'data-on': tab === t.k ? '' : undefined,
            onClick: () => { setTab(t.k); setOpen('') },
          }, Ico({ name: t.icon, size: 11 }), h('span', null, t.label),
          h('i', null, num(counts[t.k]) ? String(counts[t.k]) : '')))),
        loading && !data
          ? h('div', { 'data-dys-col': '', style: { gap: '6px' } }, [0, 1, 2].map((i) => h('div', { key: i, 'data-dys-skel': '' })))
          : null,
        !loading && pack.ok === false ? h(ErrLine, { text: pack.error || '这一块读不到' }) : null,
        h('div', { 'data-dys-ibx': '' },
          h('div', { 'data-dys-thead': '' },
            h('span', null, ''), h('span', null, '谁'), h('span', null, '说了什么'),
            h('span', null, '判定'), h('span', null, '时间')),
          items.length === 0 && !loading
            ? h(Empty, {
              text: emptyText,
              action: h('div', { 'data-dys-row': '' },
                h(Btn, { label: '再看一遍', ghost: true, onClick: onForce || onReload }),
                onFeed ? h(Btn, { label: '去刷一轮', ghost: true, onClick: onFeed }) : null),
            })
            : items.map((it, i) => {
              /* key 必须稳定。原来兜底用 Math.random()：一旦某条缺了 uid/cid，
               * 每次渲染 key 都变 → React 把这一行整个卸载重建 → 展开状态丢失、
               * 正在输入的回复被清空。React 官方文档明确点名不要这么做。
               * 兜底改成行号：同一份列表里它是稳定的。 */
              const key = tab + ':' + (it.uid || it.cid || it.conv_id || ('#' + i))
              return h(Item, {
                key, kind: tab, it, open: open === key,
                onOpen: () => setOpen(open === key ? '' : key),
              },
                h(Composer, {
                  kind: tab, it,
                  onDone: () => { setOpen(''); onAfterSend && onAfterSend() },
                }))
            })),
        err ? h(ErrLine, { text: err }) : null,
        h('div', {
          'data-dys-note': '',
          title: '判「该不该回」是本地规则：最后一句是我 → 等；系统通知 / 纯表情 / 超过 72 小时 → 不打扰。',
        }, '纯表情、系统通知、超过 72 小时的不打扰'))
    }

    /* ── 值班日志：既看「做了什么」，也看「为什么没做」 ─────────────────
     * 8 个开关只能告诉人「它是开的」，审计要看每一次判定和跳过原因。 */
    const DutyLog = ({ schedule, onRefresh }) => {
      const s = schedule || {}
      const items = (s.log && s.log.items) || []
      const sum = s.summary || {}
      const f = s.funnel || {}
      const fmax = Math.max(f.seen || 0, f.worth || 0, f.sent || 0, 1)
      return h('div', { 'data-dys-card': '', 'data-kind': 'metric' },
        h('div', { 'data-dys-head': '' },
          h('div', { 'data-dys-title': '' }, Ico({ name: 'pulse', size: 13 }), '值班日志'),
          h('div', { 'data-dys-sub': '', 'data-dys-grow': '' },
            '今天 ' + (sum.ran || 0) + ' 轮 · 跳过 ' + (sum.skipped || 0) + ' · 失败 ' + (sum.failed || 0)),
          h('div', { 'data-dys-tools': '' }, h(Btn, { label: '刷新', ghost: true, onClick: onRefresh }))),
        f.hasData
          ? h('div', { 'data-dys-funnel': '' },
            [['看到 ' + (f.seen || 0), f.seen || 0], ['判该回 ' + (f.worth || 0), f.worth || 0],
              ['回了 ' + (f.sent || 0), f.sent || 0]].map(([txt, v], i) =>
              h('div', { key: i, 'data-dys-fstep': '', 'data-i': String(i) },
                h('span', null, txt),
                h('i', null, h('b', { style: { width: Math.max(4, Math.round(v / fmax * 100)) + '%' } })))))
          : null,
        items.length
          ? h('div', { 'data-dys-log': '' }, items.map((r, i) =>
            h('div', { key: i, 'data-dys-logrow': '' },
              h('span', { 'data-dys-logtime': '' }, r.when || '—'),
              h('i', { 'data-dys-dot': '',
                [r.tone === 'bad' ? 'data-bad' : r.tone === 'warn' ? 'data-warn' : 'data-ok']: '' }),
              h('b', null, r.kind || '动作'),
              h('span', { 'data-dys-grow': '', 'data-dys-ell': '' }, r.title || ''),
              h('span', { 'data-dys-dim': '', 'data-dys-xs': '', 'data-dys-ell': '' }, r.detail || ''))))
          : h(Empty, {
              text: s.ok === false ? '调度接口还没连上 · 重启一次 DSH 就有下一轮和值班日志' : '今天还没有动作记录',
              action: s.ok === false ? null : h(Btn, { label: '刷新', ghost: true, onClick: onRefresh }),
            }))
    }

    /* ── 今天做了什么（回评 + 发布 + 出错，合成一条时间线） ───────────────
     * 以前这是三张并排的小卡，用户得自己在脑子里拼时间顺序；
     * 而且 /errors 的字段读错了，导致「出错记录」永远是空的。 */
    const digestRows = (ledger, pubs, errs, limit) => {
      const out = []
      for (const r of ledger || []) {
        out.push({
          at: r.at, tone: 'ok', kind: '回评',
          main: r.who || '（未知）',
          detail: r.reason || '',
        })
      }
      for (const r of pubs || []) {
        out.push({
          at: r.at, tone: r.published ? 'ok' : 'warn',
          kind: r.kind === 'video' ? '视频' : '图文',
          main: r.title || '（无标题）',
          detail: (r.who === 'public' ? '公开' : r.who === 'friend' ? '好友可见' : '仅自己可见')
            + (r.published ? ' · 已发布' : ' · 摆好了没点'),
        })
      }
      for (const r of errs || []) {
        out.push({
          at: r.at, tone: 'bad', kind: '出错',
          main: r.text || r.message || r.stage || '（没有描述）',
          detail: [r.kind && r.kind !== 'error' ? r.kind : '', r.detail || ''].filter(Boolean).join(' · '),
        })
      }
      return out
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
        .slice(0, limit || 30)
    }

    /* 「今天」按本机日期算。日志里的时间戳有两种写法（ISO 和 "YYYY-MM-DD hh:mm:ss"），
     * 所以先比字符串前 10 位，再退回 Date 解析。 */
    const isToday = (at) => {
      const s = String(at || '')
      const n = new Date()
      const ymd = n.getFullYear() + '-' + pad2(n.getMonth() + 1) + '-' + pad2(n.getDate())
      if (s.slice(0, 10) === ymd) return true
      const d = new Date(s)
      if (Number.isNaN(+d)) return false
      return d.getFullYear() === n.getFullYear()
        && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
    }

    const Digest = ({ ledger, pubs, errs, loading }) => {
      /* 默认只看今天（这是每天真正会看的东西）；往日的不删，收在「历史」后面。
       * 三个账本一次取够 40 条，切换只是前端过滤 —— 不额外发请求，也就不会多一种失败。 */
      const [all, setAll] = useState(false)
      const everything = digestRows(ledger, pubs, errs, 40)
      const todays = everything.filter((r) => isToday(r.at))
      const rows = (all ? everything : todays).slice(0, all ? 30 : 8)
      const bad = todays.filter((r) => r.tone === 'bad').length
      const sub = all
        ? (everything.length ? '最近 ' + rows.length + ' 条，含往日' : '')
        : (todays.length ? (todays.length + ' 件' + (bad ? ' · ' + bad + ' 件没成' : '') + (todays.length > rows.length ? ' · 显示最近 ' + rows.length : '')) : '')
      const older = everything.length > todays.length
      return h(Card, {
        title: all ? '历史记录' : '今天做了什么',
        icon: all ? 'history' : 'pulse',
        sub,
        /* 导出走 <a download> —— 同源、浏览器自己处理保存，不用前端拼 Blob。
         * 两个都是 ghost 级别：它们是"想把记录带走"时才用的动作，不该抢主次。 */
        tools: h('div', { 'data-dys-row': '' },
          h('a', {
            'data-dys-btn': '', 'data-ghost': '', download: '',
            href: API + '/export?what=ledger',
            style: { textDecoration: 'none' },
            title: '把回评记录导成 CSV（Excel 直接能打开）',
          }, Ico({ name: 'download', size: 12 }), '回评 CSV'),
          h('a', {
            'data-dys-btn': '', 'data-ghost': '', download: '',
            href: API + '/export?what=publishes',
            style: { textDecoration: 'none' },
            title: '把发布记录导成 CSV',
          }, Ico({ name: 'download', size: 12 }), '发布 CSV'),
          (older || all)
            ? h(Btn, {
              label: all ? '只看今天' : '历史',
              icon: all ? 'pulse' : 'history',
              ghost: true,
              onClick: () => setAll(!all),
              title: all ? '回到今天' : '往前翻：回评 / 发布 / 出错都在这',
            })
            : null),
      },
        loading && !rows.length
          ? h('div', { 'data-dys-col': '', style: { gap: '6px' } }, [0, 1].map((i) => h('div', { key: i, 'data-dys-skel': '' })))
          : null,
        rows.length
          ? h('div', { 'data-dys-list': '' }, rows.map((r, i) => h('div', { key: i, 'data-dys-li': '' },
            h('span', { 'data-dys-dot': '', 'data-ok': r.tone === 'ok' ? '' : undefined, 'data-warn': r.tone === 'warn' ? '' : undefined, 'data-bad': r.tone === 'bad' ? '' : undefined }),
            h('div', { 'data-dys-ell': '', title: (r.kind + ' · ' + r.main + ' ' + r.detail).trim() },
              h('span', { 'data-dys-li-main': '' },
                h('span', { 'data-dys-dim': '', 'data-dys-xs': '' }, r.kind),
                h('b', { style: { fontWeight: 600 } }, short(r.main, 28))),
              r.detail ? h('span', { 'data-dys-dim': '', 'data-dys-xs': '' }, ' · ' + short(r.detail, 34)) : null),
            h('time', null, stamp(r.at)))))
          : h(Empty, {
            text: all ? '这 40 条里什么都没有' : '今天还没动手 —— 回一条、开值班，都会记在这',
            action: (!all && older) ? h(Btn, { label: '看历史', ghost: true, onClick: () => setAll(true) }) : null,
          }))
    }

    /* ── 后台 ─────────────────────────────────────────────────────────── */
    const Ops = ({ watch, duty, queue, onPost, busyTag, err }) => {
      const watching = !!(watch && watch.running)
      const dutyOn = !!(duty && duty.running)
      const pending = num(queue && queue.pending)
      const dead = num(queue && queue.dead)
      const [armRetry, setArmRetry] = useState(false)
      const [armClear, setArmClear] = useState(false)
      /* 「点第二下才生效」的自动解除计时器。以前是裸 setTimeout：组件卸了还在跑，
       * 而且连点两下时上一颗计时器会把刚立起来的第二下提前按掉。 */
      const tRetry = useRef(0)
      const tClear = useRef(0)
      useEffect(() => () => { clearTimeout(tRetry.current); clearTimeout(tClear.current) }, [])
      const arm = (ref, setter) => {
        clearTimeout(ref.current)
        setter(true)
        ref.current = setTimeout(() => setter(false), 5000)
      }
      return h(Card, { title: '后台', icon: 'server', sub: '自动跑只在谷时；你按的按钮不受时间限制，每条都过额度' },
        h('div', { 'data-dys-row': '' },
          Pill({ tone: watching ? 'ok' : undefined, children: watching ? '盯私信 开 · 每 ' + num((watch && watch.config && watch.config.everySec) || 90) + ' 秒' : '盯私信 关' }),
          Pill({ tone: dutyOn ? 'ok' : undefined, children: dutyOn ? '定时值班 开' : '定时值班 关' }),
          Pill({ tone: pending > 0 ? 'warn' : undefined, children: '待重试 ' + pending }),
          Pill({ tone: dead > 0 ? 'bad' : undefined, children: '死信 ' + dead })),
        h('div', { 'data-dys-row': '' },
          h(Btn, {
            label: dutyOn ? '停值班' : '开值班', busy: busyTag === 'duty',
            onClick: () => onPost('/duty', { on: !dutyOn }),
            title: '定时挑评论；要不要自动回，看「自主执行 · 回评论」那个开关',
          }),
          h(Btn, {
            label: watching ? '停盯私信' : '开盯私信', busy: busyTag === 'watch',
            onClick: () => onPost('/watch', { on: !watching }),
            title: '来新私信时弹通知（不自动回）',
          }),
          h(Btn, {
            label: armRetry ? '确认重放 ' + pending + ' 条' : '重试队列', armed: armRetry,
            disabled: pending === 0, busy: busyTag === 'retry',
            onClick: () => {
              if (!armRetry) return arm(tRetry, setArmRetry)
              clearTimeout(tRetry.current); setArmRetry(false); onPost('/queue/retry', {})
            },
          }),
          h(Btn, {
            label: armClear ? '确认清掉 ' + dead + ' 条' : '清死信', ghost: true, armed: armClear,
            disabled: dead === 0, busy: busyTag === 'clear',
            onClick: () => {
              if (!armClear) return arm(tClear, setArmClear)
              clearTimeout(tClear.current); setArmClear(false); onPost('/queue/clear', {})
            },
          })),
        duty && duty.last
          ? h('div', { 'data-dys-xs': '', 'data-dys-dim': '' }, '上一轮：' + (duty.last.summary || duty.last.at || '—'))
          : h('div', { 'data-dys-xs': '', 'data-dys-dim': '' }, '还没跑过 —— 开值班后每半小时挑一轮，攒着等你点头'),
        err ? h(ErrLine, { text: err }) : null)
    }

    /* ── 趋势 ─────────────────────────────────────────────────────────── */
    const Trend = ({ data, err, onSave, saving }) => {
      const rows = (data && data.rows) || []
      const delta = (data && data.delta) || {}
      const last = rows[rows.length - 1]
      const pts = rows.map((r, i) => {
        const v = num(r.followers)
        const min = Math.min(...rows.map((x) => num(x.followers)))
        const max = Math.max(...rows.map((x) => num(x.followers)))
        const x = rows.length === 1 ? 100 : (i / (rows.length - 1)) * 100
        const y = max === min ? 50 : 30 - ((v - min) / (max - min)) * 26
        return x.toFixed(1) + ',' + y.toFixed(1)
      }).join(' ')
      return h(Card, {
        title: '粉丝趋势', icon: 'chart', kind: 'metric',
        sub: rows.length ? ('最近 ' + rows.length + ' 天') : '',
        tools: h(Btn, { label: '记今天一笔', ghost: true, busy: saving, busyLabel: '记…', onClick: onSave }),
      },
        rows.length >= 2
          ? h('div', { 'data-dys-trend': '' },
            h('svg', { viewBox: '0 0 100 44', preserveAspectRatio: 'none' },
              h('polyline', {
                points: pts, fill: 'none', stroke: 'var(--dys-blue)', 'stroke-width': '1.6',
                'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
              })),
            h('div', null,
              h('div', { 'data-dys-sm': '' }, '粉丝 ' + num(last && last.followers)
                + (delta.followers ? ' · 涨 ' + delta.followers : '')),
              h('div', { 'data-dys-xs': '', 'data-dys-dim': '' },
                '作品 ' + num(last && last.works) + ' · 赞 ' + num(last && last.liked_total))))
          : h(Empty, {
            text: rows.length ? '只有一天，明天再来就有线了' : '还没有记录',
            action: rows.length ? null : h(Btn, { label: '记今天一笔', onClick: onSave, busy: saving, busyLabel: '记…' }),
          }),
        err ? h(ErrLine, { text: err }) : null)
    }

    /* ── 刷视频 ─────────────────────────────────────────────────────────
     * 这里**没有输入框**：条件只在「设置 → 刷视频」那页改，也只在那儿存。
     * 之前两边都能填，改一边另一边不认，主人说「重复」，所以砍掉这一份。 */
    const Feed = ({ data, err, busy, onRun, onOpen }) => {
      const items = (data && data.items) || []
      const dropped = (data && data.dropped) || {}
      const srcLabel = data
        ? (data.source === 'search' ? '按你设置里的关键词搜的' : '推荐流（没设关键词）')
        : '按设置里的条件刷一批，只读不点赞'
      return h(Card, {
        title: '刷视频', icon: 'film',
        sub: data ? (srcLabel + ' · 抓 ' + num(data.fetched) + ' 留 ' + num(data.kept)) : srcLabel,
        tools: h(Btn, { label: '再刷一遍', icon: 'film', busy, busyLabel: '刷…', onClick: onRun }),
      },
        items.length
          ? h('div', { 'data-dys-list': '' }, items.slice(0, 6).map((it, i) => h('div', { key: i, 'data-dys-li': '' },
            h('span', { 'data-dys-dot': '', 'data-accent': '' }),
            h('div', { 'data-dys-ell': '', title: it.desc || '' },
              h('button', {
                'data-dys-link': '',
                title: '在机器人的浏览器里打开（用的是机器人账号，不是你的默认浏览器）',
                onClick: () => { if (onOpen) onOpen('https://www.douyin.com/video/' + it.aweme_id) },
              }, short(it.desc || '（没有文案）', 30)),
              h('span', { 'data-dys-dim': '', 'data-dys-xs': '' },
                ' · ' + (it.author || '?') + ' · 赞 ' + num(it.digg)
                + (it.duration_sec ? ' · ' + num(it.duration_sec) + 's' : '')
                + ' · id ' + short(it.aweme_id, 10))),
            h('time', null, short(String(it.create_date || '').slice(5, 10), 5)))))
          : h(Empty, {
            text: data ? '这一批都被筛掉了（看下面的原因）' : '还没刷过',
            action: data ? null : h(Btn, { label: '刷一批', onClick: onRun, busy, busyLabel: '刷…' }),
          }),
        data
          ? h('div', { 'data-dys-xs': '', 'data-dys-dim': '' },
            ['广告 ' + num(dropped.ad), '太短 ' + num(dropped.short), '太长 ' + num(dropped.long),
              '不含关键词 ' + num(dropped.allow), '命中屏蔽 ' + num(dropped.block), '见过 ' + num(dropped.seen)]
              .join(' · '))
          : null,
        err ? h(ErrLine, { text: err }) : null)
    }

    /* ── 挑：它替你刷完之后，留下值得看的那几条 ─────────────────────────
     * 设计取舍：一屏最多 8 条，每条只给两个动作。
     * 「发我」是撤不回来的（真把卡片发进你私信），所以两次点击 + 按钮变字。
     * 赞 / 收藏 还没接 —— 那要动 budget.mjs 的额度表，不在这版里假装有。 */
    const Picks = ({ onOpen }) => {
      const [st, setSt] = useState(null)
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState('')
      const [armed, setArmed] = useState('')
      const [note, setNote] = useState('')

      const pull = useCallback(async () => {
        try { setSt(await jget('/picks')); setErr('') }
        catch (e) { setErr(String((e && e.message) || e)) }
      }, [])
      useEffect(() => { pull() }, [pull])
      /* 收集中每 4 秒问一次 —— 和收件箱同一条规矩：不让人盯着转圈 */
      useEffect(() => {
        if (!st || !st.refreshing) return
        const t = setTimeout(pull, 4000)
        return () => clearTimeout(t)
      }, [st, pull])

      const collect = async () => {
        setBusy('collect'); setNote('')
        try { await jpost('/picks/collect', {}); await pull() }
        catch (e) { setNote('没跑起来：' + String((e && e.message) || e)) }
        finally { setBusy('') }
      }
      const dismiss = async (id) => {
        setBusy('dismissed:' + id)
        try { await jpost('/picks/act', { id, act: 'dismissed' }); await pull() }
        catch (e) { setNote('没成：' + String((e && e.message) || e)) }
        finally { setBusy('') }
      }
      const sendIt = async (id, confirm) => {
        setBusy('sent:' + id)
        try {
          const r = await jpost('/picks/act', { id, act: 'sent', confirm })
          if (r && r.needsConfirm) { setArmed(id); setNote('再点一次就发到「' + r.nick + '」的私信里'); return }
          if (r && r.ok) { setNote('已发到你私信'); setArmed(''); await pull() }
          else setNote((r && (r.error || r.hint)) || '没发出去')
        } catch (e) { setNote('没成：' + String((e && e.message) || e)) }
        finally { setBusy('') }
      }

      const s = (st && st.stats) || {}
      const items = (st && st.items) || []
      const spinning = busy === 'collect' || Boolean(st && st.refreshing)
      return h(Card, {
        title: '挑', icon: 'film', lead: true,
        sub: st
          ? '候选 ' + num(s.total) + ' 条 · 今天叫过 ' + num(s.called) + ' 次' + (st.refreshing ? ' · 正在刷…' : '')
          : '刷完的东西留在这儿，值得看的才叫你',
        tools: h(Btn, { label: '找新的', icon: 'film', primary: !items.length, busy: spinning, busyLabel: '刷…', onClick: collect }),
      },
        items.length
          ? h('div', null, items.slice(0, 8).map((it) => h('div', {
            key: it.aweme_id, 'data-dys-pick': '', 'data-nocover': it.cover ? undefined : '',
            /* 分数不进界面：0–1 的数字对「要不要看」没有帮助，列表本身已经按它排过序。
             * 留在 title 里，排查时鼠标一停就能看到。 */
            title: '匹配度 ' + num(it.score) + (it.source ? ' · 来自 ' + it.source : ''),
          },
            it.cover
              ? h('img', {
                'data-dys-thumb': '', src: it.cover, alt: '', loading: 'lazy',
                /* 封面地址会过期，加载失败就退回色块 —— 别在列表里放一排破图标 */
                onError: (e) => { try { e.currentTarget.style.visibility = 'hidden' } catch (_) {} },
              })
              /* 没有封面就**整格不占**：留一块 56px 的灰比什么都难看，还会把正文挤到右边 */
              : null,
            h('div', { 'data-dys-pickmain': '' },
              h('div', { 'data-dys-pickt': '', title: it.desc || '' },
                /* 点标题 = 在机器人的浏览器里打开。不看就发，等于闭着眼挑。 */
                h('button', {
                  'data-dys-link': '', title: '在机器人的浏览器里打开',
                  onClick: () => { if (onOpen) onOpen('https://www.douyin.com/video/' + it.aweme_id) },
                }, it.desc || '（没有文案）')),
              h('div', { 'data-dys-pickm': '' },
                h('span', { 'data-dys-xs': '', 'data-dys-dim': '' },
                  (it.author || '?') + ' · ' + (num(it.duration_sec) || '—') + 's · 赞 ' + num(it.digg)),
                h('span', { 'data-dys-xs': '', 'data-dys-dim': '' }, '· ' + (it.why || '')))),
            h('div', { 'data-dys-pickacts': '' },
              h(Btn, {
                label: it.state === 'sent' ? '已发' : (armed === it.aweme_id ? '确认发' : '发我'),
                disabled: it.state === 'sent',
                /* 一屏四个实心蓝按钮 = 谁都不突出（b13 那条规矩）。
                 * 所以平时是描边，点了变「确认发」才实心 —— 实心只代表"即将发生"。 */
                primary: armed === it.aweme_id,
                busy: busy === 'sent:' + it.aweme_id, busyLabel: '发…',
                onClick: () => sendIt(it.aweme_id, armed === it.aweme_id),
              }),
              h(Btn, {
                label: '×', ghost: true, title: '不想看（以后少给你这种）',
                busy: busy === 'dismissed:' + it.aweme_id,
                onClick: () => dismiss(it.aweme_id),
              })))))
          : h(Empty, {
            text: st ? '还没挑过 —— 刷一批，它会把值得看的留下' : '正在读候选库…',
            action: st ? h(Btn, { label: '找新的', onClick: collect, busy: spinning, busyLabel: '刷…' }) : null,
          }),
        h('div', { 'data-dys-xs': '', 'data-dys-dim': '' },
          '赞 / 收藏还没接，先用「发我」把值得的存在私信里。'),
        note ? h('div', { 'data-dys-note': '' }, note) : null,
        err ? h(ErrLine, { text: err }) : null)
    }

    /* ── 面板 ─────────────────────────────────────────────────────────── */
    const Panel = () => {
      const { data, err, loading, load, drop } = useData()
      const [busyTag, setBusyTag] = useState('')
      const [msg, setMsg] = useState(null)
      const [savingTrend, setSavingTrend] = useState(false)
      const [feedData, setFeedData] = useState(null)
      const [feedErr, setFeedErr] = useState('')
      const [feedBusy, setFeedBusy] = useState(false)
      const [theme, setTheme] = useState('dark')
      const [forcingInbox, setForcingInbox] = useState(false)
      const [pal, setPal] = useState(false)
      const rootRef = useRef(null)
      const [cols, setCols] = useState('2')
      /* 当前看哪一区。记住上次停在哪儿；旧版本的 tab 名（picks/inbox/digest）映射到新四区。 */
      const [view, setView] = useState(() => {
        try {
          const v = localStorage.getItem('dys-view') || 'today'
          const alias = { picks: 'find', inbox: 'reply', digest: 'today', auto: 'reply', feed: 'find',
            budget: 'today', ops: 'reply', trend: 'today' }
          const n = alias[v] || v
          return ['today', 'reply', 'find', 'settings'].includes(n) ? n : 'today'
        } catch (_) { return 'today' }
      })
      /* 内容区是不是真的滚起来了。只用来决定「要不要淡出底边」——
       * 不滚的时候也淡，会把卡片的底边框擦掉。
       * 用 ResizeObserver 盯，不要每次渲染都读 scrollHeight：
       * 那会在设置页打字时每键强制一次布局。 */
      const viewRef = useRef(null)
      const [overflowing, setOverflowing] = useState(false)
      useEffect(() => {
        const el = viewRef.current
        if (!el || typeof ResizeObserver === 'undefined') return
        const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 4)
        check()
        const ro = new ResizeObserver(check)
        ro.observe(el)
        /* 一个区现在是好几张卡：只盯第一张，后面几张变高就看不见了 */
        for (const c of el.children) ro.observe(c)
        return () => ro.disconnect()
      }, [view])
      /* 角标：回应=几条要回，找内容=几条新候选。拉不到就空着 —— 不显示假数字。 */
      const [badges, setBadges] = useState({})
      useEffect(() => {
        let dead = false
        /* ⚠️ 角标只读缓存（/inbox/count），**不能**打 /inbox —— 那个接口在缓存过期时
         * 会顺手起一轮真浏览器扫描（私信+通知+评论三条链）。为了一个数字去刷一遍抖音，
         * 是最贵的一种「顺手」。 */
        Promise.all([jget('/picks'), jget('/inbox/count')]).then(([p, i]) => {
          if (dead) return
          const find = ((p || {}).items || []).filter((x) => x && x.state === 'new').length
          setBadges({ find, reply: Number((i && i.reply) || 0) })
        }).catch(() => {})
        return () => { dead = true }
      }, [])

      const base = ['/status', '/budget', '/config', '/watch', '/duty', '/queue', '/settings', '/autopilot', '/trend?days=14', '/publishes?n=30', '/ledger?n=40', '/errors?n=20', '/schedule', '/kill']

      useEffect(() => {
        load(base)
        load(['/inbox?limit=8'])
      }, [load])

      /* 亮/暗 + 宽度：都量自己，不猜视口 */
      useEffect(() => {
        try {
          const bg = getComputedStyle(document.body).backgroundColor
          const m = bg.match(/rgba?\(([^)]+)\)/)
          if (m) {
            const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x))
            const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            setTheme(a < 0.2 || lum < 110 ? 'dark' : 'light')
          }
        } catch { /* 拿不到就按暗色 */ }
      }, [])

      useEffect(() => {
        const el = rootRef.current
        if (!el || typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver((es) => {
          const w = es[0] && es[0].contentRect ? es[0].contentRect.width : el.clientWidth
          setCols(w >= 860 ? '2' : '1')
        })
        ro.observe(el)
        return () => ro.disconnect()
      }, [])

      const reloadAll = useCallback(async (extra) => {
        await load(base.concat(extra || []))
      }, [load])

      /* 键盘：Linear/Vercel 那套最值钱的一条。输入框里不抢键，避免打不了字。 */
      useEffect(() => {
        const onKey = (e) => {
          const tag = (e.target && e.target.tagName) || ''
          if (/INPUT|TEXTAREA|SELECT/.test(tag)) return
          const k = String(e.key || '').toLowerCase()
          if ((e.metaKey || e.ctrlKey) && k === 'k') { e.preventDefault(); setPal((v) => !v); return }
          if (e.key === 'Escape') { setPal(false); return }
          if (pal) return
          if ('1234'.includes(e.key) && !e.metaKey && !e.ctrlKey) {
            setView(['today', 'reply', 'find', 'settings'][Number(e.key) - 1]); return
          }
          if (k === 'r' && !e.metaKey && !e.ctrlKey) { reloadAll(); return }
          if (e.key === '/') { e.preventDefault(); setPal(true) }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [pal, reloadAll])

      /* 「重新挑一遍」= 忽略缓存真跑一轮。跑完再读一次日常那条 key ——
       * fresh=1 的结果只用来**写缓存**，不直接拿去渲染，用完就 drop 掉，
       * 不然那 20KB 会一直挂在内存里没人读。 */
      const forceInbox = useCallback(async () => {
        setForcingInbox(true)
        try {
          await load(['/inbox?limit=8&fresh=1'])
          await load(['/inbox?limit=8'])
          drop(['/inbox?limit=8&fresh=1'])
        } finally { setForcingInbox(false) }
      }, [load, drop])

      const post = async (tag, path, body, after) => {
        setBusyTag(tag)
        try {
          const r = await jpost(path, body)
          setMsg({ ok: !!(r && r.ok !== false), tag: path, data: r })
          if (after) await after(r)
        } catch (e) {
          setMsg({ ok: false, tag: path, data: { error: String((e && e.message) || e) } })
        } finally { setBusyTag('') }
      }

      const get = (k) => data[k]
      const errOf = (k) => err[k]

      const status = get('/status')
      const budget = get('/budget')
      const cfg = get('/config')
      const inbox = get('/inbox?limit=8')
      const watch = get('/watch')
      const duty = get('/duty')
      const queue = get('/queue')
      const trend = get('/trend?days=14')
      const pubs = (get('/publishes?n=30') || {}).rows
      const ledger = (get('/ledger?n=40') || {}).rows
      const errs = (get('/errors?n=20') || {}).rows
      /* 宿主把 index.js 常驻内存：新增的 /schedule 要重启才有。没连上时给一份
       * 由现有数据拼的降级快照，看板不空白、也不显示点了会 404 的按钮。 */
      const scheduleRaw = get('/schedule')
      const schedule = (scheduleRaw && scheduleRaw.ok) ? scheduleRaw : {
        ok: false, day: '', paused: false, points: [], spreadMin: 0,
        hero: {
          pending: badges.reply != null ? badges.reply : null,
          quotaLeft: (budget && budget.messages && budget.messages.left != null) ? budget.messages.left : null,
          lastReply: (ledger && ledger.length)
            ? { ok: true, when: ago(ledger[0].at) || hhmm(ledger[0].at), error: '' } : null,
        },
        next: { action: 'unknown', level: 'ok', label: '', reason: '重启 DSH 后可见下一轮与暂停' },
        summary: {}, health: { level: 'ok', failures: 0 },
        log: { items: [] }, funnel: { hasData: false },
      }
      const refreshing = loading['/status'] || loading['/budget']
      const logged = !!(status && status.ok)

      /* 点视频默认会走系统浏览器 —— 那是用户自己的账号。这里走 CDP，
       * 在插件托管的那台 Chrome（登录的是机器人号）里开新标签。 */
      const openInBot = async (url) => {
        try {
          const r = await jpost('/open', { url })
          setMsg({ ok: !!(r && r.ok), tag: 'open', data: r })
        } catch (e) {
          setMsg({ ok: false, tag: 'open', data: { error: String((e && e.message) || e) } })
        }
      }

      const runFeed = async () => {        setFeedBusy(true); setFeedErr('')
        try {
          /* 不传条件 —— 后端回落到「设置 → 刷视频」里存的那份。 */
          const r = await jpost('/feed', { count: 12, rounds: 3, limit: 8 })
          if (r && r.ok !== false) setFeedData(r)
          else setFeedErr((r && (r.error || r.why)) || '没刷出来')
        } catch (e) { setFeedErr(String((e && e.message) || e)) }
        finally { setFeedBusy(false) }
      }

      /* 卡片先各自造好，再按宽度排：设置页那个弹窗只有 600 多宽，
       * 一列的时候顺序要按「先能动手、再是数字、最后是账」来，不能照着两列的顺序往下灌。 */
      const nodeInbox = h(Inbox, {
        data: inbox, err: errOf('/inbox?limit=8'), loading: loading['/inbox?limit=8'],
        onReload: () => load(['/inbox?limit=8']),
        onForce: forceInbox,
        forcing: forcingInbox,
        // 发完消息要看到自己那条：缓存不会自动包含它，只能真刷一轮
        onAfterSend: () => { forceInbox(); load(['/budget']) },
        onFeed: () => { setView('find'); runFeed() },
      })
      const nodeBudget = h(Budget, { data: budget, err: errOf('/budget'), loading: loading['/budget'], onReload: () => load(['/budget']) })
      const nodeOps = h(Ops, {
        watch, duty, queue, busyTag,
        err: errOf('/watch') || errOf('/duty') || errOf('/queue'),
        onPost: (path, body) => post(path, path, body, () => load(['/watch', '/duty', '/queue'])),
      })
      const nodeFeed = h(Feed, {
        data: feedData, err: feedErr, busy: feedBusy, onRun: runFeed, onOpen: openInBot,
      })
      const nodeSettings = h(SettingsCard, {
        data: get('/settings'), err: errOf('/settings'), loading: loading['/settings'],
        onSaved: () => load(['/settings']),
      })
      const nodeAuto = h(AutopilotCard, {
        data: get('/autopilot'), err: errOf('/autopilot'), loading: loading['/autopilot'],
        settings: (get('/settings') || {}).settings,
        alive: Boolean((get('/config') || {}).ok),
        onSaved: () => load(['/settings', '/autopilot']),
        onRun: () => load(['/autopilot', '/ledger?n=40', '/publishes?n=30', '/budget']),
      })
      const nodeTrend = h(Trend, {
        data: trend, err: errOf('/trend?days=14'), saving: savingTrend,
        onSave: async () => {
          setSavingTrend(true)
          try { await post('trend/save', '/trend/save', {}); await load(['/trend?days=14']) }
          finally { setSavingTrend(false) }
        },
      })
      const nodeDigest = h(Digest, {
        ledger, pubs, errs,
        loading: loading['/ledger?n=40'] || loading['/publishes?n=30'] || loading['/errors?n=20'],
      })
      const nodeDutyLog = h(DutyLog, { schedule, onRefresh: () => load(['/schedule', '/runs?limit=30']) })

      /* 四个区 = 四个动词：看（今天）· 回（回应）· 找（找内容）· 调（设置）。
       * 以前按模块分组，同一个动作被拆到几个区里（刷视频就拆成了三份），
       * 于是"我想刷点新东西"要先想清楚点哪个入口 —— 那说明分组错了。 */
      const VIEWS = [['today', '今天'], ['reply', '回应'], ['find', '找内容'], ['settings', '设置']]
      const viewCards = {
        today: [nodeBudget, nodeDutyLog, nodeDigest, nodeTrend],
        reply: [nodeInbox, nodeAuto, nodeOps],
        find: [h(Picks, { onOpen: openInBot }), nodeFeed],
        settings: [nodeSettings],
      }[view] || [nodeDigest]
      const tab = (id, label) => h('button', {
        key: id, type: 'button', 'data-on': view === id ? '' : undefined,
        onClick: () => { setView(id); try { localStorage.setItem('dys-view', id) } catch (_) {} },
      }, label, badges[id] ? h('i', null, badges[id]) : null)

      return h('div', {
        'data-dys': '', 'data-theme': theme, 'data-cols': cols, ref: rootRef,
        style: { '--dys-cols': cols },
      },
        h(Head, {
          status, budget, watch, schedule, kill: get('/kill'),
          refreshing, onRefresh: () => { reloadAll(); load(['/inbox?limit=8']) },
          onJump: (v) => { setView(v); try { localStorage.setItem('dys-view', v) } catch (_) {} },
          onKill: async (on) => {
            /* 开是止血，立刻执行；关是"恢复发送"，多问一句。 */
            if (!on && typeof window !== 'undefined' && typeof window.confirm === 'function'
              && !window.confirm('解除停损？解除后回评 / 私信 / 发布 / 删除会立刻恢复。')) return
            try {
              const r = await jpost('/kill', on ? { on: true, reason: '面板手动停损' } : { on: false })
              if (!r || r.ok === false) setMsg({ ok: false, tag: 'kill', data: r })
              await load(['/kill'])
            } catch (e) {
              setMsg({ ok: false, tag: 'kill', data: { ok: false, error: String((e && e.message) || e) } })
            }
          },
          onPause: async (paused) => {
            const r = await jpost('/schedule/pause', { paused })
            if (r && r.ok) load(['/schedule'])
            else setMsg({ ok: false, tag: 'schedule/pause', data: r })
          },
        }),

        /* 四个动词一排，没有第二层 —— 找东西不用先想"它在哪个抽屉里" */
        h('div', { 'data-dys-seg': '' }, VIEWS.map(([id, l]) => tab(id, l))),

        h('div', {
          'data-dys-view': '', ref: viewRef,
          'data-more': overflowing ? '' : undefined,
        }, ...viewCards),

        /* 动作结果：折起来，别糊脸 */
        msg ? h('div', {
          'data-dys-card': '',
          style: { '--dys-ac': msg.ok ? 'var(--dys-ok)' : 'var(--dys-bad)' },
        },
          h('details', null,
            h('summary', {
              'data-dys-sm': '', style: { cursor: 'pointer', color: msg.ok ? 'var(--dys-ok)' : 'var(--dys-bad)' },
            },
              (msg.ok ? '✓ ' : '✗ ') + msg.tag + (msg.ok ? '' : ' · 没成') + ' · 点开看原文'),
            h('pre', { 'data-dys-pre': '' }, JSON.stringify(msg.data, null, 1)))) : null,

        !logged && !refreshing
          ? h('div', { 'data-dys-card': '' },
            h('div', { 'data-dys-head': '' }, h('div', { 'data-dys-title': '' }, '没登上'),
              h('div', { 'data-dys-sub': '', 'data-dys-grow': '' }, '打开开发者浏览器扫码，扫完点刷新')),
            h('div', { 'data-dys-row': '' },
              h(Btn, {
                label: '出二维码', primary: true, busy: busyTag === 'qr',
                onClick: async () => {
                  setBusyTag('qr')
                  try { const r = await jget('/login/qr'); setMsg({ ok: !!(r && r.ok), tag: 'login/qr', data: r }) }
                  finally { setBusyTag('') }
                },
              }),
              h(Btn, { label: '刷新状态', onClick: () => reloadAll() })))
          : null,

        pal ? h('div', { 'data-dys-pal': '', onClick: () => setPal(false) },
          h('div', { 'data-dys-palbox': '', onClick: (e) => e.stopPropagation() },
            h('div', { 'data-dys-paltitle': '' }, '跳到哪儿 · Esc 关掉'),
            [['今天', () => setView('today')], ['回应', () => setView('reply')],
              ['找内容', () => setView('find')], ['设置', () => setView('settings')],
              ['刷新全部', () => reloadAll()],
              ['刷一轮视频', () => { setView('find'); runFeed() }],
              ...(schedule && schedule.ok ? [[schedule.paused ? '继续自动刷' : '暂停自动刷',
                async () => { await jpost('/schedule/pause', { paused: !schedule.paused }); load(['/schedule']) }]] : []),
            ].map(([label, fn], i) => h('button', {
              key: i, 'data-dys-palitem': '', type: 'button',
              onClick: () => { setPal(false); fn() },
            }, label)))) : null,

        /* 调试信息收进抽屉：CDP 端口、uid 不该占一级界面。
         * b<N> 留在摘要行 —— 刷新后对不上就是吃了缓存，这是老规矩。 */
        h('details', { 'data-dys-diag': '' },
          h('summary', null, '诊断与版本 · b' + PANEL_BUILD),
          h('div', { 'data-dys-diagbody': '' },
            h('div', { 'data-dys-kv': '' }, h('span', null, '调试端口'),
              h('span', null, 'CDP ' + ((cfg && cfg.cdpPort) || '—') + ' · ' + ((cfg && cfg.autoOpen) ? '没窗口自己起' : '不自动起窗口'))),
            h('div', { 'data-dys-kv': '' }, h('span', null, '账号 uid'),
              h('span', null, ((status && status.self && status.self.user && status.self.user.uid) || '—'))),
            h('div', { 'data-dys-kv': '' }, h('span', null, '每天回评上限'),
              h('span', null, ((cfg && cfg.perDay) || '—') + ' 条')),
            h('div', { 'data-dys-note': '', style: { marginTop: '2px' } },
              '发布和删稿要走工具或命令行（那些需要上下文）。'))))
    }

    class Boundary extends React.Component {
      constructor(p) { super(p); this.state = { e: null } }
      static getDerivedStateFromError(e) { return { e } }
      render() {
        if (this.state.e) {
          return h('div', { 'data-dys': '', 'data-theme': 'dark' },
            h('div', { 'data-dys-card': '' },
              h('div', { 'data-dys-title': '' }, '这一页崩了'),
              h('pre', { 'data-dys-pre': '' }, String((this.state.e && this.state.e.stack) || this.state.e))))
        }
        return this.props.children
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.setAttribute('data-plugin-css', 'dsh-douyin-studio')
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'dsh-douyin-studio: 设置页样式')

        const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
        if (!slots) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'douyin-studio', order: 32, label: '抖音工作室' },
          () => h(Boundary, null, h(Panel)),
        ))
      },
    }
  },
})
