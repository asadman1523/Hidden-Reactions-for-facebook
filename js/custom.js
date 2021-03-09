function save_options() {
    var opt = document.getElementById('HidingOptions').value;
    chrome.storage.sync.set({
        option: opt,
    }, function() {
      // Update status to let user know options were saved.
      var status = document.getElementById('status');
      status.textContent = 'Options saved. Please refresh page.';
      setTimeout(function() {
        status.textContent = '';
      }, 5000);
    });
  }
  
  // Restores select box and checkbox state using the preferences
  // stored in chrome.storage.
  function restore_options() {
    console.log("QQ");
    chrome.storage.sync.get({
        option: "1",
    }, function(items) {
      document.getElementById('HidingOptions').value = items.option;
    });
  }
  document.addEventListener('DOMContentLoaded', restore_options);
  document.getElementById('save').addEventListener('click',
      save_options);