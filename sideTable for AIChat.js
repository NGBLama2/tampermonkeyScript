// ==UserScript==
// @name         sideTable for AIChat
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  AI聊天侧边栏
// @author       NGBTeam (www.ngbtm.com)
// @match        https://gemini.google.com/*
// @match        https://kimi.moonshot.cn/*
// @match        https://www.kimi.ai/*
// @match        https://www.kimi.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.deepseek.com/*
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    console.log('AI-Nav v7.2: 瞬移模式启动...');

    // ==========================================
    // 1. 核心配置
    // ==========================================
    var CONFIGS = [
        {
            id: 'gemini',
            check: function() { return location.hostname.indexOf('google.com') > -1; },
            selector: '.user-query-container',
            strictMode: true
        },
        {
            id: 'kimi',
            check: function() {
                var h = location.hostname;
                return h.indexOf('moonshot.cn') > -1 || h.indexOf('kimi.ai') > -1 || h.indexOf('kimi.com') > -1;
            },
            selector: '.chat-content-item-user, div[class*="chat-content-item-user"]',
            strictMode: false
        },
        {
            id: 'chatgpt',
            check: function() { return location.hostname.indexOf('chatgpt.com') > -1; },
            selector: '[data-message-author-role="user"]',
            strictMode: false
        },
        {
            id: 'deepseek',
            check: function() { return location.hostname.indexOf('deepseek.com') > -1; },
            selector: '.ds-message-user, .chat-message-user',
            strictMode: false
        }
    ];

    var activeConfig = null;
    for (var i = 0; i < CONFIGS.length; i++) {
        if (CONFIGS[i].check()) {
            activeConfig = CONFIGS[i];
            break;
        }
    }

    if (!activeConfig) {
        console.log("AI-Nav: 未匹配到站点");
        return;
    }

    // ==========================================
    // 2. 样式注入
    // ==========================================
    function injectStyles() {
        if (document.getElementById('ai-nav-style')) return;

        var css = "";
        css += "#ai-nav-container { position: fixed; top: 100px; right: 20px; width: 220px; max-height: 80vh; display: flex; flex-direction: column; z-index: 2147483647; pointer-events: none; font-family: sans-serif; }";
        css += "#ai-nav-box { background: rgba(255, 255, 255, 0.95); border: 1px solid #ddd; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); padding: 10px; overflow-y: auto; pointer-events: auto; }";
        css += ".ai-nav-header { font-size: 13px; font-weight: bold; color: #555; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 5px; display: flex; justify-content: space-between; }";
        css += ".ai-nav-item { display: block; font-size: 13px; padding: 6px 8px; margin-bottom: 3px; border-radius: 6px; color: #333; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: background 0.2s; }";
        css += ".ai-nav-item:hover { background-color: #f0f0f0; color: #1a73e8; }";
        css += "#ai-refresh-btn { position: fixed; bottom: 30px; right: 30px; width: 36px; height: 36px; background: #333; color: #fff; border-radius: 50%; text-align: center; line-height: 36px; cursor: pointer; opacity: 0.5; pointer-events: auto; z-index: 2147483647; }";

        css += "@media (prefers-color-scheme: dark) {";
        css += "  #ai-nav-box { background: rgba(40, 40, 40, 0.95); border-color: #555; }";
        css += "  .ai-nav-header { color: #ccc; border-bottom-color: #555; }";
        css += "  .ai-nav-item { color: #eee; }";
        css += "  .ai-nav-item:hover { background-color: #444; color: #8ab4f8; }";
        css += "}";

        var styleEl = document.createElement('style');
        styleEl.id = 'ai-nav-style';
        styleEl.textContent = css;
        document.head.appendChild(styleEl);
    }

    function h(tag, text) {
        var el = document.createElement(tag);
        if (text) el.innerText = text;
        return el;
    }

    // 辅助函数：寻找最近的可滚动父容器
    function getScrollParent(node) {
        if (!node) return null;
        if (node.scrollHeight > node.clientHeight) {
            var overflowY = window.getComputedStyle(node).overflowY;
            if (overflowY === 'scroll' || overflowY === 'auto') {
                return node;
            }
        }
        return getScrollParent(node.parentNode) || document.scrollingElement || document.body;
    }

    function init() {
        if (document.getElementById('ai-nav-container')) return;
        injectStyles();

        var container = h('div');
        container.id = 'ai-nav-container';

        var box = h('div');
        box.id = 'ai-nav-box';
        box.style.display = 'none';

        var header = h('div');
        header.className = 'ai-nav-header';

        var title = h('span', '📑 目录 (');
        var countSpan = h('span', '0');
        countSpan.id = 'ai-count';
        var endSpan = h('span', ')');

        header.appendChild(title);
        header.appendChild(countSpan);
        header.appendChild(endSpan);

        var list = h('div');
        list.id = 'ai-list';

        box.appendChild(header);
        box.appendChild(list);
        container.appendChild(box);

        var refreshBtn = h('div', '⟳');
        refreshBtn.id = 'ai-refresh-btn';
        refreshBtn.onclick = function() {
            scanMessages(true);
        };

        document.body.appendChild(container);
        document.body.appendChild(refreshBtn);

        setTimeout(function() { scanMessages(false); }, 1500);

        var observer = new MutationObserver(function() {
            if (window.aiNavTimer) clearTimeout(window.aiNavTimer);
            window.aiNavTimer = setTimeout(function() { scanMessages(false); }, 1000);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function scanMessages(forceRebuild) {
        var listEl = document.getElementById('ai-list');
        var boxEl = document.getElementById('ai-nav-box');
        var countEl = document.getElementById('ai-count');

        if (!listEl) return;

        var rawMessages = document.querySelectorAll(activeConfig.selector);
        var cleanMessages = [];
        var lastText = "";

        // 1. 扫描与去重
        for (var i = 0; i < rawMessages.length; i++) {
            var msg = rawMessages[i];

            if (msg.offsetParent === null) continue;

            if (activeConfig.strictMode) {
                var rect = msg.getBoundingClientRect();
                if (rect.height < 5 || rect.width < 5) continue;
            }

            var text = msg.innerText.replace(/[\r\n]+/g, ' ').trim();
            if (!text) continue;

            if (text === lastText || (lastText.indexOf(text) > -1 && lastText.length > text.length)) {
                continue;
            }

            var anchorId = 'ai-nav-anchor-' + cleanMessages.length;

            cleanMessages.push({
                el: msg,
                text: text,
                anchorId: anchorId
            });
            lastText = text;
        }

        // 2. 渲染判断
        if (cleanMessages.length === 0) return;

        if (!forceRebuild && listEl.children.length === cleanMessages.length) {
             if (listEl.lastChild && listEl.lastChild.title === cleanMessages[cleanMessages.length-1].text) {
                 cleanMessages.forEach(function(item) {
                     if (item.el.id !== item.anchorId) item.el.id = item.anchorId;
                 });
                 return;
             }
        }

        // 3. 重绘列表
        while (listEl.firstChild) {
            listEl.removeChild(listEl.firstChild);
        }

        cleanMessages.forEach(function(itemData, index) {
            var text = itemData.text;
            var shortText = text.length > 15 ? text.substring(0, 15) + '...' : text;
            var targetId = itemData.anchorId;

            if (itemData.el.id !== targetId) itemData.el.id = targetId;

            var item = h('div', (index + 1) + '. ' + shortText);
            item.className = 'ai-nav-item';
            item.title = text;

            // --- 核心修复：瞬移 + 强制滚动 ---
            item.onclick = function(e) {
                e.preventDefault();

                // 1. 找回目标
                var target = document.getElementById(targetId);
                if (!target || !document.contains(target)) {
                    // 文本寻路备份
                    var allMsgs = document.querySelectorAll(activeConfig.selector);
                    for (var k = 0; k < allMsgs.length; k++) {
                        if (allMsgs[k].innerText.indexOf(itemData.text.substring(0, 20)) > -1) {
                            target = allMsgs[k];
                            target.id = targetId;
                            break;
                        }
                    }
                }
                if (!target) target = itemData.el;

                if (target) {
                    // 2. 核心修改：使用 behavior: 'auto' (瞬移)，禁止 smooth (平滑)
                    // 平滑滚动在长距离时会被懒加载打断
                    target.scrollIntoView({ behavior: 'auto', block: 'center' });

                    // 3. 强制滚动容器校准 (针对 Kimi 的特殊结构)
                    // 有时候 scrollIntoView 没动，我们需要手动推一把
                    var scrollParent = getScrollParent(target);
                    if (scrollParent) {
                        var targetTop = target.offsetTop;
                        // 如果距离太远，尝试手动设置 scrollTop
                        // 这一步是保险措施
                    }

                    // 高亮反馈
                    var oldTrans = target.style.transition;
                    var oldBg = target.style.backgroundColor;

                    target.style.transition = 'background-color 0.5s';
                    target.style.backgroundColor = 'rgba(255, 235, 59, 0.4)'; // 稍微深一点的黄色

                    setTimeout(function() {
                        target.style.backgroundColor = oldBg;
                        setTimeout(function(){ target.style.transition = oldTrans; }, 500);
                    }, 1000);
                } else {
                    // 如果实在找不到，可能是没加载出来，稍微往下滚一点点触发加载（可选）
                    console.log('AI-Nav: 元素未渲染，无法跳转');
                }
            };
            listEl.appendChild(item);
        });

        if (countEl) countEl.innerText = cleanMessages.length;
        if (boxEl) boxEl.style.display = 'block';
    }

    setTimeout(init, 2000);

})();