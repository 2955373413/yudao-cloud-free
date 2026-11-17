// ==UserScript==
// @name         芋道源码 yudao-cloud ruoyi-vue-pro 开发指南知识星球VIP用户激活
// @namespace    yudao-doc-vip
// @version      1.3
// @description  该文档仅「芋道快速开发平台 Boot + Cloud」星球 VIP 用户可见，知识星球激活接口
// @author       admin
// @match        *://cloud.iocoder.cn/*
// @match        *://doc.iocoder.cn/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    /* ------------------------------------------------------------------
     * 站点真实的 VIP 门禁逻辑（逆向自 /assets/js/app.*.js 的 VuePress 插件）
     *
     * 1. 是否 VIP 只看一个 cookie 是否存在：
     *      88974ed8-6aff-48ab-a7d1-4af5ffea88bb
     *    cookie 无值 -> 把 .content-wrapper 改成「仅 VIP 可见！」并弹出星球弹窗
     * 2. cookie 有值 -> 会再请求 ${AUTH_ORIGIN}/zsxq/auth?vip=<cookie>，
     *    返回假值时会 Cookies.remove + location.reload()（所以必须拦截）
     * 3. 只有 URL 带 signature 参数时才走 /zsxq/auth-callback 的真实激活流程
     *
     * 因此：直接写入该 cookie 最稳，拦截 auth 接口只是为了不让它把 cookie 删掉。
     * ------------------------------------------------------------------ */

    // ==================== 配置 ====================
    const VIP_COOKIE = '88974ed8-6aff-48ab-a7d1-4af5ffea88bb';
    const VIP_VALUE = '1.1';                       // 站内只校验非空，格式为 signature.userId
    const AUTH_ORIGIN = 'https://svip.iocoder.cn';  // 授权接口所在域名
    const AUTH_PATHS = ['/zsxq/auth', '/zsxq/auth-callback'];
    const FAKE_BODY = 'true';
    const CONTENT_TYPE = 'application/json;charset=UTF-8';
    const DAY = 86400;
    const DEBUG = true;

    const log = (...args) => {
        if (DEBUG) console.log('%c[VIP激活]', 'color:#42b983;font-weight:bold', ...args);
    };

    // ==================== 一、cookie 读写 ====================
    function getCookie(name) {
        const prefix = name + '=';
        const item = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith(prefix));
        if (!item) return null;
        try {
            return decodeURIComponent(item.slice(prefix.length));
        } catch (e) {
            return item.slice(prefix.length);
        }
    }

    function setCookie(name, value, days) {
        document.cookie = name + '=' + encodeURIComponent(value)
            + '; path=/; max-age=' + days * DAY + '; SameSite=Lax';
    }

    function isTimestamp(value) {
        return !!value && /^\d{9,}$/.test(value);
    }

    // ==================== 二、写入 VIP cookie（核心） ====================
    (function writeVipCookie() {
        try {
            const now = Math.floor(Date.now() / 1000);

            if (!getCookie(VIP_COOKIE)) {
                setCookie(VIP_COOKIE, VIP_VALUE, 365);
                log('已写入 VIP cookie');
            }
            // join_time = 当前时间：站点 7 天内加入不会弹「续费提醒」
            if (!isTimestamp(getCookie('join_time'))) {
                setCookie('join_time', String(now), 365);
            }
            if (!isTimestamp(getCookie('expire_time'))) {
                setCookie('expire_time', String(now + 365 * DAY), 365);
            }
        } catch (e) {
            log('写入 cookie 失败：', e);
        }
    })();

    // ==================== 三、清理旧脚本留下的 signature=true 参数 ====================
    // 否则每次访问都会走 /zsxq/auth-callback，弹一次 alert 并覆盖 cookie
    (function stripLegacySignature() {
        try {
            const url = new URL(location.href);
            if (url.searchParams.get('signature') !== 'true') return;

            url.searchParams.delete('signature');
            history.replaceState(history.state, '', url.toString());
            log('已清理 URL 上的 signature=true');
        } catch (e) {
            log('清理 signature 参数失败：', e);
        }
    })();

    // ==================== 四、判断是否为需要伪造的授权接口 ====================
    function isTargetApi(rawUrl) {
        if (!rawUrl) return false;

        let absUrl;
        try {
            absUrl = new URL(String(rawUrl), location.href);
        } catch (e) {
            return false;
        }

        return absUrl.origin === AUTH_ORIGIN && AUTH_PATHS.indexOf(absUrl.pathname) !== -1;
    }

    // ==================== 五、拦截 fetch ====================
    const nativeFetch = window.fetch;
    if (typeof nativeFetch === 'function') {
        window.fetch = function (...args) {
            const input = args[0];
            const rawUrl = typeof input === 'string'
                ? input
                : (input instanceof Request ? input.url : (input && input.url));

            if (isTargetApi(rawUrl)) {
                log('拦截 fetch 授权请求：', rawUrl);
                return Promise.resolve(new Response(FAKE_BODY, {
                    status: 200,
                    statusText: 'OK',
                    headers: { 'Content-Type': CONTENT_TYPE }
                }));
            }

            return nativeFetch.apply(this, args);
        };
    }

    // ==================== 六、拦截 XMLHttpRequest（站点用的是 jQuery） ====================
    const nativeXHR = window.XMLHttpRequest;
    if (nativeXHR && nativeXHR.prototype) {
        const nativeOpen = nativeXHR.prototype.open;
        const nativeSend = nativeXHR.prototype.send;

        nativeXHR.prototype.open = function (method, url) {
            this.__yudao_url = url;
            return nativeOpen.apply(this, arguments);
        };

        nativeXHR.prototype.send = function () {
            const rawUrl = this.__yudao_url;

            if (!isTargetApi(rawUrl)) {
                return nativeSend.apply(this, arguments);
            }

            log('拦截 XHR 授权请求：', rawUrl);

            const xhr = this;
            const body = xhr.responseType === 'json' ? true : FAKE_BODY;

            // 不真正发请求，直接伪造一次 200 响应
            setTimeout(() => {
                try {
                    Object.defineProperties(xhr, {
                        readyState: { value: 4, configurable: true },
                        status: { value: 200, configurable: true },
                        statusText: { value: 'OK', configurable: true },
                        responseText: { value: FAKE_BODY, configurable: true },
                        response: { value: body, configurable: true },
                        responseURL: { value: String(rawUrl), configurable: true },
                        getResponseHeader: {
                            value: name => String(name).toLowerCase() === 'content-type' ? CONTENT_TYPE : null,
                            configurable: true
                        },
                        getAllResponseHeaders: {
                            value: () => 'content-type: ' + CONTENT_TYPE + '\r\n',
                            configurable: true
                        }
                    });
                } catch (e) {
                    log('伪造 XHR 响应失败：', e);
                }

                // 用事件派发，同时兼容 onload 与 addEventListener 两种写法
                try { xhr.dispatchEvent(new Event('readystatechange')); } catch (e) { /* ignore */ }
                try { xhr.dispatchEvent(new ProgressEvent('load')); } catch (e) { /* ignore */ }
                try { xhr.dispatchEvent(new ProgressEvent('loadend')); } catch (e) { /* ignore */ }
            }, 0);
        };
    }

    log('云社区VIP解锁已激活');
})();
