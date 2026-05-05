/* PKCS#12 解析と CMS (PKCS#7 SignedData) 構築
 *  forge ライブラリを使用する。
 */
(function (global) {
  'use strict';
  const U = global.U;

  /**
   * PKCS#12 (.p12 / .pfx) を読み込んで秘密鍵 + 証明書チェインを返す
   * @returns {{ privateKey, leafCert, certs: forge.pki.Certificate[] }}
   */
  function readPkcs12(bytes, password) {
    const der = U.bytesToLatin1(bytes);
    const asn1 = forge.asn1.fromDer(der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, /* strict */ false, password || '');

    // 証明書
    let certs = [];
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
    if (certBags[forge.pki.oids.certBag]) {
      certs = certBags[forge.pki.oids.certBag].map(b => b.cert);
    }
    if (!certs.length) throw new Error('p12 内に証明書が見つかりません');

    // 秘密鍵
    let key = null;
    const keyBagsShr = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const keyBagsPlain = p12.getBags({ bagType: forge.pki.oids.keyBag });
    if (keyBagsShr[forge.pki.oids.pkcs8ShroudedKeyBag] && keyBagsShr[forge.pki.oids.pkcs8ShroudedKeyBag].length) {
      key = keyBagsShr[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;
    } else if (keyBagsPlain[forge.pki.oids.keyBag] && keyBagsPlain[forge.pki.oids.keyBag].length) {
      key = keyBagsPlain[forge.pki.oids.keyBag][0].key;
    }
    if (!key) throw new Error('p12 内に秘密鍵が見つかりません');

    // リーフ (秘密鍵に対応する証明書) を特定
    const leaf = pickLeafCert(certs, key);
    return { privateKey: key, leafCert: leaf, certs };
  }

  // 公開鍵が一致するものをリーフ候補にする
  function pickLeafCert(certs, key) {
    for (const c of certs) {
      try {
        const certPubMod = c.publicKey.n.toString(16);
        const keyMod     = key.n.toString(16);
        if (certPubMod === keyMod) return c;
      } catch (e) { /* skip */ }
    }
    return certs[0];
  }

  /**
   * CodeDirectory バイト列に対する CMS SignedData (detached) を生成
   *   - eContent は省略 (detached)
   *   - signedAttrs: contentType (id-data), signingTime, messageDigest
   *   - 署名アルゴリズム: SHA-256 + RSA
   *   - certificates: 提供された全証明書を含める
   * @returns {Uint8Array} CMS DER
   */
  function buildCMS(codeDirectoryBytes, signer) {
    const p7 = forge.pkcs7.createSignedData();

    // content には CD バイトをセットしておくと forge が messageDigest を自動計算してくれる
    p7.content = forge.util.createBuffer(U.bytesToLatin1(codeDirectoryBytes), 'binary');

    // 証明書チェインを全て追加
    for (const c of signer.certs) p7.addCertificate(c);

    p7.addSigner({
      key: signer.privateKey,
      certificate: signer.leafCert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.signingTime, value: new Date() },
        { type: forge.pki.oids.messageDigest /* 自動 */ },
      ],
    });

    p7.sign({ detached: true });

    // 完成した PKCS#7 を DER に
    const asn1 = p7.toAsn1();
    const der  = forge.asn1.toDer(asn1).getBytes();
    return U.latin1ToBytes(der);
  }

  global.CMS = { readPkcs12, buildCMS };
})(window);
