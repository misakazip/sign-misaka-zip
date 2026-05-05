/* ── アプリ全体のコントローラ ── */
(function () {
  'use strict';
  const U = window.U;

  // ── 状態 ─────────────────────────────────────────────────
  const state = {
    ipaFile: null,
    p12File: null,
    ppFile:  null,
    lastBlobUrl: null,
  };

  // ── DOM ─────────────────────────────────────────────────
  const ipaInput  = document.getElementById('ipa-input');
  const p12Input  = document.getElementById('p12-input');
  const ppInput   = document.getElementById('pp-input');
  const passInput = document.getElementById('p12-pass');

  const optShow = document.getElementById('opt-show');
  const optPP   = document.getElementById('opt-pp');
  const optBid  = document.getElementById('opt-bid');
  const optEnt  = document.getElementById('opt-ent');
  const optSign = document.getElementById('opt-sign');

  const newBidInput = document.getElementById('new-bid');
  const rowBid      = document.getElementById('row-bid');

  const btnInspect = document.getElementById('btn-inspect');
  const btnRun     = document.getElementById('btn-run');
  const btnDl      = document.getElementById('btn-download');
  const btnClear   = document.getElementById('btn-clear-log');

  // ── ファイル選択ハンドラ ─────────────────────────────────
  U.onFile(ipaInput, f => state.ipaFile = f);
  U.onFile(p12Input, f => state.p12File = f);
  U.onFile(ppInput,  f => state.ppFile  = f);

  optBid.addEventListener('change', () => { rowBid.hidden = !optBid.checked; });
  btnClear.addEventListener('click', () => U.clearLog());

  // ── 内容確認 ────────────────────────────────────────────
  btnInspect.addEventListener('click', async () => {
    if (!state.ipaFile) { U.error('IPA ファイルを選択してください'); return; }
    try {
      U.setProgress(0, 'IPA を読み込み中...');
      const bytes = await U.readFileAsBytes(state.ipaFile);
      U.setProgress(40, 'IPA を解凍中...');
      const zip = await JSZip.loadAsync(bytes);
      U.setProgress(80, '内容を解析中...');
      await window.Inspector.showIpaContents(zip);
      U.setProgress(100, '完了');
      setTimeout(() => U.hideProgress(), 600);
    } catch (e) {
      U.error('内容確認に失敗: ' + e.message);
      console.error(e);
      U.hideProgress();
    }
  });

  // ── 署名処理 ────────────────────────────────────────────
  btnRun.addEventListener('click', async () => {
    btnRun.disabled = true;
    btnDl.hidden = true;
    btnDl.removeAttribute('href');
    if (state.lastBlobUrl) {
      URL.revokeObjectURL(state.lastBlobUrl);
      state.lastBlobUrl = null;
    }
    try {
      await runPipeline();
    } catch (e) {
      U.error('処理中にエラー: ' + e.message);
      console.error(e);
    } finally {
      btnRun.disabled = false;
    }
  });

  async function runPipeline() {
    if (!state.ipaFile) { U.error('IPA ファイルを選択してください'); return; }

    const willSign = optSign.checked;
    const willReplacePP = optPP.checked;
    const willChangeBid = optBid.checked;
    const willEnts      = optEnt.checked;
    const willShow      = optShow.checked;

    if (willChangeBid && !newBidInput.value.trim()) {
      U.error('新しい Bundle ID を入力してください'); return;
    }
    if ((willReplacePP || willEnts) && !state.ppFile) {
      U.error('Provisioning Profile (.mobileprovision) を選択してください'); return;
    }
    if (willSign && !state.p12File) {
      U.error('証明書 (.p12) を選択してください'); return;
    }

    U.clearLog();

    // ── ファイル読込 ──────────────────────────────
    U.setProgress(0, 'ファイル読み込み中...');
    const ipaBytes = await U.readFileAsBytes(state.ipaFile);
    const p12Bytes = state.p12File ? await U.readFileAsBytes(state.p12File) : null;
    const ppBytes  = state.ppFile  ? await U.readFileAsBytes(state.ppFile)  : null;

    // ── IPA 展開 ──────────────────────────────────
    U.setProgress(8, 'IPA を解凍中...');
    const zip = await JSZip.loadAsync(ipaBytes);

    // アプリパスを特定
    const appPath = window.Inspector.findAppPath(zip);
    if (!appPath) throw new Error('Payload 内に .app が見つかりません');
    U.info('アプリ: ' + appPath);

    // ── 内容確認 ──────────────────────────────────
    if (willShow) {
      await window.Inspector.showIpaContents(zip);
    }

    // ── PP 解析 ───────────────────────────────────
    let ppData = null;
    if (ppBytes) {
      try {
        ppData = window.PP.parseProvisioningProfile(ppBytes);
        const sum = window.PP.summary(ppData);
        U.info('PP 名     : ' + sum.Name);
        U.info('Team      : ' + sum.TeamName);
        U.info('App ID    : ' + sum.AppID);
        if (sum.Expiration) U.info('有効期限  : ' + sum.Expiration.toISOString().split('T')[0]);
      } catch (e) {
        throw new Error('Provisioning Profile の解析に失敗: ' + e.message);
      }
    }

    // ── PKCS#12 解析 ───────────────────────────────
    let signer = null;
    if (willSign) {
      U.setProgress(18, '証明書を読み込み中...');
      try {
        signer = window.CMS.readPkcs12(p12Bytes, passInput.value || '');
        U.info('署名 ID    : ' + (signer.leafCert.subject.getField('CN') || {}).value);
      } catch (e) {
        throw new Error('証明書の読み込みに失敗: ' + e.message + ' (パスワードを確認してください)');
      }
    }

    // ── Bundle ID 変更 ─────────────────────────────
    if (willChangeBid) {
      U.setProgress(28, 'Bundle ID 変更中...');
      await window.BundleID.changeBundleId(zip, appPath, newBidInput.value.trim());
    }

    // ── 署名 (PP 差し替え + Entitlements + バイナリ署名) ─
    if (willSign) {
      U.setProgress(40, '再署名中...');
      await window.Signer.signBundle(zip, appPath, signer, ppData, {
        replacePP: willReplacePP,
        ppBytes: willReplacePP ? ppBytes : null,
        applyEntitlements: willEnts,
      });
    } else {
      // 署名しないがプロファイル差し替えだけは行う場合
      if (willReplacePP && ppBytes) {
        U.setProgress(45, 'Provisioning Profile 差し替え中...');
        zip.file(appPath + '/embedded.mobileprovision', ppBytes);
        U.success('Provisioning Profile を差し替えました');
      }
    }

    // ── 再 zip 化 ─────────────────────────────────
    U.setProgress(80, 'IPA を再パッケージ中...');
    const outBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    }, (meta) => {
      const p = 80 + Math.min(18, (meta.percent / 100) * 18);
      U.setProgress(p, '再パッケージ中... ' + meta.percent.toFixed(0) + '%');
    });

    // ── ダウンロードリンク作成 ───────────────────
    const url = URL.createObjectURL(outBlob);
    state.lastBlobUrl = url;
    const baseName = state.ipaFile.name.replace(/\.ipa$/i, '');
    btnDl.href = url;
    btnDl.download = U.sanitizeFilename(baseName + '_signed.ipa');
    btnDl.hidden = false;

    U.setProgress(100, '完了');
    U.success('処理が完了しました。「署名済み IPA をダウンロード」からダウンロードしてください。');
    setTimeout(() => U.hideProgress(), 1200);
  }
})();
