// 流式发送与逐句渲染。从旧 app.js sendMessage()（app.js:603-758）原样搬来，
// 内部保持 fetch + reader，不改成框架风格。behavior 一比一保住。
//
// 暴露 send(sticker?) 给 Composer.vue 调用；新消息通过回调 onPush 推给父组件，
// 父组件只管塞进 chat.messages[] 并滚动——不侵入流控逻辑。
import { chat, chatKey, currentChatKey, isSending, loadMessagesForSession, loadMessagesForGroup } from '../stores/chat.js';
import { personaSpeaker } from './useAvatar.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randDelay(min = 300, max = 900) {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

function typingDelayFor(text) {
  const base = 260 + (text ? text.length : 0) * 34;
  return Math.min(1500, base) + Math.random() * 220;
}

/** 返回 { send(text, sticker?), abort() }，分别给 composer 和导航切换使用。 */
export function useChatStream(onPush) {
  let abortController = null;

  /**
   * 发送一条消息。text 为输入框文本；sticker 为 {id,file,emotion} 时忽略文本。
   * 用户气泡由本函数在校验通过后推出（旧 app.js sendMessage 的顺序），调用方只管清输入框。
   */
  async function send(text = '', sticker = null) {
    if (sticker) text = '';
    const mode = chat.activeMode;
    const isGroup = mode === 'group';
    if (!mode) return;
    if (!sticker && !text) return;
    if (!isGroup && !chat.activeSessionId) return;
    if (isGroup && !chat.activeGroupId) return;

    const myKey = currentChatKey();
    if (!myKey || chat._sendingKeys[myKey]) return;
    let detached = false;
    const stillHere = () => {
      if (!detached && currentChatKey() !== myKey) detached = true;
      return !detached;
    };

    chat._sendingKeys[myKey] = true;

    // 用户气泡（唯一一处，调用方不要再自己 push，否则会多出一个空气泡）
    const userMsg = sticker
      ? { role: 'user', kind: 'sticker', sticker, speaker: null }
      : { role: 'user', kind: 'text', content: text, speaker: null };
    onPush(userMsg, { isUser: true });

    // 已读回执
    await randDelay();
    if (stillHere()) onPush({ _receipt: true }, { silent: true });

    // 正在输入
    const defaultTypingName = isGroup ? '群成员' : (chat.chatTitle || '对方');
    if (stillHere()) onPush({ _typing: defaultTypingName }, { silent: true });

    const queue = [];
    let streamDone = false;
    let wake;
    const notify = () => { if (wake) { wake(); wake = null; } };
    const waitItem = () => new Promise((r) => { wake = r; });

    const isg = isGroup;
    const singleSpeaker = isg ? null : personaSpeaker(chat.personas.find((p) => p.id === chat.activePersonaId));
    let lastSpeakerId = null;
    abortController = new AbortController();

    const consumer = (async () => {
      while (true) {
        if (!queue.length) {
          if (streamDone) break;
          await waitItem();
          continue;
        }
        const item = queue.shift();
        if (!stillHere()) continue;
        if (item.type === 'tool') {
          onPush({ _tool: item }, { silent: true });
          continue;
        }
        const speaker = item.speaker || singleSpeaker;
        const sid = speaker ? (speaker.personaId ?? 'self') : null;
        const showHead = sid !== lastSpeakerId;
        const typingName = isGroup && speaker ? speaker.name : defaultTypingName;
        onPush({ _typing: typingName }, { silent: true });
        const delay = item.type === 'sticker' || item.type === 'file'
          ? 500 + Math.random() * 300 : typingDelayFor(item.text);
        await sleep(delay);
        if (!stillHere()) continue;
        onPush({ _typing: null }, { silent: true });
        if (item.type === 'sticker') {
          onPush({ role: 'assistant', kind: 'sticker', sticker: item.sticker, speaker, showHead, isGroup });
        } else if (item.type === 'file') {
          onPush({ role: 'assistant', kind: 'file', file: item.file, speaker, showHead, isGroup });
        } else {
          onPush({ role: 'assistant', kind: 'text', content: item.text, speaker, showHead, isGroup });
        }
        lastSpeakerId = sid;
      }
    })();

    let currentSpeaker = null;

    try {
      const url = isGroup ? endpoints.groupChat : endpoints.chat;
      const payload = isGroup
        ? { groupId: chat.activeGroupId, message: text, stickerId: sticker?.id || null }
        : { sessionId: chat.activeSessionId, message: text, stickerId: sticker?.id || null };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      // 后端校验失败（400/404）等非流式响应：body 是 JSON 而不是 SSE，
      // 直接当错误抛出，否则下面的解析会静默读不到任何 event，界面一句话都不出。
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) detail = body.error;
        } catch { /* 非 JSON 响应就沿用状态码 */ }
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const block of events) {
          const evMatch = block.match(/^event: (.+)$/m);
          const dataMatch = block.match(/^data: (.+)$/m);
          if (!evMatch || !dataMatch) continue;
          const event = evMatch[1].trim();
          const data = JSON.parse(dataMatch[1]);

          if (event === 'speaker') {
            currentSpeaker = data;
          } else if (event === 'segment') {
            queue.push({ type: 'text', text: data.text, speaker: data.speaker || currentSpeaker });
          } else if (event === 'tool') {
            queue.push({ type: 'tool', query: data.args?.query || '', domains: data.args?.domains });
          } else if (event === 'sticker') {
            queue.push({ type: 'sticker', sticker: data, speaker: data.speaker || currentSpeaker });
          } else if (event === 'file') {
            const { speaker, ...file } = data;
            queue.push({ type: 'file', file, speaker: speaker || currentSpeaker });
          } else if (event === 'error') {
            queue.push({ type: 'text', text: `[出错] ${data.error}`, speaker: currentSpeaker });
          }
          notify();
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // 被外部 abort() 取消，不发错误气泡
      } else {
        queue.push({ type: 'text', text: `[连接失败] ${err.message}` });
        notify();
      }
    } finally {
      streamDone = true;
      abortController = null;
      notify();
      await consumer;
      delete chat._sendingKeys[myKey];
      if (stillHere()) {
        onPush({ _typing: null, _done: true }, { silent: true });
      } else if (currentChatKey() === myKey) {
        await reloadCurrent();
      }
    }
  }

  async function reloadCurrent() {
    if (chat.activeMode === 'single' && chat.activeSessionId) {
      await loadMessagesForSession(chat.activeSessionId);
    } else if (chat.activeMode === 'group' && chat.activeGroupId) {
      await loadMessagesForGroup(chat.activeGroupId);
    }
    if (currentChatKey()) {
      onPush({ _reload: true }, { silent: true });
    }
  }

  function abort() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  return { send, abort };
}

// 小写 endpoints 避免和 api 层冲突
const endpoints = { chat: '/api/chat', groupChat: '/api/group-chat' };
