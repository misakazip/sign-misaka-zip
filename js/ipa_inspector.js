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
    const t = (k, p) => (global.I18N ? global.I18N.t(k, p) : k);
    U.header(t('insp.heading'));

    const appPath = findAppPath(zip);
    if (!appPath) {
      U.warn(t('err.appNotFound'));
      return null;
    }
    U.info(t('insp.appShort', { name: appPath.split('/').pop() }));

    // ── ファイル一覧 (上位 50) ────────────────────────
    const names = [];
    zip.forEach((relPath, entry) => { if (!entry.dir) names.push(relPath); });
    names.sort();
    U.plain(t('insp.fileList'));
    names.slice(0, 50).forEach(n => U.plain('  ' + n));
    if (names.length > 50) U.plain(t('insp.moreFiles', { n: names.length - 50 }));

    // ── Info.plist ────────────────────────────────────
    const infoPath = appPath + '/Info.plist';
    const infoEntry = zip.file(infoPath);
    if (infoEntry) {
      try {
        const data = await infoEntry.async('uint8array');
        const plist = Plist.parse(data);
        U.plain('');
        U.plain(t('insp.infoPlistTitle'));
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
          U.plain('  ' + label.padEnd(16) + ': ' + (v == null ? t('val.none') : v));
        }
      } catch (e) {
        U.warn(t('insp.infoPlistFailed', { msg: e.message }));
      }
    } else {
      U.warn(t('insp.infoPlistMissing'));
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
        U.plain(t('insp.ppTitle'));
        U.plain(t('insp.ppName',  { v: sum.Name }));
        U.plain(t('insp.ppTeam',  { v: sum.TeamName }));
        U.plain(t('insp.ppAppId', { v: sum.AppID }));
        U.plain(t('insp.ppExp',   { v: sum.Expiration ? sum.Expiration.toISOString().split('T')[0] : t('val.unknown') }));
      } catch (e) {
        U.warn(t('insp.ppParseFailed', { msg: e.message }));
      }
    } else {
      U.warn(t('insp.ppMissing'));
    }

    return appPath;
  }

  global.Inspector = { findAppPath, showIpaContents };
})(window);
