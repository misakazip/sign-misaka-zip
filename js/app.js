/* ── アプリ全体のコントローラ ── */
(function () {
  'use strict';
  const U = window.U;
  const t = (k, p) => (window.I18N ? window.I18N.t(k, p) : k);

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
    if (!state.ipaFile) { U.error(t('err.selectIpa')); return; }
    try {
      U.setProgress(0, t('prog.readingIpa'));
      const bytes = await U.readFileAsBytes(state.ipaFile);
      U.setProgress(40, t('prog.unzipping'));
      const zip = await JSZip.loadAsync(bytes);
      U.setProgress(80, t('prog.parsing'));
      await window.Inspector.showIpaContents(zip);
      U.setProgress(100, t('prog.done'));
      setTimeout(() => U.hideProgress(), 600);
    } catch (e) {
      U.error(t('err.inspectFailed', { msg: e.message }));
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
      U.error(t('err.processFailed', { msg: e.message }));
      console.error(e);
    } finally {
      btnRun.disabled = false;
    }
  });

  async function runPipeline() {
    if (!state.ipaFile) { U.error(t('err.selectIpa')); return; }

    const willSign = optSign.checked;
    const willReplacePP = optPP.checked;
    const willChangeBid = optBid.checked;
    const willEnts      = optEnt.checked;
    const willShow      = optShow.checked;

    if (willChangeBid && !newBidInput.value.trim()) {
      U.error(t('err.enterNewBid')); return;
    }
    if ((willReplacePP || willEnts) && !state.ppFile) {
      U.error(t('err.selectPP')); return;
    }
    if (willSign && !state.p12File) {
      U.error(t('err.selectP12')); return;
    }

    U.clearLog();

    // ── ファイル読込 ──────────────────────────────
    U.setProgress(0, t('prog.readingFiles'));
    const ipaBytes = await U.readFileAsBytes(state.ipaFile);
    const p12Bytes = state.p12File ? await U.readFileAsBytes(state.p12File) : null;
    const ppBytes  = state.ppFile  ? await U.readFileAsBytes(state.ppFile)  : null;

    // ── IPA 展開 ──────────────────────────────────
    U.setProgress(8, t('prog.unzipping'));
    const zip = await JSZip.loadAsync(ipaBytes);

    // アプリパスを特定
    const appPath = window.Inspector.findAppPath(zip);
    if (!appPath) throw new Error(t('err.appNotFound'));
    U.info(t('info.app', { path: appPath }));

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
        U.info(t('info.ppName', { name: sum.Name }));
        U.info(t('info.team',   { team: sum.TeamName }));
        U.info(t('info.appId',  { id:   sum.AppID }));
        if (sum.Expiration) {
          U.info(t('info.expiration', { date: sum.Expiration.toISOString().split('T')[0] }));
        }
      } catch (e) {
        throw new Error(t('err.ppParseFailed', { msg: e.message }));
      }
    }

    // ── PKCS#12 解析 ───────────────────────────────
    let signer = null;
    if (willSign) {
      U.setProgress(18, t('prog.readingCert'));
      try {
        signer = window.CMS.readPkcs12(p12Bytes, passInput.value || '');
        U.info(t('info.signId', { name: (signer.leafCert.subject.getField('CN') || {}).value }));
      } catch (e) {
        throw new Error(t('err.p12LoadFailed', { msg: e.message }));
      }
    }

    // ── Bundle ID 変更 ─────────────────────────────
    if (willChangeBid) {
      U.setProgress(28, t('prog.changingBid'));
      await window.BundleID.changeBundleId(zip, appPath, newBidInput.value.trim());
    }

    // ── 署名 (PP 差し替え + Entitlements + バイナリ署名) ─
    if (willSign) {
      U.setProgress(40, t('prog.signing'));
      await window.Signer.signBundle(zip, appPath, signer, ppData, {
        replacePP: willReplacePP,
        ppBytes: willReplacePP ? ppBytes : null,
        applyEntitlements: willEnts,
      });
    } else {
      // 署名しないがプロファイル差し替えだけは行う場合
      if (willReplacePP && ppBytes) {
        U.setProgress(45, t('prog.replacingPP'));
        zip.file(appPath + '/embedded.mobileprovision', ppBytes);
        U.success(t('info.ppReplaced'));
      }
    }

    // ── 再 zip 化 ─────────────────────────────────
    U.setProgress(80, t('prog.repackaging'));
    const outBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    }, (meta) => {
      const p = 80 + Math.min(18, (meta.percent / 100) * 18);
      U.setProgress(p, t('prog.repackagingPct', { pct: meta.percent.toFixed(0) }));
    });

    // ── ダウンロードリンク作成 ───────────────────
    const url = URL.createObjectURL(outBlob);
    state.lastBlobUrl = url;
    const baseName = state.ipaFile.name.replace(/\.ipa$/i, '');
    btnDl.href = url;
    btnDl.download = U.sanitizeFilename(baseName + '_signed.ipa');
    btnDl.hidden = false;

    U.setProgress(100, t('prog.done'));
    U.success(t('info.complete'));
    setTimeout(() => U.hideProgress(), 1200);
  }
})();
