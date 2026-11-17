# yudao-cloud-free

芋道文档（cloud.iocoder.cn）VIP 解锁脚本说明

配套文件：`user.js`（Tampermonkey 用户脚本，v1.3）

本文档记录三件事：站点真实的前端门禁逻辑、脚本是怎么绕过它的、以及历史两次失效的原因。

---

## 一、站点门禁的真实逻辑

逆向来源：`https://cloud.iocoder.cn/assets/js/app.*.js` 中的 VuePress 插件（压缩混淆，函数名如 `Md=[({Vue,options,router,siteData,isServer}) => ...`）。

### 1. 是否 VIP 只看一个 cookie

```
88974ed8-6aff-48ab-a7d1-4af5ffea88bb
```

- cookie **存在且非空** → 认为已授权
- cookie 不存在 → 把 `.content-wrapper` 的内容替换成「仅 VIP 可见！」（每 100ms 重写一次，持续 2 秒），并弹出星球引导弹窗

### 2. 授权复核接口

cookie 存在时，每次路由切换会请求：

```
GET https://svip.iocoder.cn/zsxq/auth?host=cloud.iocoder.cn&vip=<cookie值>&telemetrySession=...
```

- 返回**真值** → 继续校验续费（`join_time` / `expire_time`）
- 返回**假值** → `Cookies.remove(vipCookie)` + `location.reload()`
- 请求失败（`.fail`，如 4xx/5xx）→ 只记录，不删 cookie

> 关键：这个接口是「复核」，不是「授权」。只伪造它的返回值，cookie 依然不存在，弹窗照样出。

### 3. 真实激活通道

仅当 URL 带 `signature` 查询参数时才会走：

```
GET https://svip.iocoder.cn/zsxq/auth-callback?host=...&appId=...&expireTime=...&userId=...&signature=...
```

成功（返回真值）后写入三个 cookie，并 `alert("验证通过，可阅读所有文档！...")`。

### 4. 弹窗与续费提醒

| 弹窗 | 触发条件 | 标题 |
| --- | --- | --- |
| `vip_guide` | 无 VIP cookie（`guest`）或被 MCP 工具调用（`mcp`） | 🚀 该文档仅「芋道快速开发平台 Boot + Cloud」星球 VIP 用户可见 🚀 |
| `renewal` | 加入星球超过 7 天，且 `expire_time` 距今不足 90 天 | 🔔 知识星球即将到期提醒 🔔 |

此外还有一个 `setInterval`：每秒检查 cookie，一旦出现就关闭引导弹窗并 `reload`。

### 5. 门禁只作用于部分路径

`p()` 按 pathname 白名单判断，命中才做校验，例如：`/mall/`、`/pay/`、`/erp/`、`/ai/`、`/iot/`、`/bpm/`、`/gateway/`、`/deployment-*` 等（本次目标页 `/mall/promotion-coupon/` 命中 `/mall/`）。

兜底：内容被替换时若 JS 异常，会跳转到星球文章页。

---

## 二、脚本实现

```
@run-at document-start
@inject-into page
@grant none
@match *://cloud.iocoder.cn/*
@match *://doc.iocoder.cn/*
```

执行顺序即脚本内的编号：

1. **写 cookie（核心手段）**
   - `88974ed8-...` = `1.1`（站内只校验非空，格式为 `signature.userId`）
   - `join_time` = 当前时间 → 让续费提醒逻辑在「7 天内加入」的判断处提前 return
   - `expire_time` = 当前时间 + 365 天
   - 已存在合法值时不覆盖，真实 VIP 的订阅信息保持原样
2. **清理 URL 上的 `signature=true`**
   - 这是 v1.0 遗留参数，存在时会触发 `/zsxq/auth-callback`，弹一次 `alert` 并用 `undefined` 覆盖 cookie
   - 用 `history.replaceState` 改写地址栏，不做跳转
3. **拦截 `/zsxq/auth`、`/zsxq/auth-callback`**
   - 匹配方式：`origin === https://svip.iocoder.cn` 且 `pathname` 精确等于二者之一
   - 刻意**不**匹配 `/zsxq/auth-url`（站点会用它取跳转地址，伪造会让页面跳到 "true"）
   - 返回 `200` + `true`（`Content-Type: application/json`），避免 cookie 被删后进入 reload 循环
4. **fetch + XHR 双拦截**
   - 站点用的是 jQuery（XHR 通道），所以必须改 `XMLHttpRequest.prototype.open/send`
   - 伪造响应时用 `dispatchEvent` 派发 `readystatechange` / `load` / `loadend`，同时兼容 `onload` 与 `addEventListener` 两种写法
   - 补齐 `status`、`responseText`、`response`、`responseURL`、`getResponseHeader`、`getAllResponseHeaders`，jQuery 需要读这些字段判断成功与 dataType

