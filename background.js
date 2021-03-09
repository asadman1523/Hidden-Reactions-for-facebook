var option = 1;
chrome.storage.sync.get({
	option: 1,
}, function(items) {
	option = items.option
});
document.addEventListener("DOMNodeInserted", function (e) {
	removeReaction();
}, false);

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