/* 署名パイプライン全体
 *  - Mach-O 単体への再署名
 *  - .app / .appex バンドルの再署名 (CodeResources 生成 + バイナリ署名)
 *  - PlugIns / Frameworks 内の入れ子バンドル/dylib を再帰処理
 */
(function (global) {
  'use strict';
  const U      = global.U;
  const Plist  = global.Plist;
  const MachO  = global.MachO;
  const CD     = global.CD;
  const CMS    = global.CMS;
  const CR     = global.CR;

  // 署名サイズの上限見積もり (bytes) — 余裕を持って確保する
  // SuperBlob + CD + Requirements + Ents(xml) + DER Ents + CMSWrapper
  function estimateSigSize(opts, codeLimit, identLen, teamLen, hashSize, nSpecialSlots, entXmlLen, entDerLen) {
    const pageSize = 4096;
    const nCodeSlots = Math.ceil(codeLimit / pageSize);
    // CodeDirectory
    const cdSize = 88 + identLen + 1 + (teamLen ? teamLen + 1 : 0) +
                   nSpecialSlots * hashSize + nCodeSlots * hashSize;
    // 各 Blob (header 8byte + body)
    const reqsSize = 12;                 // 空 Requirements
    const entsSize = 8 + entXmlLen;      // Entitlements
    const derSize  = entDerLen ? 8 + entDerLen : 0;
    // CMS の概算: 8KB を上限とする
    const cmsWrap  = 8 + 8 * 1024;       // BlobWrapper + 8KB CMS
    const sbHeader = 12;
    const numSlots = 3 + (entXmlLen ? 1 : 0) + (entDerLen ? 1 : 0); // CD, Requirements, CMS, [Ents], [DER]
    const sbIndex  = 8 * numSlots;
    const total = sbHeader + sbIndex + cdSize + reqsSize + entsSize + derSize + cmsWrap;
    return MachO.alignTo(total + 256, 16); // 余白付き
  }

  /** Entitlements XML を整形して Uint8Array にする */
  function entitlementsToXmlBytes(ents) {
    if (!ents || Object.keys(ents).length === 0) return null;
    return Plist.build(ents);
  }

  /**
   * thin Mach-O スライスに署名する
   *   bytes:       スライスのバイト列
   *   opts:        { signer, identifier, teamId, entitlements, infoPlistHash, codeResourcesHash, isMainExe }
   * 戻り値: 新しいバイト列
   */
  async function signThin(bytes, opts) {
    const thin  = MachO.parseThin(bytes, 0, bytes.length);
    const parts = MachO.findKeyParts(thin);
    if (!parts.linkedit) throw new Error('thin Mach-O に __LINKEDIT が見つかりません');

    // ── 出力パラメータ ────────────────────────────
    const ident   = opts.identifier;
    const teamId  = opts.teamId || '';
    const hashType = CD.HT.SHA256;
    const hashSize = 32;

    // Entitlements (メイン実行 + .appex のみ)
    const wantEnts = opts.isMainExe || opts.isAppex;
    const entXml = (wantEnts && opts.entitlements) ? entitlementsToXmlBytes(opts.entitlements) : null;
    const entDer = (wantEnts && opts.entitlements) ? CD.encodeDEREntitlements(opts.entitlements) : null;
    const nSpecialSlots = (entDer ? 7 : 5);

    // ── 新シグネチャ配置先 ────────────────────────
    let newSigOff;
    let needAddLC = false;
    if (parts.codeSig) {
      newSigOff = parts.codeSig.dataoff;  // 既存 LC_CODE_SIGNATURE の場所をそのまま再利用
    } else {
      // 未署名バイナリ: __LINKEDIT 末尾の直後 (16-byte 整列) に新規署名を配置し、
      // load commands に LC_CODE_SIGNATURE を 1 件追加する
      const linkeditEnd = parts.linkedit.fileoff + parts.linkedit.filesize;
      newSigOff = MachO.alignTo(Math.max(linkeditEnd, bytes.length), 16);
      needAddLC = true;
      U.info('LC_CODE_SIGNATURE が無いため新規追加します');
      // load commands エリアに 16 byte の余裕があるか検証
      const minSecOff = MachO.getMinSectionFileOff(thin);
      const newLcEnd = thin.headerSize + thin.sizeofcmds + 16;
      if (minSecOff !== Infinity && newLcEnd > minSecOff) {
        throw new Error('load commands エリアに LC_CODE_SIGNATURE を追加する余地がありません ('
                        + 'newLcEnd=' + newLcEnd + ', minSecOff=' + minSecOff + ')');
      }
    }
    const estSize   = estimateSigSize(opts, newSigOff, U.strToBytes(ident).length, U.strToBytes(teamId).length,
                                      hashSize, nSpecialSlots, entXml ? entXml.length : 0, entDer ? entDer.length : 0);

    // ── 新バッファ ────────────────────────────────
    const newLen = newSigOff + estSize;
    const out = new Uint8Array(newLen);
    // bytes.subarray(0, newSigOff) は newSigOff > bytes.length の場合に
    // bytes.length までクランプされる (差分は Uint8Array の初期 0 で埋まる)
    out.set(bytes.subarray(0, Math.min(bytes.length, newSigOff)));

    // ── LC_CODE_SIGNATURE.size を更新 (or 新規追加) ─────────────
    if (needAddLC) {
      const newLcOff = thin.headerSize + thin.sizeofcmds;
      U.writeU32LE(out, newLcOff,      MachO.LC_CODE_SIGNATURE);
      U.writeU32LE(out, newLcOff + 4,  16);          // cmdsize
      U.writeU32LE(out, newLcOff + 8,  newSigOff);   // dataoff
      U.writeU32LE(out, newLcOff + 12, estSize);     // datasize
      // ヘッダの ncmds / sizeofcmds を更新 (32bit/64bit いずれもオフセット 16, 20)
      U.writeU32LE(out, 16, thin.ncmds + 1);
      U.writeU32LE(out, 20, thin.sizeofcmds + 16);
    } else {
      U.writeU32LE(out, parts.codeSig.lcOff + 8,  newSigOff);
      U.writeU32LE(out, parts.codeSig.lcOff + 12, estSize);
    }

    // ── __LINKEDIT.filesize/vmsize を更新 ─────────
    const le = parts.linkedit;
    const newLEFileSize = (newSigOff + estSize) - le.fileoff;
    // VM 上のページサイズで切り上げ (arm64=16K, それ以外=4K で安全に 16K にする)
    const vmPageAlign = thin.is64 ? 16384 : 4096;
    const newLEVmSize = MachO.alignTo(newLEFileSize, vmPageAlign);
    if (le.is64) {
      U.writeU64LE(out, le.lcOff + 32, newLEVmSize);   // vmsize
      U.writeU64LE(out, le.lcOff + 48, newLEFileSize); // filesize
    } else {
      U.writeU32LE(out, le.lcOff + 28, newLEVmSize);
      U.writeU32LE(out, le.lcOff + 36, newLEFileSize);
    }

    // ── __TEXT 情報 (execSegBase / Limit / Flags) ──
    const exeInfo = MachO.getExecSegInfo(MachO.parseThin(out, 0, out.length), opts.isMainExe);

    // ── 特殊スロット ハッシュ ─────────────────────
    const algo = 'SHA-256';
    const specialHashes = {};
    if (opts.infoPlistHash) {
      specialHashes[CD.SLOT.INFOSLOT] = opts.infoPlistHash;
    }
    // Requirements ハッシュ (空 Requirements の SHA-256)
    const reqsBlob = CD.buildEmptyRequirementsBlob();
    specialHashes[CD.SLOT.REQUIREMENTS] = await U.digest(algo, reqsBlob);

    if (opts.codeResourcesHash) {
      specialHashes[CD.SLOT.RESOURCEDIR] = opts.codeResourcesHash;
    }
    // application 特殊 (slot 4) は使わない
    let entsBlob = null;
    if (entXml) {
      entsBlob = CD.buildEntitlementsBlob(entXml);
      specialHashes[CD.SLOT.ENTITLEMENTS] = await U.digest(algo, entsBlob);
    }
    let entDerBlob = null;
    if (entDer) {
      entDerBlob = CD.buildDEREntitlementsBlob(opts.entitlements);
      specialHashes[CD.SLOT.DER_ENTITLEMENTS] = await U.digest(algo, entDerBlob);
    }

    // ── CodeDirectory (codeLimit = newSigOff) ─────
    const cd = await CD.buildCodeDirectory({
      identifier: ident,
      teamId,
      fileBytes: out,
      codeLimit: newSigOff,
      pageSize: 4096,
      hashType,
      specialHashes,
      execSegBase:  exeInfo.base,
      execSegLimit: exeInfo.limit,
      execSegFlags: exeInfo.flags,
      flags: 0,
    });

    // ── CMS 署名 ─────────────────────────────────
    const cms = CMS.buildCMS(cd, opts.signer);
    const cmsBlob = CD.buildBlobWrapper(cms);

    // ── SuperBlob 構築 ────────────────────────────
    const slots = [];
    slots.push({ slot: CD.SLOT.CODEDIRECTORY, blob: cd });
    slots.push({ slot: CD.SLOT.REQUIREMENTS, blob: reqsBlob });
    if (entsBlob)    slots.push({ slot: CD.SLOT.ENTITLEMENTS,     blob: entsBlob });
    if (entDerBlob)  slots.push({ slot: CD.SLOT.DER_ENTITLEMENTS, blob: entDerBlob });
    slots.push({ slot: CD.SLOT.SIGNATURESLOT, blob: cmsBlob });

    const sb = CD.buildSuperBlob(slots);

    if (sb.length > estSize) {
      throw new Error(`SuperBlob (${sb.length}B) が見積もり (${estSize}B) を超えました`);
    }

    // ── 配置 (残りはゼロ埋め) ─────────────────────
    out.set(sb, newSigOff);
    return out;
  }

  /**
   * Mach-O (FAT/thin) への署名のエントリーポイント
   */
  async function signMachO(bytes, opts) {
    const top = MachO.parseTop(bytes);
    if (!top.isFat) {
      return await signThin(bytes, opts);
    }
    // FAT: 各スライスに対して署名し、再構築
    const signedSlices = [];
    for (const arch of top.slices) {
      const sliceBytes = bytes.slice(arch.offset, arch.offset + arch.size);
      try {
        const newSlice = await signThin(sliceBytes, opts);
        signedSlices.push({ cputype: arch.cputype, cpusubtype: arch.cpusubtype, align: arch.align, bytes: newSlice });
      } catch (e) {
        U.warn(`FAT スライス (cputype=${arch.cputype}) の署名に失敗: ${e.message}。スキップします。`);
      }
    }
    if (!signedSlices.length) throw new Error('全 FAT スライスの署名に失敗しました');
    return rebuildFat(signedSlices, top.fat64);
  }

  function rebuildFat(slices, fat64) {
    const archSize = fat64 ? 32 : 20;
    const headerLen = 8 + archSize * slices.length;
    // 各スライス位置を 16K に整列
    let cursor = MachO.alignTo(headerLen, 0x4000);
    const offsets = [];
    for (const s of slices) {
      offsets.push(cursor);
      cursor += s.bytes.length;
      cursor = MachO.alignTo(cursor, 0x4000);
    }
    const totalSize = offsets[offsets.length - 1] + slices[slices.length - 1].bytes.length;
    // 最終バッファ
    const out = new Uint8Array(MachO.alignTo(totalSize, 0x4000));
    U.writeU32BE(out, 0, fat64 ? MachO.FAT_MAGIC_64 : MachO.FAT_MAGIC);
    U.writeU32BE(out, 4, slices.length);
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      const off = 8 + i * archSize;
      U.writeU32BE(out, off,     s.cputype);
      U.writeU32BE(out, off + 4, s.cpusubtype);
      if (fat64) {
        U.writeU64BE(out, off + 8,  offsets[i]);
        U.writeU64BE(out, off + 16, s.bytes.length);
        U.writeU32BE(out, off + 24, s.align);
      } else {
        U.writeU32BE(out, off + 8,  offsets[i]);
        U.writeU32BE(out, off + 12, s.bytes.length);
        U.writeU32BE(out, off + 16, s.align);
      }
      out.set(s.bytes, offsets[i]);
    }
    return out;
  }

  // ============================================================
  //  バンドル (.app / .appex) 単位の署名
  // ============================================================
  async function signBundle(zip, bundlePath, signer, ppData, options) {
    const isAppex = bundlePath.endsWith('.appex');
    U.header((isAppex ? 'App Extension' : 'App') + ' 再署名: ' + bundlePath.split('/').pop());

    // ── Info.plist を読む ─────────────────────────
    const infoEntry = zip.file(bundlePath + '/Info.plist');
    if (!infoEntry) throw new Error(bundlePath + '/Info.plist が見つかりません');
    const infoBytes = await infoEntry.async('uint8array');
    const infoPlist = Plist.parse(infoBytes);
    const mainExe   = infoPlist.CFBundleExecutable;
    if (!mainExe) throw new Error('CFBundleExecutable が Info.plist にありません');
    const bundleId  = infoPlist.CFBundleIdentifier || '';

    // ── 1. ネスト Bundle (PlugIns/*.appex) 署名 ───
    const nested = [];
    zip.forEach((rel, ent) => {
      const m = rel.match(new RegExp('^' + escRe(bundlePath) + '/PlugIns/([^/]+\\.appex)/Info\\.plist$'));
      if (m) nested.push(bundlePath + '/PlugIns/' + m[1]);
    });
    for (const np of nested) {
      await signBundle(zip, np, signer, ppData, { ...options, isAppex: true });
    }

    // ── 2. Frameworks/ 内の dylib / framework 直接署名 ──
    const frameworks = [];
    zip.forEach((rel, ent) => {
      if (ent.dir) return;
      // Frameworks/ABC.framework/ABC  または  Frameworks/foo.dylib
      const re1 = new RegExp('^' + escRe(bundlePath) + '/Frameworks/([^/]+)\\.dylib$');
      const re2 = new RegExp('^' + escRe(bundlePath) + '/Frameworks/([^/]+)\\.framework/([^/]+)$');
      const m1 = rel.match(re1);
      if (m1) frameworks.push({ path: rel, name: m1[1], identifier: bundleId + '.' + m1[1] });
      const m2 = rel.match(re2);
      if (m2 && m2[1] === m2[2]) frameworks.push({ path: rel, name: m2[1], identifier: m2[1] });
    });
    for (const fw of frameworks) {
      await signBinary(zip, fw.path, signer, fw.identifier, false, false);
    }

    // ── 3. Provisioning Profile 差し替え (この時点で) ──
    if (options.replacePP && options.ppBytes) {
      zip.file(bundlePath + '/embedded.mobileprovision', options.ppBytes);
    }

    // ── 4. CodeResources 生成 ─────────────────────
    U.info('CodeResources 生成中...');
    const crBytes = await CR.buildCodeResources(zip, bundlePath, mainExe);
    zip.file(bundlePath + '/_CodeSignature/CodeResources', crBytes);

    // ── 5. ハッシュ計算 ───────────────────────────
    const infoHash = await U.sha256(infoBytes);
    const crHash   = await U.sha256(crBytes);

    // ── 6. メインバイナリ署名 ──────────────────────
    const binPath = bundlePath + '/' + mainExe;
    const binBytes = await zip.file(binPath).async('uint8array');
    const teamId = (ppData && ppData.TeamIdentifier && ppData.TeamIdentifier[0]) || '';
    const entitlements = options.applyEntitlements ? (ppData && ppData.Entitlements) : null;

    const newBin = await signMachO(binBytes, {
      signer,
      identifier: bundleId,
      teamId,
      entitlements,
      infoPlistHash: infoHash,
      codeResourcesHash: crHash,
      isMainExe: !isAppex,
      isAppex: isAppex,
    });
    zip.file(binPath, newBin);

    U.success((isAppex ? 'App Extension' : 'アプリ') + ' を再署名しました: ' + bundlePath.split('/').pop());
  }

  /** 単独バイナリ (Frameworks/*.dylib) の署名 */
  async function signBinary(zip, path, signer, identifier, isMainExe, isAppex) {
    const bytes = await zip.file(path).async('uint8array');
    if (!MachO.isMachO(bytes)) {
      U.warn('Mach-O ではないためスキップ: ' + path);
      return;
    }
    U.info('バイナリ署名: ' + path);
    const newBytes = await signMachO(bytes, {
      signer,
      identifier,
      teamId: '',
      entitlements: null,
      isMainExe: !!isMainExe,
      isAppex: !!isAppex,
    });
    zip.file(path, newBytes);
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  global.Signer = { signMachO, signBundle, signThin };
})(window);
