/* _CodeSignature/CodeResources の生成
 *  バンドル内の全ファイル (主実行ファイルと _CodeSignature/* を除く) をハッシュし、
 *  Apple 互換の plist を生成する。
 */
(function (global) {
  'use strict';
  const U = global.U;
  const Plist = global.Plist;

  // ── 既定ルール (codesign 互換) ───────────────────────
  function defaultRules() {
    return {
      '^version\\.plist$': true,
      '^Resources/': true,
      '^.*': true,
      '^Resources/.*\\.lproj/': { optional: true, weight: 1000 },
      '^Resources/.*\\.lproj/locversion.plist$': { omit: true, weight: 1100 },
      '^Resources/Base\\.lproj/': { weight: 1010 },
    };
  }
  function defaultRules2() {
    return {
      '.*\\.dSYM($|/)': { weight: 11 },
      '^(.*/)?\\.DS_Store$': { omit: true, weight: 2000 },
      '^(Frameworks|SharedFrameworks|PlugIns|Plug-ins|XPCServices|Helpers|MacOS|Library/(Automator|Spotlight|LoginItems))/': { nested: true, weight: 10 },
      '^.*': true,
      '^Info\\.plist$': { omit: true, weight: 20 },
      '^PkgInfo$': { omit: true, weight: 20 },
      '^[^/]+$': { nested: true, weight: 10 },
      '^embedded\\.provisionprofile$': { weight: 20 },
      '^version\\.plist$': { weight: 20 },
      '^.*\\.lproj/': { optional: true, weight: 1000 },
      '^.*\\.lproj/locversion.plist$': { omit: true, weight: 1100 },
      '^Base\\.lproj/': { weight: 1010 },
    };
  }

  /**
   * バンドル直下のファイル (再帰) を列挙する
   *   bundlePath: "Payload/Foo.app" など (zip 内のパス)
   *   excludeMain: メイン実行ファイル名 (CFBundleExecutable)
   *
   * 戻り値: [{ rel, full, isSymlink, bytes? }] (rel は bundlePath からの相対)
   */
  function listBundleFiles(zip, bundlePath, excludeMain) {
    const items = [];
    const prefix = bundlePath + '/';
    zip.forEach((relPath, entry) => {
      if (!relPath.startsWith(prefix)) return;
      if (entry.dir) return;
      const rel = relPath.substring(prefix.length);
      // 除外: _CodeSignature/* と Info.plist と メイン実行ファイル
      if (rel.startsWith('_CodeSignature/')) return;
      if (rel === 'Info.plist') return;
      if (rel === excludeMain) return;
      items.push({ rel, full: relPath, entry });
    });
    items.sort((a, b) => a.rel < b.rel ? -1 : (a.rel > b.rel ? 1 : 0));
    return items;
  }

  /**
   * CodeResources plist を生成する
   *
   * @param zip JSZip instance
   * @param bundlePath "Payload/Foo.app"
   * @param mainExecutableName CFBundleExecutable
   */
  async function buildCodeResources(zip, bundlePath, mainExecutableName) {
    const files = {};   // rel → Uint8Array(SHA-1)
    const files2 = {};  // rel → { hash, hash2, optional? }

    const items = listBundleFiles(zip, bundlePath, mainExecutableName);
    for (const it of items) {
      const data = await it.entry.async('uint8array');
      const h1 = await U.sha1(data);
      const h2 = await U.sha256(data);
      files[it.rel] = h1;
      files2[it.rel] = { hash: h1, hash2: h2 };
    }

    const cr = {
      files,
      files2,
      rules:  defaultRules(),
      rules2: defaultRules2(),
    };
    return Plist.build(cr);
  }

  global.CR = { buildCodeResources, listBundleFiles };
})(window);
