(function () {
  "use strict";

  var copyBtn = document.getElementById("copy-btn");
  var cmd = document.getElementById("install-cmd");

  copyBtn.addEventListener("click", function () {
    var text = cmd.textContent;
    var done = function () {
      var original = copyBtn.textContent;
      copyBtn.textContent = "✓";
      setTimeout(function () { copyBtn.textContent = original; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {});
    } else {
      var range = document.createRange();
      range.selectNode(cmd);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      try { document.execCommand("copy"); done(); } catch (e) {}
      window.getSelection().removeAllRanges();
    }
  });
})();
