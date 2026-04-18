/**
 * uploader.js
 * Handles file selection via tap/click and drag-and-drop.
 * Validates file type and size before passing the file to the app.
 */
const Uploader = (() => {

  const MAX_FILE_SIZE_MB = 20;

  let _onFileSelected = null;

  function init(onFileSelected) {
    _onFileSelected = onFileSelected;

    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');

    // Open native file picker on button tap (prevents double-trigger from zone click)
    browseBtn.addEventListener('click', e => {
      e.stopPropagation();
      fileInput.click();
    });

    // Also allow tapping anywhere on the zone
    dropZone.addEventListener('click', () => fileInput.click());

    // Keyboard accessibility
    dropZone.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') fileInput.click();
    });

    // Native file input change
    fileInput.addEventListener('change', e => {
      if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
        // Reset so the same file can be re-uploaded if needed
        e.target.value = '';
      }
    });

    // Drag and drop (desktop / future use)
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });
  }

  function handleFile(file) {
    clearError();

    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      showError('Please upload a PDF file.');
      return;
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      showError(`File is too large. Maximum size is ${MAX_FILE_SIZE_MB} MB.`);
      return;
    }

    _onFileSelected?.(file);
  }

  function showError(message) {
    const el = document.getElementById('upload-error');
    if (el) { el.textContent = message; el.style.display = 'block'; }
  }

  function clearError() {
    const el = document.getElementById('upload-error');
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  }

  return { init };
})();
