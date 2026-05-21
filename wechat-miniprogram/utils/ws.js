// utils/ws.js — WebSocket 连接管理 (会议室 /ws/stt 用).
//
// 封装:
//   - 鉴权 (Bearer header)
//   - exponential backoff 自动重连 (1s/2s/4s/8s/16s, 上限 60s)
//   - 事件回调注册 (按 type 分发)
//   - 主动断开 (stop)
//   - 发 binary (PCM) / text (JSON action)
//
// 用法:
//   const conn = createMeetingWs({
//     meetingId, token,
//     onSystem: (ev) => { ... },
//     onTranscript: (ev) => { ... },
//     onAgentMessageStart / Chunk / End: (ev) => { ... },
//     onAgendaEvent: (ev) => { ... },  // off_topic, stuck, time_warning, ...
//     onAgentsInvited: (ev) => { ... },
//     onSpeakersUpdated: () => { ... },
//     onConnectionChange: (state) => { ... },  // "connecting" | "connected" | "ready" | "closed" | "reconnecting"
//   });
//   conn.send({ action: 'invoke_agent', agent_id: '...' });
//   conn.sendPCM(arrayBuffer);
//   conn.close();
//
// 不在这层做的:
//   - 历史转录回填 (调用方自己 fetch /api/m/meetings/{id}/transcript)
//   - 录音管理 (utils/recorder.js 第 3 刀做)
//   - UI 渲染 (page 自己管)

const app = getApp();

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 32000, 60000];

function createMeetingWs(options) {
  const {
    meetingId,
    token,
    onSystem,
    onTranscript,
    onAgentMessageStart,
    onAgentMessageChunk,
    onAgentMessageEnd,
    onAgendaEvent,
    onAgentsInvited,
    onDissentDetected,
    onSpeakersUpdated,
    onConnectionChange,
  } = options;

  if (!meetingId || !token) {
    throw new Error('createMeetingWs: meetingId + token required');
  }

  let socketTask = null;
  let connState = 'connecting';
  let closedByUser = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let readyEventReceived = false;
  let pendingPCM = [];  // ready 之前不发, 缓存 (上限 50 帧 ~ 5 秒, 防内存爆)
  const PCM_BUFFER_MAX = 50;

  function _setState(s) {
    connState = s;
    if (typeof onConnectionChange === 'function') {
      onConnectionChange(s);
    }
  }

  function _connect() {
    if (closedByUser) return;
    _setState(reconnectAttempt === 0 ? 'connecting' : 'reconnecting');

    const url = app.globalData.h5Base.replace(/^http/, 'ws') +
      '/ws/stt?meeting_id=' + encodeURIComponent(meetingId);

    socketTask = wx.connectSocket({
      url,
      header: { Authorization: 'Bearer ' + token },
      // 微信文档: 协议默认 ['wxapp']; web-view 内不影响. 我们不指定.
      success: () => {},
      fail: (err) => {
        console.warn('[ws] connectSocket fail', err);
        _scheduleReconnect();
      },
    });

    socketTask.onOpen(() => {
      console.log('[ws] open');
      readyEventReceived = false;
      reconnectAttempt = 0;  // 成功打开就重置重连计数
      _setState('connected');
    });

    socketTask.onMessage(({ data }) => {
      if (typeof data !== 'string') {
        // 服务器目前不发 binary back, 忽略
        return;
      }
      let event;
      try {
        event = JSON.parse(data);
      } catch (e) {
        console.warn('[ws] non-JSON message', data);
        return;
      }
      _dispatch(event);
    });

    socketTask.onError((err) => {
      console.warn('[ws] error', err);
    });

    socketTask.onClose((res) => {
      console.log('[ws] close', res);
      socketTask = null;
      if (closedByUser) {
        _setState('closed');
        return;
      }
      _scheduleReconnect();
    });
  }

  function _dispatch(event) {
    const t = event.type;
    if (t === 'system') {
      if (event.msg === 'ready') {
        readyEventReceived = true;
        _setState('ready');
        // ready 后 flush pending PCM
        if (socketTask && pendingPCM.length > 0) {
          for (const buf of pendingPCM) {
            socketTask.send({ data: buf });
          }
          pendingPCM = [];
        }
      }
      if (typeof onSystem === 'function') onSystem(event);
    } else if (t === 'transcript_persisted') {
      if (typeof onTranscript === 'function') onTranscript(event);
    } else if (t === 'agent_message_start') {
      if (typeof onAgentMessageStart === 'function') onAgentMessageStart(event);
    } else if (t === 'agent_message_chunk') {
      if (typeof onAgentMessageChunk === 'function') onAgentMessageChunk(event);
    } else if (t === 'agent_message_end') {
      if (typeof onAgentMessageEnd === 'function') onAgentMessageEnd(event);
    } else if (t === 'agents_invited') {
      if (typeof onAgentsInvited === 'function') onAgentsInvited(event);
    } else if (t === 'dissent_detected') {
      if (typeof onDissentDetected === 'function') onDissentDetected(event);
    } else if (t === 'speakers_updated') {
      if (typeof onSpeakersUpdated === 'function') onSpeakersUpdated();
    } else if (
      t === 'agenda_off_topic' ||
      t === 'agenda_stuck' ||
      t === 'agenda_time_warning' ||
      t === 'agenda_decision_summary' ||
      t === 'agenda_advance_suggested'
    ) {
      if (typeof onAgendaEvent === 'function') onAgendaEvent(event);
    } else {
      console.log('[ws] unhandled event type:', t, event);
    }
  }

  function _scheduleReconnect() {
    if (closedByUser) {
      _setState('closed');
      return;
    }
    const delay =
      RECONNECT_DELAYS_MS[
        Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
      ];
    reconnectAttempt += 1;
    console.log('[ws] reconnect in', delay, 'ms (attempt', reconnectAttempt, ')');
    _setState('reconnecting');
    reconnectTimer = setTimeout(_connect, delay);
  }

  function send(payload) {
    if (!socketTask) {
      console.warn('[ws] send dropped, no socket');
      return false;
    }
    try {
      socketTask.send({ data: JSON.stringify(payload) });
      return true;
    } catch (e) {
      console.warn('[ws] send failed', e);
      return false;
    }
  }

  function sendPCM(arrayBuffer) {
    if (!socketTask || !readyEventReceived) {
      // ready 前缓存 (上限). 录音器启动可能比 ws ready 早.
      if (pendingPCM.length < PCM_BUFFER_MAX) {
        pendingPCM.push(arrayBuffer);
      }
      return false;
    }
    try {
      socketTask.send({ data: arrayBuffer });
      return true;
    } catch (e) {
      console.warn('[ws] sendPCM failed', e);
      return false;
    }
  }

  function close() {
    closedByUser = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socketTask) {
      try {
        socketTask.send({ data: JSON.stringify({ action: 'stop' }) });
      } catch (_) { /* ignore */ }
      try {
        socketTask.close({});
      } catch (_) { /* ignore */ }
    }
    socketTask = null;
    _setState('closed');
  }

  // 启动
  _connect();

  return {
    send,
    sendPCM,
    close,
    getState: () => connState,
    isReady: () => readyEventReceived,
  };
}

module.exports = { createMeetingWs };
