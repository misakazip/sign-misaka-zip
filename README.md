# iOS App Signer

ブラウザ内で完結する iOS IPA の再署名ツールです。アップロードしたファイルやパスワードは外部サーバーへ送信されず、すべての処理はクライアントサイド（端末上）で安全に実行されます。

## 主な機能

- **完全クライアントサイド動作**: サーバーへのデータ送信は一切ありません
- **IPAの内容確認**: 署名前の `Info.plist` やプロファイル情報をプレビュー
- **Provisioning Profile の差し替え**
- **Bundle ID の変更**
- **Entitlements の自動抽出・適用**
- **IPAの再署名**: `.p12` 証明書と `.mobileprovision` ファイルを使用
- **多言語対応**: 日本語 / 英語

## 使い方

1. 本ツール（`index.html`）をブラウザで開きます。
2. **「1. ファイルを選択」** セクションにて、以下のファイルを選択します。
   - 対象の **IPA ファイル**
   - **証明書 (.p12 / .pfx)** およびそのパスワード（設定されている場合）
   - **Provisioning Profile (.mobileprovision)**
3. **「2. 操作を選択」** セクションで、必要な操作（再署名、Bundle IDの変更など）にチェックを入れます。
4. **「3. 実行」** セクションの「処理を実行」ボタンをクリックします。
5. 処理完了後、「署名済み IPA をダウンロード」からファイルを保存します。

## 注意事項

- 有効な Apple Developer 証明書 (Development / Distribution) と、それに一致する Provisioning Profile が必要です。
- 再署名した IPA を実機にインストールするには、対象デバイスの UDID が Provisioning Profile に登録されている必要があります。
- FairPlay DRM で保護された App Store アプリ（暗号化された Mach-O）は再署名できません。
- 大きな IPA ファイルを処理する場合、ブラウザのメモリ消費や応答遅延が発生する可能性があります。デスクトップ版の Chrome または Edge での実行を推奨します。

## ライセンス

This project is licensed under [The Unlicense](LICENSE) (Public Domain).
