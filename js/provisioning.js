/* Provisioning Profile (.mobileprovision) パーサ
 *  CMS SignedData の中に XML plist が格納されている。
 */
(function (global) {
  'use strict';
  const U = global.U;

  /**
   * .mobileprovision を解析して plist (オブジェクト) を返す
   * @param {Uint8Array} bytes
   * @returns {Object}
   */
  function parseProvisioningProfile(bytes) {
    // ── 方法1: CMS DER を ASN.1 パース ─────────────────
    try {
      const der = U.bytesToLatin1(bytes);
      const asn1 = forge.asn1.fromDer(der, /* strict */ false);
      // ContentInfo ::= { contentType, [0] EXPLICIT content }
      // SignedData ::= { version, digestAlgs, encapContentInfo, ... }
      // encapContentInfo ::= { eContentType, [0] EXPLICIT eContent }
      // eContent は plist 本体 (OCTET STRING)
      const inner = findOctetString(asn1, 0);
      if (inner) {
        return global.Plist.parseXML(inner);
      }
    } catch (e) {
      // フォールバック
    }

    // ── 方法2: XML 直接抽出 (frgile fallback) ──────────
    const text = U.bytesToLatin1(bytes);
    const start = text.indexOf('<?xml');
    const end   = text.indexOf('</plist>');
    if (start < 0 || end < 0) {
      throw new Error('Provisioning Profile から plist を抽出できませんでした');
    }
    const xml = text.substring(start, end + '</plist>'.length);
    return global.Plist.parseXML(xml);
  }

  // ASN.1 ツリーを辿って最初に現れる OCTET STRING (生バイト) を返す
  function findOctetString(node, depth) {
    if (depth > 12) return null;
    if (!node) return null;
    if (node.type === forge.asn1.Type.OCTETSTRING && typeof node.value === 'string') {
      // plist っぽいか軽く確認
      if (node.value.indexOf('<?xml') >= 0 || node.value.indexOf('<plist') >= 0) {
        return node.value;
      }
    }
    if (Array.isArray(node.value)) {
      for (const child of node.value) {
        const r = findOctetString(child, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }

  /**
   * Provisioning Profile から application-identifier を取得 (Entitlements 内)
   */
  function flattenAppId(pp) {
    const ents = pp.Entitlements || {};
    if (ents['application-identifier']) {
      pp['application-identifier'] = ents['application-identifier'];
    }
    return pp;
  }

  /**
   * 要約を返す
   */
  function summary(pp) {
    flattenAppId(pp);
    return {
      Name:      pp.Name || '(不明)',
      TeamName:  pp.TeamName || '(不明)',
      AppID:     pp['application-identifier'] || '(不明)',
      TeamId:    (pp.TeamIdentifier && pp.TeamIdentifier[0]) || '',
      Expiration: pp.ExpirationDate ? new Date(pp.ExpirationDate) : null,
      Entitlements: pp.Entitlements || {},
      DeveloperCertificates: pp.DeveloperCertificates || [],
    };
  }

  global.PP = { parseProvisioningProfile, summary };
})(window);
