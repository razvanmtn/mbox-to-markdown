const dialog = document.querySelector('.shot-lightbox');
const image = dialog?.querySelector('img');

function fitImage() {
  const maxWidth = window.innerWidth * 0.92;
  const maxHeight = window.innerHeight * 0.9;
  const naturalWidth = image.naturalWidth || 1;
  const naturalHeight = image.naturalHeight || 1;
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
  image.style.width = `${Math.round(naturalWidth * scale)}px`;
  image.style.height = `${Math.round(naturalHeight * scale)}px`;
}

function openShot(source) {
  const show = () => {
    fitImage();
    if (!dialog.open) dialog.showModal();
  };
  image.onload = show;
  image.alt = source.alt;
  image.src = source.currentSrc || source.src;
  if (image.complete && image.naturalWidth) show();
}

if (dialog && image) {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.shot-open');
    if (!button) return;
    const source = button.querySelector('img');
    if (!source) return;
    openShot(source);
  });

  dialog.addEventListener('click', (event) => {
    const close = event.target === dialog
      || event.target === image
      || event.target.closest('[data-close]');
    if (close) dialog.close();
  });

  dialog.addEventListener('close', () => {
    image.onload = null;
    image.removeAttribute('src');
    image.alt = '';
    image.style.width = '';
    image.style.height = '';
  });

  window.addEventListener('resize', () => {
    if (dialog.open) fitImage();
  });
}
