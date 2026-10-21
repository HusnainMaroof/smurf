// Minimal WebSocket server side (RFC 6455): text frames, ping/pong, close. Enough for
// JSON messaging with the desktop app and the runner, without a runtime dependency.
// Clients use Node's / the browser's built-in WebSocket.
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME = 64 * 1024 * 1024;

export class Socket extends EventEmitter {
  open = true;
  private buf = Buffer.alloc(0);
  private parts: Buffer[] = [];

  private sock: Duplex;

  constructor(sock: Duplex) {
    super();
    this.sock = sock;
    sock.on("data", (d: Buffer) => this.onData(d));
    sock.on("close", () => this.closed());
    sock.on("error", () => this.closed());
  }

  send(obj: unknown) {
    if (this.open) this.frame(0x1, Buffer.from(typeof obj === "string" ? obj : JSON.stringify(obj)));
  }

  close(code = 1000) {
    if (!this.open) return;
    const b = Buffer.alloc(2);
    b.writeUInt16BE(code);
    this.frame(0x8, b);
    this.sock.end();
    this.closed();
  }

  private closed() {
    if (!this.open) return;
    this.open = false;
    this.emit("close");
  }

  private frame(op: number, payload: Buffer) {
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    if (n >= 126 && n < 65536) {
      head[0] = 0x80 | op;
      head[1] = 126;
      head.writeUInt16BE(n, 2);
    } else if (n >= 65536) {
      head[0] = 0x80 | op;
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(n), 2);
    }
    this.sock.write(Buffer.concat([head, payload]));
  }

  private onData(d: Buffer) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const fin = (this.buf[0] & 0x80) !== 0;
      const op = this.buf[0] & 0x0f;
      const masked = (this.buf[1] & 0x80) !== 0;
      let len = this.buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_FRAME) return this.close(1009);
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
      }
      this.buf = this.buf.subarray(need);
      if (op === 0x8) return this.close();
      if (op === 0x9) {
        this.frame(0xa, payload);
        continue;
      }
      if (op === 0xa) continue;
      this.parts.push(payload);
      if (!fin) continue;
      const text = Buffer.concat(this.parts).toString("utf8");
      this.parts = [];
      try {
        this.emit("message", JSON.parse(text));
      } catch {
        this.emit("message", text);
      }
    }
  }
}

/** Completes the HTTP upgrade. Returns null (and rejects) when it is not a WebSocket request. */
export function accept(req: IncomingMessage, sock: Duplex): Socket | null {
  const key = req.headers["sec-websocket-key"];
  if (!key || String(req.headers.upgrade).toLowerCase() !== "websocket") {
    sock.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }
  const acceptKey = createHash("sha1").update(key + GUID).digest("base64");
  sock.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey}`, "", ""].join("\r\n"));
  return new Socket(sock);
}
