var reactionArray = document.getElementsByClassName('_3t54');
var html_tag_id='data-testid';
var html_tag_id2='reaction';


var array2 = ["ex2SliderVal","ex3SliderVal","ex4SliderVal","ex5SliderVal","ex6SliderVal"];
var result;
chrome.storage.sync.get(array2, function(callback) {
    result = callback;

    //監聽facebook往下loading
    document.addEventListener("DOMNodeInserted", function(e) {
        removeReaction();
    }, false);
});



function removeReaction() {
    //外層toolbar
    for(var i=0;i<reactionArray.length;i++) {
        var toolbar = reactionArray[i];
            for(var j=0;j<toolbar.childElementCount;j++) {
                //每個表情
                // console.log(toolbar.children[j]);
                if(toolbar.children[j]!==null && 
                    toolbar.children[j].getAttribute(html_tag_id)!=null && 
                    toolbar.children[j].getAttribute(html_tag_id)!='ufi_bling_token_1' &&
                    toolbar.children[j].children[1]!=null
                ) {
                    switch(toolbar.children[j].getAttribute(html_tag_id)) {
                        case 'ufi_bling_token_2':
                            if(result[array2[0]] === undefined) {
                                console.log(toolbar.children[j]);
                                toolbar.children[j].remove();
                            } 
                            if(result[array2[0]] != undefined &&  toolbar.children[j].children[1].textContent <= result[array2[0]]) {
                                console.log(toolbar.children[j]);
                                toolbar.children[j].remove();
                                j--;
                            }
                        break;
                        case 'ufi_bling_token_3':
                        if(result[array2[1]] === undefined) {
                            console.log(toolbar.children[j]);
                            toolbar.children[j].remove();
                        } 
                            if(result[array2[1]] != undefined &&   toolbar.children[j].children[1].textContent <= result[array2[1]]) {
                                console.log(toolbar.children[j]);
                                toolbar.children[j].remove();
                                j--;
                            }
                        break;
                        case 'ufi_bling_token_4':
                        if(result[array2[2]] === undefined) {
                            console.log(toolbar.children[j]);
                            toolbar.children[j].remove();
                        }                             if(result[array2[2]] != undefined &&   toolbar.children[j].children[1].textContent <= result[array2[2]]) {
                                console.log(toolbar.children[j]);
                                toolbar.children[j].remove();
                                j--;
                            }
                        break;
                        case 'ufi_bling_token_7':
                        if(result[array2[3]] === undefined) {
                            console.log(toolbar.children[j]);
                            toolbar.children[j].remove();
                        } 
                            if(result[array2[3]] != undefined &&   toolbar.children[j].children[1].textContent <= result[array2[3]]) {
                                console.log(toolbar.children[j]);
                                toolbar.children[j].remove();
                                j--;
                            }
                        break;
                        case 'ufi_bling_token_8':
                        if(result[array2[4]] === undefined) {
                            console.log(toolbar.children[j]);
                            toolbar.children[j].remove();
                        } 
                            if(result[array2[4]] != undefined &&   toolbar.children[j].children[1].textContent <= result[array2[4]]) {
                                console.log(toolbar.children[j]);
                                toolbar.children[j].remove();
                                j--;
                            }
                        break;
                    }
                
                }
            }
        }
}




