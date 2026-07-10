# Hide reactions for Facebook

這是一個 Manifest V3 Chrome 擴充功能，用來隱藏桌面版 Facebook 的反應圖示。它會處理貼文、留言以及巢狀回覆，但不會隱藏總反應數、不會修改留言文字中的 emoji，也不會移除「讚」或「回覆」等操作按鈕。

介面會依 Chrome 語言自動切換，涵蓋 Chrome Web Store 官方支援的全部語系；英國、美國與澳洲英文會依 Chrome 的區域回退規則共用英文翻譯。Chrome 尚未提供的語系會回退英文，因此所有發佈區域皆可使用。

彈窗右上角提供 GitHub 星號連結，方便使用者前往專案頁支持此專案。

## 顯示模式

- **只顯示讚（預設）**：只保留「讚」圖示，隱藏其他反應圖示。
- **只顯示最熱門反應**：保留第一個反應圖示，隱藏其他反應圖示。
- **隱藏所有反應**：隱藏所有反應圖示。
- **停用**：還原擴充功能加上的隱藏效果。

四種模式都會保留 Facebook 顯示的總反應數。新安裝或尚未儲存模式時會使用「只顯示讚」；既有使用者已儲存的模式會保留。設定儲存在 `chrome.storage.sync`，儲存後會立即套用，不需要重新整理 Facebook。

點開擴充功能時，會顯示自開始統計以來累計隱藏的表情圖示，並分別列出讚、大心、加油、哈、哇、嗚與怒。統計的是被隱藏的圖示數，不是按表情的人數；同一個 Facebook 圖示在同一頁面生命週期內反覆掃描或切換模式不會重複累加，重新載入後建立的新圖示以及動態載入的新內容則會在被隱藏時加入累計。

累計資料會先排入 `chrome.storage.local` 的本機待寫佇列，再以每台裝置分片儲存在 `chrome.storage.sync`，彈窗會合併所有裝置的數字。登入 Chrome、開啟 Chrome 同步且各裝置安裝的是相同擴充功能 ID 時，資料會隨 Google 帳號同步；資料不會寫入 Gmail 信箱。Chrome 線上應用程式商店版本會使用相同 ID，但各自載入的未封裝版本可能因 ID 不同而無法互相同步。停用、切換顯示模式或更新版本不會清除既有累計；目前介面未提供重設功能，也不應把解除安裝視為可靠的統計重設方式。

## 安裝未封裝版本

1. 開啟 `chrome://extensions/`。
2. 啟用「開發人員模式」。
3. 選擇「載入未封裝項目」。
4. 選取這個專案資料夾。

目前支援 `https://www.facebook.com/` 的桌面版首頁動態與貼文頁，不支援行動版 Facebook、Messenger 網站或其他 Facebook 子網域。

## 維護說明

Facebook 沒有提供穩定的公開 DOM API。本專案只會處理具有明確反應摘要語意、合理圖示數量與安全結構的元素；遇到無法辨識的結構時會保留原畫面，避免誤隱藏一般工具列或留言內容。Facebook 改版後，相關辨識條件仍可能需要更新。

## GitHub Release

發布 GitHub Release 時使用 `v<manifest version>` 或 `<manifest version>` 標籤，例如 `v9.5.0`。`.github/workflows/release.yml` 會驗證標籤與 `manifest.json` 版號一致，只封裝外掛執行所需檔案，並將 `hidden-reactions-for-facebook-v<version>.zip` 附加到該 Release。

核心檔案：

- `content.js`：辨識及處理貼文、留言與回覆的反應統計。
- `content.css`：可逆的隱藏樣式。
- `stats-worker.js`：保存待寫佇列，並合併跨頁面、跨裝置的累計統計。
- `popup.html`、`popup.js`、`popup.css`：設定介面。
- `_locales/*/messages.json`：Manifest、彈窗、狀態訊息與反應名稱翻譯。

## License

Copyright (c) 2018 Jack Wu <dm3352andy@gmail.com>

Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this project except in compliance with the License. You may obtain a copy at
[apache.org/licenses/LICENSE-2.0](https://www.apache.org/licenses/LICENSE-2.0).

Unless required by applicable law or agreed to in writing, software distributed
under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
CONDITIONS OF ANY KIND, either express or implied. See the License for the
specific language governing permissions and limitations under the License.
