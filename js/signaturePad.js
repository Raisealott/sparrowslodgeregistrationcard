/**
 * signaturePad.js
 * Canvas-based signature capture with touch and mouse support.
 * Designed for iPad Safari (touch-first).
 */
const SignaturePad = (() => {

  let _canvas   = null;
  let _ctx      = null;
  let _drawing  = false;
  let _hasDrawn = false;
  let _lastX    = 0;
  let _lastY    = 0;

  /** Attach to a canvas element and begin listening for input. */
  function init(canvas) {
    _canvas   = canvas;
    _ctx      = canvas.getContext('2d');
    _hasDrawn = false;
    _drawing  = false;

    _sizeCanvas();
    _applyStyle();

    // Touch — passive: false so we can preventDefault scroll
    canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  _onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   _onTouchEnd);

    // Mouse (desktop / Apple Pencil fallback)
    canvas.addEventListener('mousedown',  _onMouseDown);
    canvas.addEventListener('mousemove',  _onMouseMove);
    canvas.addEventListener('mouseup',    _onMouseUp);
    canvas.addEventListener('mouseleave', _onMouseUp);
  }

  /** Resize the canvas backing store to match its CSS size × device pixel ratio. */
  function _sizeCanvas() {
    if (!_canvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = _canvas.getBoundingClientRect();
    _canvas.width  = Math.round(rect.width  * dpr);
    _canvas.height = Math.round(rect.height * dpr);
    _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    _applyStyle();
  }

  function _applyStyle() {
    if (!_ctx) return;
    _ctx.strokeStyle = '#000';
    _ctx.lineWidth   = 2.5;
    _ctx.lineCap     = 'round';
    _ctx.lineJoin    = 'round';
  }

  function _pos(clientX, clientY) {
    const rect = _canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function _startDraw(x, y) {
    _drawing  = true;
    _hasDrawn = true;
    _lastX = x; _lastY = y;
    _ctx.beginPath();
    _ctx.moveTo(x, y);
  }

  function _continueDraw(x, y) {
    if (!_drawing) return;
    _ctx.beginPath();
    _ctx.moveTo(_lastX, _lastY);
    _ctx.lineTo(x, y);
    _ctx.stroke();
    _lastX = x; _lastY = y;
  }

  function _endDraw() { _drawing = false; }

  // Touch handlers
  function _onTouchStart(e) {
    e.preventDefault();
    const t = e.touches[0];
    const p = _pos(t.clientX, t.clientY);
    _startDraw(p.x, p.y);
  }
  function _onTouchMove(e) {
    e.preventDefault();
    const t = e.touches[0];
    const p = _pos(t.clientX, t.clientY);
    _continueDraw(p.x, p.y);
  }
  function _onTouchEnd() { _endDraw(); }

  // Mouse handlers
  function _onMouseDown(e) {
    const p = _pos(e.clientX, e.clientY);
    _startDraw(p.x, p.y);
  }
  function _onMouseMove(e) {
    const p = _pos(e.clientX, e.clientY);
    _continueDraw(p.x, p.y);
  }
  function _onMouseUp() { _endDraw(); }

  /** Clear the canvas. */
  function clear() {
    if (!_canvas || !_ctx) return;
    const dpr = window.devicePixelRatio || 1;
    _ctx.clearRect(0, 0, _canvas.width / dpr, _canvas.height / dpr);
    _hasDrawn = false;
  }

  /** True if no strokes have been drawn since last clear/init. */
  function isEmpty() { return !_hasDrawn; }

  /** Return a PNG data URL of the current signature, or null if empty. */
  function getDataUrl() {
    return _hasDrawn ? _canvas.toDataURL('image/png') : null;
  }

  /** Call after a layout resize (e.g. orientation change). */
  function resize() { _sizeCanvas(); }

  return { init, clear, isEmpty, getDataUrl, resize };
})();
