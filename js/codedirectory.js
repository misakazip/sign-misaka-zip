/* Code Directory / SuperBlob ビルダー
 *  ref: bsd/sys/codesign.h, OSAKextSignature.cpp 等
 */
(function (global) {
  'use strict';
  const U = global.U;

  // ── Blob magic ───────────────────────────────────────────
  const MAGIC = {
    REQUIREMENT:                0xfade0c00,
    REQUIREMENTS:               0xfade0c01,
    CODEDIRECTORY:              0xfade0c02,
    EMBEDDED_SIGNATURE:         0xfade0cc0,
    EMBEDDED_ENTITLEMENTS:      0xfade7171,
    EMBEDDED_DER_ENTITLEMENTS:  0xfade7172,
    BLOBWRAPPER:                0xfade0b01,
  };

  // ── Slot 番号 ────────────────────────────────────────────
  const SLOT = {
    CODEDIRECTORY:    0,
    INFOSLOT:         1,
    REQUIREMENTS:     2,
    RESOURCEDIR:      3,
    APPLICATION:      4,
    ENTITLEMENTS:     5,
    DER_ENTITLEMENTS: 7,
    SIGNATURESLOT:    0x10000,
  };

  // ── ハッシュ種別 (CodeDirectory hashType) ────────────────
  const HT = {
    SHA1:    1,
    SHA256:  2,
    SHA384:  3,
  };

  // 全 0 ハッシュ
  function zeroHash(size) { return new Uint8Array(size); }

  /**
   * 単純な Blob ヘッダ付きラッパ
   *   [magic:u32][length:u32][payload...]
   */
  function blobWrap(magic, payload) {
    const out = new Uint8Array(8 + payload.length);
    U.writeU32BE(out, 0, magic);
    U.writeU32BE(out, 4, out.length);
    out.set(payload, 8);
    return out;
  }

  /** Entitlements (XML plist) Blob */
  function buildEntitlementsBlob(entXmlBytes) {
    return blobWrap(MAGIC.EMBEDDED_ENTITLEMENTS, entXmlBytes);
  }

  /** DER Entitlements Blob */
  function buildDEREntitlementsBlob(entObj) {
    const der = encodeDEREntitlements(entObj);
    return blobWrap(MAGIC.EMBEDDED_DER_ENTITLEMENTS, der);
  }

  /** 空の Requirements Blob (count=0) */
  function buildEmptyRequirementsBlob() {
    const payload = new Uint8Array(4);
    U.writeU32BE(payload, 0, 0); // count = 0
    return blobWrap(MAGIC.REQUIREMENTS, payload);
  }

  /** CMS BlobWrapper */
  function buildBlobWrapper(cmsBytes) {
    return blobWrap(MAGIC.BLOBWRAPPER, cmsBytes);
  }

  // ============================================================
  //  CodeDirectory 構築
  //   opts: {
  //     identifier:  string
  //     teamId:      string
  //     fileBytes:   Uint8Array (codeLimit までを page 単位で hash)
  //     codeLimit:   number
  //     pageSize:    number (default 4096)
  //     hashType:    HT.SHA256
  //     specialHashes: { [slotIndex]: Uint8Array }
  //     execSegBase, execSegLimit, execSegFlags
  //     flags:       number (CD flags, e.g. 0)
  //   }
  // ============================================================
  async function buildCodeDirectory(opts) {
    const pageSize = opts.pageSize || 4096;
    const hashType = opts.hashType || HT.SHA256;
    const hashSize = hashType === HT.SHA256 ? 32 : (hashType === HT.SHA1 ? 20 : 48);
    const ident    = opts.identifier || '';
    const teamId   = opts.teamId || '';

    // 特殊スロット数: -1..-7 のうち最大インデックスを使う
    // 我々は 1, 2, 3, 5 (および 7) を使用
    const useDER = !!opts.specialHashes[SLOT.DER_ENTITLEMENTS];
    const nSpecialSlots = useDER ? 7 : 5;

    // ページ数
    const codeLimit = opts.codeLimit;
    const nCodeSlots = Math.ceil(codeLimit / pageSize);

    // ── ヘッダサイズ (v0x20400) ────────────────────
    const HDR_SIZE = 88;
    const identBytes = U.strToBytes(ident);
    const teamBytes  = U.strToBytes(teamId);

    const identOffset = HDR_SIZE;
    const teamOffset  = teamId ? (identOffset + identBytes.length + 1) : 0;
    let cursor = identOffset + identBytes.length + 1;
    if (teamId) cursor += teamBytes.length + 1;

    // ハッシュ配置: cursor から特殊スロット (逆順) → コードスロット
    const hashRegionStart = cursor;
    const hashOffset = hashRegionStart + nSpecialSlots * hashSize;
    const totalLen = hashOffset + nCodeSlots * hashSize;

    const cd = new Uint8Array(totalLen);

    // ── ヘッダ書き込み ────────────────────────────
    U.writeU32BE(cd,  0, MAGIC.CODEDIRECTORY);
    U.writeU32BE(cd,  4, totalLen);
    U.writeU32BE(cd,  8, 0x20400);              // version
    U.writeU32BE(cd, 12, opts.flags || 0);      // flags
    U.writeU32BE(cd, 16, hashOffset);
    U.writeU32BE(cd, 20, identOffset);
    U.writeU32BE(cd, 24, nSpecialSlots);
    U.writeU32BE(cd, 28, nCodeSlots);
    U.writeU32BE(cd, 32, codeLimit > 0xffffffff ? 0xffffffff : codeLimit);
    cd[36] = hashSize;
    cd[37] = hashType;
    cd[38] = 0; // platform
    cd[39] = log2(pageSize);
    U.writeU32BE(cd, 40, 0); // spare2
    U.writeU32BE(cd, 44, 0); // scatterOffset
    U.writeU32BE(cd, 48, teamOffset);
    U.writeU32BE(cd, 52, 0); // spare3
    U.writeU64BE(cd, 56, codeLimit > 0xffffffff ? codeLimit : 0); // codeLimit64
    U.writeU64BE(cd, 64, opts.execSegBase || 0);
    U.writeU64BE(cd, 72, opts.execSegLimit || 0);
    U.writeU64BE(cd, 80, opts.execSegFlags || 0);

    // ── identifier ────────────────────────────────
    cd.set(identBytes, identOffset);
    cd[identOffset + identBytes.length] = 0;
    if (teamId) {
      cd.set(teamBytes, teamOffset);
      cd[teamOffset + teamBytes.length] = 0;
    }

    // ── 特殊スロット ──────────────────────────────
    // hashOffset を 0 として、 i 番目のコードスロットは hashOffset + i*hashSize
    // 特殊スロット n (n>=1) は hashOffset - n*hashSize に配置する
    const algo = hashType === HT.SHA256 ? 'SHA-256' : (hashType === HT.SHA1 ? 'SHA-1' : 'SHA-384');
    for (let n = 1; n <= nSpecialSlots; n++) {
      const slot = opts.specialHashes[n] || zeroHash(hashSize);
      cd.set(slot, hashOffset - n * hashSize);
    }

    // ── ページハッシュ ────────────────────────────
    for (let i = 0; i < nCodeSlots; i++) {
      const start = i * pageSize;
      const end   = Math.min(start + pageSize, codeLimit);
      const page  = opts.fileBytes.subarray(start, end);
      const h     = await U.digest(algo, page);
      cd.set(h, hashOffset + i * hashSize);
    }

    return cd;
  }

  function log2(n) {
    let r = 0; let v = n;
    while (v > 1) { v >>>= 1; r++; }
    return r;
  }

  // ============================================================
  //  SuperBlob: index で各 Blob を参照する EmbeddedSignature
  //    slots: [{ slot, blob }]
  //    blob は Uint8Array (CD/Reqs/Ents/DER/CMSWrapper を含む完成済み)
  // ============================================================
  function buildSuperBlob(slots) {
    const HEAD = 12;
    const INDEX = 8;
    const headerLen = HEAD + slots.length * INDEX;
    let total = headerLen;
    for (const s of slots) total += s.blob.length;

    const sb = new Uint8Array(total);
    U.writeU32BE(sb, 0, MAGIC.EMBEDDED_SIGNATURE);
    U.writeU32BE(sb, 4, total);
    U.writeU32BE(sb, 8, slots.length);

    let cursor = headerLen;
    for (let i = 0; i < slots.length; i++) {
      U.writeU32BE(sb, HEAD + i * INDEX,     slots[i].slot);
      U.writeU32BE(sb, HEAD + i * INDEX + 4, cursor);
      sb.set(slots[i].blob, cursor);
      cursor += slots[i].blob.length;
    }
    return sb;
  }

  // ============================================================
  //  DER Entitlements エンコード
  //   Apple の独自形式: [APPLICATION 16 IMPLICIT] SET 内に SEQUENCE OF SEQUENCE { key, value }
  //   value は BOOLEAN / INTEGER / UTF8String / SEQUENCE / SET から多様
  // ============================================================
  function encodeDEREntitlements(entObj) {
    // forge.asn1 を使って構築
    const asn1   = forge.asn1;
    const Class  = asn1.Class;
    const Type   = asn1.Type;

    // ── 値変換 ───────────────────────────────────
    function encodeValue(v) {
      if (typeof v === 'boolean') {
        return asn1.create(Class.UNIVERSAL, Type.BOOLEAN, false, v ? '\xff' : '\x00');
      }
      if (typeof v === 'number' && Number.isInteger(v)) {
        return asn1.create(Class.UNIVERSAL, Type.INTEGER, false, asn1.integerToDer(v).getBytes());
      }
      if (typeof v === 'string') {
        return asn1.create(Class.UNIVERSAL, Type.UTF8, false, forge.util.encodeUtf8(v));
      }
      if (Array.isArray(v)) {
        return asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, v.map(encodeValue));
      }
      if (v && typeof v === 'object' && !(v instanceof Uint8Array) && !(v instanceof Date)) {
        return encodeDict(v);
      }
      // 未対応型は文字列化
      return asn1.create(Class.UNIVERSAL, Type.UTF8, false, forge.util.encodeUtf8(String(v)));
    }

    // dict は SET OF SEQUENCE { key UTF8String, value }
    function encodeDict(obj) {
      const keys = Object.keys(obj).sort(); // SET なので key 昇順
      const entries = keys.map(k => {
        return asn1.create(Class.UNIVERSAL, Type.SEQUENCE, true, [
          asn1.create(Class.UNIVERSAL, Type.UTF8, false, forge.util.encodeUtf8(k)),
          encodeValue(obj[k]),
        ]);
      });
      return asn1.create(Class.UNIVERSAL, Type.SET, true, entries);
    }

    // 最上位は [APPLICATION 16] CONSTRUCTED:
    //   INTEGER 1
    //   SET OF SEQUENCE { key, value }
    const inner = [
      asn1.create(Class.UNIVERSAL, Type.INTEGER, false, asn1.integerToDer(1).getBytes()),
      encodeDict(entObj),
    ];
    const top = asn1.create(Class.APPLICATION, 16, true, inner);
    const der = asn1.toDer(top).getBytes();
    // forge は Latin-1 文字列で返すので Uint8Array へ
    return U.latin1ToBytes(der);
  }

  global.CD = {
    MAGIC, SLOT, HT,
    blobWrap,
    buildEntitlementsBlob,
    buildDEREntitlementsBlob,
    buildEmptyRequirementsBlob,
    buildBlobWrapper,
    buildCodeDirectory,
    buildSuperBlob,
    encodeDEREntitlements,
  };
})(window);
