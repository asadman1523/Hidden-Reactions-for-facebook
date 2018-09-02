var reactionArray = document.getElementsByClassName('_3t54');
var html_tag_id='data-testid';


//監聽facebook往下loading
document.addEventListener("DOMNodeInserted", function(e) {
    removeReaction();
  }, false);
observer.observe(document, { childList: true });

function removeReaction() {
    //外層toolbar
    for(var i=0;i<reactionArray.length;i++) {
        var toolbar = reactionArray[i];
            for(var j=0;j<toolbar.childElementCount;j++) {
                //每個表情
                // console.log(toolbar.children[j]);
                if(toolbar.children[j]!==null && toolbar.children[j].getAttribute(html_tag_id)!=null && toolbar.children[j].getAttribute(html_tag_id)!='ufi_bling_token_1') {
                    console.log("remove");
                    toolbar.children[j].remove();
                    j--;
                }
            }
        }
}




