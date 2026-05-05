/* Mach-O パーサ
 *  iOS の実行可能ファイル / dylib / framework / appex を解析し、
 *  Code Signature の差し替えに必要な情報を抽出する。
 *
 *  参考: <mach-o/loader.h>, <mach-o/fat.h>
 */
(function (global) {
  'use strict';
  const U = global.U;

  // ── 定数 ─────────────────────────────────────────────────
  const MH_MAGIC    = 0xfeedface;
  const MH_CIGAM    = 0xcefaedfe;
  const MH_MAGIC_64 = 0xfeedfacf;
  const MH_CIGAM_64 = 0xcffaedfe;
  const FAT_MAGIC   = 0xcafebabe;
  const FAT_CIGAM   = 0xbebafeca;
  const FAT_MAGIC_64 = 0xcafebabf;
  const FAT_CIGAM_64 = 0xbfbafeca;

  const LC_SEGMENT        = 0x01;
  const LC_SEGMENT_64     = 0x19;
  const LC_CODE_SIGNATURE = 0x1d;
  const LC_REQ_DYLD       = 0x80000000;

  const CPU_TYPE_ARM    = 12;
  const CPU_TYPE_ARM64  = 0x0100000c;
  const CPU_TYPE_X86    = 7;
  const CPU_TYPE_X86_64 = 0x01000007;

  // ── DoS 対策上限 ─────────────────────────────────────────
  const MAX_FAT_SLICES = 64;     // 現実的な FAT スライス数上限
  const MAX_LOAD_CMDS  = 4096;   // 現実的な load command 数上限
  const MAX_CMDS_SIZE  = 64 * 1024 * 1024; // sizeofcmds 上限 (64MB)

  const MH_EXECUTE  = 0x2;
  const MH_DYLIB    = 0x6;
  const MH_BUNDLE   = 0x8;
  const MH_DYLINKER = 0x7;

  /**
   * Mach-O かどうか判定する (FAT も含む)
   *   FAT: ディスク上は常に BE で書かれる
   *   thin Mach-O: 通常 LE
   */
  function isMachO(bytes) {
    if (!bytes || bytes.length < 8) return false;
    const mBE = U.readU32BE(bytes, 0);
    if (mBE === FAT_MAGIC || mBE === FAT_MAGIC_64) return true;
    const mLE = U.readU32LE(bytes, 0);
    return mLE === MH_MAGIC || mLE === MH_MAGIC_64
        || mLE === MH_CIGAM || mLE === MH_CIGAM_64;
  }

  /**
   * トップレベルのバイト列を解析して、 thin Mach-O のスライス配列を返す
   *   { isFat, fat64, slices: [{ cputype, cpusubtype, offset, size, align }] }
   */
  function parseTop(bytes) {
    // FAT は BE で書かれるので BE で読む
    const mBE = U.readU32BE(bytes, 0);
    if (mBE === FAT_MAGIC || mBE === FAT_MAGIC_64) {
      const fat64 = (mBE === FAT_MAGIC_64);
      const n = U.readU32BE(bytes, 4);
      if (n === 0 || n > MAX_FAT_SLICES) {
        throw new Error('FAT スライス数が不正: ' + n);
      }
      const archSize = fat64 ? 32 : 20;
      if (8 + n * archSize > bytes.length) {
        throw new Error('FAT ヘッダがファイル長を超えています');
      }
      const slices = [];
      for (let i = 0; i < n; i++) {
        const off = 8 + i * archSize;
        const cputype    = U.readU32BE(bytes, off);
        const cpusubtype = U.readU32BE(bytes, off + 4);
        let sliceOff, sliceSize, align;
        if (fat64) {
          sliceOff  = U.readU64BE(bytes, off + 8);
          sliceSize = U.readU64BE(bytes, off + 16);
          align     = U.readU32BE(bytes, off + 24);
        } else {
          sliceOff  = U.readU32BE(bytes, off + 8);
          sliceSize = U.readU32BE(bytes, off + 12);
          align     = U.readU32BE(bytes, off + 16);
        }
        if (sliceOff + sliceSize > bytes.length) {
          throw new Error('FAT スライスがファイル長を超えています');
        }
        slices.push({ cputype, cpusubtype, offset: sliceOff, size: sliceSize, align });
      }
      return { isFat: true, fat64, slices };
    }
    // thin Mach-O は LE で読む (iOS は LE のみ)
    const mLE = U.readU32LE(bytes, 0);
    if (mLE === MH_MAGIC || mLE === MH_MAGIC_64) {
      return { isFat: false, slices: [{ cputype: 0, cpusubtype: 0, offset: 0, size: bytes.length, align: 0 }] };
    }
    if (mLE === MH_CIGAM || mLE === MH_CIGAM_64) {
      throw new Error('Mach-O big-endian は未対応');
    }
    throw new Error('Mach-O ではありません: magic(BE)=0x' + mBE.toString(16) + ', magic(LE)=0x' + mLE.toString(16));
  }

  /**
   * thin Mach-O スライスを解析
   */
  function parseThin(bytes, sliceOff, sliceSize) {
    const buf = bytes.subarray(sliceOff, sliceOff + sliceSize);
    if (buf.length < 28) throw new Error('thin Mach-O が短すぎます');
    const magic = U.readU32LE(buf, 0);
    let is64;
    if (magic === MH_MAGIC_64) is64 = true;
    else if (magic === MH_MAGIC) is64 = false;
    else throw new Error('thin Mach-O magic 不正: 0x' + magic.toString(16));

    const cputype    = U.readU32LE(buf, 4);
    const cpusubtype = U.readU32LE(buf, 8);
    const filetype   = U.readU32LE(buf, 12);
    const ncmds      = U.readU32LE(buf, 16);
    const sizeofcmds = U.readU32LE(buf, 20);
    const flags      = U.readU32LE(buf, 24);
    const headerSize = is64 ? 32 : 28;

    if (ncmds > MAX_LOAD_CMDS) throw new Error('ncmds が大きすぎます: ' + ncmds);
    if (sizeofcmds > MAX_CMDS_SIZE) throw new Error('sizeofcmds が大きすぎます: ' + sizeofcmds);
    if (headerSize + sizeofcmds > buf.length) {
      throw new Error('load commands がスライス長を超えています');
    }

    const lcs = [];
    let off = headerSize;
    const lcEnd = headerSize + sizeofcmds;
    for (let i = 0; i < ncmds; i++) {
      if (off + 8 > lcEnd) throw new Error('load command がはみ出しました');
      const cmd     = U.readU32LE(buf, off);
      const cmdsize = U.readU32LE(buf, off + 4);
      if (cmdsize < 8 || off + cmdsize > lcEnd) {
        throw new Error('cmdsize が不正: ' + cmdsize);
      }
      lcs.push({ cmd, cmdsize, off, _bytes: buf });
      off += cmdsize;
    }

    return {
      buf,                // スライスを参照するビュー
      sliceOff,
      sliceSize,
      is64,
      cputype, cpusubtype, filetype, ncmds, sizeofcmds, flags, headerSize,
      loadCommands: lcs,
    };
  }

  /**
   * thin Mach-O から __LINKEDIT セグメントと既存 LC_CODE_SIGNATURE を見つける
   */
  function findKeyParts(thin) {
    let linkedit = null;
    let codeSig = null;
    let textExec = null; // __TEXT segment

    for (const lc of thin.loadCommands) {
      const cmd = lc.cmd & ~LC_REQ_DYLD;
      if (cmd === LC_SEGMENT_64) {
        const name = readCStr(thin.buf, lc.off + 8, 16);
        const vmaddr   = U.readU64LE(thin.buf, lc.off + 24);
        const vmsize   = U.readU64LE(thin.buf, lc.off + 32);
        const fileoff  = U.readU64LE(thin.buf, lc.off + 40);
        const filesize = U.readU64LE(thin.buf, lc.off + 48);
        const seg = { name, lcOff: lc.off, lcSize: lc.cmdsize, vmaddr, vmsize, fileoff, filesize, is64: true };
        if (name === '__LINKEDIT') linkedit = seg;
        if (name === '__TEXT')     textExec = seg;
      } else if (cmd === LC_SEGMENT) {
        const name = readCStr(thin.buf, lc.off + 8, 16);
        const vmaddr   = U.readU32LE(thin.buf, lc.off + 24);
        const vmsize   = U.readU32LE(thin.buf, lc.off + 28);
        const fileoff  = U.readU32LE(thin.buf, lc.off + 32);
        const filesize = U.readU32LE(thin.buf, lc.off + 36);
        const seg = { name, lcOff: lc.off, lcSize: lc.cmdsize, vmaddr, vmsize, fileoff, filesize, is64: false };
        if (name === '__LINKEDIT') linkedit = seg;
        if (name === '__TEXT')     textExec = seg;
      } else if (cmd === LC_CODE_SIGNATURE) {
        const dataoff  = U.readU32LE(thin.buf, lc.off + 8);
        const datasize = U.readU32LE(thin.buf, lc.off + 12);
        codeSig = { lcOff: lc.off, lcSize: lc.cmdsize, dataoff, datasize };
      }
    }
    return { linkedit, codeSig, textExec };
  }

  function readCStr(buf, off, max) {
    let s = '';
    for (let i = 0; i < max; i++) {
      const c = buf[off + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  /**
   * thin Mach-O から __TEXT セグメントの execSegBase / execSegLimit / Flags を取得
   */
  function getExecSegInfo(thin, isMainExe) {
    const { textExec } = findKeyParts(thin);
    if (!textExec) return { base: 0, limit: 0, flags: 0 };
    const flags = isMainExe ? 0x1 : 0; // CS_EXECSEG_MAIN_BINARY
    return { base: textExec.fileoff, limit: textExec.filesize, flags };
  }

  /**
   * 16-byte 境界に切り上げる
   */
  function align16(n) { return (n + 15) & ~15; }
  function alignTo(n, a) { return (n + a - 1) & ~(a - 1); }

  global.MachO = {
    isMachO, parseTop, parseThin, findKeyParts, getExecSegInfo, readCStr, align16, alignTo,
    LC_CODE_SIGNATURE, LC_SEGMENT, LC_SEGMENT_64,
    MH_EXECUTE, MH_DYLIB, MH_BUNDLE,
    FAT_MAGIC, FAT_MAGIC_64,
    MH_MAGIC_64, MH_MAGIC,
    CPU_TYPE_ARM, CPU_TYPE_ARM64, CPU_TYPE_X86, CPU_TYPE_X86_64,
  };
})(window);
