/**
 * signaturePad.js
 * Canvas-based signature capture with touch and mouse support.
 * Designed for iPad Safari (touch-first).
 *
 * Stores strokes as vector data — compact JSON, ~1–5 KB per signature.
 * Format: Array of strokes, each stroke is an array of {x, y} points
 * in CSS pixels (device-independent, renders correctly at any DPI).
 *
 * Public API:
 *   init(canvas)         — attach to canvas element
 *   clear()              — wipe canvas and stroke data
 *   isEmpty()            — true if no strokes recorded
 *   getStrokes()         — returns stroke data array (for DB storage)
 *   loadStrokes(strokes) — replay saved strokes onto canvas
 *   resize()             — call after layout/orientation change
 */
const SignaturePad = (() => {

  let _canvas        = null;
  let _ctx           = null;
  let _drawing       = false;
  let _strokes       = [];      // all completed strokes
  let _currentStroke = [];      // points in the stroke being drawn

  // ─── Public API ──────────────────────────────────────────────

  function init(canvas) {
    _canvas        = canvas;
    _ctx           = canvas.getContext('2d');
    _strokes       = [];
    _currentStroke = [];
    _drawing       = false;

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

  function clear() {
    if (!_canvas || !_ctx) return;
    const dpr = window.devicePixelRatio || 1;
    _ctx.clearRect(0, 0, _canvas.width / dpr, _canvas.height / dpr);
    _strokes       = [];
    _currentStroke = [];
    _drawing       = false;
  }

  function isEmpty() {
    return _strokes.length === 0 && _currentStroke.length === 0;
  }

  /** Returns the stroke data array — store this in the database. */
  function getStrokes() {
    return _strokes.length > 0 ? _strokes : null;
  }

  /**
   * Replay saved stroke data onto the canvas.
   * Call this when loading a saved signature for display.
   */
  function loadStrokes(strokes) {
    if (!strokes || !strokes.length) return;
    _strokes = strokes;
    _sizeCanvas();
    _applyStyle();
    strokes.forEach(stroke => _drawStroke(stroke));
  }

  function resize() {
    const saved = _strokes.slice();
    _sizeCanvas();
    _applyStyle();
    if (saved.length) saved.forEach(stroke => _drawStroke(stroke));
  }

  // ─── Drawing ─────────────────────────────────────────────────

  function _sizeCanvas() {
    if (!_canvas) return;
    const dpr  = window.devicePixelRatio || 1;
    const rect = _canvas.getBoundingClientRect();
    _canvas.width  = Math.round(rect.width  * dpr);
    _canvas.height = Math.round(rect.height * dpr);
    _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    return {
      x: Math.round((clientX - rect.left) * 10) / 10,
      y: Math.round((clientY - rect.top)  * 10) / 10,
    };
  }

  function _startDraw(p) {
    _drawing       = true;
    _currentStroke = [p];
    _ctx.beginPath();
    _ctx.moveTo(p.x, p.y);
  }

  function _continueDraw(p) {
    if (!_drawing) return;
    const prev = _currentStroke[_currentStroke.length - 1];
    _currentStroke.push(p);
    _ctx.beginPath();
    _ctx.moveTo(prev.x, prev.y);
    _ctx.lineTo(p.x, p.y);
    _ctx.stroke();
  }

  function _endDraw() {
    if (!_drawing) return;
    _drawing = false;
    if (_currentStroke.length > 0) {
      _strokes.push(_currentStroke);
      _currentStroke = [];
    }
  }

  /** Replay a single stroke array onto the canvas. */
  function _drawStroke(stroke) {
    if (!stroke || stroke.length < 1) return;
    _ctx.beginPath();
    _ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i++) {
      _ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    _ctx.stroke();
  }

  // ─── Touch handlers ──────────────────────────────────────────

  function _onTouchStart(e) {
    e.preventDefault();
    const t = e.touches[0];
    _startDraw(_pos(t.clientX, t.clientY));
  }
  function _onTouchMove(e) {
    e.preventDefault();
    const t = e.touches[0];
    _continueDraw(_pos(t.clientX, t.clientY));
  }
  function _onTouchEnd() { _endDraw(); }

  // ─── Mouse handlers ──────────────────────────────────────────

  function _onMouseDown(e) { _startDraw(_pos(e.clientX, e.clientY)); }
  function _onMouseMove(e) { _continueDraw(_pos(e.clientX, e.clientY)); }
  function _onMouseUp()    { _endDraw(); }

  return { init, clear, isEmpty, getStrokes, loadStrokes, resize };
})();
