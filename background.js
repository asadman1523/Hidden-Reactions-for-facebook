//監聽facebook往下loading
document.addEventListener("DOMNodeInserted", function(e) {
	removeReaction();
}, false);

function removeReaction() {
	var array = document.querySelectorAll("[role=toolbar]");
	for (var i = 0;i<array.length;i++) {
		while(array[i].firstElementChild.childElementCount>1) {
			array[i].firstElementChild.children[1].remove();
		}
	}
}




