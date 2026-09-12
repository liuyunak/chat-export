// ==UserScript==
// @name         聊天会话导出助手
// @namespace    chat-export-userscript
// @version      0.1.0
// @author       Chat Export Contributors
// @description  把分享会话导出为 Markdown，可选是否包含思考过程（DeepSeek/WorkBuddy/豆包/Trae/Kimi/元宝/智谱清言/秘塔）
// @license      MIT
// @match        https://chat.deepseek.com/*
// @match        https://*.workbuddy.link/*
// @match        https://www.doubao.com/*
// @match        https://share.traecontent.cn/*
// @match        https://www.kimi.com/share/*
// @match        https://kimi.moonshot.cn/share/*
// @match        https://yb.tencent.com/s/*
// @match        https://chatglm.cn/*
// @match        https://metaso.cn/*
// @run-at       document-idle
// ==/UserScript==

(function() {
	"use strict";
	var deepseekAdapter = {
		platform: "deepseek",
		detect(url) {
			return /chat\.deepseek\.com\/(share\/|a\/chat\/s\/)/.test(url);
		},
		async extract() {
			const shareId = extractShareId$2(location.href);
			if (!shareId) throw new Error("无法从链接解析出分享 ID");
			const resp = await fetch(`/api/v0/share/content?share_id=${encodeURIComponent(shareId)}`, { credentials: "include" });
			if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status}`);
			const json = await resp.json();
			if (json.code !== 0 || json.data?.biz_code !== 0) throw new Error(`分享不存在或已失效（biz_code=${json.data?.biz_code}）`);
			return mapShareData(shareId, location.href, json.data.biz_data);
		}
	};
	function extractShareId$2(url) {
		const m = url.match(/\/(?:share|a\/chat\/s)\/([A-Za-z0-9_-]+)/);
		return m ? m[1] : null;
	}
	function mapShareData(shareId, sourceUrl, bd) {
		return {
			id: shareId,
			title: deriveTitle(bd),
			platform: "deepseek",
			sourceUrl,
			model: bd.model_type && bd.model_type !== "default" ? bd.model_type : void 0,
			createdAt: bd.messages[0]?.inserted_at ? unixToIso$1(bd.messages[0].inserted_at) : void 0,
			messages: bd.messages.map(toMessage$5)
		};
	}
	function deriveTitle(bd) {
		const t = bd.title?.trim();
		if (t && t !== "Shared Conversation") return t;
		const c = bd.messages.find((m) => m.role === "USER")?.content?.trim().replace(/\s+/g, " ");
		if (c) return c.length > 30 ? `${c.slice(0, 30)}…` : c;
		return t || "未命名会话";
	}
	function toMessage$5(m) {
		const thinking = m.thinking_content && m.thinking_content.trim() ? [{
			title: "深度思考",
			content: m.thinking_content
		}] : [];
		return {
			id: String(m.message_id),
			role: m.role === "USER" ? "user" : m.role === "ASSISTANT" ? "assistant" : "system",
			content: m.content ?? "",
			thinking,
			timestamp: m.inserted_at ? unixToIso$1(m.inserted_at) : void 0,
			attachments: (m.files ?? []).map(toAttachment).filter((a) => a !== null)
		};
	}
	function toAttachment(f) {
		const url = f.file_url ?? f.url;
		const name = f.file_name ?? f.name;
		if (!url && !name) return null;
		return {
			type: "file",
			name,
			url
		};
	}
	function unixToIso$1(sec) {
		return new Date(sec * 1e3).toISOString();
	}
	var workbuddyAdapter = {
		platform: "workbuddy",
		detect(url) {
			return /workbuddy\.link\/p\//.test(url);
		},
		async extract() {
			const data = await loadData();
			return mapWBData(location.href, data);
		}
	};
	async function loadData() {
		const base = readBootstrap()?.artifact?.url;
		if (base) {
			const resp = await fetch(join(base, "conversation-data.json"), { credentials: "omit" });
			if (resp.ok) return await resp.json();
		}
		const nodeId = extractNodeId(location.href);
		if (!nodeId) throw new Error("无法解析分享 ID");
		location.host.replace(/^www\./, "").replace(/^workbuddy\.link$/, "");
		const fallbackBase = `https://workbuddy-space-static.codebuddy.work/page/${nodeId}/0/`;
		const resp = await fetch(join(fallbackBase, "conversation-data.json"), { credentials: "omit" });
		if (!resp.ok) throw new Error(`数据请求失败：HTTP ${resp.status}`);
		return await resp.json();
	}
	function readBootstrap() {
		const scripts = Array.from(document.querySelectorAll("script"));
		for (const s of scripts) {
			const t = s.textContent ?? "";
			const i = t.indexOf("__PUBLISH_BOOTSTRAP__");
			if (i < 0) continue;
			const start = t.indexOf("{", i);
			const end = t.lastIndexOf("}");
			if (start < 0 || end < 0) continue;
			try {
				return JSON.parse(t.slice(start, end + 1));
			} catch {}
		}
		return null;
	}
	function extractNodeId(url) {
		const m = url.match(/\/p\/([A-Za-z0-9]+)/);
		return m ? m[1] : null;
	}
	function join(base, file) {
		return base.endsWith("/") ? base + file : `${base}/${file}`;
	}
	function mapWBData(sourceUrl, d) {
		return {
			id: extractNodeId(sourceUrl) ?? "unknown",
			title: d.name?.trim() || "未命名会话",
			platform: "workbuddy",
			sourceUrl,
			createdAt: d.messages[0]?.createTime ? new Date(d.messages[0].createTime).toISOString() : void 0,
			messages: d.messages.map(toMessage$4)
		};
	}
	function toMessage$4(m) {
		const thinking = [];
		const contentParts = [];
		for (const b of m.content) if (b.type === "reasoning" && b.text?.trim()) thinking.push({ content: b.text });
		else if (b.type === "text" && b.text?.trim()) contentParts.push(b.text);
		else if (b.type === "tool-call") {
			const name = toolName(b.tool);
			if (name) contentParts.push(`> 🔧 调用工具：\`${name}\``);
		}
		return {
			id: m.id,
			role: m.messageType === "user" ? "user" : "assistant",
			content: contentParts.join("\n\n"),
			thinking,
			timestamp: m.createTime ? new Date(m.createTime).toISOString() : void 0
		};
	}
	function toolName(tool) {
		if (!tool || typeof tool !== "object") return null;
		const t = tool;
		const n = t.name ?? t.tool_name ?? t.toolName ?? t.type;
		return typeof n === "string" ? n : null;
	}
	var doubaoAdapter = {
		platform: "doubao",
		detect(url) {
			return /doubao\.com\/(thread|share\/doc)\/[A-Za-z0-9]/.test(url);
		},
		extract() {
			const inner = readShareInner();
			if (!inner) throw new Error("未找到内嵌的分享数据（页面可能未加载完成或结构已变化）");
			return mapDoubaoShare(inner, location.href);
		}
	};
	function readShareInner() {
		const scripts = document.querySelectorAll("script[data-fn-name=\"mergeLoaderData\"]");
		for (const s of scripts) {
			const attr = s.getAttribute("data-fn-args");
			if (!attr) continue;
			let outer;
			try {
				outer = JSON.parse(attr);
			} catch {
				continue;
			}
			const loaders = outer[1];
			if (!Array.isArray(loaders)) continue;
			const arg = loaders.find((x) => x.key === "shareInfo")?.routerDataFnArgs?.[0];
			if (typeof arg === "string") try {
				return JSON.parse(arg);
			} catch {}
		}
		return null;
	}
	function mapDoubaoShare(inner, sourceUrl) {
		const shareInfo = inner.data?.share_info;
		const list = (inner.data?.message_snapshot?.message_list ?? []).slice().sort((a, b) => num(a.index_in_conv) - num(b.index_in_conv));
		return {
			id: sourceUrl.match(/\/(?:thread|share\/doc)\/([A-Za-z0-9]+)/)?.[1] ?? "unknown",
			title: shareInfo?.share_name?.trim() || firstUserPreview(list),
			platform: "doubao",
			sourceUrl,
			model: shareInfo?.bot?.name || void 0,
			createdAt: list[0]?.create_time ? unixToIso(list[0].create_time) : void 0,
			messages: list.map(toMessage$3)
		};
	}
	function num(v) {
		const n = Number(v);
		return Number.isFinite(n) ? n : 0;
	}
	function toMessage$3(m, idx) {
		let blocks = [];
		try {
			blocks = m.content ? JSON.parse(m.content) : [];
		} catch {
			blocks = [];
		}
		const contentParts = [];
		const thinking = [];
		const attachments = [];
		for (const b of blocks) switch (b.block_type) {
			case 1e4:
				if (b.content?.text_block?.text) contentParts.push(b.content.text_block.text);
				break;
			case 10025: {
				const s = b.content?.search_query_result_block;
				if (s) contentParts.push(renderSearch(s));
				break;
			}
			case 10052: {
				const atts = b.content?.attachment_block?.attachments ?? [];
				for (const a of atts) {
					const url = a?.image?.image_thumb?.url ?? a?.image?.url;
					if (url) attachments.push({
						type: "image",
						name: "图片",
						url
					});
				}
				break;
			}
			case 10050:
				contentParts.push("> 📎 此处含富媒体内容（视频等），Markdown 中省略原媒体。");
				break;
			case 10056: {
				const t = textOfObject(b.content?.reference_block);
				if (t) thinking.push({
					title: "深度思考",
					content: t
				});
				break;
			}
			case 10053: break;
			default: contentParts.push(`> _[未识别块 block_type=${b.block_type}]_`);
		}
		if (m.thinking_content?.trim()) thinking.unshift({
			title: "深度思考",
			content: m.thinking_content
		});
		return {
			id: m.message_id ?? String(idx),
			role: m.user_type === 1 ? "user" : m.user_type === 2 ? "assistant" : "system",
			content: contentParts.join("\n\n"),
			thinking,
			timestamp: m.create_time ? unixToIso(m.create_time) : void 0,
			attachments
		};
	}
	function renderSearch(s) {
		const lines = [];
		if (s.summary) lines.push(`> 🔍 **联网搜索**：${s.summary}`);
		for (const r of s.results ?? []) {
			const t = r.text_card?.title;
			const u = r.text_card?.url;
			if (t && u) lines.push(`> - [${t}](${u})`);
		}
		return lines.join("\n");
	}
	function textOfObject(o) {
		if (!o) return null;
		const strs = [];
		const walk = (v, d) => {
			if (d > 3 || v == null) return;
			if (typeof v === "string") {
				if (v.trim()) strs.push(v);
				return;
			}
			if (typeof v === "object") for (const x of Object.values(v)) walk(x, d + 1);
		};
		walk(o, 0);
		return strs.length ? strs.join("\n") : null;
	}
	function firstUserPreview(list) {
		const first = list.find((m) => m.user_type === 1);
		try {
			const t = JSON.parse(first?.content ?? "[]").find((b) => b.block_type === 1e4)?.content?.text_block?.text?.trim();
			if (t) return t.length > 30 ? t.slice(0, 30) + "…" : t;
		} catch {}
		return "未命名会话";
	}
	function unixToIso(sec) {
		return new Date(sec * 1e3).toISOString();
	}
	var traeAdapter = {
		platform: "trae",
		detect(url) {
			return /share\.traecontent\.cn\/share\/[A-Za-z0-9_-]+/.test(url);
		},
		async extract() {
			const shareId = extractShareId$1(location.href);
			if (!shareId) throw new Error("无法从链接解析分享 ID");
			const share = await getJson(`/api/remote/v1/share/${shareId}`);
			if (share.code !== 0 || !share.data) throw new Error(`分享不存在或已失效（code=${share.code}）`);
			const items = await fetchAllMessages(shareId);
			return mapTraeData(shareId, location.href, share.data, items);
		}
	};
	function extractShareId$1(url) {
		return url.match(/\/share\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
	}
	async function getJson(url) {
		const resp = await fetch(url, { credentials: "include" });
		if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status} ${url}`);
		return resp.json();
	}
	async function fetchAllMessages(shareId) {
		const all = [];
		let pageToken;
		for (let i = 0; i < 20; i++) {
			const q = new URLSearchParams({ page_size: "100" });
			if (pageToken) q.set("page_token", pageToken);
			const resp = await getJson(`/api/remote/v1/share/${shareId}/messages?${q}`);
			if (resp.code !== 0 || !resp.data) throw new Error(`消息接口异常（code=${resp.code}）`);
			all.push(...resp.data.items ?? []);
			if (!resp.data.has_more || !resp.data.next_page_token) break;
			pageToken = resp.data.next_page_token;
		}
		return all.sort((a, b) => (a.message_index ?? 0) - (b.message_index ?? 0));
	}
	function mapTraeData(shareId, sourceUrl, shareInfo, items) {
		let agentName;
		const messages = items.map((it, idx) => {
			const m = toMessage$2(it, idx);
			if (!agentName) agentName = m.agentName;
			return m.message;
		});
		return {
			id: shareId,
			title: shareInfo.title?.trim() || "未命名会话",
			platform: "trae",
			sourceUrl,
			model: agentName ?? "TraeWork",
			createdAt: shareInfo.created_at ?? items[0]?.created_at,
			messages
		};
	}
	function toMessage$2(it, idx) {
		if (it.role === "user") return { message: {
			id: String(idx),
			role: "user",
			content: userText(it.content),
			timestamp: it.created_at
		} };
		const thinking = [];
		const toolNotes = [];
		let answer = "";
		let answerTool = "";
		let agentName;
		const plan = parsePlanItems(it.content);
		for (const p of plan) {
			if (!agentName && p.agent_display_name) agentName = p.agent_display_name;
			if (p.reasoning_content?.trim()) thinking.push({
				title: "深度思考",
				content: p.reasoning_content.trim()
			});
			const tool = p.tool_call_info;
			if (!tool?.name) continue;
			const summary = typeof tool.params?.summary === "string" ? tool.params.summary : void 0;
			if (summary && (!answer || summary.length > answer.length)) {
				if (answer && answerTool) toolNotes.push(`> 🔧 调用工具：\`${answerTool}\``);
				answer = summary;
				answerTool = tool.name;
				continue;
			}
			const query = typeof tool.params?.query === "string" ? tool.params.query : void 0;
			toolNotes.push(query ? `> 🔧 调用工具：\`${tool.name}\`（${query}）` : `> 🔧 调用工具：\`${tool.name}\``);
		}
		return {
			agentName,
			message: {
				id: String(idx),
				role: "assistant",
				content: [toolNotes.join("\n\n"), answer].filter((s) => s.trim()).join("\n\n"),
				thinking,
				timestamp: it.created_at
			}
		};
	}
	function parsePlanItems(content) {
		if (!content) return [];
		try {
			return (JSON.parse(content).messages ?? []).map((m) => m.plan_item).filter((p) => !!p);
		} catch {
			return [];
		}
	}
	function userText(content) {
		if (!content) return "";
		try {
			return JSON.parse(content).map((b) => b.text_content ?? "").filter(Boolean).join("\n\n");
		} catch {
			return content;
		}
	}
	var API_PATH = "/apiv2/kimi.gateway.chat.v1.ChatService/GetChatShare";
	var kimiAdapter = {
		platform: "kimi",
		detect(url) {
			return /(?:www\.kimi\.com|kimi\.moonshot\.cn)\/share\/[A-Za-z0-9]+/.test(url);
		},
		async extract() {
			const shareId = extractShareId(location.href);
			if (!shareId) throw new Error("无法从链接解析分享 ID");
			const resp = await fetch(API_PATH, {
				method: "POST",
				credentials: "include",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ share_id: shareId })
			});
			if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status}`);
			const json = await resp.json();
			if (!json.share) throw new Error("分享不存在或已失效");
			return mapKimiShare(json.share, location.href);
		}
	};
	function extractShareId(url) {
		return url.match(/\/share\/([A-Za-z0-9]+)/)?.[1] ?? null;
	}
	function mapKimiShare(share, sourceUrl) {
		const messages = share.messages ?? [];
		return {
			id: share.id ?? extractShareId(sourceUrl) ?? "unknown",
			title: share.chat?.name?.trim() || "未命名会话",
			platform: "kimi",
			sourceUrl,
			createdAt: messages[0]?.createTime,
			messages: messages.map(toMessage$1)
		};
	}
	function toMessage$1(m, idx) {
		const contentParts = [];
		const thinking = [];
		const attachments = [];
		const unknownKinds = new Map();
		for (const b of m.blocks ?? []) if (b.text?.content) contentParts.push(b.text.content);
		else if (b.think?.reasoning_content) thinking.push({
			title: "深度思考",
			content: b.think.reasoning_content
		});
		else if (b.search) {
			const lines = ["> 🔍 **联网搜索**："];
			for (const w of b.search.webPages ?? []) if (w.title && w.url) lines.push(`> - [${w.title}](${w.url})`);
			if (lines.length > 1) contentParts.push(lines.join("\n"));
		} else {
			const kind = Object.keys(b).find((k) => k !== "id");
			if (kind) unknownKinds.set(kind, (unknownKinds.get(kind) ?? 0) + 1);
		}
		if (unknownKinds.size > 0) {
			const summary = [...unknownKinds.entries()].map(([k, n]) => `${k}×${n}`).join(", ");
			contentParts.push(`> _（未导出的内容块：${summary}）_`);
		}
		return {
			id: m.id ?? String(idx),
			role: m.role === "user" ? "user" : m.role === "assistant" ? "assistant" : "system",
			content: contentParts.join("\n\n"),
			thinking,
			timestamp: m.createTime,
			attachments
		};
	}
	var yuanbaoAdapter = {
		platform: "yuanbao",
		detect(url) {
			return /yb\.tencent\.com\/s\/[A-Za-z0-9]+/.test(url);
		},
		extract() {
			const data = readShareData();
			if (!data?.chat) throw new Error("未找到 SSR 内嵌的分享数据（页面可能未加载完成或结构已变化）");
			return mapYuanbaoShare(data, location.href);
		}
	};
	function readShareData() {
		return window.__NEXT_DATA__?.props?.pageProps?.fullChatShareData ?? null;
	}
	function mapYuanbaoShare(data, sourceUrl) {
		const chat = data.chat ?? {};
		const convs = (chat.convs ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
		return {
			id: data.id ?? sourceUrl.match(/\/s\/([A-Za-z0-9]+)/)?.[1] ?? "unknown",
			title: chat.title?.trim() || "未命名会话",
			platform: "yuanbao",
			sourceUrl,
			model: chat.modelId || void 0,
			createdAt: convs[0] ? toIso(convs[0].createTime) : void 0,
			messages: convs.map(toMessage)
		};
	}
	function toMessage(m, idx) {
		const isUser = m.role?.type === "user";
		const contentParts = [];
		const thinking = [];
		const unknownKinds = new Map();
		for (const sp of m.speechesV2 ?? []) for (const seg of sp.content ?? []) {
			const type = seg.type ?? "";
			const thinkRaw = seg.thinkDeepInfo ?? (type === "think" ? seg : void 0);
			if (thinkRaw != null && type !== "text") {
				const text = textOf$1(thinkRaw);
				if (text) thinking.push({
					title: "深度思考",
					content: text
				});
				continue;
			}
			if (type === "text" && seg.msg?.trim()) contentParts.push(seg.msg);
			else if (type === "searchGuid" && seg.docs?.length) {
				const lines = ["> 🔍 **联网搜索**："];
				for (const d of seg.docs) if (d.title && d.url) lines.push(`> - [${d.title}](${d.url})`);
				if (lines.length > 1) contentParts.push(lines.join("\n"));
			} else if (!isUser && type && !["text", "searchGuid"].includes(type)) unknownKinds.set(type, (unknownKinds.get(type) ?? 0) + 1);
		}
		if (unknownKinds.size > 0) {
			const summary = [...unknownKinds.entries()].map(([k, n]) => `${k}×${n}`).join(", ");
			contentParts.push(`> _（未导出的过程段：${summary}）_`);
		}
		if (isUser && contentParts.length === 0 && m.speech?.trim()) contentParts.push(m.speech);
		return {
			id: String(m.index ?? idx),
			role: isUser ? "user" : "assistant",
			content: contentParts.join("\n\n"),
			thinking,
			timestamp: toIso(m.createTime)
		};
	}
	function textOf$1(v, depth = 0) {
		if (depth > 3 || v == null) return null;
		if (typeof v === "string") return v.trim() || null;
		if (Array.isArray(v)) {
			const parts = v.map((x) => textOf$1(x, depth + 1)).filter(Boolean);
			return parts.length ? parts.join("\n") : null;
		}
		if (typeof v === "object") {
			const o = v;
			for (const key of [
				"msg",
				"content",
				"text",
				"reasoning_content"
			]) if (key in o) {
				const t = textOf$1(o[key], depth + 1);
				if (t) return t;
			}
		}
		return null;
	}
	function toIso(v) {
		if (v == null) return void 0;
		if (typeof v === "string") {
			if (/^\d+$/.test(v)) return toIso(Number(v));
			const d = new Date(v);
			return Number.isNaN(d.getTime()) ? void 0 : d.toISOString();
		}
		const ms = v > 0xe8d4a51000 ? v : v * 1e3;
		const d = new Date(ms);
		return Number.isNaN(d.getTime()) ? void 0 : d.toISOString();
	}
	var STORE_PATH_ERROR = "未找到智谱清言分享数据（store 路径变化或页面未加载完成）。请点「复制调试信息」并把结果贴到 issue。";
	var chatglmAdapter = {
		platform: "chatglm",
		detect(url) {
			return /chatglm\.cn\/(share\/[A-Za-z0-9]+|glmsShare\?)/.test(url);
		},
		extract() {
			const data = readStoreData();
			if (!data || !data.dataList?.length) throw new Error(STORE_PATH_ERROR);
			return mapChatglmData(data, location.href);
		}
	};
	function readStoreData() {
		try {
			const gp = (document.querySelector("#app")?.__vue_app__)?.config?.globalProperties;
			const conv = gp?.$store?.state?.Conversation;
			if (!conv?.dataList) return null;
			const glms = gp.$store.state.Glms;
			return {
				dataList: conv.dataList,
				assistantInfo: glms?.assistantInfo
			};
		} catch {
			return null;
		}
	}
	function mapChatglmData(data, sourceUrl) {
		const rounds = data.dataList ?? [];
		const messages = [];
		let model;
		for (const [idx, round] of rounds.entries()) {
			if (round.question?.trim()) messages.push({
				id: `u${idx}`,
				role: "user",
				content: round.question
			});
			const contentParts = [];
			const thinking = [];
			let toolStepCount = 0;
			collectThinking(round.thinkList, thinking);
			for (const a of round.answerArray ?? []) if (a.answer_type === "text") {
				if (a.answer?.trim()) contentParts.push(a.answer);
				if (!model && a.model) model = a.model;
				collectThinking(a.thinkList, thinking);
				renderRefs(a, contentParts);
			} else if (a.answer_type === "tool_calls" || a.answer_type === "tool_result") toolStepCount++;
			else if (a.answer_type) contentParts.push(`> _（未导出的内容块：${a.answer_type}）_`);
			if (toolStepCount > 0) contentParts.unshift(`> 🔧 含 ${toolStepCount} 个工具/搜索步骤（分享数据未含明细）`);
			if (contentParts.length || thinking.length) messages.push({
				id: `a${idx}`,
				role: "assistant",
				content: contentParts.join("\n\n"),
				thinking
			});
		}
		const firstQ = rounds.find((r) => r.question?.trim())?.question?.trim();
		const title = firstQ ? firstQ.length > 30 ? `${firstQ.slice(0, 30)}…` : firstQ : `与 ${data.assistantInfo?.name || "ChatGLM"} 的对话`;
		return {
			id: sourceUrl.match(/share_conversation_id=([A-Za-z0-9]+)/)?.[1] ?? sourceUrl.match(/\/share\/([A-Za-z0-9]+)/)?.[1] ?? "unknown",
			title,
			platform: "chatglm",
			sourceUrl,
			model,
			messages
		};
	}
	function collectThinking(list, out) {
		for (const item of list ?? []) {
			const text = textOf(item);
			if (text) out.push({
				title: "深度思考",
				content: text
			});
		}
	}
	function renderRefs(a, out) {
		const refs = [...a.searchPages ?? [], ...a.citations ?? []];
		if (refs.length === 0) return;
		const lines = ["> 🔍 **引用来源**："];
		for (const r of refs) {
			const o = r;
			const title = typeof o.title === "string" ? o.title : void 0;
			const url = typeof o.url === "string" ? o.url : typeof o.link === "string" ? o.link : void 0;
			if (title && url) lines.push(`> - [${title}](${url})`);
		}
		if (lines.length > 1) out.push(lines.join("\n"));
	}
	function textOf(v, depth = 0) {
		if (depth > 3 || v == null) return null;
		if (typeof v === "string") return v.trim() || null;
		if (Array.isArray(v)) {
			const parts = v.map((x) => textOf(x, depth + 1)).filter(Boolean);
			return parts.length ? parts.join("\n") : null;
		}
		if (typeof v === "object") {
			const o = v;
			for (const key of [
				"content",
				"reasoning_content",
				"text",
				"msg",
				"think"
			]) if (key in o) {
				const t = textOf(o[key], depth + 1);
				if (t) return t;
			}
		}
		return null;
	}
	var GENERIC_TITLES = new Set(["新对话", ""]);
	var metasoAdapter = {
		platform: "metaso",
		detect(url) {
			return /metaso\.cn\/(s\/[A-Za-z0-9]+|chat\/\d+)/.test(url);
		},
		async extract() {
			const { conversationId, shareKey, shareType } = parseShareParams(location.href);
			if (!conversationId || !shareKey) throw new Error("无法从链接解析分享参数（conversationId / shareKey）");
			const q = new URLSearchParams({
				shareKey,
				shareType: shareType ?? "15"
			});
			const resp = await fetch(`/api/conversation/${conversationId}/branched-messages?${q}`, { credentials: "include" });
			if (!resp.ok) throw new Error(`接口请求失败：HTTP ${resp.status}`);
			const json = await resp.json();
			if (json.errCode !== 0 || !json.data) throw new Error(`分享不存在或已失效（errCode=${json.errCode}）`);
			return mapMetasoData(json.data, location.href);
		}
	};
	function parseShareParams(url) {
		const conversationId = url.match(/\/chat\/(\d+)/)?.[1] ?? null;
		const q = new URL(url, "https://metaso.cn").searchParams;
		return {
			conversationId,
			shareKey: q.get("ssi") ?? q.get("shareKey") ?? url.match(/\/s\/([A-Za-z0-9]+)/)?.[1] ?? null,
			shareType: q.get("shareType")
		};
	}
	function mapMetasoData(data, sourceUrl) {
		const messages = [];
		let model;
		const walk = (nodes) => {
			for (const node of nodes ?? []) {
				if (node.role === "USER") {
					if (node.content?.text?.trim()) messages.push({
						id: node.id ?? String(messages.length),
						role: "user",
						content: node.content.text,
						timestamp: node.createTime
					});
				} else if (node.role === "ASSISTANT") {
					if (!model && node.model) model = node.model;
					messages.push(toAssistant(node, messages.length));
				}
				walk(node.children);
			}
		};
		walk(data.messageTree);
		const firstUser = messages.find((m) => m.role === "user")?.content.trim();
		const title = data.title && !GENERIC_TITLES.has(data.title.trim()) ? data.title.trim() : firstUser ? firstUser.length > 30 ? `${firstUser.slice(0, 30)}…` : firstUser : "未命名会话";
		return {
			id: sourceUrl.match(/\/chat\/(\d+)/)?.[1] ?? sourceUrl.match(/\/s\/([A-Za-z0-9]+)/)?.[1] ?? "unknown",
			title,
			platform: "metaso",
			sourceUrl,
			model,
			createdAt: data.createTime,
			messages
		};
	}
	function toAssistant(node, idx) {
		const thinkingParts = [];
		const contentParts = [];
		for (const stage of node.content?.stages ?? []) for (const t of stage.texts ?? []) if (t.type === "reasoning_content" && t.text?.trim()) thinkingParts.push(t.text.trim());
		else if (t.type === "action" && t.text?.trim()) contentParts.push(`> 🔧 ${t.text.trim()}`);
		else if (t.type === "text" && t.text?.trim()) contentParts.push(t.text);
		const cites = node.citation ?? [];
		if (cites.length > 0) {
			const seen = new Set();
			const uniq = [];
			for (const c of cites) {
				const key = `${c.title ?? ""}|${c.link ?? ""}`;
				if (!seen.has(key)) {
					seen.add(key);
					uniq.push(c);
				}
			}
			const lines = [`> 📚 **来源**（共 ${node.totalCiteNum ?? uniq.length} 条引用，去重后 ${uniq.length} 条）：`];
			for (const c of uniq) if (c.title && c.link) lines.push(`> - [${c.title}](${c.link})`);
			if (lines.length > 1) contentParts.push(lines.join("\n"));
		} else if (node.totalCiteNum) contentParts.push(`> 📚 引用来源共 ${node.totalCiteNum} 条（分享数据未含明细）`);
		const thinking = thinkingParts.length > 0 ? [{
			title: "深度思考",
			content: thinkingParts.join("\n\n")
		}] : [];
		return {
			id: node.id ?? String(idx),
			role: "assistant",
			content: contentParts.join("\n\n"),
			thinking,
			timestamp: node.createTime
		};
	}
	var adapters = [
		deepseekAdapter,
		workbuddyAdapter,
		doubaoAdapter,
		traeAdapter,
		kimiAdapter,
		yuanbaoAdapter,
		chatglmAdapter,
		metasoAdapter
	];
	function findAdapter(url) {
		return adapters.find((a) => a.detect(url));
	}
	function yamlString(s) {
		return `"${s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n")}"`;
	}
	function renderThinking(msg, style) {
		const thinking = msg.thinking ?? [];
		if (thinking.length === 0) return "";
		const content = thinking.map((t) => t.content).join("\n\n");
		switch (style) {
			case "details": return `<details>\n<summary>思考过程</summary>\n\n${content}\n\n</details>`;
			case "blockquote": return content.split("\n").map((l) => l.trim() ? `> ${l}` : ">").join("\n");
			case "raw": return content;
			default: return `<details>\n<summary>思考过程</summary>\n\n${content}\n\n</details>`;
		}
	}
	function renderAttachments(msg) {
		const out = [];
		for (const a of msg.attachments ?? []) {
			const src = a.dataUrl ?? a.url ?? "";
			if (a.type === "image") out.push(`![${a.name ?? "图片"}](${src})`);
			else if (a.type === "file") out.push(`📎 [${a.name ?? "附件"}](${src})`);
			else if (a.type === "link") out.push(`[${a.name ?? src}](${src})`);
		}
		return out;
	}
	function renderMessage(msg, opts) {
		const lines = [];
		const label = msg.role === "user" ? "用户" : msg.role === "assistant" ? "助手" : "系统";
		lines.push(`## ${label}`);
		lines.push("");
		if (opts.includeTimestamps && msg.timestamp) {
			lines.push(`*${msg.timestamp}*`);
			lines.push("");
		}
		if (opts.includeThinking && msg.thinking && msg.thinking.length > 0) {
			lines.push(renderThinking(msg, opts.thinkingStyle));
			lines.push("");
		}
		if (msg.content.trim()) {
			lines.push(msg.content);
			lines.push("");
		}
		lines.push(...renderAttachments(msg));
		return lines.join("\n");
	}
	function renderMarkdown(conv, opts) {
		const lines = [];
		if (opts.includeFrontmatter) {
			lines.push("---");
			lines.push(`title: ${yamlString(conv.title)}`);
			lines.push(`platform: ${conv.platform}`);
			lines.push(`source: ${conv.sourceUrl}`);
			if (conv.model) lines.push(`model: ${yamlString(conv.model)}`);
			if (conv.createdAt) lines.push(`created_at: ${yamlString(conv.createdAt)}`);
			lines.push(`exported_at: ${yamlString(new Date().toISOString())}`);
			lines.push(`include_thinking: ${opts.includeThinking}`);
			lines.push("---");
			lines.push("");
		}
		lines.push(`# ${conv.title}`);
		lines.push("");
		for (const msg of conv.messages) lines.push(renderMessage(msg, opts));
		return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
	}
	function sanitizeFilename(name) {
		return name.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "conversation";
	}
	function downloadText(filename, text, mime = "text/markdown") {
		const blob = new Blob([`\ufeff${text}`], { type: `${mime};charset=utf-8` });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2e3);
	}
	var defaultExportOptions = {
		includeThinking: true,
		includeTimestamps: true,
		includeFrontmatter: true,
		thinkingStyle: "details",
		downloadImages: false
	};
	function domSkeleton(root = document.body, maxDepth = 8, maxNodes = 500) {
		let count = 0;
		function walk(el, depth) {
			if (depth > maxDepth || count++ > maxNodes) return null;
			const node = { tag: el.tagName.toLowerCase() };
			if (el.id) node.id = el.id;
			if (typeof el.className === "string" && el.className) node.cls = el.className.slice(0, 200);
			const children = [];
			for (const child of Array.from(el.children)) {
				const c = walk(child, depth + 1);
				if (c) children.push(c);
			}
			if (children.length === 0) {
				const t = el.textContent?.trim();
				if (t) node.text = t.slice(0, 200);
			} else node.children = children;
			return node;
		}
		return walk(root, 0) ?? { tag: "empty" };
	}
	var PANEL_ID = "chat-export-panel";
	function injectStyles() {
		if (document.getElementById(`${PANEL_ID}-style`)) return;
		const style = document.createElement("style");
		style.id = `${PANEL_ID}-style`;
		style.textContent = `
    #${PANEL_ID} {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      width: 240px;
      padding: 12px;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 6px 24px rgba(0,0,0,.18);
      font: 13px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      color: #1f2328;
    }
    #${PANEL_ID} .cex-title { font-weight: 600; margin: 0 0 8px; font-size: 14px; }
    #${PANEL_ID} label { display: flex; align-items: center; gap: 6px; margin: 6px 0; cursor: pointer; }
    #${PANEL_ID} button {
      display: block; width: 100%; margin: 6px 0 0; padding: 8px;
      border: none; border-radius: 6px; cursor: pointer; font-size: 13px;
    }
    #${PANEL_ID} .cex-primary { background: #4d6bfe; color: #fff; }
    #${PANEL_ID} .cex-secondary { background: #f0f2f5; color: #1f2328; }
    #${PANEL_ID} .cex-close {
      position: absolute; top: 6px; right: 8px; background: none; border: none;
      cursor: pointer; font-size: 14px; color: #666; width: auto; margin: 0; padding: 0 4px;
    }
    #${PANEL_ID} .cex-hint { font-size: 11px; color: #888; margin-top: 6px; }
  `;
		document.head.appendChild(style);
	}
	function toast(msg, ok = true) {
		const el = document.createElement("div");
		el.textContent = msg;
		el.style.cssText = [
			"position: fixed",
			"bottom: 24px",
			"left: 50%",
			"transform: translateX(-50%)",
			"padding: 10px 16px",
			"border-radius: 8px",
			"z-index: 2147483647",
			"font: 13px system-ui, \"Microsoft YaHei\", sans-serif",
			"color: #fff",
			`background: ${ok ? "#2ea44f" : "#d1242f"}`
		].join(";");
		document.body.appendChild(el);
		setTimeout(() => el.remove(), 3e3);
	}
	function createPanel(platform) {
		injectStyles();
		const panel = document.createElement("div");
		panel.id = PANEL_ID;
		const title = document.createElement("div");
		title.className = "cex-title";
		title.textContent = `导出会话（${platform}）`;
		const close = document.createElement("button");
		close.className = "cex-close";
		close.textContent = "×";
		close.title = "关闭";
		close.addEventListener("click", () => panel.remove());
		const includeThinking = document.createElement("input");
		includeThinking.type = "checkbox";
		includeThinking.checked = defaultExportOptions.includeThinking;
		const thinkingLabel = document.createElement("label");
		thinkingLabel.append(includeThinking, document.createTextNode("包含思考过程"));
		const exportBtn = document.createElement("button");
		exportBtn.className = "cex-primary";
		exportBtn.textContent = "导出 Markdown";
		const debugBtn = document.createElement("button");
		debugBtn.className = "cex-secondary";
		debugBtn.textContent = "复制调试信息";
		const hint = document.createElement("div");
		hint.className = "cex-hint";
		hint.textContent = "仅用于导出你自己分享的会话";
		panel.append(title, close, thinkingLabel, exportBtn, debugBtn, hint);
		document.body.appendChild(panel);
		exportBtn.addEventListener("click", async () => {
			const adapter = findAdapter(location.href);
			if (!adapter) {
				toast("当前页面不是支持的分享页", false);
				return;
			}
			try {
				const conv = await adapter.extract();
				const md = renderMarkdown(conv, {
					...defaultExportOptions,
					includeThinking: includeThinking.checked
				});
				const filename = `${sanitizeFilename(conv.title)}.md`;
				downloadText(filename, md);
				toast(`已导出：${filename}`);
			} catch (err) {
				console.error("[chat-export]", err);
				toast(`导出失败：${err.message}`, false);
			}
		});
		debugBtn.addEventListener("click", () => {
			const json = JSON.stringify(domSkeleton(), null, 2);
			navigator.clipboard.writeText(json).then(() => toast("调试信息已复制到剪贴板"), () => {
				console.log("[chat-export debug]\n", json);
				toast("已输出到控制台");
			});
		});
	}
	function main() {
		const adapter = findAdapter(location.href);
		if (!adapter) return;
		createPanel(adapter.platform);
	}
	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main);
	else main();
})();
