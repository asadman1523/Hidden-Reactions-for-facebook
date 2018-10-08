var array = ["2","3","4","5","6"];
var array2 = ["ex2SliderVal","ex3SliderVal","ex4SliderVal","ex5SliderVal","ex6SliderVal"];

chrome.storage.sync.get(array2, function(result) {
    for(var i=0;i<array.length;i++) {
        initSlider(i, result);
    }
});


var applyBtn = document.getElementById("applyBtn");
applyBtn.onclick = saveChanges;

function initSlider(position, result) {
    var name = 'ex' + array[position];
    var name_id = '#' + name;
    var name2 = name + 'SliderVal';

    //Get stored data
        var val = 10000;

        //Set init value
        if(result[array2[position]] === undefined) {
            result = 10000;
        } else {
            val = result[array2[position]];
        }

        //Set label text
        document.getElementById(array2[position]).textContent = val;

        //Init slider
        var slider = new Slider(name_id, {
            min: 0,
            max: 10000,
            value: val,
            tooltip_position:'bottom'
        });
        
        //Set listener
        slider.on("slide", function(sliderValue) {
            document.getElementById(array2[position]).textContent = sliderValue;
        });

    
}
function saveChanges() {
    var obj = {};

    //Write data
    for(var i=0;i<array.length;i++) {
        var name = 'ex' + array[i]; //ex2
        var name2 = name + 'SliderVal'; //ex2SliderVal
        var sliderValue = document.getElementById(name2).textContent;
        console.log(name2,sliderValue);
        obj[name2]=sliderValue;
    }

    //Save
    chrome.storage.sync.set(obj, function() {
        //Nothing
      });
}
