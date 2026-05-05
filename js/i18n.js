/* 多言語化 (i18n)
 *  - ja / en の辞書を内蔵
 *  - I18N.t(key, params) でキー参照、{name} 形式で値を埋め込み
 *  - data-i18n="key"           : 要素テキストを翻訳
 *  - data-i18n-attr="attr:key" : 任意属性 (placeholder, title, content など) を翻訳。複数は "," 区切り
 *  - data-lang-set="ja|en"     : クリックで言語切替
 */
(function (global) {
  'use strict';

  const dict = {
    ja: {
      // ── ヘッダ / 言語切替 ────────────────────────────
      'ui.langLabel'        : '言語',
      'ui.lang.ja'          : '日本語',
      'ui.lang.en'          : 'English',

      // ── meta / header ───────────────────────────────
      'meta.title'          : 'iOS App Signer',
      'meta.description'    : 'ブラウザ完結で動く iOS IPA 再署名ツール。証明書 (.p12) と Provisioning Profile を使って IPA を(再)署名します。',
      'header.title'        : 'iOS App Signer',
      'header.badge'        : 'Web',
      'header.lead'         : 'ブラウザ内で完結する iOS IPA の再署名ツールです。アップロードしたファイルはサーバーへ送信されず、すべての処理は端末上で実行されます。',

      // ── Step 1 ─────────────────────────────────────
      'step1.heading'       : '1. ファイルを選択',
      'step1.ipa.title'     : 'IPA ファイル',
      'step1.ipa.hint'      : '.ipa 形式',
      'step1.p12.title'     : '証明書 (.p12 / .pfx)',
      'step1.p12.hint'      : '秘密鍵を含む PKCS#12',
      'step1.pp.title'      : 'Provisioning Profile',
      'step1.pp.hint'       : '.mobileprovision',
      'step1.passLabel'     : '証明書パスワード',
      'step1.passPlaceholder': '(なしの場合は空)',
      'step1.notSelected'   : '未選択',

      // ── Step 2 ─────────────────────────────────────
      'step2.heading'       : '2. 操作を選択',
      'step2.optShow'       : 'IPA 内容を表示する (署名前確認)',
      'step2.optPP'         : 'Provisioning Profile を差し替える',
      'step2.optBid'        : 'Bundle ID を変更する',
      'step2.optEnt'        : 'Entitlements を自動抽出して適用する',
      'step2.optSign'       : '再署名する',
      'step2.newBidLabel'   : '新しい Bundle ID',
      'step2.newBidPlaceholder': 'com.example.app',

      // ── Step 3 ─────────────────────────────────────
      'step3.heading'       : '3. 実行',
      'step3.inspect'       : '内容を確認',
      'step3.run'           : '処理を実行',
      'step3.download'      : '署名済み IPA をダウンロード',
      'step3.preparing'     : '準備中...',

      // ── ログ / 注意事項 / フッタ ───────────────────
      'log.heading'         : 'ログ',
      'log.clear'           : 'ログをクリア',
      'notes.heading'       : '使い方とご注意',
      'notes.item1'         : 'このツールはブラウザ内のみで動作します。アップロードしたファイル・証明書・パスワードは外部サーバーへ送信されません。',
      'notes.item2'         : '有効な Apple Developer 証明書 (Development / Distribution) と一致する Provisioning Profile が必要です。',
      'notes.item3'         : '再署名した IPA を実機にインストールするには、デバイスの UDID が Provisioning Profile に登録されている必要があります。',
      'notes.item4'         : 'FairPlay DRM で保護された App Store アプリ (暗号化された Mach-O) は再署名できません。',
      'notes.item5'         : '大きな IPA ではメモリ消費とブラウザの応答遅延に注意してください。デスクトップ Chrome / Edge での実行を推奨します。',
      'footer.source'       : 'ソース',
      'footer.middle'       : 'クライアントサイドのみで動作 · No data leaves your browser',

      // ── 値の表示用 ──────────────────────────────────
      'val.none'            : '(なし)',
      'val.unknown'         : '(不明)',

      // ── 進捗メッセージ ──────────────────────────────
      'prog.readingIpa'     : 'IPA を読み込み中...',
      'prog.unzipping'      : 'IPA を解凍中...',
      'prog.parsing'        : '内容を解析中...',
      'prog.done'           : '完了',
      'prog.readingFiles'   : 'ファイル読み込み中...',
      'prog.readingCert'    : '証明書を読み込み中...',
      'prog.changingBid'    : 'Bundle ID 変更中...',
      'prog.signing'        : '再署名中...',
      'prog.replacingPP'    : 'Provisioning Profile 差し替え中...',
      'prog.repackaging'    : 'IPA を再パッケージ中...',
      'prog.repackagingPct' : '再パッケージ中... {pct}%',

      // ── エラー / 警告 / 情報メッセージ ──────────────
      'err.selectIpa'       : 'IPA ファイルを選択してください',
      'err.selectPP'        : 'Provisioning Profile (.mobileprovision) を選択してください',
      'err.selectP12'       : '証明書 (.p12) を選択してください',
      'err.enterNewBid'     : '新しい Bundle ID を入力してください',
      'err.inspectFailed'   : '内容確認に失敗: {msg}',
      'err.processFailed'   : '処理中にエラー: {msg}',
      'err.appNotFound'     : 'Payload 内に .app が見つかりません',
      'err.ppParseFailed'   : 'Provisioning Profile の解析に失敗: {msg}',
      'err.p12LoadFailed'   : '証明書の読み込みに失敗: {msg} (パスワードを確認してください)',
      'err.infoPlistMissing': '{path}/Info.plist が見つかりません',
      'err.cfBundleExeMissing': 'CFBundleExecutable が Info.plist にありません',

      'info.app'            : 'アプリ: {path}',
      'info.ppName'         : 'PP 名     : {name}',
      'info.team'           : 'Team      : {team}',
      'info.appId'          : 'App ID    : {id}',
      'info.expiration'     : '有効期限  : {date}',
      'info.signId'         : '署名 ID    : {name}',
      'info.complete'       : '処理が完了しました。「署名済み IPA をダウンロード」からダウンロードしてください。',
      'info.ppReplaced'     : 'Provisioning Profile を差し替えました',

      // Inspector
      'insp.heading'        : 'IPA 内容確認',
      'insp.appShort'       : 'アプリ: {name}',
      'insp.fileList'       : 'ファイル一覧 (上位 50 件):',
      'insp.moreFiles'      : '  ... 他 {n} ファイル',
      'insp.infoPlistTitle' : 'Info.plist 主要項目:',
      'insp.infoPlistFailed': 'Info.plist の解析に失敗: {msg}',
      'insp.infoPlistMissing': 'Info.plist が見つかりません',
      'insp.ppTitle'        : 'Provisioning Profile:',
      'insp.ppName'         : '  Name           : {v}',
      'insp.ppTeam'         : '  Team           : {v}',
      'insp.ppAppId'        : '  App ID         : {v}',
      'insp.ppExp'          : '  有効期限       : {v}',
      'insp.ppParseFailed'  : 'PP の解析に失敗: {msg}',
      'insp.ppMissing'      : 'embedded.mobileprovision が見つかりません',

      // Bundle ID
      'bid.heading'         : 'Bundle ID 変更',
      'bid.cfBidMissing'    : 'CFBundleIdentifier が見つかりません',
      'bid.before'          : '変更前: {id}',
      'bid.after'           : '変更後: {id}',
      'bid.extChanged'      : '  Extension: {old} → {new}',
      'bid.extSkipped'      : '  Extension の Bundle ID が一致しないためスキップ: {id}',
      'bid.success'         : 'Bundle ID を変更しました',

      // Signer
      'sign.bundleHeader'   : '{kind} 再署名: {name}',
      'sign.kindAppExtension': 'App Extension',
      'sign.kindApp'        : 'App',
      'sign.kindAppShort'   : 'アプリ',
      'sign.lcAdded'        : 'LC_CODE_SIGNATURE が無いため新規追加します',
      'sign.fatSliceFailed' : 'FAT スライス (cputype={cputype}) の署名に失敗: {msg}。スキップします。',
      'sign.crBuilding'     : 'CodeResources 生成中...',
      'sign.bundleSuccess'  : '{kind} を再署名しました: {name}',
      'sign.notMachO'       : 'Mach-O ではないためスキップ: {path}',
      'sign.binary'         : 'バイナリ署名: {path}',
    },

    en: {
      // ── Header / language switcher ───────────────────
      'ui.langLabel'        : 'Language',
      'ui.lang.ja'          : '日本語',
      'ui.lang.en'          : 'English',

      // ── meta / header ───────────────────────────────
      'meta.title'          : 'iOS App Signer',
      'meta.description'    : 'A browser-only iOS IPA re-signing tool. (Re-)signs IPAs using a certificate (.p12) and a provisioning profile.',
      'header.title'        : 'iOS App Signer',
      'header.badge'        : 'Web',
      'header.lead'         : 'A browser-only iOS IPA re-signing tool. Uploaded files are never sent to a server — all processing happens locally on your device.',

      // ── Step 1 ─────────────────────────────────────
      'step1.heading'       : '1. Select Files',
      'step1.ipa.title'     : 'IPA File',
      'step1.ipa.hint'      : '.ipa format',
      'step1.p12.title'     : 'Certificate (.p12 / .pfx)',
      'step1.p12.hint'      : 'PKCS#12 with private key',
      'step1.pp.title'      : 'Provisioning Profile',
      'step1.pp.hint'       : '.mobileprovision',
      'step1.passLabel'     : 'Certificate Password',
      'step1.passPlaceholder': '(leave empty if none)',
      'step1.notSelected'   : 'Not selected',

      // ── Step 2 ─────────────────────────────────────
      'step2.heading'       : '2. Choose Operations',
      'step2.optShow'       : 'Show IPA contents (preview before signing)',
      'step2.optPP'         : 'Replace Provisioning Profile',
      'step2.optBid'        : 'Change Bundle ID',
      'step2.optEnt'        : 'Auto-extract and apply Entitlements',
      'step2.optSign'       : 'Re-sign',
      'step2.newBidLabel'   : 'New Bundle ID',
      'step2.newBidPlaceholder': 'com.example.app',

      // ── Step 3 ─────────────────────────────────────
      'step3.heading'       : '3. Execute',
      'step3.inspect'       : 'Inspect Contents',
      'step3.run'           : 'Run',
      'step3.download'      : 'Download Signed IPA',
      'step3.preparing'     : 'Preparing...',

      // ── Log / notes / footer ────────────────────────
      'log.heading'         : 'Log',
      'log.clear'           : 'Clear log',
      'notes.heading'       : 'Usage & Notes',
      'notes.item1'         : 'This tool runs entirely inside your browser. Uploaded files, certificates, and passwords are never sent to any external server.',
      'notes.item2'         : 'A valid Apple Developer certificate (Development / Distribution) and a matching Provisioning Profile are required.',
      'notes.item3'         : 'To install the re-signed IPA on a real device, the device UDID must be registered in the Provisioning Profile.',
      'notes.item4'         : 'App Store apps protected by FairPlay DRM (encrypted Mach-O binaries) cannot be re-signed.',
      'notes.item5'         : 'Watch out for memory usage and browser responsiveness with large IPAs. Desktop Chrome / Edge is recommended.',
      'footer.source'       : 'Source',
      'footer.middle'       : 'Runs entirely client-side · No data leaves your browser',

      // ── Display values ─────────────────────────────
      'val.none'            : '(none)',
      'val.unknown'         : '(unknown)',

      // ── Progress messages ──────────────────────────
      'prog.readingIpa'     : 'Reading IPA...',
      'prog.unzipping'      : 'Unzipping IPA...',
      'prog.parsing'        : 'Parsing contents...',
      'prog.done'           : 'Done',
      'prog.readingFiles'   : 'Reading files...',
      'prog.readingCert'    : 'Loading certificate...',
      'prog.changingBid'    : 'Changing Bundle ID...',
      'prog.signing'        : 'Re-signing...',
      'prog.replacingPP'    : 'Replacing Provisioning Profile...',
      'prog.repackaging'    : 'Repackaging IPA...',
      'prog.repackagingPct' : 'Repackaging... {pct}%',

      // ── Error / warning / info messages ────────────
      'err.selectIpa'       : 'Please select an IPA file',
      'err.selectPP'        : 'Please select a Provisioning Profile (.mobileprovision)',
      'err.selectP12'       : 'Please select a certificate (.p12)',
      'err.enterNewBid'     : 'Please enter a new Bundle ID',
      'err.inspectFailed'   : 'Inspection failed: {msg}',
      'err.processFailed'   : 'Error during processing: {msg}',
      'err.appNotFound'     : 'No .app found inside Payload',
      'err.ppParseFailed'   : 'Failed to parse Provisioning Profile: {msg}',
      'err.p12LoadFailed'   : 'Failed to load certificate: {msg} (please check the password)',
      'err.infoPlistMissing': '{path}/Info.plist not found',
      'err.cfBundleExeMissing': 'CFBundleExecutable is missing in Info.plist',

      'info.app'            : 'App: {path}',
      'info.ppName'         : 'PP Name   : {name}',
      'info.team'           : 'Team      : {team}',
      'info.appId'          : 'App ID    : {id}',
      'info.expiration'     : 'Expires   : {date}',
      'info.signId'         : 'Signing ID : {name}',
      'info.complete'       : 'Done. Click "Download Signed IPA" to save the file.',
      'info.ppReplaced'     : 'Replaced the Provisioning Profile',

      // Inspector
      'insp.heading'        : 'IPA Inspection',
      'insp.appShort'       : 'App: {name}',
      'insp.fileList'       : 'File list (top 50):',
      'insp.moreFiles'      : '  ... and {n} more files',
      'insp.infoPlistTitle' : 'Info.plist key fields:',
      'insp.infoPlistFailed': 'Failed to parse Info.plist: {msg}',
      'insp.infoPlistMissing': 'Info.plist not found',
      'insp.ppTitle'        : 'Provisioning Profile:',
      'insp.ppName'         : '  Name           : {v}',
      'insp.ppTeam'         : '  Team           : {v}',
      'insp.ppAppId'        : '  App ID         : {v}',
      'insp.ppExp'          : '  Expires        : {v}',
      'insp.ppParseFailed'  : 'Failed to parse PP: {msg}',
      'insp.ppMissing'      : 'embedded.mobileprovision not found',

      // Bundle ID
      'bid.heading'         : 'Change Bundle ID',
      'bid.cfBidMissing'    : 'CFBundleIdentifier not found',
      'bid.before'          : 'Before: {id}',
      'bid.after'           : 'After : {id}',
      'bid.extChanged'      : '  Extension: {old} → {new}',
      'bid.extSkipped'      : '  Extension Bundle ID does not match, skipping: {id}',
      'bid.success'         : 'Bundle ID changed',

      // Signer
      'sign.bundleHeader'   : 'Re-signing {kind}: {name}',
      'sign.kindAppExtension': 'App Extension',
      'sign.kindApp'        : 'App',
      'sign.kindAppShort'   : 'App',
      'sign.lcAdded'        : 'LC_CODE_SIGNATURE is missing, adding a new one',
      'sign.fatSliceFailed' : 'Failed to sign FAT slice (cputype={cputype}): {msg}. Skipping.',
      'sign.crBuilding'     : 'Building CodeResources...',
      'sign.bundleSuccess'  : 'Re-signed {kind}: {name}',
      'sign.notMachO'       : 'Not a Mach-O, skipping: {path}',
      'sign.binary'         : 'Signing binary: {path}',
    },
  };

  let currentLocale = 'ja';
  const listeners = new Set();

  function detectInitialLocale() {
    try {
      const saved = localStorage.getItem('lang');
      if (saved && dict[saved]) return saved;
    } catch (_) { /* ignore */ }
    const nav = (global.navigator && global.navigator.language || 'ja').toLowerCase();
    if (nav.startsWith('en')) return 'en';
    return 'ja';
  }

  function getLocale() { return currentLocale; }

  function format(s, params) {
    if (!params) return s;
    return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] != null ? String(params[k]) : ''));
  }

  function t(key, params) {
    const table = dict[currentLocale] || dict.ja;
    let s = table[key];
    if (s == null) s = (dict.ja && dict.ja[key]);
    if (s == null) s = key;
    return format(s, params);
  }

  function apply(root) {
    const r = root || document;
    r.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    r.querySelectorAll('[data-i18n-attr]').forEach(el => {
      const spec = el.getAttribute('data-i18n-attr');
      spec.split(',').forEach(pair => {
        const idx = pair.indexOf(':');
        if (idx <= 0) return;
        const a = pair.slice(0, idx).trim();
        const k = pair.slice(idx + 1).trim();
        if (a && k) el.setAttribute(a, t(k));
      });
    });
  }

  function setLocale(loc) {
    if (!dict[loc] || loc === currentLocale) return;
    currentLocale = loc;
    try { localStorage.setItem('lang', loc); } catch (_) { /* ignore */ }
    if (document.documentElement) document.documentElement.setAttribute('lang', loc);
    apply();
    updateLangButtons();
    listeners.forEach(fn => { try { fn(loc); } catch (_) { /* ignore */ } });
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function updateLangButtons() {
    document.querySelectorAll('[data-lang-set]').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-lang-set') === currentLocale);
      el.setAttribute('aria-pressed', el.getAttribute('data-lang-set') === currentLocale ? 'true' : 'false');
    });
  }

  function init() {
    if (document.documentElement) document.documentElement.setAttribute('lang', currentLocale);
    apply();
    document.querySelectorAll('[data-lang-set]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        setLocale(el.getAttribute('data-lang-set'));
      });
    });
    updateLangButtons();
  }

  currentLocale = detectInitialLocale();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.I18N = { t, setLocale, getLocale, apply, onChange };
})(window);
