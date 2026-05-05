/* 機能 3: Bundle ID 変更
 *  IPA 内の Info.plist を書き換える。
 *  実体は zip エントリ単位の差し替えなので、 ipa.js 側で取得した
 *  「アプリパス」と JSZip インスタンスを引数に取る。
 */
(function (global) {
  'use strict';
  const U = global.U;
  const Plist = global.Plist;

  /**
   * @param {JSZip} zip       - 作業中の IPA zip
   * @param {string} appPath  - "Payload/Foo.app"
   * @param {string} newBundleId
   */
  async function changeBundleId(zip, appPath, newBundleId) {
    const t = (k, p) => (window.I18N ? window.I18N.t(k, p) : k);
    U.header(t('bid.heading'));

    const mainPlistPath = appPath + '/Info.plist';
    const mainBytes = await zip.file(mainPlistPath).async('uint8array');
    const mainPlist = Plist.parse(mainBytes);
    const oldBundleId = mainPlist.CFBundleIdentifier;
    if (!oldBundleId) {
      U.warn(t('bid.cfBidMissing'));
      return;
    }
    U.info(t('bid.before', { id: oldBundleId }));
    U.info(t('bid.after',  { id: newBundleId }));
    mainPlist.CFBundleIdentifier = newBundleId;
    zip.file(mainPlistPath, Plist.build(mainPlist));

    // PlugIns/*.appex の Info.plist も更新
    const plugins = zip.folder(appPath + '/PlugIns');
    if (plugins) {
      const appexes = [];
      zip.forEach((relPath, entry) => {
        const m = relPath.match(new RegExp('^' + escapeRe(appPath) + '/PlugIns/([^/]+\\.appex)/Info\\.plist$'));
        if (m) appexes.push({ name: m[1], path: relPath });
      });
      for (const ex of appexes) {
        const exBytes = await zip.file(ex.path).async('uint8array');
        const exPlist = Plist.parse(exBytes);
        const exId = exPlist.CFBundleIdentifier || '';
        if (exId.startsWith(oldBundleId + '.')) {
          const newExId = newBundleId + exId.substring(oldBundleId.length);
          exPlist.CFBundleIdentifier = newExId;
          zip.file(ex.path, Plist.build(exPlist));
          U.info(t('bid.extChanged', { old: exId, new: newExId }));
        } else {
          U.warn(t('bid.extSkipped', { id: exId }));
        }
      }
    }
    U.success(t('bid.success'));
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  global.BundleID = { changeBundleId };
})(window);
