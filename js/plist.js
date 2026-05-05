/* plist パーサ/シリアライザ
 *  - XML plist の読み書き
 *  - Binary plist (bplist00) の読み込み
 *  - 出力は常に XML plist
 *
 * 値の型:
 *    string, boolean, number (整数/実数), Date, Uint8Array (data),
 *    Array, plain Object (dict)
 */
(function (global) {
  'use strict';

  const U = global.U;

  // ── DoS 対策上限 ─────────────────────────────────────────
  const MAX_DEPTH = 256;       // ネスト深度
  const MAX_OBJECTS = 1000000; // 1 plist あたりの総オブジェクト数

  // ============================================================
  //  XML plist パーサ
  // ============================================================
  function parseXML(input) {
    const text = (typeof input === 'string') ? input : U.bytesToStr(input);
    const dom = new DOMParser().parseFromString(text, 'application/xml');
    const errEl = dom.getElementsByTagName('parsererror')[0];
    if (errEl) throw new Error('plist XML parse error: ' + errEl.textContent.slice(0, 200));
    const root = dom.documentElement;
    if (root.tagName !== 'plist') throw new Error('plist: ルート要素が <plist> ではありません');
    const child = firstElement(root);
    if (!child) return null;
    const ctx = { count: 0 };
    return parseElement(child, 0, ctx);
  }

  function firstElement(node) {
    let c = node.firstChild;
    while (c && c.nodeType !== 1) c = c.nextSibling;
    return c;
  }
  function nextElement(node) {
    let c = node.nextSibling;
    while (c && c.nodeType !== 1) c = c.nextSibling;
    return c;
  }

  function parseElement(el, depth, ctx) {
    if (depth > MAX_DEPTH) throw new Error('plist: ネストが深すぎます');
    if (++ctx.count > MAX_OBJECTS) throw new Error('plist: オブジェクト数が多すぎます');
    switch (el.tagName) {
      case 'string':  return el.textContent;
      case 'integer': return parseInt(el.textContent, 10);
      case 'real':    return parseFloat(el.textContent);
      case 'true':    return true;
      case 'false':   return false;
      case 'date':    return new Date(el.textContent);
      case 'data': {
        const b64 = el.textContent.replace(/\s+/g, '');
        return U.base64ToBytes(b64);
      }
      case 'array': {
        const out = [];
        let c = firstElement(el);
        while (c) { out.push(parseElement(c, depth + 1, ctx)); c = nextElement(c); }
        return out;
      }
      case 'dict': {
        const out = Object.create(null); // prototype pollution 防止
        let c = firstElement(el);
        while (c) {
          if (c.tagName !== 'key') throw new Error('plist: dict 内に <key> 以外の要素');
          const key = c.textContent;
          const v = nextElement(c);
          if (!v) throw new Error('plist: <key> の値が無い: ' + key);
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            // 危険キーはスキップ
            c = nextElement(v);
            continue;
          }
          out[key] = parseElement(v, depth + 1, ctx);
          c = nextElement(v);
        }
        return out;
      }
      default:
        throw new Error('plist: 未対応の要素 ' + el.tagName);
    }
  }

  // ============================================================
  //  XML plist シリアライザ
  // ============================================================
  function buildXML(value) {
    const lines = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">');
    lines.push('<plist version="1.0">');
    appendValue(lines, value, '');
    lines.push('</plist>');
    return lines.join('\n') + '\n';
  }

  function escapeXML(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function appendValue(lines, v, indent) {
    if (v === null || v === undefined) {
      lines.push(indent + '<string></string>');
      return;
    }
    if (v instanceof Uint8Array) {
      lines.push(indent + '<data>');
      const b64 = U.bytesToBase64(v);
      // 76 文字で改行 (Apple 互換)
      for (let i = 0; i < b64.length; i += 76) {
        lines.push(indent + b64.substr(i, 76));
      }
      lines.push(indent + '</data>');
      return;
    }
    if (v instanceof Date) {
      lines.push(indent + '<date>' + v.toISOString().replace(/\.\d+Z$/, 'Z') + '</date>');
      return;
    }
    if (Array.isArray(v)) {
      if (v.length === 0) { lines.push(indent + '<array/>'); return; }
      lines.push(indent + '<array>');
      for (const item of v) appendValue(lines, item, indent + '\t');
      lines.push(indent + '</array>');
      return;
    }
    switch (typeof v) {
      case 'string':  lines.push(indent + '<string>' + escapeXML(v) + '</string>'); return;
      case 'boolean': lines.push(indent + (v ? '<true/>' : '<false/>')); return;
      case 'number':
        if (Number.isInteger(v)) lines.push(indent + '<integer>' + v + '</integer>');
        else                     lines.push(indent + '<real>' + v + '</real>');
        return;
      case 'object': {
        const keys = Object.keys(v);
        if (keys.length === 0) { lines.push(indent + '<dict/>'); return; }
        lines.push(indent + '<dict>');
        for (const k of keys) {
          lines.push(indent + '\t<key>' + escapeXML(k) + '</key>');
          appendValue(lines, v[k], indent + '\t');
        }
        lines.push(indent + '</dict>');
        return;
      }
    }
    throw new Error('plist: 未対応の値型: ' + typeof v);
  }

  // ============================================================
  //  Binary plist (bplist00) パーサ
  //   ref: CoreFoundation/CFBinaryPList.c
  // ============================================================
  function parseBinary(bytes) {
    if (bytes.length < 32) throw new Error('bplist: too short');
    if (bytes[0] !== 0x62 || bytes[1] !== 0x70 || bytes[2] !== 0x6c || bytes[3] !== 0x69 ||
        bytes[4] !== 0x73 || bytes[5] !== 0x74 || bytes[6] !== 0x30 || bytes[7] !== 0x30) {
      throw new Error('bplist: magic 不一致');
    }
    // trailer (last 32 bytes)
    const tOff = bytes.length - 32;
    const offsetIntSize = bytes[tOff + 6];
    const objectRefSize = bytes[tOff + 7];
    const numObjects    = U.readU64BE(bytes, tOff + 8);
    const topObject     = U.readU64BE(bytes, tOff + 16);
    const offsetTableOffset = U.readU64BE(bytes, tOff + 24);

    if (offsetIntSize < 1 || offsetIntSize > 8) throw new Error('bplist: offsetIntSize 不正');
    if (objectRefSize < 1 || objectRefSize > 8) throw new Error('bplist: objectRefSize 不正');
    if (numObjects > MAX_OBJECTS) throw new Error('bplist: オブジェクト数が多すぎます');
    if (topObject >= numObjects) throw new Error('bplist: topObject が範囲外');
    if (offsetTableOffset + numObjects * offsetIntSize > tOff) {
      throw new Error('bplist: offsetTable が trailer を超えています');
    }

    const visited = new Uint8Array(numObjects); // 循環参照検出
    let depth = 0;

    function ensureRange(off, len) {
      if (off < 0 || len < 0 || off + len > tOff) {
        throw new Error('bplist: 範囲外アクセス');
      }
    }
    function readSizedInt(off, size) {
      ensureRange(off, size);
      let v = 0;
      for (let i = 0; i < size; i++) v = v * 256 + bytes[off + i];
      return v;
    }
    function objectOffset(idx) {
      if (idx >= numObjects) throw new Error('bplist: object index 範囲外: ' + idx);
      return readSizedInt(offsetTableOffset + idx * offsetIntSize, offsetIntSize);
    }

    function readObject(idx) {
      if (idx >= numObjects) throw new Error('bplist: object index 範囲外: ' + idx);
      if (visited[idx]) throw new Error('bplist: 循環参照を検出');
      if (depth > MAX_DEPTH) throw new Error('bplist: ネストが深すぎます');
      visited[idx] = 1;
      depth++;
      try {
        return readObjectInner(idx);
      } finally {
        depth--;
        visited[idx] = 0;
      }
    }

    function readObjectInner(idx) {
      const off = objectOffset(idx);
      ensureRange(off, 1);
      const marker = bytes[off];
      const hi = (marker >> 4) & 0xf;
      const lo = marker & 0xf;

      if (marker === 0x00) return null;
      if (marker === 0x08) return false;
      if (marker === 0x09) return true;

      // Int
      if (hi === 0x1) {
        const n = 1 << lo; // 1, 2, 4, 8, 16
        if (n > 16) throw new Error('bplist: int size ' + n);
        return readSizedInt(off + 1, n);
      }
      // Real
      if (hi === 0x2) {
        const n = 1 << lo;
        ensureRange(off + 1, n);
        const dv = new DataView(bytes.buffer, bytes.byteOffset + off + 1, n);
        if (n === 4) return dv.getFloat32(0, false);
        if (n === 8) return dv.getFloat64(0, false);
        throw new Error('bplist: real size ' + n);
      }
      // Date
      if (marker === 0x33) {
        ensureRange(off + 1, 8);
        const dv = new DataView(bytes.buffer, bytes.byteOffset + off + 1, 8);
        const sec = dv.getFloat64(0, false);
        // Apple epoch: 2001-01-01
        return new Date((sec + 978307200) * 1000);
      }
      // Data
      if (hi === 0x4) {
        const [count, dataOff] = readCount(off, lo);
        ensureRange(dataOff, count);
        return bytes.slice(dataOff, dataOff + count);
      }
      // ASCII string
      if (hi === 0x5) {
        const [count, dataOff] = readCount(off, lo);
        ensureRange(dataOff, count);
        let s = '';
        for (let i = 0; i < count; i++) s += String.fromCharCode(bytes[dataOff + i]);
        return s;
      }
      // UTF-16BE string
      if (hi === 0x6) {
        const [count, dataOff] = readCount(off, lo);
        ensureRange(dataOff, count * 2);
        let s = '';
        for (let i = 0; i < count; i++) {
          s += String.fromCharCode((bytes[dataOff + i*2] << 8) | bytes[dataOff + i*2 + 1]);
        }
        return s;
      }
      // UID
      if (hi === 0x8) {
        const n = lo + 1;
        return { __uid: readSizedInt(off + 1, n) };
      }
      // Array
      if (hi === 0xa) {
        const [count, dataOff] = readCount(off, lo);
        ensureRange(dataOff, count * objectRefSize);
        const out = [];
        for (let i = 0; i < count; i++) {
          const ref = readSizedInt(dataOff + i * objectRefSize, objectRefSize);
          out.push(readObject(ref));
        }
        return out;
      }
      // Set (treat as array)
      if (hi === 0xc) {
        const [count, dataOff] = readCount(off, lo);
        ensureRange(dataOff, count * objectRefSize);
        const out = [];
        for (let i = 0; i < count; i++) {
          const ref = readSizedInt(dataOff + i * objectRefSize, objectRefSize);
          out.push(readObject(ref));
        }
        return out;
      }
      // Dict
      if (hi === 0xd) {
        const [count, dataOff] = readCount(off, lo);
        ensureRange(dataOff, count * objectRefSize * 2);
        const out = Object.create(null); // prototype pollution 防止
        for (let i = 0; i < count; i++) {
          const keyRef = readSizedInt(dataOff + i * objectRefSize, objectRefSize);
          const valRef = readSizedInt(dataOff + (count + i) * objectRefSize, objectRefSize);
          const k = String(readObject(keyRef));
          const v = readObject(valRef);
          if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
          out[k] = v;
        }
        return out;
      }
      throw new Error('bplist: 未対応 marker 0x' + marker.toString(16));
    }

    function readCount(off, lo) {
      if (lo !== 0xf) return [lo, off + 1];
      // Extended count: next int marker
      ensureRange(off + 1, 1);
      const m = bytes[off + 1];
      if (((m >> 4) & 0xf) !== 0x1) throw new Error('bplist: extended count not int');
      const n = 1 << (m & 0xf);
      if (n > 16) throw new Error('bplist: extended count size ' + n);
      const count = readSizedInt(off + 2, n);
      if (count < 0 || count > MAX_OBJECTS) throw new Error('bplist: count が大きすぎます');
      return [count, off + 2 + n];
    }

    return readObject(topObject);
  }

  // ============================================================
  //  公開: 自動検出 (bplist or XML)
  // ============================================================
  function parse(bytes) {
    if (typeof bytes === 'string') return parseXML(bytes);
    if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    // bplist00
    if (bytes.length >= 8 &&
        bytes[0] === 0x62 && bytes[1] === 0x70 && bytes[2] === 0x6c && bytes[3] === 0x69 &&
        bytes[4] === 0x73 && bytes[5] === 0x74) {
      return parseBinary(bytes);
    }
    return parseXML(bytes);
  }

  function build(value) {
    const xml = buildXML(value);
    return U.strToBytes(xml);
  }

  global.Plist = { parse, build, parseXML, parseBinary, buildXML };
})(window);