---

## 三、两次失效的原因

### 第一次：文件被"剥符号"

原始 `user.js` 里的 `//`、`=`、`:`、`=>`、`?`、`.`、`/` 全部丢失，例如：

| 文件中的样子 | 实际应为 |
| --- | --- |
| `==UserScript==` | `// ==UserScript==` |
| `@match cloud.iocoder.cn` | `// @match *://cloud.iocoder.cn/*` |
| `'httpssvip.iocoder.cnzsxqauth'` | `'https://svip.iocoder.cn/zsxq/auth'` |
| `status 200` | `status: 200` |
| `async (input, init) = {` | `async (input, init) => {` |

整段 JS 语法错误 → Tampermonkey 解析失败 → 等于没装。此外还有三个即使语法正确也会失效的点：

- `@match cloud.iocoder.cn` 不是合法匹配模式，脚本不会被注入任何页面
- 拦截条件写死 `url.includes('host=cloud.iocoder.cn')`，在 `doc.iocoder.cn` 上永不命中
- `class extends XMLHttpRequest` 只回调 `onload` / `onreadystatechange`，用 `addEventListener` 的调用方拿不到响应

### 第二次：门禁在 cookie，不在接口

v1.1 仍然只伪造 `/zsxq/auth` 返回 `true`，但该接口只是复核：

- 没有 VIP cookie → 直接走弹窗分支，接口根本没被调用
- 旧脚本强制追加 `signature=true` → 反而触发 `/zsxq/auth-callback`，`alert` 一次、把 `expire_time` 覆盖成 `undefined`

v1.2 起改为直接写 cookie，接口拦截仅用于防止 cookie 被删。

---

## 四、安装

1. 打开 Tampermonkey → 添加新脚本 → 全选删除 → 粘贴 `user.js` 内容 → Ctrl+S 保存
2. 确认脚本处于启用状态（TM 图标菜单与面板总开关）
3. 打开 `https://cloud.iocoder.cn/mall/promotion-coupon/`，Ctrl+F5 硬刷新
4. F12 → Console 应出现：

```
[VIP激活] 已写入 VIP cookie
[VIP激活] 云社区VIP解锁已激活
[VIP激活] 拦截 XHR 授权请求： https://svip.iocoder.cn/zsxq/auth?host=cloud.iocoder.cn&vip=1.1...
```

---

## 五、验证数据

Chrome headless + CDP，真实访问 `https://cloud.iocoder.cn/mall/promotion-coupon/`，等待 10 秒：

| 观测项 | 不注入脚本 | 注入 v1.2 |
| --- | --- | --- |
| `.alert-container` 数量 | 1（星球 VIP 弹窗） | 0 |
| 正文 | 仅 VIP 可见！ | 【营销】优惠劵 优惠劵功能，主要由 yudao-module-promotion 后端模块的 coupon 实现… |
| 授权接口 | 未被调用 | 被拦截并返回 true |

---

## 六、常见问题

### 提示「脚本未被执行」

这是注入层问题，与脚本内容无关，按顺序排查：

1. **Chrome 127+ 必须开启「允许用户脚本」**：`chrome://extensions` → 右上角开发者模式 → Tampermonkey「详情」→ 打开 *Allow User Scripts* → 刷新页面（Edge 在 `edge://extensions` 同理）
2. 脚本是否启用、保存时编辑器是否报红
3. 安装方式：双击 `user.js` 后必须点「安装」；被 `file://` 拦截时改用 TM「实用工具 → 从文件导入」
4. 访问域名是否为 `cloud.iocoder.cn`（`doc.iocoder.cn` 会被站点自身重定向）
5. 脚本设置页的「用户包括」应包含 `*://cloud.iocoder.cn/*`

### Console 有 `[VIP激活]` 日志，但弹窗仍出现

说明 cookie 没写成或被清掉，检查 Application → Cookies 中 `88974ed8-6aff-48ab-a7d1-4af5ffea88bb` 是否存在；若在被清除，通常是 `/zsxq/auth` 返回了假值（拦截未生效，多为 `@inject-into` 未落页面上下文）。

### 出现「知识星球即将到期提醒」

真实 VIP cookie 的 `join_time` 距今超过 7 天且 `expire_time` 在 3 个月内。脚本只在 cookie 缺失时才写入，不会覆盖真实订阅数据；需要屏蔽可在浏览器里手动改 `join_time`。

---

## 七、免责声明

脚本仅用于个人学习与本地调试，作者未对站点服务端做任何改动。文档内容版权归「芋道源码」所有，长期阅读请加入知识星球。
