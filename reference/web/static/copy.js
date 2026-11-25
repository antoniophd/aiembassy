// Copies one part of a press pack (owner, 2026-11-25). The only script of the site.
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('button.copy');
  if (!b || !navigator.clipboard) return;
  var el = document.getElementById(b.getAttribute('data-copy'));
  if (!el) return;
  navigator.clipboard.writeText(el.innerText.trim()).then(function () {
    b.textContent = 'Copied';
    setTimeout(function () { b.textContent = 'Copy'; }, 1500);
  });
});
