// Copy BibTeX button on project pages.
document.querySelectorAll('[data-copy]').forEach(function (btn) {
  var src = document.getElementById(btn.getAttribute('data-copy'));
  if (!src) return;
  var label = btn.textContent;
  btn.addEventListener('click', function () {
    var text = src.textContent;
    var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = label; }, 1600); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var range = document.createRange();
      range.selectNodeContents(src);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'Press Ctrl/Cmd+C'; }
    }
  });
});
