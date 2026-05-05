/* 機能 1: IPA 内容確認 */
(function (global) {
  'use strict';
  const U = global.U;
  const Plist = global.Plist;
  const PP = global.PP;

  /**
   * IPA 内のアプリパス "Payload/Foo.app" を返す
   */
  function findAppPath(zip) {
    const candidates = [];
    zip.forEach((relPath, entry) => {
      // entry.dir が真でない可能性があるが、name が "Payload/<X>.app/" の形
      const m = relPath.match(/^Payload\/([^/]+\.app)\/?$/);
      if (m && entry.dir) candidates.push('Payload/' + m[1]);
    });
    if (candidates.length) return candidates[0];

    // ディレクトリエントリが無い zip もあるので、ファイルパスから推定
    let prefix = null;
    zip.forEach((relPath) => {
      const m = relPath.match(/^Payload\/([^/]+\.app)\//);
      if (m) prefix = 'Payload/' + m[1];
    });
    return prefix;
  }

  async function showIpaContents(zip) {
    U.header('IPA 内容確認');

    const appPath = findAppPath(zip);
    if (!appPath) {
      U.warn('Payload 内に .app が見つかりません');
      return null;
    }
    U.info('アプリ: ' + appPath.split('/').pop());

    // ── ファイル一覧 (上位 50) ────────────────────────
    const names = [];
    zip.forEach((relPath, entry) => { if (!entry.dir) names.push(relPath); });
    names.sort();
    U.plain('ファイル一覧 (上位 50 件):');
    names.slice(0, 50).forEach(n => U.plain('  ' + n));
    if (names.length > 50) U.plain('  ... 他 ' + (names.length - 50) + ' ファイル');

    // ── Info.plist ────────────────────────────────────
    const infoPath = appPath + '/Info.plist';
    const infoEntry = zip.file(infoPath);
    if (infoEntry) {
      try {
        const data = await infoEntry.async('uint8array');
        const plist = Plist.parse(data);
        U.plain('');
        U.plain('Info.plist 主要項目:');
        const fields = [
          ['Bundle ID',     'CFBundleIdentifier'],
          ['Version',       'CFBundleVersion'],
          ['Short Version', 'CFBundleShortVersionString'],
          ['Display Name',  'CFBundleDisplayName'],
          ['Min iOS',       'MinimumOSVersion'],
          ['Executable',    'CFBundleExecutable'],
        ];
        for (const [label, key] of fields) {
          const v = plist[key];
          U.plain('  ' + label.padEnd(16) + ': ' + (v == null ? '(なし)' : v));
        }
      } catch (e) {
        U.warn('Info.plist の解析に失敗: ' + e.message);
      }
    } else {
      U.warn('Info.plist が見つかりません');
    }

    // ── Provisioning Profile ──────────────────────────
    const ppPath = appPath + '/embedded.mobileprovision';
    const ppEntry = zip.file(ppPath);
    if (ppEntry) {
      try {
        const ppBytes = await ppEntry.async('uint8array');
        const ppData = PP.parseProvisioningProfile(ppBytes);
        const sum = PP.summary(ppData);
        U.plain('');
        U.plain('Provisioning Profile:');
        U.plain('  Name           : ' + sum.Name);
        U.plain('  Team           : ' + sum.TeamName);
        U.plain('  App ID         : ' + sum.AppID);
        U.plain('  有効期限       : ' + (sum.Expiration ? sum.Expiration.toISOString().split('T')[0] : '(不明)'));
      } catch (e) {
        U.warn('PP の解析に失敗: ' + e.message);
      }
    } else {
      U.warn('embedded.mobileprovision が見つかりません');
    }

    return appPath;
  }

  global.Inspector = { findAppPath, showIpaContents };
})(window);
