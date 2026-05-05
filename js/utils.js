/* 共通ユーティリティ */
(function (global) {
  'use strict';

  // ── ログ ─────────────────────────────────────────────────
  const logEl = () => document.getElementById('log');

  function logRaw(text, cls) {
    const el = logEl();
    if (!el) { console.log(text); return; }
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text + '\n';
    el.appendChild(span);
    el.scrollTop = el.scrollHeight;
  }
  function info(msg)    { logRaw('[INFO]  ' + msg, 'info'); }
  function success(msg) { logRaw('[OK]    ' + msg, 'ok'); }
  function warn(msg)    { logRaw('[WARN]  ' + msg, 'warn'); }
  function error(msg)   { logRaw('[ERROR] ' + msg, 'err'); }
  function header(msg)  { logRaw('── ' + msg + ' ' + '─'.repeat(Math.max(2, 44 - msg.length)), 'header'); }
  function plain(msg)   { logRaw(msg); }
  function clearLog()   { const el = logEl(); if (el) el.textContent = ''; }

  // ── プログレス ───────────────────────────────────────────
  function setProgress(percent, text) {
    const wrap = document.getElementById('progress');
    const fill = document.getElementById('progress-fill');
    const txt  = document.getElementById('progress-text');
    if (wrap)  wrap.hidden = false;
    if (fill)  fill.style.width = (percent | 0) + '%';
    if (txt && text != null) txt.textContent = text;
  }
  function hideProgress() {
    const wrap = document.getElementById('progress');
    if (wrap) wrap.hidden = true;
  }

  // ── バイト/文字列変換 ────────────────────────────────────
  function strToBytes(str) {
    return new TextEncoder().encode(str);
  }
  function bytesToStr(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  function bytesToLatin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return s;
  }
  function latin1ToBytes(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }
  function concatBytes(arrays) {
    let len = 0;
    for (const a of arrays) len += a.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const a of arrays) { out.set(a, off); off += a.length; }
    return out;
  }
  function bytesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // ── HEX ─────────────────────────────────────────────────
  function bytesToHex(bytes) {
    const hex = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      s += hex[(bytes[i] >> 4) & 0xf] + hex[bytes[i] & 0xf];
    }
    return s;
  }
  function hexToBytes(hex) {
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  // ── BE/LE 読み書き ───────────────────────────────────────
  function readU32BE(b, off) {
    return ((b[off] << 24) | (b[off+1] << 16) | (b[off+2] << 8) | b[off+3]) >>> 0;
  }
  function readU32LE(b, off) {
    return (b[off] | (b[off+1] << 8) | (b[off+2] << 16) | (b[off+3] << 24)) >>> 0;
  }
  function writeU32BE(b, off, v) {
    b[off]   = (v >>> 24) & 0xff;
    b[off+1] = (v >>> 16) & 0xff;
    b[off+2] = (v >>> 8) & 0xff;
    b[off+3] = v & 0xff;
  }
  function writeU32LE(b, off, v) {
    b[off]   = v & 0xff;
    b[off+1] = (v >>> 8) & 0xff;
    b[off+2] = (v >>> 16) & 0xff;
    b[off+3] = (v >>> 24) & 0xff;
  }
  function readU16BE(b, off) { return (b[off] << 8 | b[off+1]) & 0xffff; }
  function writeU16BE(b, off, v) { b[off] = (v>>>8)&0xff; b[off+1] = v&0xff; }
  function readU64BE(b, off) {
    const hi = readU32BE(b, off);
    const lo = readU32BE(b, off + 4);
    return hi * 0x100000000 + lo;
  }
  function writeU64BE(b, off, v) {
    const hi = Math.floor(v / 0x100000000);
    const lo = v >>> 0;
    writeU32BE(b, off, hi);
    writeU32BE(b, off + 4, lo);
  }
  function readU64LE(b, off) {
    const lo = readU32LE(b, off);
    const hi = readU32LE(b, off + 4);
    return hi * 0x100000000 + lo;
  }
  function writeU64LE(b, off, v) {
    const hi = Math.floor(v / 0x100000000);
    const lo = v >>> 0;
    writeU32LE(b, off, lo);
    writeU32LE(b, off + 4, hi);
  }

  // ── ハッシュ (Web Crypto) ────────────────────────────────
  async function sha1(bytes)   { return new Uint8Array(await crypto.subtle.digest('SHA-1',   bytes)); }
  async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
  async function digest(alg, bytes) {
    return new Uint8Array(await crypto.subtle.digest(alg, bytes));
  }

  // ── Base64 ──────────────────────────────────────────────
  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function base64ToBytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // ── ファイル名のセーフ化 ─────────────────────────────────
  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]/g, '_');
  }

  // ── イベントハンドラ ─────────────────────────────────────
  function onFile(inputEl, callback) {
    inputEl.addEventListener('change', () => {
      const f = inputEl.files && inputEl.files[0];
      const label = document.querySelector(`[data-target="${inputEl.id}"]`);
      if (label) {
        if (f) {
          label.textContent = f.name;
          label.removeAttribute('data-i18n');
        } else {
          label.setAttribute('data-i18n', 'step1.notSelected');
          label.textContent = (window.I18N ? window.I18N.t('step1.notSelected') : '未選択');
        }
      }
      if (f) callback(f);
    });
  }

  function readFileAsBytes(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(new Uint8Array(r.result));
      r.onerror = () => rej(r.error);
      r.readAsArrayBuffer(file);
    });
  }

  global.U = {
    info, success, warn, error, header, plain, clearLog,
    setProgress, hideProgress,
    strToBytes, bytesToStr, bytesToLatin1, latin1ToBytes,
    concatBytes, bytesEqual,
    bytesToHex, hexToBytes,
    readU32BE, readU32LE, writeU32BE, writeU32LE,
    readU16BE, writeU16BE,
    readU64BE, writeU64BE, readU64LE, writeU64LE,
    sha1, sha256, digest,
    bytesToBase64, base64ToBytes,
    sanitizeFilename,
    onFile, readFileAsBytes,
  };
})(window);
