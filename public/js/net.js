// WebSocket transport: connection, clock sync and typed message dispatch.

import { MSG } from '/shared/constants.js';

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.rtt = 0;
    this.offset = 0; // serverTime = Date.now() + offset
    this.connected = false;
    this.pingSeq = 0;
    this.pingTimer = null;
    this.sentBytes = 0;
  }

  on(type, fn) {
    this.handlers.set(type, fn);
    return this;
  }

  emit(type, payload) {
    const fn = this.handlers.get(type);
    if (fn) fn(payload);
  }

  connect(join) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}`);
      this.ws = ws;
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          ws.close();
          reject(new Error('서버 응답이 없습니다.'));
        }
      }, 8000);

      ws.onopen = () => this.send({ t: MSG.JOIN, ...join });

      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.t === MSG.WELCOME) {
          this.connected = true;
          // First clock estimate; refined by the ping loop below.
          this.offset = msg.now - Date.now();
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            this.startPing();
            resolve(msg);
          }
        } else if (msg.t === MSG.PONG) {
          const sentAt = this.pingSentAt;
          if (sentAt) {
            const rtt = Date.now() - sentAt;
            this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt;
            const estimate = msg.now + rtt / 2 - Date.now();
            this.offset = this.offset ? this.offset * 0.8 + estimate * 0.2 : estimate;
          }
        } else if (msg.t === MSG.ERROR) {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(new Error(msg.reason || '접속이 거부되었습니다.'));
          }
        }
        this.emit(msg.t, msg);
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error('서버에 연결할 수 없습니다.'));
        }
      };

      ws.onclose = () => {
        this.connected = false;
        clearInterval(this.pingTimer);
        this.emit('close');
      };
    });
  }

  startPing() {
    clearInterval(this.pingTimer);
    const beat = () => {
      this.pingSentAt = Date.now();
      this.send({ t: MSG.PING, c: ++this.pingSeq });
    };
    beat();
    this.pingTimer = setInterval(beat, 2000);
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const raw = JSON.stringify(obj);
    this.sentBytes += raw.length;
    this.ws.send(raw);
  }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws) this.ws.close();
  }
}
