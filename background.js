var option = 1;
chrome.storage.sync.get({
	option: 1,
}, function(items) {
	option = items.option
});

// 配置觀察選項
const config = { childList: true, subtree: true };

// 創建一個MutationObserver實例，並傳入回調函數
const observer = new MutationObserver((mutationsList, observer) => {
    for (let mutation of mutationsList) {
		// console.log('QQAQ');
		// console.log(mutation.type);
        if (mutation.type === 'childList') {
            // console.log('A child node has been added or removed.');
            // 在這裡處理元素插入的邏輯
			removeReaction();
        }
    }
});

observer.observe(document, config);
// document.addEventListener("DOMNodeInserted", function (e) {
// 	console.log("insert")
// 	removeReaction();
// }, false);

/**
 * <option value="0">Hide all reactions</option>
 * <option value="1">Show the most popular reaction</option> 
 */
function removeReaction() {
	if (option == 2) {
		return;
	}
	var remainIcon = 1;
	if (option == 0) {
		remainIcon = 0;
	}
	var array = document.querySelectorAll("[role=toolbar]");
	for (var i = 0; i < array.length; i++) {
		while (array[i].firstElementChild.childElementCount > remainIcon) {
			array[i].firstElementChild.children[remainIcon].remove();
		}
	}
}