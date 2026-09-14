// Design Perception Tensor — Engine v0.1.0
// Assembled from src/utils.js + src/layers/*.js
// Runs in browser context via page.evaluate()
// Returns: structured JSON describing design quality across 5 perception layers
(() => {
try {
// DPT Shared Utilities — Color Math, Geometry, DOM Traversal
// These run in the browser context via page.evaluate()

const DPT_UTILS = {

  // ─── Color Parsing ───────────────────────────────────────────────

  _unparseableColors: new Map(),

  _recordUnparseableColor(str) {
    const value = String(str || '').trim();
    if (!value) return;
    this._unparseableColors.set(value, (this._unparseableColors.get(value) || 0) + 1);
  },

  colorParseDiagnostics() {
    const entries = Array.from(this._unparseableColors.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      unparseable_count: entries.reduce((sum, entry) => sum + entry[1], 0),
      unique_unparseable: entries.length,
      samples: entries.slice(0, 10).map(([value, occurrences]) =>
        occurrences > 1 ? `${value} (${occurrences} uses)` : value
      )
    };
  },

  _clampChannel(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 255);
  },

  _parseAlpha(value) {
    if (value == null || value === '') return 1;
    const token = String(value).trim();
    const parsed = parseFloat(token);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(1, token.endsWith('%') ? parsed / 100 : parsed));
  },

  _parseRgbChannel(value) {
    const token = String(value).trim();
    const parsed = parseFloat(token);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(255, token.endsWith('%') ? parsed * 2.55 : parsed));
  },

  _parseUnitInterval(value, percentScale = 1) {
    const token = String(value).trim();
    const parsed = parseFloat(token);
    if (!Number.isFinite(parsed)) return null;
    return token.endsWith('%') ? (parsed / 100) * percentScale : parsed;
  },

  _parseHue(value) {
    const token = String(value).trim().toLowerCase();
    const parsed = parseFloat(token);
    if (!Number.isFinite(parsed)) return null;
    if (token.endsWith('turn')) return parsed * 360;
    if (token.endsWith('grad')) return parsed * 0.9;
    if (token.endsWith('rad')) return parsed * (180 / Math.PI);
    return parsed;
  },

  _linearToSrgb(value) {
    return value <= 0.0031308
      ? 12.92 * value
      : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  },

  _srgbToLinear(value) {
    return value <= 0.04045
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  },

  _fromLinearSrgb(r, g, b, a) {
    return {
      r: this._clampChannel(this._linearToSrgb(r)),
      g: this._clampChannel(this._linearToSrgb(g)),
      b: this._clampChannel(this._linearToSrgb(b)),
      a
    };
  },

  parseColor(str) {
    if (!str) return null;
    const raw = String(str).trim();
    const lower = raw.toLowerCase();
    if (!raw || lower === 'transparent') return null;

    const hex = lower.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let value = hex[1];
      if (value.length === 3 || value.length === 4) {
        value = value.split('').map(char => char + char).join('');
      }
      if (value.length === 6 || value.length === 8) {
        return {
          r: parseInt(value.slice(0, 2), 16),
          g: parseInt(value.slice(2, 4), 16),
          b: parseInt(value.slice(4, 6), 16),
          a: value.length === 8 ? parseInt(value.slice(6, 8), 16) / 255 : 1
        };
      }
    }

    const rgb = lower.match(/^rgba?\((.*)\)$/);
    if (rgb) {
      const commaSyntax = rgb[1].includes(',');
      let channels;
      let alphaToken;
      if (commaSyntax) {
        const parts = rgb[1].split(',').map(part => part.trim());
        channels = parts.slice(0, 3);
        alphaToken = parts[3];
      } else {
        const slashParts = rgb[1].split('/').map(part => part.trim());
        channels = slashParts[0].split(/\s+/);
        alphaToken = slashParts[1];
      }
      if (channels.length === 3) {
        const parsed = channels.map(channel => this._parseRgbChannel(channel));
        const alpha = this._parseAlpha(alphaToken);
        if (parsed.every(Number.isFinite) && alpha != null) {
          if (alpha === 0) return null;
          return {
            r: Math.round(parsed[0]),
            g: Math.round(parsed[1]),
            b: Math.round(parsed[2]),
            a: alpha
          };
        }
      }
      this._recordUnparseableColor(raw);
      return null;
    }

    const hsl = lower.match(/^hsla?\((.*)\)$/);
    if (hsl) {
      const commaSyntax = hsl[1].includes(',');
      let channels;
      let alphaToken;
      if (commaSyntax) {
        const parts = hsl[1].split(',').map(part => part.trim());
        channels = parts.slice(0, 3);
        alphaToken = parts[3];
      } else {
        const slashParts = hsl[1].split('/').map(part => part.trim());
        channels = slashParts[0].split(/\s+/);
        alphaToken = slashParts[1];
      }
      if (channels.length === 3) {
        const hue = this._parseHue(channels[0]);
        const saturation = this._parseUnitInterval(channels[1]);
        const lightness = this._parseUnitInterval(channels[2]);
        const alpha = this._parseAlpha(alphaToken);
        if ([hue, saturation, lightness].every(Number.isFinite) && alpha != null) {
          const normalizedHue = ((hue % 360) + 360) % 360;
          const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
          const x = chroma * (1 - Math.abs((normalizedHue / 60) % 2 - 1));
          const offset = lightness - chroma / 2;
          let red = 0;
          let green = 0;
          let blue = 0;
          if (normalizedHue < 60) [red, green, blue] = [chroma, x, 0];
          else if (normalizedHue < 120) [red, green, blue] = [x, chroma, 0];
          else if (normalizedHue < 180) [red, green, blue] = [0, chroma, x];
          else if (normalizedHue < 240) [red, green, blue] = [0, x, chroma];
          else if (normalizedHue < 300) [red, green, blue] = [x, 0, chroma];
          else [red, green, blue] = [chroma, 0, x];
          return {
            r: this._clampChannel(red + offset),
            g: this._clampChannel(green + offset),
            b: this._clampChannel(blue + offset),
            a: alpha
          };
        }
      }
      this._recordUnparseableColor(raw);
      return null;
    }

    const oklch = lower.match(/^oklch\((.*)\)$/);
    if (oklch) {
      const slashParts = oklch[1].split('/').map(part => part.trim());
      const channels = slashParts[0].split(/\s+/);
      const alpha = this._parseAlpha(slashParts[1]);
      if (channels.length === 3 && alpha != null) {
        const lightness = this._parseUnitInterval(channels[0]);
        // CSS Color 4 maps 100% chroma to 0.4 for OKLCH.
        const chroma = this._parseUnitInterval(channels[1], 0.4);
        const hue = this._parseHue(channels[2]);
        if ([lightness, chroma, hue].every(Number.isFinite)) {
          const radians = hue * Math.PI / 180;
          const a = chroma * Math.cos(radians);
          const b = chroma * Math.sin(radians);
          const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
          const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
          const sPrime = lightness - 0.0894841775 * a - 1.2914855480 * b;
          const l = lPrime ** 3;
          const m = mPrime ** 3;
          const s = sPrime ** 3;
          return this._fromLinearSrgb(
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
            alpha
          );
        }
      }
      this._recordUnparseableColor(raw);
      return null;
    }

    const color = lower.match(/^color\(\s*([^\s]+)\s+(.+)\)$/);
    if (color) {
      const space = color[1];
      const slashParts = color[2].split('/').map(part => part.trim());
      const channelTokens = slashParts[0].split(/\s+/);
      const alpha = this._parseAlpha(slashParts[1]);
      if (channelTokens.length === 3 && alpha != null) {
        const channels = channelTokens.map(channel => this._parseUnitInterval(channel));
        if (channels.every(Number.isFinite)) {
          if (space === 'srgb') {
            return {
              r: this._clampChannel(channels[0]),
              g: this._clampChannel(channels[1]),
              b: this._clampChannel(channels[2]),
              a: alpha
            };
          }
          if (space === 'srgb-linear') {
            return this._fromLinearSrgb(channels[0], channels[1], channels[2], alpha);
          }
          if (space === 'display-p3') {
            const [pr, pg, pb] = channels.map(channel => this._srgbToLinear(channel));
            const x = 0.4865709486 * pr + 0.2656676932 * pg + 0.1982172852 * pb;
            const y = 0.2289745641 * pr + 0.6917385218 * pg + 0.0792869141 * pb;
            const z = 0.0000000000 * pr + 0.0451133820 * pg + 1.0439443689 * pb;
            return this._fromLinearSrgb(
              3.2409699419 * x - 1.5373831776 * y - 0.4986107603 * z,
              -0.9692436363 * x + 1.8759675015 * y + 0.0415550574 * z,
              0.0556300797 * x - 0.2039769589 * y + 1.0569715142 * z,
              alpha
            );
          }
        }
      }
      this._recordUnparseableColor(raw);
      return null;
    }

    // Computed styles should resolve named and HSL colors to rgb(). Any
    // remaining explicit color function is unsupported and must be visible in
    // the result instead of silently turning into a perfect score.
    if (/^(#|hsl|hwb|lab|lch|oklab|oklch|color\()/.test(lower)) {
      this._recordUnparseableColor(raw);
    }
    return null;
  },

  rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  },

  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  },

  // Relative luminance per WCAG 2.1
  relativeLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  },

  contrastRatio(rgb1, rgb2) {
    const l1 = this.relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
    const l2 = this.relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  },

  // CIEDE2000 — perceptual color distance
  // Simplified implementation sufficient for design analysis
  rgbToLab(r, g, b) {
    // RGB -> XYZ (D65)
    let rr = r / 255, gg = g / 255, bb = b / 255;
    rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
    gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
    bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
    let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
    let y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750);
    let z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;
    x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + 16/116;
    y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + 16/116;
    z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + 16/116;
    return { L: (116 * y) - 16, a: 500 * (x - y), b: 200 * (y - z) };
  },

  ciede2000(rgb1, rgb2) {
    const lab1 = this.rgbToLab(rgb1.r, rgb1.g, rgb1.b);
    const lab2 = this.rgbToLab(rgb2.r, rgb2.g, rgb2.b);
    // Simplified: use CIE76 as approximation (sufficient for design thresholds)
    const dL = lab1.L - lab2.L;
    const da = lab1.a - lab2.a;
    const db = lab1.b - lab2.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  },

  isWarm(hue) {
    return (hue >= 0 && hue <= 60) || (hue >= 300 && hue <= 360);
  },

  isCool(hue) {
    return hue > 60 && hue < 300;
  },

  isNeutral(s) {
    return s < 10;
  },

  // HSL saturation alone overstates chroma near black and white. Multiplying
  // by the lightness envelope recovers the actual HSL chroma on a 0-100 scale.
  effectiveSaturation(hsl) {
    const lightness = Math.max(0, Math.min(100, hsl.l)) / 100;
    return hsl.s * (1 - Math.abs(2 * lightness - 1));
  },

  isStatusColor(h, s) {
    if (s < 20) return false;
    // Red zone: 340-20
    if (h >= 340 || h <= 20) return true;
    // Yellow/amber zone: 35-65
    if (h >= 35 && h <= 65) return true;
    // Green zone: 90-160
    if (h >= 90 && h <= 160) return true;
    return false;
  },

  fontWeightRange(value) {
    const normalized = String(value || 'normal').trim().toLowerCase();
    if (normalized === 'normal') return [400, 400];
    if (normalized === 'bold') return [700, 700];
    const values = (normalized.match(/\d+(?:\.\d+)?/g) || []).map(Number);
    if (values.length === 0) return [400, 400];
    return values.length === 1 ? [values[0], values[0]] : [values[0], values[1]];
  },

  // ─── DOM Traversal ───────────────────────────────────────────────

  getEffectiveBackground(el) {
    let current = el;
    while (current && current !== document.documentElement) {
      const computed = window.getComputedStyle(current);
      const backgroundImage = computed.backgroundImage;
      if (backgroundImage && backgroundImage !== 'none') {
        this._recordUnparseableColor(`background-image: ${backgroundImage}`);
        return null;
      }
      const bg = computed.backgroundColor;
      const parsed = this.parseColor(bg);
      if (parsed && parsed.a > 0.1) {
        if (parsed.a < 1 && current.parentElement) {
          // Semi-transparent — blend with parent
          const parentBg = this.getEffectiveBackground(current.parentElement);
          if (parentBg) {
            return {
              r: Math.round(parsed.r * parsed.a + parentBg.r * (1 - parsed.a)),
              g: Math.round(parsed.g * parsed.a + parentBg.g * (1 - parsed.a)),
              b: Math.round(parsed.b * parsed.a + parentBg.b * (1 - parsed.a)),
              a: 1
            };
          }
        }
        return parsed;
      }
      current = current.parentElement;
    }
    // Default: white
    return { r: 255, g: 255, b: 255, a: 1 };
  },

  isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  },

  isInViewport(el) {
    const rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0 &&
           rect.left < window.innerWidth && rect.right > 0;
  },

  documentHeight() {
    const body = document.body || {};
    const root = document.documentElement || {};
    return Math.max(
      window.innerHeight || 0,
      body.scrollHeight || 0,
      body.offsetHeight || 0,
      root.scrollHeight || 0,
      root.offsetHeight || 0,
      root.clientHeight || 0
    );
  },

  isOnPage(el) {
    const rect = el.getBoundingClientRect();
    const top = rect.top + (window.scrollY || window.pageYOffset || 0);
    const left = rect.left + (window.scrollX || window.pageXOffset || 0);
    const root = document.documentElement || {};
    const width = Math.max(window.innerWidth || 0, root.scrollWidth || 0, root.clientWidth || 0);
    return rect.width > 0 && rect.height > 0 &&
      top < this.documentHeight() && top + rect.height > 0 &&
      left < width && left + rect.width > 0;
  },

  isTextElement(el) {
    const textTags = ['P', 'SPAN', 'LI', 'TD', 'TH', 'LABEL', 'A', 'STRONG', 'EM', 'B', 'I',
                      'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'FIGCAPTION', 'CAPTION'];
    return textTags.includes(el.tagName);
  },

  isBodyText(el) {
    return ['P', 'LI', 'TD', 'TH', 'SPAN', 'LABEL'].includes(el.tagName);
  },

  isHeading(el) {
    return /^H[1-6]$/.test(el.tagName);
  },

  isInteractive(el) {
    if (['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return true;
    if (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link') return true;
    if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') return true;
    if (el.getAttribute('onclick') || el.getAttribute('role') === 'checkbox' ||
        el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'menuitem') return true;
    return false;
  },

  isFormField(el) {
    return ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) &&
           el.type !== 'hidden' && el.type !== 'submit' && el.type !== 'button';
  },

  getSelector(el, maxLen = 80) {
    if (el.id) return '#' + el.id;
    let sel = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/).slice(0, 2).join('.');
      if (cls) sel += '.' + cls;
    }
    return sel.slice(0, maxLen);
  },

  // Collect all visible elements of specified types
  queryVisible(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(el => this.isVisible(el));
  },

  // Keep bounded checks representative of the whole document. A plain
  // `slice(0, limit)` silently collapses back to the first viewport on large
  // pages because DOM order is usually top-to-bottom.
  sampleAcrossPage(elements, limit) {
    if (!Number.isFinite(limit) || limit <= 0 || elements.length <= limit) return [...elements];
    const scrollY = window.scrollY || window.pageYOffset || 0;
    const ordered = [...elements].sort((a, b) =>
      (a.getBoundingClientRect().top + scrollY) - (b.getBoundingClientRect().top + scrollY)
    );
    const sample = [];
    const denominator = Math.max(1, limit - 1);
    for (let index = 0; index < limit; index++) {
      const sourceIndex = Math.round((index / denominator) * (ordered.length - 1));
      sample.push(ordered[sourceIndex]);
    }
    return sample;
  },

  // ─── Geometry ────────────────────────────────────────────────────

  gap(rect1, rect2) {
    // Vertical gap between two rects
    if (rect1.bottom <= rect2.top) return rect2.top - rect1.bottom;
    if (rect2.bottom <= rect1.top) return rect1.top - rect2.bottom;
    return 0; // overlapping
  },

  areAdjacent(rect1, rect2, threshold = 50) {
    const dx = Math.max(0, Math.max(rect1.left - rect2.right, rect2.left - rect1.right));
    const dy = Math.max(0, Math.max(rect1.top - rect2.bottom, rect2.top - rect1.bottom));
    return Math.sqrt(dx * dx + dy * dy) < threshold;
  },

  // ─── Statistics ──────────────────────────────────────────────────

  median(arr) {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  },

  stddev(arr) {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return Math.sqrt(arr.reduce((sum, x) => sum + (x - mean) ** 2, 0) / arr.length);
  },

  mode(arr) {
    const counts = {};
    arr.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    let maxCount = 0, maxVal = arr[0];
    Object.entries(counts).forEach(([v, c]) => { if (c > maxCount) { maxCount = c; maxVal = v; } });
    return parseFloat(maxVal);
  },

  // Detect the base unit from a set of spacing values
  detectBaseUnit(values) {
    if (!values.length) return { unit: 8, confidence: 0 };
    const candidates = [4, 8];
    let best = { unit: 8, score: 0 };
    for (const unit of candidates) {
      const onGrid = values.filter(v => v > 0 && v % unit === 0).length;
      const score = onGrid / values.length;
      if (score > best.score) best = { unit, score };
    }
    return { unit: best.unit, confidence: Math.round(best.score * 100) / 100 };
  },

  // Detect type scale ratio from sorted font sizes
  detectScaleRatio(sizes) {
    if (sizes.length < 3) return { ratio: null, variance: 1, systematic: false };
    const ratios = [];
    for (let i = 1; i < sizes.length; i++) {
      if (sizes[i - 1] > 0) ratios.push(sizes[i] / sizes[i - 1]);
    }
    if (!ratios.length) return { ratio: null, variance: 1, systematic: false };
    const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const variance = this.stddev(ratios) / avgRatio;
    // Try to match known scales
    const knownScales = [1.067, 1.125, 1.200, 1.250, 1.333, 1.414, 1.500, 1.618];
    let bestMatch = avgRatio;
    let bestDist = Infinity;
    for (const s of knownScales) {
      const d = Math.abs(avgRatio - s);
      if (d < bestDist) { bestDist = d; bestMatch = s; }
    }
    return {
      ratio: Math.round(avgRatio * 1000) / 1000,
      best_known_match: bestMatch,
      variance: Math.round(variance * 1000) / 1000,
      systematic: variance < 0.15
    };
  }
};

// DPT Layer 1: Chromatic Field
// Color perception, palette structure, contrast, emotional mapping

function chromaticField(utils) {

  const MAX_VIOLATIONS = 20;
  const MAX_TEXT_SAMPLE = 500;

  // ─── Shared collection: gather all visible elements once ──────────

  const allVisible = utils.queryVisible('*');
  const textElements = allVisible.filter(el => utils.isTextElement(el));
  const interactiveElements = allVisible.filter(el => utils.isInteractive(el));
  const pageElements = allVisible.filter(el => utils.isOnPage(el));

  // ─── CF-01: WCAG Text Contrast ────────────────────────────────────

  function cf01_textContrast() {
    const sampled = utils.sampleAcrossPage(textElements, MAX_TEXT_SAMPLE);
    const violations = [];
    let checkedCount = 0;
    let hardFailCount = 0;
    let softFailCount = 0;

    // Detect dominant text color to identify secondary text
    const colorCounts = new Map();
    for (const el of sampled) {
      const style = window.getComputedStyle(el);
      const fg = utils.parseColor(style.color);
      if (!fg || fg.a < 0.1) continue;
      const hex = utils.rgbToHex(fg.r, fg.g, fg.b);
      colorCounts.set(hex, (colorCounts.get(hex) || 0) + 1);
    }
    let dominantTextHex = null;
    let maxCount = 0;
    for (const [hex, count] of colorCounts) {
      if (count > maxCount) { maxCount = count; dominantTextHex = hex; }
    }

    for (const el of sampled) {
      const style = window.getComputedStyle(el);
      const fg = utils.parseColor(style.color);
      if (!fg || fg.a < 0.1) continue;

      const bg = utils.getEffectiveBackground(el);
      if (!bg) continue;

      checkedCount++;
      const ratio = utils.contrastRatio(fg, bg);
      const fontSize = parseFloat(style.fontSize);
      const fontWeight = parseInt(style.fontWeight, 10) || 400;
      const isBold = fontWeight >= 700;
      const isLarge = fontSize >= 18 || (fontSize >= 14 && isBold);

      // Detect text role: secondary text is dimmer than dominant
      const fgHex = utils.rgbToHex(fg.r, fg.g, fg.b);
      let textRole = 'primary';
      if (dominantTextHex && fgHex !== dominantTextHex) {
        const domR = parseInt(dominantTextHex.slice(1, 3), 16);
        const domG = parseInt(dominantTextHex.slice(3, 5), 16);
        const domB = parseInt(dominantTextHex.slice(5, 7), 16);
        const fgLum = utils.relativeLuminance(fg.r, fg.g, fg.b);
        const domLum = utils.relativeLuminance(domR, domG, domB);
        const bgLum = utils.relativeLuminance(bg.r, bg.g, bg.b);
        // Secondary: closer to bg luminance than dominant text is
        const fgDist = Math.abs(fgLum - bgLum);
        const domDist = Math.abs(domLum - bgLum);
        if (fgDist < domDist * 0.7) {
          textRole = 'secondary';
        }
      }

      let level;
      if (ratio >= 7) {
        level = 'AAA';
      } else if (ratio >= 4.5) {
        level = 'AA';
      } else if (ratio >= 3 && (isLarge || textRole === 'secondary')) {
        // 3:1 passes for large text AND intentional secondary text
        level = textRole === 'secondary' ? 'AA_secondary' : 'AA_large';
      } else {
        level = 'fail';
      }

      if (level === 'fail') {
        // Hard fail: below 3:1 — genuinely unreadable
        // Soft fail: 3-4.5:1 on primary text — below AA but visible
        if (ratio < 3) {
          hardFailCount++;
        } else {
          softFailCount++;
        }
        if (violations.length < MAX_VIOLATIONS) {
          violations.push({
            selector: utils.getSelector(el),
            contrast: Math.round(ratio * 100) / 100,
            fg: utils.rgbToHex(fg.r, fg.g, fg.b),
            bg: utils.rgbToHex(bg.r, bg.g, bg.b),
            text_role: textRole,
            level,
            severity: ratio < 3 ? 'hard' : 'soft'
          });
        }
      }
    }

    const totalFails = hardFailCount + softFailCount;
    const passRate = checkedCount > 0
      ? Math.round(((checkedCount - totalFails) / checkedCount) * 1000) / 1000
      : 1;
    // Adjusted: only hard fails (< 3:1) count against the rate
    const adjustedPassRate = checkedCount > 0
      ? Math.round(((checkedCount - hardFailCount) / checkedCount) * 1000) / 1000
      : 1;

    const result = {
      pairs_checked: checkedCount,
      violations,
      pass_rate: passRate,
      adjusted_pass_rate: adjustedPassRate,
      hard_failures: hardFailCount,
      soft_failures: softFailCount,
      pass: hardFailCount === 0
    };

    if (totalFails > MAX_VIOLATIONS) {
      result.violations_note = `Showing ${MAX_VIOLATIONS} of ${totalFails} violations`;
    }

    return result;
  }

  // ─── CF-02: Palette Analysis ──────────────────────────────────────

  function cf02_palette() {
    const colorMap = new Map(); // hex -> { hsl, count, role }
    const HUE_BUCKET_SIZE = 30;

    for (const el of allVisible) {
      const style = window.getComputedStyle(el);
      const props = ['color', 'backgroundColor', 'borderColor'];

      for (const prop of props) {
        const raw = style[prop];
        const parsed = utils.parseColor(raw);
        if (!parsed || parsed.a < 0.1) continue;

        const hex = utils.rgbToHex(parsed.r, parsed.g, parsed.b);
        const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);

        if (colorMap.has(hex)) {
          colorMap.get(hex).area_count++;
        } else {
          let role;
          if (utils.isNeutral(hsl.s)) {
            role = 'neutral';
          } else if (utils.isStatusColor(hsl.h, hsl.s)) {
            role = 'status';
          } else {
            role = 'chromatic';
          }
          colorMap.set(hex, { hex, hsl, role, area_count: 1 });
        }
      }
    }

    // Cluster chromatic hues by 30-degree buckets
    const hueBuckets = new Set();
    let neutralCount = 0;
    let statusCount = 0;

    for (const entry of colorMap.values()) {
      if (entry.role === 'neutral') {
        neutralCount++;
      } else if (entry.role === 'status') {
        statusCount++;
      }
      if (entry.role === 'chromatic' || entry.role === 'status') {
        hueBuckets.add(Math.floor(entry.hsl.h / HUE_BUCKET_SIZE));
      }
    }

    // Sort palette by usage count descending
    const palette = Array.from(colorMap.values())
      .sort((a, b) => b.area_count - a.area_count);

    return {
      total_colors: colorMap.size,
      chromatic_hues: hueBuckets.size,
      neutrals: neutralCount,
      status_colors: statusCount,
      palette
    };
  }

  // ─── CF-03: Grey Saturation Check ─────────────────────────────────

  function cf03_greySaturation() {
    const greys = [];

    for (const el of allVisible) {
      const style = window.getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const parsed = utils.parseColor(style[prop]);
        if (!parsed || parsed.a < 0.1) continue;
        const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);
        // Neutral range: saturation < 15%, lightness 15-95%
        if (hsl.s < 15 && hsl.l >= 15 && hsl.l <= 95) {
          greys.push(hsl);
        }
      }
    }

    let untinted = 0;
    let tinted = 0;
    const tintedHues = [];

    for (const g of greys) {
      if (g.s === 0) {
        untinted++;
      } else if (g.s >= 3 && g.s <= 10) {
        tinted++;
        tintedHues.push(g.h);
      }
      // s between 1-2 or 11-14 are in a middle ground; count neither
    }

    // Determine dominant grey hue and consistency
    let dominantGreyHue = null;
    let hueConsistent = true;

    if (tintedHues.length > 0) {
      // Find mode of hue buckets (30-degree granularity)
      const hueCounts = {};
      for (const h of tintedHues) {
        const bucket = Math.round(h / 30) * 30;
        hueCounts[bucket] = (hueCounts[bucket] || 0) + 1;
      }
      let maxCount = 0;
      for (const [hue, count] of Object.entries(hueCounts)) {
        if (count > maxCount) {
          maxCount = count;
          dominantGreyHue = parseInt(hue);
        }
      }

      // Consistent if >= 70% of tinted greys share the dominant bucket
      const dominantShare = maxCount / tintedHues.length;
      hueConsistent = dominantShare >= 0.7;
    }

    return {
      untinted_greys: untinted,
      tinted_greys: tinted,
      dominant_grey_hue: dominantGreyHue,
      hue_consistent: hueConsistent
    };
  }

  // ─── CF-04: Interactive-Only Primary Hue ──────────────────────────

  function cf04_interactivePrimary() {
    const HUE_TOLERANCE = 15;
    const hueUsage = {}; // hue bucket -> count

    // Collect saturated hues from interactive elements
    for (const el of interactiveElements) {
      const style = window.getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const parsed = utils.parseColor(style[prop]);
        if (!parsed || parsed.a < 0.1) continue;
        const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);
        if (utils.effectiveSaturation(hsl) >= 20) { // must be perceptually chromatic
          const bucket = Math.round(hsl.h / 10) * 10; // 10-degree buckets
          hueUsage[bucket] = (hueUsage[bucket] || 0) + 1;
        }
      }
    }

    // Find primary hue (most used saturated hue on interactive elements)
    let primaryHue = null;
    let maxInteractive = 0;
    for (const [hue, count] of Object.entries(hueUsage)) {
      if (count > maxInteractive) {
        maxInteractive = count;
        primaryHue = parseInt(hue);
      }
    }

    if (primaryHue === null) {
      return {
        primary_hue: null,
        interactive_uses: 0,
        non_interactive_leaks: 0,
        leaked_selectors: [],
        pass: true
      };
    }

    // Check non-interactive elements for leaks of the primary hue
    const nonInteractive = allVisible.filter(el =>
      !utils.isInteractive(el) &&
      (el.tagName.match(/^H[1-6]$/) || el.tagName === 'P' || el.tagName === 'DIV' ||
       el.tagName === 'SPAN' || el.tagName === 'SECTION')
    );

    // Status chips share the semantic hue system by DESIGN: a GREENLIGHT
    // verdict tag sharing green with the Advance button is one signaling
    // system, not a leak of it. A chip is a status-hued element sized like
    // one line of label text; its ceiling is derived, not chosen — two
    // body-text line boxes (16px x 1.6 doubled, rounded to the 4px grid).
    const CHIP_MAX_HEIGHT_PX = 52;

    function isStatusChip(el, hsl) {
      if (!utils.isStatusColor(hsl.h, utils.effectiveSaturation(hsl))) return false;
      const rect = el.getBoundingClientRect();
      return rect.height > 0 && rect.height <= CHIP_MAX_HEIGHT_PX;
    }

    let leakCount = 0;
    let statusChipExempt = 0;
    const leakedSelectors = [];

    for (const el of nonInteractive) {
      const style = window.getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const parsed = utils.parseColor(style[prop]);
        if (!parsed || parsed.a < 0.1) continue;
        const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);
        if (utils.effectiveSaturation(hsl) < 20) continue;

        const hueDist = Math.min(
          Math.abs(hsl.h - primaryHue),
          360 - Math.abs(hsl.h - primaryHue)
        );

        if (hueDist <= HUE_TOLERANCE) {
          if (isStatusChip(el, hsl)) {
            statusChipExempt++;
          } else {
            leakCount++;
            if (leakedSelectors.length < MAX_VIOLATIONS) {
              leakedSelectors.push(utils.getSelector(el));
            }
          }
          break; // count element once
        }
      }
    }

    return {
      primary_hue: primaryHue,
      interactive_uses: maxInteractive,
      non_interactive_leaks: leakCount,
      status_chip_exempt: statusChipExempt,
      leaked_selectors: leakedSelectors,
      effective_saturation_threshold: 20,
      pass: leakCount === 0
    };
  }

  // ─── CF-05: Warm/Cool Balance ─────────────────────────────────────

  function cf05_warmCoolBalance() {
    let warmCount = 0;
    let coolCount = 0;

    for (const el of allVisible) {
      const style = window.getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const parsed = utils.parseColor(style[prop]);
        if (!parsed || parsed.a < 0.1) continue;
        const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);
        if (utils.isNeutral(hsl.s)) continue; // skip neutrals

        if (utils.isWarm(hsl.h)) warmCount++;
        else if (utils.isCool(hsl.h)) coolCount++;
      }
    }

    const total = warmCount + coolCount;
    const warmPct = total > 0 ? Math.round((warmCount / total) * 1000) / 10 : 0;
    const coolPct = total > 0 ? Math.round((coolCount / total) * 1000) / 10 : 0;

    // Monotony: one side exceeds 90%
    const monotony = total > 0 && (warmPct > 90 || coolPct > 90);

    return {
      warm_pct: warmPct,
      cool_pct: coolPct,
      monotony
    };
  }

  // ─── CF-06: Dark Mode Checks ──────────────────────────────────────

  function cf06_darkMode() {
    let pureBlackBgs = 0;
    let pureWhiteText = 0;

    for (const el of allVisible) {
      const style = window.getComputedStyle(el);

      // Check background for pure black
      const bgParsed = utils.parseColor(style.backgroundColor);
      if (bgParsed && bgParsed.a > 0.1 &&
          bgParsed.r === 0 && bgParsed.g === 0 && bgParsed.b === 0) {
        pureBlackBgs++;
      }

      // Check text color for pure white
      if (utils.isTextElement(el)) {
        const fgParsed = utils.parseColor(style.color);
        if (fgParsed && fgParsed.r === 255 && fgParsed.g === 255 && fgParsed.b === 255) {
          pureWhiteText++;
        }
      }
    }

    // Halation risk: pure white text on pure black background exists
    let halationRisk = false;
    if (pureBlackBgs > 0 && pureWhiteText > 0) {
      // Verify at least one element actually combines both
      for (const el of allVisible) {
        if (!utils.isTextElement(el)) continue;
        const style = window.getComputedStyle(el);
        const fg = utils.parseColor(style.color);
        if (!fg || fg.r !== 255 || fg.g !== 255 || fg.b !== 255) continue;

        const bg = utils.getEffectiveBackground(el);
        if (bg && bg.r === 0 && bg.g === 0 && bg.b === 0) {
          halationRisk = true;
          break;
        }
      }
    }

    return {
      pure_black_backgrounds: pureBlackBgs,
      pure_white_text: pureWhiteText,
      halation_risk: halationRisk
    };
  }

  // ─── CF-07: Red-Blue Adjacency (Chromostereopsis) ─────────────────

  function cf07_redBlueAdjacency() {
    // Collect elements with strong red or blue backgrounds/colors
    const redEls = [];
    const blueEls = [];

    function isStrongRed(h, s) {
      return s > 40 && (h >= 340 || h <= 20);
    }

    function isStrongBlue(h, s) {
      return s > 40 && h >= 210 && h <= 260;
    }

    for (const el of pageElements) {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Check background and text color
      for (const prop of ['color', 'backgroundColor']) {
        const parsed = utils.parseColor(style[prop]);
        if (!parsed || parsed.a < 0.1) continue;
        const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);

        if (isStrongRed(hsl.h, hsl.s)) {
          redEls.push({ el, rect });
          break;
        }
        if (isStrongBlue(hsl.h, hsl.s)) {
          blueEls.push({ el, rect });
          break;
        }
      }
    }

    let pairCount = 0;

    // Check adjacency between red and blue elements
    for (const red of redEls) {
      for (const blue of blueEls) {
        if (red.el === blue.el) continue;
        if (utils.areAdjacent(red.rect, blue.rect)) {
          pairCount++;
        }
      }
    }

    return {
      chromostereopsis_pairs: pairCount,
      risk: pairCount > 0
    };
  }

  // ─── CF-08: Full Saturation Overuse ───────────────────────────────

  function cf08_saturationOveruse() {
    const SAT_THRESHOLD = 85;
    let fullSatElements = 0;
    const fullSatHues = new Set(); // 30-degree buckets

    for (const el of pageElements) {
      const style = window.getComputedStyle(el);
      let found = false;

      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const parsed = utils.parseColor(style[prop]);
        if (!parsed || parsed.a < 0.1) continue;
        const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);

        if (hsl.s > SAT_THRESHOLD && hsl.l > 10 && hsl.l < 90) {
          fullSatHues.add(Math.floor(hsl.h / 30));
          if (!found) {
            fullSatElements++;
            found = true;
          }
        }
      }
    }

    return {
      full_saturation_elements: fullSatElements,
      full_saturation_hues: fullSatHues.size,
      pass: fullSatHues.size <= 1
    };
  }

  // ─── CF-09: Body Text Color Softness ──────────────────────────────

  function cf09_bodyTextSoftness() {
    const bodyTextEls = allVisible.filter(el =>
      el.tagName === 'P' || el.tagName === 'LI'
    );

    let pureBlackCount = 0;

    for (const el of bodyTextEls) {
      const style = window.getComputedStyle(el);
      const fg = utils.parseColor(style.color);
      if (!fg) continue;

      // Pure black text
      if (fg.r === 0 && fg.g === 0 && fg.b === 0) {
        // On white or near-white background
        const bg = utils.getEffectiveBackground(el);
        if (bg) {
          const bgHsl = utils.rgbToHsl(bg.r, bg.g, bg.b);
          if (bgHsl.l >= 90) {
            pureBlackCount++;
          }
        }
      }
    }

    return {
      pure_black_body_text: pureBlackCount,
      pass: pureBlackCount === 0
    };
  }

  // ─── CF-10: Complementary Adjacency Detection ────────────────────

  function cf10_complementaryAdjacency() {
    const MAX_ELEMENTS = 200;
    const MAX_PAIRS = 10;

    // Collect page elements with chromatic colors (S > 40%)
    const chromaticEls = [];

    for (const el of utils.sampleAcrossPage(pageElements, MAX_ELEMENTS)) {
      if (chromaticEls.length >= MAX_ELEMENTS) break;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      for (const prop of ['color', 'backgroundColor']) {
        const parsed = utils.parseColor(style[prop]);
        if (!parsed || parsed.a < 0.1) continue;
        const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);

        if (hsl.s > 40) {
          chromaticEls.push({ el, rect, hue: hsl.h, selector: utils.getSelector(el) });
          break;
        }
      }
    }

    let pairCount = 0;
    const pairs = [];

    for (let i = 0; i < chromaticEls.length; i++) {
      for (let j = i + 1; j < chromaticEls.length; j++) {
        const a = chromaticEls[i];
        const b = chromaticEls[j];
        if (a.el === b.el) continue;

        const hueDist = Math.min(
          Math.abs(a.hue - b.hue),
          360 - Math.abs(a.hue - b.hue)
        );

        if (hueDist >= 150 && hueDist <= 210 && utils.areAdjacent(a.rect, b.rect)) {
          pairCount++;
          if (pairs.length < MAX_PAIRS) {
            pairs.push({
              sel1: a.selector,
              sel2: b.selector,
              hue1: Math.round(a.hue),
              hue2: Math.round(b.hue),
              hue_distance: Math.round(hueDist)
            });
          }
        }
      }
    }

    return {
      complementary_pairs: pairCount,
      risk: pairCount > 0,
      pairs
    };
  }

  // ─── CF-11: Saturated Color Area Overuse ────────────────────────

  function cf11_saturatedArea() {
    const SAT_THRESHOLD = 70;
    const AREA_THRESHOLD = 25; // percent
    const HUE_BUCKET_SIZE = 30;
    const bucketAreas = {}; // bucket -> total pixel area

    const scanArea = window.innerWidth * utils.documentHeight();

    for (const el of pageElements) {
      const style = window.getComputedStyle(el);
      const bgParsed = utils.parseColor(style.backgroundColor);
      if (!bgParsed || bgParsed.a < 0.1) continue;

      const hsl = utils.rgbToHsl(bgParsed.r, bgParsed.g, bgParsed.b);
      if (hsl.s <= SAT_THRESHOLD) continue;

      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area === 0) continue;

      const bucket = Math.floor(hsl.h / HUE_BUCKET_SIZE) * HUE_BUCKET_SIZE;
      bucketAreas[bucket] = (bucketAreas[bucket] || 0) + area;
    }

    const hueAreas = [];
    let overuseCount = 0;

    for (const [bucket, area] of Object.entries(bucketAreas)) {
      const areaPct = Math.round((area / scanArea) * 1000) / 10;
      hueAreas.push({ hue_bucket: parseInt(bucket), area_pct: areaPct });
      if (areaPct > AREA_THRESHOLD) {
        overuseCount++;
      }
    }

    // Sort by area descending
    hueAreas.sort((a, b) => b.area_pct - a.area_pct);

    return {
      hue_areas: hueAreas,
      overuse_hues: overuseCount,
      pass: overuseCount === 0
    };
  }

  // ─── CF-12: Perceived Brightness Consistency ───────────────────────

  function cf12_perceivedBrightness(paletteResult) {
    const SAT_THRESHOLD = 30;
    const DELTA_THRESHOLD = 0.15;

    // Group chromatic colors by semantic role
    const roleGroups = new Map(); // role -> [{r,g,b,brightness}]

    for (const entry of paletteResult.palette) {
      if (entry.hsl.s <= SAT_THRESHOLD) continue; // skip low-saturation

      // Status colors are EXPECTED to differ in brightness: a deliberate
      // luminance ordering (amber light, green mid, red dark) is what keeps
      // verdicts tellable-apart for color-deficient readers. Only the
      // decorative chromatic family owes brightness consistency.
      const role = entry.role;
      if (role !== 'chromatic') continue;

      // Parse hex back to RGB for brightness calc
      const r = parseInt(entry.hex.slice(1, 3), 16);
      const g = parseInt(entry.hex.slice(3, 5), 16);
      const b = parseInt(entry.hex.slice(5, 7), 16);

      const brightness = Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b) / 255;

      if (!roleGroups.has(role)) {
        roleGroups.set(role, []);
      }
      roleGroups.get(role).push({ hex: entry.hex, brightness });
    }

    let roleGroupsChecked = 0;
    let inconsistentGroups = 0;
    let maxDelta = 0;

    for (const [, colors] of roleGroups) {
      if (colors.length < 2) continue;
      roleGroupsChecked++;

      // Compute max brightness delta within this role group
      let groupMin = Infinity;
      let groupMax = -Infinity;

      for (const c of colors) {
        if (c.brightness < groupMin) groupMin = c.brightness;
        if (c.brightness > groupMax) groupMax = c.brightness;
      }

      const delta = groupMax - groupMin;
      if (delta > maxDelta) maxDelta = delta;

      if (delta > DELTA_THRESHOLD) {
        inconsistentGroups++;
      }
    }

    return {
      role_groups_checked: roleGroupsChecked,
      inconsistent_groups: inconsistentGroups,
      max_delta: Math.round(maxDelta * 1000) / 1000,
      pass: inconsistentGroups === 0
    };
  }

  // ─── Execute all checks and assemble result ───────────────────────

  const cf02 = cf02_palette();

  return {
    cf01_text_contrast: cf01_textContrast(),
    cf02_palette: cf02,
    cf03_grey_saturation: cf03_greySaturation(),
    cf04_interactive_primary: cf04_interactivePrimary(),
    cf05_warm_cool_balance: cf05_warmCoolBalance(),
    cf06_dark_mode: cf06_darkMode(),
    cf07_red_blue_adjacency: cf07_redBlueAdjacency(),
    cf08_saturation_overuse: cf08_saturationOveruse(),
    cf09_body_text_softness: cf09_bodyTextSoftness(),
    cf10_complementary_adjacency: cf10_complementaryAdjacency(),
    cf11_saturated_area: cf11_saturatedArea(),
    cf12_perceived_brightness: cf12_perceivedBrightness(cf02)
  };
}

// DPT Layer 2: Typographic Skeleton
// Type scale, weight hierarchy, measure, line-height, typographic craft

function typographicSkeleton(utils) {

  const MAX_ITEMS = 15;
  const GENERIC_FAMILIES = new Set(['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded']);

  // ── Helpers ──────────────────────────────────────────────────────

  function px(el, prop) {
    return parseFloat(window.getComputedStyle(el)[prop]) || 0;
  }

  function fontSize(el) {
    return parseFloat(window.getComputedStyle(el).fontSize) || 0;
  }

  function lineHeight(el) {
    const style = window.getComputedStyle(el);
    const lh = style.lineHeight;
    if (lh === 'normal') return fontSize(el) * 1.2; // browser default ~1.2
    return parseFloat(lh) || 0;
  }

  function primaryFamily(el) {
    const raw = window.getComputedStyle(el).fontFamily;
    if (!raw) return null;
    // First font in the comma-separated list, stripped of quotes
    const first = raw.split(',')[0].trim().replace(/^["']|["']$/g, '');
    return first || null;
  }

  function collectVisible(selector) {
    return utils.queryVisible(selector).filter(el => utils.isOnPage(el));
  }

  // Gather body-text elements across the full rendered page.
  const bodyTextEls = collectVisible('p, li, td, th, span')
    .filter(el => utils.isBodyText(el) && el.textContent.trim().length > 0);

  const paragraphs = collectVisible('p')
    .filter(el => el.textContent.trim().length > 0);

  const headings = collectVisible('h1, h2, h3, h4, h5, h6')
    .filter(el => el.textContent.trim().length > 0);

  const allTextEls = collectVisible('p, span, li, td, th, label, a, strong, em, b, i, h1, h2, h3, h4, h5, h6, blockquote, figcaption, caption')
    .filter(el => utils.isTextElement(el) && el.textContent.trim().length > 0);


  // ── TS-01: Body Text Minimum Size ───────────────────────────────
  // The 16px expectation is for READING text — paragraphs and list prose.
  // Table cells, labels, and UI spans are data typography, where 13-14px
  // is craft-correct; they answer only to the TS-02 12px absolute floor.
  // Counting them here inflated canon pages to dozens of false violations.

  function ts01() {
    let minSize = Infinity;
    let violations = 0;
    const violationSelectors = [];
    const proseEls = bodyTextEls.filter(el => el.tagName === 'P' || el.tagName === 'LI');

    for (const el of proseEls) {
      const size = fontSize(el);
      if (size > 0 && size < minSize) minSize = size;
      if (size < 16) {
        violations++;
        if (violationSelectors.length < MAX_ITEMS) {
          violationSelectors.push(utils.getSelector(el));
        }
      }
    }

    return {
      min_size: minSize === Infinity ? 0 : Math.round(minSize * 100) / 100,
      violations,
      violation_selectors: violationSelectors,
      pass: violations === 0
    };
  }


  // ── TS-02: Absolute Floor (12px) ────────────────────────────────

  function ts02() {
    let count = 0;
    const elements = [];

    for (const el of allTextEls) {
      const size = fontSize(el);
      if (size > 0 && size < 12) {
        count++;
        if (elements.length < MAX_ITEMS) {
          elements.push(utils.getSelector(el));
        }
      }
    }

    return {
      sub_12px_count: count,
      elements,
      pass: count === 0
    };
  }


  // ── TS-03: Line Length (Measure) ────────────────────────────────

  function ts03() {
    const checks = [];
    let violations = 0;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    // A stable mixed-case sample makes the estimate specific to the rendered
    // face without letting one paragraph's unusual letter distribution skew it.
    const glyphSample = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789';

    for (const el of paragraphs) {
      const rect = el.getBoundingClientRect();
      const size = fontSize(el);
      if (size <= 0 || rect.width <= 0) continue;

      const style = window.getComputedStyle(el);
      let averageWidth = size * 0.5;
      const renderedText = (el.textContent || '').replace(/\s+/g, ' ').trim();
      let renderedTextWidth = averageWidth * renderedText.length;
      if (context) {
        const requestedFont = `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${style.fontSize} ${style.fontFamily}`;
        context.font = requestedFont;
        // Canvas keeps its previous value when a font shorthand is invalid.
        // Only trust the metrics when it accepted this element's size.
        if (context.font.includes(style.fontSize)) {
          const measured = context.measureText(glyphSample).width / glyphSample.length;
          if (Number.isFinite(measured) && measured > 0) averageWidth = measured;
          renderedTextWidth = context.measureText(renderedText).width;
        }
      }
      const letterSpacing = parseFloat(style.letterSpacing);
      if (Number.isFinite(letterSpacing)) {
        averageWidth += letterSpacing;
        renderedTextWidth += Math.max(0, renderedText.length - 1) * letterSpacing;
      }
      // Measure is a multiline-prose constraint. A short status line or label
      // expressed with a <p> does not create a long readable line merely
      // because its container is wide.
      if (renderedTextWidth <= rect.width * 1.02) continue;
      const charsPerLine = Math.round(rect.width / averageWidth);
      const pass = charsPerLine >= 45 && charsPerLine <= 75;
      if (!pass) violations++;

      if (checks.length < MAX_ITEMS) {
        checks.push({
          selector: utils.getSelector(el),
          chars_per_line: charsPerLine,
          average_character_width: Math.round(averageWidth * 100) / 100,
          font_family: primaryFamily(el),
          pass
        });
      }
    }

    return { checks, violations, pass: violations === 0 };
  }


  // ── TS-04: Body Line Height ─────────────────────────────────────

  function ts04() {
    const ratios = [];

    for (const el of bodyTextEls) {
      const size = fontSize(el);
      if (size <= 0) continue;
      const lh = lineHeight(el);
      const ratio = Math.round((lh / size) * 100) / 100;

      if (ratios.length < MAX_ITEMS) {
        ratios.push({
          selector: utils.getSelector(el),
          ratio,
          pass: ratio >= 1.4 && ratio <= 1.6
        });
      }
    }

    const allRatios = bodyTextEls
      .map(el => { const s = fontSize(el); return s > 0 ? lineHeight(el) / s : null; })
      .filter(r => r !== null);

    const med = utils.median(allRatios);
    const medRounded = Math.round(med * 100) / 100;

    return {
      ratios,
      median_ratio: medRounded,
      pass: medRounded >= 1.4 && medRounded <= 1.6
    };
  }


  // ── TS-05: Headline Line Height ─────────────────────────────────

  function ts05() {
    const ratios = [];
    let allPass = true;

    for (const el of headings) {
      const size = fontSize(el);
      if (size <= 0) continue;
      const lh = lineHeight(el);
      const ratio = Math.round((lh / size) * 100) / 100;
      const pass = ratio >= 1.1 && ratio <= 1.25;
      if (!pass) allPass = false;

      if (ratios.length < MAX_ITEMS) {
        ratios.push({
          tag: el.tagName.toLowerCase(),
          ratio,
          pass
        });
      }
    }

    return {
      ratios,
      pass: allPass
    };
  }


  // ── TS-06: Typeface Family Count ────────────────────────────────

  function ts06() {
    const familySet = new Set();

    for (const el of allTextEls) {
      const fam = primaryFamily(el);
      if (fam && !GENERIC_FAMILIES.has(fam.toLowerCase())) {
        familySet.add(fam);
      }
    }

    const families = Array.from(familySet).sort();

    return {
      families: families.slice(0, MAX_ITEMS),
      count: families.length,
      pass: families.length <= 3
    };
  }


  // ── TS-07: Font Weight Count ────────────────────────────────────

  function ts07() {
    const weightSet = new Set();

    for (const el of allTextEls) {
      const w = parseInt(window.getComputedStyle(el).fontWeight) || 400;
      weightSet.add(w);
    }

    const weights = Array.from(weightSet).sort((a, b) => a - b);

    // Group into bands of 100 (300-399, 400-499, etc.)
    const bandSet = new Set();
    for (const w of weights) {
      bandSet.add(Math.floor(w / 100) * 100);
    }

    return {
      weights_used: weights,
      band_count: bandSet.size,
      pass: bandSet.size <= 2
    };
  }


  // ── TS-08: Type Scale Systematicity ─────────────────────────────

  function ts08() {
    const sizeSet = new Set();

    for (const el of allTextEls) {
      const size = fontSize(el);
      if (size > 0) sizeSet.add(Math.round(size * 10) / 10);
    }

    const sizes = Array.from(sizeSet).sort((a, b) => a - b);
    const detection = utils.detectScaleRatio(sizes);

    return {
      sizes,
      detected_ratio: detection.ratio,
      best_known_match: detection.best_known_match || null,
      variance: detection.variance,
      systematic: detection.systematic
    };
  }


  // ── TS-09: Headline Size Jump ───────────────────────────────────

  function ts09() {
    const h1Els = collectVisible('h1').filter(el => el.textContent.trim().length > 0);
    const h1Size = h1Els.length > 0 ? fontSize(h1Els[0]) : 0;

    // Body text size: median of paragraph font sizes
    const pSizes = paragraphs.map(el => fontSize(el)).filter(s => s > 0);
    const bodySize = pSizes.length > 0 ? utils.median(pSizes) : 16;

    const ratio = bodySize > 0 ? Math.round((h1Size / bodySize) * 100) / 100 : 0;

    // 2.0-3.0 is the classic sweet spot; editorial display scale runs to
    // ~4.5 (ratified Palingenesis hero 3.72x, recognitionoracle 4.16x) and
    // is a choice, not an error. Below 1.5 the h1 fails to outrank body.
    return {
      h1_size: Math.round(h1Size * 100) / 100,
      body_size: Math.round(bodySize * 100) / 100,
      ratio,
      pass: ratio >= 2.0 && ratio <= 4.5
    };
  }


  // ── TS-10: ALL CAPS Letter-Spacing ──────────────────────────────

  function ts10() {
    const uppercaseEls = allTextEls.filter(el =>
      window.getComputedStyle(el).textTransform === 'uppercase'
    );

    let properlySpaced = 0;
    const violations = [];

    for (const el of uppercaseEls) {
      const style = window.getComputedStyle(el);
      const ls = parseFloat(style.letterSpacing) || 0;
      const size = fontSize(el);
      const minSpacing = size * 0.05;
      const maxSpacing = size * 0.1;

      if (ls >= minSpacing && ls <= maxSpacing) {
        properlySpaced++;
      } else {
        if (violations.length < MAX_ITEMS) {
          violations.push(utils.getSelector(el));
        }
      }
    }

    return {
      uppercase_elements: uppercaseEls.length,
      properly_spaced: properlySpaced,
      violations,
      pass: uppercaseEls.length === 0 || violations.length === 0
    };
  }


  // ── TS-11: ALL CAPS Word Count ──────────────────────────────────

  function ts11() {
    const uppercaseEls = allTextEls.filter(el =>
      window.getComputedStyle(el).textTransform === 'uppercase'
    );

    const longUppercase = [];

    for (const el of uppercaseEls) {
      const text = el.textContent.trim();
      const words = text.split(/\s+/).filter(w => w.length > 0);
      if (words.length > 3) {
        if (longUppercase.length < MAX_ITEMS) {
          longUppercase.push({
            selector: utils.getSelector(el),
            word_count: words.length,
            text: text.slice(0, 80)
          });
        }
      }
    }

    return {
      long_uppercase: longUppercase,
      pass: longUppercase.length === 0
    };
  }


  // ── TS-12: Centered Body Text ───────────────────────────────────

  function ts12() {
    const centered = [];

    for (const el of paragraphs) {
      const style = window.getComputedStyle(el);
      if (style.textAlign !== 'center') continue;

      const rect = el.getBoundingClientRect();
      const lh = lineHeight(el);
      if (lh <= 0) continue;

      const lines = Math.round(rect.height / lh);
      if (lines > 3) {
        if (centered.length < MAX_ITEMS) {
          centered.push({
            selector: utils.getSelector(el),
            lines
          });
        }
      }
    }

    return {
      centered_paragraphs: centered,
      pass: centered.length === 0
    };
  }


  // ── TS-13: Heading Semantic/Visual Alignment ────────────────────

  function ts13() {
    // Query all headings in document order (not just viewport)
    const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .filter(el => utils.isVisible(el) && el.textContent.trim().length > 0);

    const sequence = [];
    const levelsUsed = new Set();

    for (const el of allHeadings) {
      const tag = el.tagName.toLowerCase();
      const level = parseInt(tag.charAt(1));
      const size = fontSize(el);
      levelsUsed.add(level);

      if (sequence.length < MAX_ITEMS) {
        sequence.push({
          tag,
          size: Math.round(size * 100) / 100
        });
      }
    }

    // Check for skipped levels
    const skippedLevels = [];
    const sortedLevels = Array.from(levelsUsed).sort((a, b) => a - b);
    for (let i = 1; i < sortedLevels.length; i++) {
      const gap = sortedLevels[i] - sortedLevels[i - 1];
      if (gap > 1) {
        for (let skipped = sortedLevels[i - 1] + 1; skipped < sortedLevels[i]; skipped++) {
          skippedLevels.push('h' + skipped);
        }
      }
    }

    // Check visual size monotonicity: for each heading level used,
    // the average size should decrease as level increases
    const sizeByLevel = {};
    for (const el of allHeadings) {
      const level = parseInt(el.tagName.charAt(1));
      const size = fontSize(el);
      if (!sizeByLevel[level]) sizeByLevel[level] = [];
      sizeByLevel[level].push(size);
    }

    const avgByLevel = {};
    for (const [level, sizes] of Object.entries(sizeByLevel)) {
      avgByLevel[level] = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    }

    let visualMonotonic = true;
    const levelKeys = Object.keys(avgByLevel).map(Number).sort((a, b) => a - b);
    for (let i = 1; i < levelKeys.length; i++) {
      if (avgByLevel[levelKeys[i]] >= avgByLevel[levelKeys[i - 1]]) {
        visualMonotonic = false;
        break;
      }
    }

    return {
      sequence,
      skipped_levels: skippedLevels,
      visual_monotonic: visualMonotonic,
      pass: skippedLevels.length === 0 && visualMonotonic
    };
  }


  // ── TS-14: Heading Space Asymmetry ──────────────────────────────

  function ts14() {
    const results = [];
    let violationCount = 0;

    for (const el of headings) {
      const style = window.getComputedStyle(el);
      const mt = parseFloat(style.marginTop) || 0;
      const mb = parseFloat(style.marginBottom) || 0;
      const pass = mt > mb;
      if (!pass) violationCount++;

      if (results.length < MAX_ITEMS) {
        results.push({
          tag: el.tagName.toLowerCase(),
          margin_top: Math.round(mt * 100) / 100,
          margin_bottom: Math.round(mb * 100) / 100,
          pass
        });
      }
    }

    return {
      headings: results,
      violation_count: violationCount
    };
  }


  // ── TS-15: Straight Quotes Detection ────────────────────────────

  function ts15() {
    let count = 0;
    const samples = [];

    // Walk text nodes, skip code/pre/kbd
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === 'CODE' || tag === 'PRE' || tag === 'KBD') {
            return NodeFilter.FILTER_REJECT;
          }
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent;
      // Match straight double quotes (") and straight single quotes/apostrophes (')
      // but not within empty content
      const straightDoubles = (text.match(/"/g) || []).length;
      const straightSingles = (text.match(/'/g) || []).length;
      const found = straightDoubles + straightSingles;

      if (found > 0) {
        count += found;
        if (samples.length < MAX_ITEMS) {
          const trimmed = text.trim();
          if (trimmed.length > 0) {
            samples.push(trimmed.slice(0, 80));
          }
        }
      }
    }

    return {
      straight_quote_count: count,
      sample_texts: samples,
      pass: count === 0
    };
  }


  // ── TS-16: Double Hyphen Detection ──────────────────────────────

  function ts16() {
    let count = 0;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === 'CODE' || tag === 'PRE' || tag === 'KBD' ||
              tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const matches = node.textContent.match(/--/g);
      if (matches) count += matches.length;
    }

    return {
      double_hyphen_count: count,
      pass: count === 0
    };
  }


  // ── TS-17: Faux Bold/Italic Detection ───────────────────────────

  function ts17() {
    let fauxBold = 0;
    let fauxItalic = 0;
    let unverifiable = 0;
    const elements = [];

    function normalizeFamily(value) {
      return String(value || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
    }

    function styleMatches(faceStyle, requestedStyle) {
      const face = String(faceStyle || 'normal').toLowerCase();
      const requested = String(requestedStyle || 'normal').toLowerCase();
      if (requested === 'normal') return face === 'normal';
      if (requested === 'italic') return face === 'italic';
      if (requested.startsWith('oblique')) return face.startsWith('oblique');
      return face === requested;
    }

    for (const el of allTextEls) {
      const style = window.getComputedStyle(el);
      const weight = parseInt(style.fontWeight) || 400;
      const isItalic = style.fontStyle === 'italic' || style.fontStyle.startsWith('oblique');

      if (weight < 700 && !isItalic) continue;

      const synthesis = (style.fontSynthesis || '').toLowerCase();
      const families = (style.fontFamily || '').split(',').map(normalizeFamily).filter(Boolean);

      // document.fonts enumerates authored @font-face entries, including
      // variable faces whose weight is a range such as "200 900". System font
      // families are not enumerated, so their status is unknown, never faux by
      // default.
      const familyFaces = [];
      if (document.fonts && typeof document.fonts.forEach === 'function') {
        document.fonts.forEach(face => {
          if (families.includes(normalizeFamily(face.family))) familyFaces.push(face);
        });
      }

      if (familyFaces.length === 0) {
        unverifiable++;
        continue;
      }

      const matchingWeight = familyFaces.some(face => {
        const [minimum, maximum] = utils.fontWeightRange(face.weight);
        return weight >= minimum && weight <= maximum && styleMatches(face.style, style.fontStyle);
      });
      const matchingItalic = familyFaces.some(face => {
        const [minimum, maximum] = utils.fontWeightRange(face.weight);
        return weight >= minimum && weight <= maximum && styleMatches(face.style, style.fontStyle);
      });

      // font-synthesis declares what the browser may synthesize. It becomes
      // evidence only when an authored family inventory exists and proves the
      // requested face is absent. Permission alone is not proof.
      const allowsWeightSynthesis = synthesis === 'auto' || synthesis.split(/\s+/).includes('weight');
      const allowsStyleSynthesis = synthesis === 'auto' || synthesis.split(/\s+/).includes('style');
      const isFauxBold = weight >= 700 && !matchingWeight && allowsWeightSynthesis;
      const isFauxItalic = isItalic && !matchingItalic && allowsStyleSynthesis;

      if (isFauxBold) fauxBold++;
      if (isFauxItalic) fauxItalic++;

      if ((isFauxBold || isFauxItalic) && elements.length < MAX_ITEMS) {
        elements.push({
          selector: utils.getSelector(el),
          issue: isFauxBold && isFauxItalic ? 'faux bold+italic'
            : isFauxBold ? 'faux bold' : 'faux italic'
        });
      }
    }

    return {
      faux_bold: fauxBold,
      faux_italic: fauxItalic,
      unverifiable_elements: unverifiable,
      elements,
      pass: fauxBold === 0 && fauxItalic === 0
    };
  }


  // ── TS-18: Tabular Numerals in Data Tables ────────────────────

  function ts18() {
    const cells = collectVisible('td, th')
      .filter(el => /\d/.test(el.textContent));

    let withTabularNums = 0;
    const violations = [];

    for (const el of cells) {
      const style = window.getComputedStyle(el);
      const variantNumeric = style.fontVariantNumeric || '';
      const featureSettings = style.fontFeatureSettings || '';

      if (variantNumeric.includes('tabular-nums') ||
          featureSettings.includes('"tnum"')) {
        withTabularNums++;
      } else {
        if (violations.length < MAX_ITEMS) {
          violations.push({ selector: utils.getSelector(el) });
        }
      }
    }

    return {
      numeric_cells: cells.length,
      with_tabular_nums: withTabularNums,
      violations,
      pass: cells.length === 0 || violations.length === 0
    };
  }


  // ── TS-19: Justified Text Without Hyphenation ─────────────────

  function ts19() {
    const justified = allTextEls.filter(el =>
      window.getComputedStyle(el).textAlign === 'justify'
    );

    let withoutHyphens = 0;
    const violations = [];

    for (const el of justified) {
      let hasHyphens = false;
      let current = el;

      while (current && current !== document.body) {
        if (window.getComputedStyle(current).hyphens === 'auto') {
          hasHyphens = true;
          break;
        }
        current = current.parentElement;
      }

      if (!hasHyphens) {
        withoutHyphens++;
        if (violations.length < MAX_ITEMS) {
          violations.push({ selector: utils.getSelector(el) });
        }
      }
    }

    return {
      justified_elements: justified.length,
      without_hyphens: withoutHyphens,
      violations,
      pass: justified.length === 0 || withoutHyphens === 0
    };
  }


  // ── TS-20: Paragraph Separation Consistency ───────────────────

  function ts20() {
    let indentCount = 0;
    let spaceCount = 0;

    for (const el of paragraphs) {
      const style = window.getComputedStyle(el);
      const textIndent = parseFloat(style.textIndent) || 0;
      const mt = parseFloat(style.marginTop) || 0;
      const mb = parseFloat(style.marginBottom) || 0;
      const totalMargin = mt + mb;

      if (textIndent > 0 && totalMargin < 4) {
        indentCount++;
      } else if (totalMargin > 0 && textIndent === 0) {
        spaceCount++;
      }
    }

    const mixed = indentCount > 0 && spaceCount > 0;

    return {
      indent_count: indentCount,
      space_count: spaceCount,
      mixed,
      pass: !mixed
    };
  }


  // ── TS-21: Typeface Distortion Detection ──────────────────────

  function ts21() {
    let distortedElements = 0;
    const elements = [];

    for (const el of allTextEls) {
      const transform = window.getComputedStyle(el).transform;
      if (!transform || transform === 'none') continue;

      // Parse matrix(a, b, c, d, tx, ty) or matrix3d(...)
      const matrixMatch = transform.match(/^matrix\((.+)\)$/);
      if (!matrixMatch) continue;

      const values = matrixMatch[1].split(',').map(v => parseFloat(v.trim()));
      if (values.length < 6) continue;

      const scaleX = Math.round(values[0] * 1000) / 1000;
      const scaleY = Math.round(values[3] * 1000) / 1000;

      if (Math.abs(scaleX - scaleY) > 0.01) {
        distortedElements++;
        if (elements.length < MAX_ITEMS) {
          elements.push({
            selector: utils.getSelector(el),
            scaleX,
            scaleY
          });
        }
      }
    }

    return {
      distorted_elements: distortedElements,
      elements,
      pass: distortedElements === 0
    };
  }


  // ── TS-22: Heading Letter-Spacing ──────────────────────────────

  function ts22() {
    let largeHeadings = 0;
    let positiveTracking = 0;
    const violations = [];

    for (const el of headings) {
      const size = fontSize(el);
      if (size <= 30) continue;

      largeHeadings++;
      const style = window.getComputedStyle(el);
      const ls = parseFloat(style.letterSpacing) || 0;

      if (ls > 0) {
        positiveTracking++;
        if (violations.length < MAX_ITEMS) {
          violations.push({
            selector: utils.getSelector(el),
            size: Math.round(size * 100) / 100,
            letter_spacing: Math.round(ls * 100) / 100
          });
        }
      }
    }

    return {
      large_headings: largeHeadings,
      positive_tracking: positiveTracking,
      violations,
      pass: positiveTracking === 0
    };
  }


  // ── Assemble ────────────────────────────────────────────────────

  return {
    ts01_body_text_min_size:        ts01(),
    ts02_absolute_floor:            ts02(),
    ts03_line_length:               ts03(),
    ts04_body_line_height:          ts04(),
    ts05_headline_line_height:      ts05(),
    ts06_typeface_family_count:     ts06(),
    ts07_font_weight_count:         ts07(),
    ts08_type_scale:                ts08(),
    ts09_headline_size_jump:        ts09(),
    ts10_caps_letter_spacing:       ts10(),
    ts11_caps_word_count:           ts11(),
    ts12_centered_body_text:        ts12(),
    ts13_heading_semantic_visual:   ts13(),
    ts14_heading_space_asymmetry:   ts14(),
    ts15_straight_quotes:           ts15(),
    ts16_double_hyphens:            ts16(),
    ts17_faux_bold_italic:          ts17(),
    ts18_tabular_numerals:          ts18(),
    ts19_justified_hyphenation:     ts19(),
    ts20_paragraph_separation:      ts20(),
    ts21_typeface_distortion:       ts21(),
    ts22_heading_letter_spacing:    ts22()
  };
}

// DPT Layer 3: Spatial Rhythm
// Spacing scale, touch targets, proximity, elevation, alignment, whitespace
function spatialRhythm(utils) {

  const MAX_VIOLATIONS = 15;
  const MAX_SAMPLE = 300;

  // ─── Helpers ─────────────────────────────────────────────────────

  function parsePx(val) {
    if (!val || val === 'normal' || val === 'auto' || val === 'none') return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }

  function roundTo(n, decimals) {
    const f = Math.pow(10, decimals);
    return Math.round(n * f) / f;
  }

  function clusterValues(values, tolerance) {
    // Sort and merge values within tolerance into clusters
    if (!values.length) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const clusters = [];
    let current = { value: sorted[0], sum: sorted[0], count: 1 };

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - (current.sum / current.count) <= tolerance) {
        current.sum += sorted[i];
        current.count++;
      } else {
        clusters.push({ value: roundTo(current.sum / current.count, 1), count: current.count });
        current = { value: sorted[i], sum: sorted[i], count: 1 };
      }
    }
    clusters.push({ value: roundTo(current.sum / current.count, 1), count: current.count });
    return clusters;
  }

  // ─── SR-01: Spacing Scale Systematicity ──────────────────────────

  function sr01_spacingScale() {
    const allElements = utils.queryVisible('*');
    const sample = utils.sampleAcrossPage(allElements, MAX_SAMPLE);
    const spacingValues = [];

    for (const el of sample) {
      const cs = window.getComputedStyle(el);
      const props = [
        cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft,
        cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft,
        cs.gap, cs.rowGap, cs.columnGap
      ];
      for (const val of props) {
        const px = parsePx(val);
        if (px !== null && px > 0) {
          spacingValues.push(Math.round(px));
        }
      }
    }

    const detected = utils.detectBaseUnit(spacingValues);
    const baseUnit = detected.unit;
    const onGrid = spacingValues.filter(v => v % baseUnit === 0).length;
    const offGrid = spacingValues.length - onGrid;

    // Collect the actual off-grid values (deduplicated, sorted)
    const offGridSet = new Set();
    for (const v of spacingValues) {
      if (v % baseUnit !== 0) offGridSet.add(v);
    }
    const offGridValues = [...offGridSet].sort((a, b) => a - b).slice(0, 30);

    const consistency = spacingValues.length > 0
      ? roundTo(onGrid / spacingValues.length, 3)
      : 1;

    return {
      base_unit: baseUnit,
      confidence: detected.confidence,
      total_values: spacingValues.length,
      on_grid: onGrid,
      off_grid: offGrid,
      off_grid_values: offGridValues,
      consistency: consistency
    };
  }

  // ─── SR-02: Target Size ──────────────────────────────────────────
  // WCAG 2.5.8 (AA, 2023): minimum target size is 24x24 CSS px, with an
  // explicit exemption for targets that sit inline within a sentence or
  // block of text — the surrounding prose disambiguates the click. The
  // earlier 44px figure is Apple's touch-HIG number for finger-first
  // surfaces; on desktop pages it condemned inline evidence links and
  // 43px buttons, so 44 is reported as advisory context, never a failure.

  const TARGET_FLOOR_PX = 24;       // WCAG 2.5.8 target-size minimum
  const TOUCH_GUIDELINE_PX = 44;    // Apple HIG touch guideline (advisory)

  function isInlineTextTarget(el) {
    // Inline within text flow: the WCAG inline exemption. display:inline
    // (not inline-block — a styled chip/button opts back into the floor)
    // inside a prose container.
    const display = window.getComputedStyle(el).display;
    if (display !== 'inline') return false;
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (['P', 'LI', 'TD', 'TH', 'FIGCAPTION', 'BLOCKQUOTE'].includes(parent.tagName)) return true;
      if (window.getComputedStyle(parent).display !== 'inline') return false;
      parent = parent.parentElement;
    }
    return false;
  }

  function sr02_touchTargets() {
    const allElements = utils.queryVisible('*');
    const interactive = allElements.filter(el => utils.isInteractive(el) && utils.isOnPage(el));
    const violations = [];
    let undersized = 0;
    let inlineExempt = 0;
    let subTouchGuideline = 0;

    for (const el of interactive) {
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);

      if (w < TOUCH_GUIDELINE_PX || h < TOUCH_GUIDELINE_PX) subTouchGuideline++;

      if (w < TARGET_FLOOR_PX || h < TARGET_FLOOR_PX) {
        if (isInlineTextTarget(el)) {
          inlineExempt++;
          continue;
        }
        undersized++;
        if (violations.length < MAX_VIOLATIONS) {
          violations.push({
            selector: utils.getSelector(el),
            width: w,
            height: h
          });
        }
      }
    }

    return {
      total_interactive: interactive.length,
      floor_px: TARGET_FLOOR_PX,
      undersized: undersized,
      inline_exempt: inlineExempt,
      sub_touch_guideline_44: subTouchGuideline,
      violations: violations,
      pass: undersized === 0
    };
  }

  // ─── SR-03: Proximity Grouping (Label-Input) ────────────────────

  function sr03_proximityGrouping() {
    const labels = utils.queryVisible('label[for]');
    const pairs = [];
    const violations = [];

    for (const label of labels) {
      const forId = label.getAttribute('for');
      if (!forId) continue;
      const input = document.getElementById(forId);
      if (!input || !utils.isVisible(input)) continue;

      const labelRect = label.getBoundingClientRect();
      const inputRect = input.getBoundingClientRect();
      const gapToInput = utils.gap(labelRect, inputRect);

      // Find the previous visible element before the label
      let gapToPrevious = Infinity;
      let prev = label.previousElementSibling;

      // Walk backwards to find a visible previous sibling
      while (prev && !utils.isVisible(prev)) {
        prev = prev.previousElementSibling;
      }

      // If no previous sibling, try parent's previous sibling
      if (!prev && label.parentElement) {
        prev = label.parentElement.previousElementSibling;
        while (prev && !utils.isVisible(prev)) {
          prev = prev.previousElementSibling;
        }
      }

      if (prev) {
        const prevRect = prev.getBoundingClientRect();
        gapToPrevious = utils.gap(prevRect, labelRect);
      }

      const properlyGrouped = gapToInput <= gapToPrevious;
      pairs.push({ label: forId, properlyGrouped });

      if (!properlyGrouped && violations.length < MAX_VIOLATIONS) {
        violations.push({
          label: utils.getSelector(label),
          input: utils.getSelector(input),
          gap_to_input: Math.round(gapToInput),
          gap_to_previous: gapToPrevious === Infinity ? 'none' : Math.round(gapToPrevious)
        });
      }
    }

    const properlyGrouped = pairs.filter(p => p.properlyGrouped).length;

    return {
      pairs_checked: pairs.length,
      properly_grouped: properlyGrouped,
      violations: violations
    };
  }

  // ─── SR-04: Border Radius Consistency ────────────────────────────

  function sr04_borderRadius() {
    const allElements = utils.queryVisible('*');
    const sample = utils.sampleAcrossPage(allElements, MAX_SAMPLE);
    const radiiSet = new Set();

    for (const el of sample) {
      const cs = window.getComputedStyle(el);
      const br = cs.borderRadius;
      if (!br || br === '0px') continue;

      // borderRadius can be shorthand: "4px 4px 4px 4px" or "4px"
      // Take the first value as the representative token
      const first = br.split(/\s+/)[0];
      const px = parsePx(first);
      if (px !== null && px > 0) {
        radiiSet.add(Math.round(px));
      }
    }

    const distinctRadii = [...radiiSet].sort((a, b) => a - b);

    return {
      distinct_radii: distinctRadii,
      token_count: distinctRadii.length,
      pass: distinctRadii.length <= 4
    };
  }

  // ─── SR-05: Shadow Elevation System ──────────────────────────────

  function sr05_shadowElevation() {
    const allElements = utils.queryVisible('*');
    const sample = utils.sampleAcrossPage(allElements, MAX_SAMPLE);
    const shadows = [];

    for (const el of sample) {
      const cs = window.getComputedStyle(el);
      const bs = cs.boxShadow;
      if (!bs || bs === 'none') continue;

      // A single element can have multiple comma-separated shadows.
      // Split carefully: commas inside rgb()/rgba() should not split.
      // getComputedStyle normalizes to "rgb(r, g, b) Xpx Ypx Bpx Spx"
      const shadowParts = [];
      let depth = 0;
      let current = '';
      for (let i = 0; i < bs.length; i++) {
        const ch = bs[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
          shadowParts.push(current.trim());
          current = '';
          continue;
        }
        current += ch;
      }
      if (current.trim()) shadowParts.push(current.trim());

      for (const part of shadowParts) {
        // Extract numeric px values from the shadow string.
        // Computed form: "rgb(r, g, b) Xpx Ypx Bpx [Spx]"
        // Or with inset:  "inset rgb(r, g, b) Xpx Ypx Bpx [Spx]"
        // Strip color function and "inset", then grab px values.
        const stripped = part
          .replace(/rgba?\([^)]*\)/g, '')
          .replace(/inset/g, '')
          .trim();
        const pxValues = stripped.match(/-?[\d.]+px/g);
        if (!pxValues || pxValues.length < 2) continue;

        const xOffset = parseFloat(pxValues[0]);
        const yOffset = parseFloat(pxValues[1]);
        const blur = pxValues.length >= 3 ? parseFloat(pxValues[2]) : 0;

        shadows.push({ y_offset: yOffset, blur: blur });
      }
    }

    if (shadows.length === 0) {
      return {
        shadow_count: 0,
        elevation_levels: 0,
        direction_consistent: true,
        levels: [],
        pass: true
      };
    }

    // Check directional consistency: all y-offsets should be same sign (or zero)
    const nonZeroY = shadows.filter(s => s.y_offset !== 0);
    let directionConsistent = true;
    if (nonZeroY.length > 0) {
      const positive = nonZeroY.filter(s => s.y_offset > 0).length;
      const negative = nonZeroY.filter(s => s.y_offset < 0).length;
      directionConsistent = positive === 0 || negative === 0;
    }

    // Cluster by (y_offset, blur) to find elevation levels
    // Use combined metric: group shadows with similar y+blur signatures
    const signatures = shadows.map(s => ({
      y_offset: Math.round(s.y_offset),
      blur: Math.round(s.blur)
    }));

    // Deduplicate into level buckets
    const levelMap = new Map();
    for (const sig of signatures) {
      const key = `${sig.y_offset}|${sig.blur}`;
      if (!levelMap.has(key)) {
        levelMap.set(key, { y_offset: sig.y_offset, blur: sig.blur, count: 0 });
      }
      levelMap.get(key).count++;
    }

    const levels = [...levelMap.values()]
      .sort((a, b) => a.y_offset - b.y_offset || a.blur - b.blur);

    return {
      shadow_count: shadows.length,
      elevation_levels: levels.length,
      direction_consistent: directionConsistent,
      levels: levels,
      pass: directionConsistent && levels.length <= 5
    };
  }

  // ─── SR-06: Content Container Max-Width ──────────────────────────

  function sr06_containerMaxWidth() {
    const paragraphs = utils.queryVisible('p');
    const blowoutRisk = [];

    for (const p of paragraphs) {
      const text = p.textContent || '';
      if (text.trim().length < 20) continue; // skip trivially short paragraphs

      const rect = p.getBoundingClientRect();
      const cs = window.getComputedStyle(p);
      const fontSize = parseFloat(cs.fontSize) || 16;

      // Approximate ch width as ~0.5em for most proportional fonts
      const chWidth = fontSize * 0.5;
      const estimatedChars = Math.round(rect.width / chWidth);

      if (estimatedChars > 75) {
        // Check if the paragraph or any ancestor has a max-width constraint
        let constrained = false;
        let current = p;
        while (current && current !== document.body) {
          const style = window.getComputedStyle(current);
          const mw = style.maxWidth;
          if (mw && mw !== 'none' && mw !== '0px') {
            const mwPx = parsePx(mw);
            // Percentage max-widths still count as constrained
            if (mwPx !== null || mw.includes('%') || mw.includes('ch') || mw.includes('em')) {
              constrained = true;
              break;
            }
          }
          current = current.parentElement;
        }

        if (!constrained && blowoutRisk.length < MAX_VIOLATIONS) {
          blowoutRisk.push({
            selector: utils.getSelector(p),
            width: Math.round(rect.width),
            estimated_chars: estimatedChars
          });
        }
      }
    }

    return {
      unconstrained_containers: blowoutRisk.length,
      blowout_risk: blowoutRisk,
      pass: blowoutRisk.length === 0
    };
  }

  // ─── SR-07: Alignment Vector Detection ───────────────────────────

  function sr07_alignmentVectors() {
    const allElements = utils.queryVisible('*');
    const pageElements = allElements.filter(el => utils.isOnPage(el));
    const sample = utils.sampleAcrossPage(pageElements, MAX_SAMPLE);
    const TOLERANCE = 2;

    // Collect left and right edges
    const leftEdges = [];
    const rightEdges = [];
    const elementEdges = []; // track per-element for unaligned counting

    for (const el of sample) {
      const rect = el.getBoundingClientRect();
      const left = Math.round(rect.left);
      const right = Math.round(rect.right);
      leftEdges.push(left);
      rightEdges.push(right);
      elementEdges.push({ left, right });
    }

    const allEdges = [...leftEdges, ...rightEdges];
    const clusters = clusterValues(allEdges, TOLERANCE);

    // Only keep guides with multiple elements aligned
    const guides = clusters
      .filter(c => c.count >= 3)
      .sort((a, b) => b.count - a.count)
      .map(c => ({ x: c.value, element_count: c.count }));

    // Count elements that don't align with any guide
    let unalignedCount = 0;
    for (const edge of elementEdges) {
      const leftAligned = guides.some(g => Math.abs(edge.left - g.x) <= TOLERANCE);
      const rightAligned = guides.some(g => Math.abs(edge.right - g.x) <= TOLERANCE);
      if (!leftAligned && !rightAligned) {
        unalignedCount++;
      }
    }

    const alignmentScore = sample.length > 0
      ? roundTo(1 - (unalignedCount / sample.length), 3)
      : 1;

    return {
      alignment_guides: guides.slice(0, 20),
      unaligned_count: unalignedCount,
      alignment_score: alignmentScore
    };
  }

  // ─── SR-08: Whitespace Density Map ───────────────────────────────

  function sr08_whitespaceDensity() {
    const vw = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const documentHeight = utils.documentHeight();
    const cellW = vw / 4;
    const cellH = documentHeight / 4;

    // Initialize 4x4 grid of zeros (occupied pixels)
    const occupied = Array.from({ length: 4 }, () => Array(4).fill(0));
    const cellArea = cellW * cellH;

    const allElements = utils.queryVisible('*');
    const pageElements = allElements.filter(el => utils.isOnPage(el));
    const scrollY = window.scrollY || window.pageYOffset || 0;

    // For each element, add its overlap with each grid cell
    for (const el of pageElements) {
      const rect = el.getBoundingClientRect();
      const documentTop = rect.top + scrollY;
      const documentBottom = rect.bottom + scrollY;
      // Skip elements that are the full document (body, html, wrappers).
      if (rect.width >= vw * 0.98 && rect.height >= documentHeight * 0.98) continue;

      for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 4; col++) {
          const cellLeft = col * cellW;
          const cellTop = row * cellH;
          const cellRight = cellLeft + cellW;
          const cellBottom = cellTop + cellH;

          // Compute intersection area
          const overlapLeft = Math.max(rect.left, cellLeft);
          const overlapTop = Math.max(documentTop, cellTop);
          const overlapRight = Math.min(rect.right, cellRight);
          const overlapBottom = Math.min(documentBottom, cellBottom);

          if (overlapRight > overlapLeft && overlapBottom > overlapTop) {
            const area = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
            occupied[row][col] += area;
          }
        }
      }
    }

    // Compute density per cell (capped at 1.0 since elements can overlap)
    const grid = occupied.map(row =>
      row.map(val => roundTo(Math.min(val / cellArea, 1), 3))
    );

    const flat = grid.flat();
    const minDensity = roundTo(Math.min(...flat), 3);
    const maxDensity = roundTo(Math.max(...flat), 3);

    // Balance score: 1.0 means perfectly uniform, drops as variance grows
    const mean = flat.reduce((a, b) => a + b, 0) / flat.length;
    const variance = flat.reduce((sum, v) => sum + (v - mean) ** 2, 0) / flat.length;
    // Normalize: stddev of 0 = perfect balance (1.0), stddev of 0.5 = poor (0.0)
    const balanceScore = roundTo(Math.max(0, 1 - Math.sqrt(variance) * 2), 3);

    return {
      grid: grid,
      min_density: minDensity,
      max_density: maxDensity,
      balance_score: balanceScore,
      document_height: Math.round(documentHeight),
      bands_scanned: Math.max(1, Math.ceil(documentHeight / viewportHeight))
    };
  }

  // ─── SR-09: Body Text Margin Adequacy ────────────────────────────

  function sr09_bodyTextMarginAdequacy() {
    const paragraphs = utils.queryVisible('p');
    const pageParagraphs = paragraphs.filter(el => utils.isOnPage(el));
    const violations = [];
    let inadequateMargin = 0;

    for (const p of pageParagraphs) {
      const cs = window.getComputedStyle(p);
      const fontSize = parseFloat(cs.fontSize) || 16;
      const rect = p.getBoundingClientRect();
      const textLeft = rect.left + (parseFloat(cs.borderLeftWidth) || 0) +
        (parseFloat(cs.paddingLeft) || 0);
      const textRight = rect.right - (parseFloat(cs.borderRightWidth) || 0) -
        (parseFloat(cs.paddingRight) || 0);
      // Measure the rendered text inset from the actual page edges. This
      // naturally includes padding on any ancestor instead of accusing a
      // paragraph merely because its direct wrapper has zero padding.
      const leftSpace = Math.max(0, textLeft);
      const rightSpace = Math.max(0, window.innerWidth - textRight);

      // Minimum adequate margin is 1em (the paragraph's own font-size)
      if (leftSpace < fontSize || rightSpace < fontSize) {
        inadequateMargin++;
        if (violations.length < MAX_VIOLATIONS) {
          violations.push({
            selector: utils.getSelector(p),
            effective_left_space: roundTo(leftSpace, 1),
            effective_right_space: roundTo(rightSpace, 1),
            font_size: roundTo(fontSize, 1)
          });
        }
      }
    }

    return {
      paragraphs_checked: pageParagraphs.length,
      inadequate_margin: inadequateMargin,
      violations: violations,
      pass: inadequateMargin === 0
    };
  }

  // ─── SR-10: Shadow Color Temperature ────────────────────────────

  function sr10_shadowColorTemperature() {
    const allElements = utils.queryVisible('*');
    const sample = utils.sampleAcrossPage(allElements, MAX_SAMPLE);
    let shadowsFound = 0;
    let achromaticShadows = 0;
    let tintedShadows = 0;

    for (const el of sample) {
      const cs = window.getComputedStyle(el);
      const bs = cs.boxShadow;
      if (!bs || bs === 'none') continue;

      // Split comma-separated shadows (respecting parentheses)
      const shadowParts = [];
      let depth = 0;
      let current = '';
      for (let i = 0; i < bs.length; i++) {
        const ch = bs[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
          shadowParts.push(current.trim());
          current = '';
          continue;
        }
        current += ch;
      }
      if (current.trim()) shadowParts.push(current.trim());

      for (const part of shadowParts) {
        // Extract the color function from the shadow string
        const colorMatch = part.match(/rgba?\([^)]*\)/);
        if (!colorMatch) continue;

        const parsed = utils.parseColor(colorMatch[0]);
        if (!parsed || parsed.a === 0) continue;

        shadowsFound++;
        const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);

        if (hsl.s < 5) {
          achromaticShadows++;
        } else {
          tintedShadows++;
        }
      }
    }

    return {
      shadows_found: shadowsFound,
      achromatic_shadows: achromaticShadows,
      tinted_shadows: tintedShadows,
      pass: shadowsFound === 0 || tintedShadows > achromaticShadows
    };
  }

  // ─── Assemble and Return ─────────────────────────────────────────

  return {
    sr01_spacing_scale: sr01_spacingScale(),
    sr02_touch_targets: sr02_touchTargets(),
    sr03_proximity_grouping: sr03_proximityGrouping(),
    sr04_border_radius: sr04_borderRadius(),
    sr05_shadow_elevation: sr05_shadowElevation(),
    sr06_container_max_width: sr06_containerMaxWidth(),
    sr07_alignment_vectors: sr07_alignmentVectors(),
    sr08_whitespace_density: sr08_whitespaceDensity(),
    sr09_body_text_margin: sr09_bodyTextMarginAdequacy(),
    sr10_shadow_color_temperature: sr10_shadowColorTemperature()
  };
}

// DPT Layer 4: Attention Architecture
// Visual hierarchy, affordances, interaction patterns, navigation

function attentionArchitecture(utils) {

  const MAX_ITEMS = 15;

  // ─── Shared collection: gather visible elements once ──────────────

  const allVisible = utils.queryVisible('*');
  const pageElements = allVisible.filter(el => utils.isOnPage(el));
  const weightedPageElements = utils.sampleAcrossPage(pageElements, 300);
  const interactiveElements = allVisible.filter(el => utils.isInteractive(el));
  const vw = window.innerWidth;
  const scanHeight = utils.documentHeight();

  // ─── AA-01: Visual Weight Ranking ─────────────────────────────────

  function aa01_visualWeightRanking() {
    const rects = new Map();
    const scored = [];

    // Pre-compute rects for all rendered page elements.
    for (const el of weightedPageElements) {
      rects.set(el, el.getBoundingClientRect());
    }

    for (const el of weightedPageElements) {
      const rect = rects.get(el);
      if (rect.width < 2 || rect.height < 2) continue;

      const style = window.getComputedStyle(el);

      // Size weight: fraction of the full scanned document area.
      const sizeWeight = (rect.width * rect.height) / (vw * scanHeight);

      // Contrast weight: element foreground or background vs effective bg
      const fg = utils.parseColor(style.color);
      const bg = utils.getEffectiveBackground(el);
      let contrastWeight = 0;
      if (fg && bg) {
        contrastWeight = utils.contrastRatio(fg, bg) / 21;
      }

      // Saturation weight: from the element's most prominent color
      let saturationWeight = 0;
      for (const prop of ['color', 'backgroundColor', 'borderColor']) {
        const parsed = utils.parseColor(style[prop]);
        if (parsed && parsed.a > 0.1) {
          const hsl = utils.rgbToHsl(parsed.r, parsed.g, parsed.b);
          saturationWeight = Math.max(saturationWeight, hsl.s / 100);
        }
      }

      // Isolation weight: 1 / (1 + nearby count within 50px)
      let nearbyCount = 0;
      for (const other of weightedPageElements) {
        if (other === el) continue;
        const otherRect = rects.get(other);
        if (utils.areAdjacent(rect, otherRect, 50)) {
          nearbyCount++;
        }
      }
      const isolationWeight = 1 / (1 + nearbyCount);

      const weight = (
        sizeWeight * 0.3 +
        contrastWeight * 0.3 +
        saturationWeight * 0.2 +
        isolationWeight * 0.2
      );

      scored.push({
        el,
        selector: utils.getSelector(el),
        text: (el.textContent || '').trim().slice(0, 60),
        weight: Math.round(weight * 10000) / 10000
      });
    }

    // Rank by weight descending, take top 10
    scored.sort((a, b) => b.weight - a.weight);
    const top10 = scored.slice(0, 10);
    const rankings = top10.map((item, i) => ({
      selector: item.selector,
      text: item.text,
      weight: item.weight,
      rank: i + 1
    }));

    const weights = rankings.map(r => r.weight);
    const weightSpread = weights.length >= 2
      ? Math.round((weights[0] - weights[weights.length - 1]) * 10000) / 10000
      : 0;

    return {
      rankings,
      dominant_element: rankings.length > 0 ? rankings[0].selector : null,
      weight_spread: weightSpread
    };
  }

  // ─── AA-02: Button Hierarchy ──────────────────────────────────────

  function aa02_buttonHierarchy() {
    // Detect page theme: dark if body/html bg luminance < 0.2
    const pageBg = utils.getEffectiveBackground(document.body);
    const pageLum = pageBg
      ? utils.relativeLuminance(pageBg.r, pageBg.g, pageBg.b)
      : 0.95;
    const isDarkMode = pageLum < 0.2;

    // Collect all button-like elements
    const buttons = [];

    // <button> and [role="button"]
    const btnEls = utils.queryVisible('button, [role="button"]');
    for (const el of btnEls) {
      if (utils.isOnPage(el)) buttons.push(el);
    }

    // <a> styled as buttons: must have a visible background or border
    const links = utils.queryVisible('a');
    for (const el of links) {
      if (!utils.isOnPage(el)) continue;
      const style = window.getComputedStyle(el);
      const bg = utils.parseColor(style.backgroundColor);
      const border = parseFloat(style.borderWidth) || 0;
      if ((bg && bg.a > 0.1) || border >= 1) {
        if (!el.hasAttribute('role') || el.getAttribute('role') !== 'button') {
          buttons.push(el);
        }
      }
    }

    let primary = 0;
    let secondary = 0;
    let tertiary = 0;
    let unclassified = 0;
    const primaryButtons = [];

    for (const el of buttons) {
      const style = window.getComputedStyle(el);
      const bg = utils.parseColor(style.backgroundColor);
      const borderWidth = parseFloat(style.borderWidth) || 0;
      const borderColor = utils.parseColor(style.borderColor);

      const hasVisibleBg = bg && bg.a > 0.1;
      const hasVisibleBorder = borderWidth >= 1 &&
        borderColor && borderColor.a > 0.1;

      // Theme-aware classification
      let isPrimary = false;

      if (hasVisibleBg) {
        const bgLum = utils.relativeLuminance(bg.r, bg.g, bg.b);
        const bgHsl = utils.rgbToHsl(bg.r, bg.g, bg.b);

        if (isDarkMode) {
          // Dark mode: primary = high contrast against page bg
          // A button that stands out (light fill on dark page, or saturated fill)
          const contrastVsPage = pageBg
            ? utils.contrastRatio(bg, pageBg)
            : 1;
          isPrimary = contrastVsPage >= 3 && (bgLum > pageLum + 0.1 || bgHsl.s > 30);
        } else {
          // Light mode: primary = saturated, non-white fill
          const isWhiteBg = bg.r > 240 && bg.g > 240 && bg.b > 240;
          isPrimary = !isWhiteBg && bgHsl.s > 30;
        }
      }

      if (isPrimary) {
        primary++;
        if (primaryButtons.length < MAX_ITEMS) {
          primaryButtons.push({
            selector: utils.getSelector(el),
            text: (el.textContent || '').trim().slice(0, 60)
          });
        }
        continue;
      }

      // Secondary: outlined/bordered without strong fill
      const isTransparentBg = !hasVisibleBg;
      const isSubtleBg = hasVisibleBg && (() => {
        const contrast = pageBg ? utils.contrastRatio(bg, pageBg) : 1;
        return contrast < 1.5;
      })();

      if (hasVisibleBorder && (isTransparentBg || isSubtleBg)) {
        secondary++;
        continue;
      }

      // Tertiary: ghost button — no visible bg distinction, no border
      if ((isTransparentBg || isSubtleBg) && !hasVisibleBorder) {
        tertiary++;
        continue;
      }

      unclassified++;
    }

    return {
      primary,
      secondary,
      tertiary,
      unclassified,
      primary_buttons: primaryButtons,
      pass: primary === 1
    };
  }

  // ─── AA-03: Interactive Affordance ────────────────────────────────

  function aa03_interactiveAffordance() {
    const pageInteractive = interactiveElements.filter(el =>
      utils.isOnPage(el)
    );

    let withAffordance = 0;
    const weakAffordance = [];

    for (const el of pageInteractive) {
      const style = window.getComputedStyle(el);
      const issues = [];

      // Check cursor: pointer
      const hasCursorPointer = style.cursor === 'pointer';

      // Check distinct color from parent text
      let hasDistinctColor = false;
      if (el.parentElement) {
        const parentStyle = window.getComputedStyle(el.parentElement);
        const elColor = utils.parseColor(style.color);
        const parentColor = utils.parseColor(parentStyle.color);
        if (elColor && parentColor) {
          const dist = utils.ciede2000(elColor, parentColor);
          hasDistinctColor = dist > 10;
        }
      }

      // Check underline (for links in text)
      const hasUnderline = style.textDecorationLine.includes('underline') ||
        style.textDecoration.includes('underline');

      // Check background/border distinguishing it
      const bg = utils.parseColor(style.backgroundColor);
      const hasVisibleBg = bg && bg.a > 0.1 &&
        !(bg.r > 245 && bg.g > 245 && bg.b > 245);
      const borderWidth = parseFloat(style.borderWidth) || 0;
      const borderColor = utils.parseColor(style.borderColor);
      const hasVisibleBorder = borderWidth >= 1 &&
        borderColor && borderColor.a > 0.1;

      const affordanceSignals = [
        hasCursorPointer,
        hasDistinctColor,
        hasUnderline,
        hasVisibleBg,
        hasVisibleBorder
      ];

      const signalCount = affordanceSignals.filter(Boolean).length;

      if (signalCount >= 1) {
        withAffordance++;
      } else {
        if (!hasCursorPointer) issues.push('no cursor:pointer');
        if (!hasDistinctColor) issues.push('color same as parent');
        if (!hasUnderline) issues.push('no underline');
        if (!hasVisibleBg && !hasVisibleBorder) issues.push('no bg/border distinction');

        if (weakAffordance.length < MAX_ITEMS) {
          weakAffordance.push({
            selector: utils.getSelector(el),
            tag: el.tagName.toLowerCase(),
            issues
          });
        }
      }
    }

    return {
      total: pageInteractive.length,
      with_affordance: withAffordance,
      weak_affordance: weakAffordance,
      pass: weakAffordance.length === 0
    };
  }

  // ─── AA-04: Icon Text Labels ──────────────────────────────────────

  function aa04_iconTextLabels() {
    let iconsFound = 0;
    let withLabels = 0;
    const withoutLabels = [];

    // Find SVGs and small images inside interactive elements
    for (const interactive of interactiveElements) {
      if (!utils.isOnPage(interactive)) continue;

      const icons = interactive.querySelectorAll('svg, img');
      for (const icon of icons) {
        // For img, check if it's small (icon-sized)
        if (icon.tagName === 'IMG') {
          const rect = icon.getBoundingClientRect();
          if (rect.width >= 40) continue;
        }

        iconsFound++;

        // Check for labeling mechanisms
        let hasLabel = false;

        // 1. Adjacent visible text sibling
        const parent = icon.parentElement;
        if (parent) {
          const siblings = Array.from(parent.childNodes);
          for (const sib of siblings) {
            if (sib === icon) continue;
            if (sib.nodeType === Node.TEXT_NODE) {
              const text = sib.textContent.trim();
              if (text.length > 0) { hasLabel = true; break; }
            }
            if (sib.nodeType === Node.ELEMENT_NODE) {
              const sibEl = /** @type {Element} */ (sib);
              if (sibEl.textContent && sibEl.textContent.trim().length > 0) {
                const sibStyle = window.getComputedStyle(sibEl);
                if (sibStyle.display !== 'none' && sibStyle.visibility !== 'hidden') {
                  hasLabel = true;
                  break;
                }
              }
            }
          }
        }

        // 2. aria-label on icon or parent interactive element
        if (!hasLabel) {
          if (icon.getAttribute('aria-label') ||
              interactive.getAttribute('aria-label') ||
              interactive.getAttribute('aria-labelledby')) {
            hasLabel = true;
          }
        }

        // 3. title attribute on the icon
        if (!hasLabel) {
          if (icon.getAttribute('title')) {
            hasLabel = true;
          }
        }

        if (hasLabel) {
          withLabels++;
        } else {
          if (withoutLabels.length < MAX_ITEMS) {
            withoutLabels.push({
              selector: utils.getSelector(icon),
              parent_text: (interactive.textContent || '').trim().slice(0, 60)
            });
          }
        }
      }
    }

    return {
      icons_found: iconsFound,
      with_labels: withLabels,
      without_labels: withoutLabels,
      pass: withoutLabels.length === 0
    };
  }

  // ─── AA-05: Link Affordance in Body Text ──────────────────────────

  function aa05_linkAffordanceInBody() {
    // Find <a> elements inside prose containers
    const proseContainers = utils.queryVisible('p, li, td');
    let inlineLinks = 0;
    let withUnderline = 0;
    let withDistinctColor = 0;
    let bareLinks = 0;

    for (const container of proseContainers) {
      const links = container.querySelectorAll('a');
      for (const link of links) {
        if (!utils.isVisible(link)) continue;
        inlineLinks++;

        const linkStyle = window.getComputedStyle(link);
        const containerStyle = window.getComputedStyle(container);

        // Check underline
        const hasUnderline = linkStyle.textDecorationLine.includes('underline') ||
          linkStyle.textDecoration.includes('underline');

        // Check distinct color from surrounding text
        const linkColor = utils.parseColor(linkStyle.color);
        const containerColor = utils.parseColor(containerStyle.color);
        let hasDistinct = false;
        if (linkColor && containerColor) {
          const dist = utils.ciede2000(linkColor, containerColor);
          hasDistinct = dist > 10;
        }

        if (hasUnderline) withUnderline++;
        if (hasDistinct) withDistinctColor++;

        if (!hasUnderline && !hasDistinct) {
          bareLinks++;
        }
      }
    }

    return {
      inline_links: inlineLinks,
      with_underline: withUnderline,
      with_distinct_color: withDistinctColor,
      bare_links: bareLinks,
      pass: bareLinks === 0
    };
  }

  // ─── AA-06: Form Label Presence ───────────────────────────────────

  function aa06_formLabelPresence() {
    const fields = allVisible.filter(el => utils.isFormField(el));
    let withVisibleLabel = 0;
    let placeholderOnly = 0;
    let noLabel = 0;
    const violations = [];

    for (const field of fields) {
      const id = field.id;
      const placeholder = field.getAttribute('placeholder');
      let hasVisibleLabel = false;

      // 1. Check for <label for="id"> matching this field
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label && utils.isVisible(label)) {
          hasVisibleLabel = true;
        }
      }

      // 2. Check for wrapping <label>
      if (!hasVisibleLabel) {
        let parent = field.parentElement;
        while (parent && parent !== document.body) {
          if (parent.tagName === 'LABEL') {
            // Verify the label has text beyond just the field itself
            const labelText = parent.textContent.replace(field.textContent || '', '').trim();
            if (labelText.length > 0 && utils.isVisible(parent)) {
              hasVisibleLabel = true;
            }
            break;
          }
          parent = parent.parentElement;
        }
      }

      // 3. Check aria-label / aria-labelledby as visible label proxy
      if (!hasVisibleLabel) {
        const ariaLabelledBy = field.getAttribute('aria-labelledby');
        if (ariaLabelledBy) {
          const labelEl = document.getElementById(ariaLabelledBy);
          if (labelEl && utils.isVisible(labelEl)) {
            hasVisibleLabel = true;
          }
        }
      }

      if (hasVisibleLabel) {
        withVisibleLabel++;
      } else if (placeholder) {
        placeholderOnly++;
        if (violations.length < MAX_ITEMS) {
          violations.push({
            selector: utils.getSelector(field),
            type: field.type || field.tagName.toLowerCase(),
            issue: 'placeholder_only'
          });
        }
      } else {
        noLabel++;
        if (violations.length < MAX_ITEMS) {
          violations.push({
            selector: utils.getSelector(field),
            type: field.type || field.tagName.toLowerCase(),
            issue: 'no_label'
          });
        }
      }
    }

    return {
      fields: fields.length,
      with_visible_label: withVisibleLabel,
      placeholder_only: placeholderOnly,
      no_label: noLabel,
      violations,
      pass: placeholderOnly === 0 && noLabel === 0
    };
  }

  // ─── AA-07: Disabled Button Count ─────────────────────────────────

  function aa07_disabledButtons() {
    const disabledBtns = utils.queryVisible(
      'button[disabled], button[aria-disabled="true"], ' +
      '[role="button"][disabled], [role="button"][aria-disabled="true"]'
    );

    const elements = [];
    for (const el of disabledBtns) {
      if (elements.length >= MAX_ITEMS) break;
      elements.push({
        selector: utils.getSelector(el),
        text: (el.textContent || '').trim().slice(0, 60)
      });
    }

    return {
      disabled_count: disabledBtns.length,
      elements
    };
  }

  // ─── AA-08: Generic Link Text ─────────────────────────────────────

  function aa08_genericLinkText() {
    const BLOCKLIST = [
      'learn more', 'read more', 'click here', 'more',
      'here', 'link', 'info', 'details',
      'view all', 'see more', 'explore', 'view details', 'find out more'
    ];

    const allLinks = utils.queryVisible('a');
    const samples = [];

    for (const el of allLinks) {
      const text = (el.textContent || '').trim();
      const normalized = text.toLowerCase();

      if (BLOCKLIST.includes(normalized)) {
        if (samples.length < MAX_ITEMS) {
          samples.push({
            selector: utils.getSelector(el),
            text
          });
        }
      }
    }

    return {
      generic_links: samples.length,
      samples,
      pass: samples.length === 0
    };
  }

  // ─── AA-09: Navigation Item Count ─────────────────────────────────

  function aa09_navigationItemCount() {
    const navElements = utils.queryVisible('nav, [role="navigation"]');
    const itemsPerNav = [];
    let allPass = true;

    function isNavItem(el) {
      if (!utils.isVisible(el)) return false;
      const tag = el.tagName;
      // Direct interactive elements
      if (tag === 'A' || tag === 'BUTTON') return true;
      // Radix/headless UI triggers and menu items
      const role = el.getAttribute('role');
      if (role === 'menuitem' || role === 'tab' || role === 'link' || role === 'button') return true;
      return false;
    }

    function collectNavItems(container) {
      // Resilient approach: query all interactive elements within the nav,
      // filter to visible ones with text. Works regardless of nesting depth
      // (handles Radix, Headless UI, and other framework-generated markup).
      const selector = 'a, button, [role="menuitem"], [role="tab"], [role="link"]';
      const all = container.querySelectorAll(selector);
      const items = [];
      const seenText = new Set();

      for (const el of all) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (!utils.isVisible(el)) continue;
        const text = (el.textContent || '').trim();
        if (!text) continue;
        // Deduplicate by text content (dropdown trigger + link often share text)
        if (seenText.has(text)) continue;
        seenText.add(text);
        items.push(el);
      }

      return items;
    }

    for (const nav of navElements) {
      const items = collectNavItems(nav);
      const count = items.length;
      const navPass = count <= 7;
      if (!navPass) allPass = false;

      if (itemsPerNav.length < MAX_ITEMS) {
        itemsPerNav.push({
          selector: utils.getSelector(nav),
          count,
          pass: navPass
        });
      }
    }

    return {
      nav_elements: navElements.length,
      items_per_nav: itemsPerNav,
      pass: allPass
    };
  }

  // ─── AA-10: Tab Order vs Visual Order ─────────────────────────────

  function aa10_tabOrderVisualOrder() {
    // Collect all focusable elements in DOM (tab) order
    const focusableSelector = [
      'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])', 'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])', '[role="button"]:not([aria-disabled="true"])'
    ].join(', ');

    // Sticky/fixed elements (decision bars, floating actions) live at the
    // END of the DOM but render pinned mid-viewport — their geometry is
    // detached from document flow, so comparing it against reading order
    // manufactures a mismatch that no keyboard user experiences.
    function inStickyOrFixed(el) {
      let node = el;
      while (node && node !== document.body) {
        const position = window.getComputedStyle(node).position;
        if (position === 'sticky' || position === 'fixed') return true;
        node = node.parentElement;
      }
      return false;
    }

    const allFocusable = Array.from(document.querySelectorAll(focusableSelector))
      .filter(el => utils.isVisible(el) && utils.isOnPage(el) && !inStickyOrFixed(el));

    // Separate elements with explicit tabindex > 0 from natural order
    const withTabindex = [];
    const naturalOrder = [];

    for (const el of allFocusable) {
      const ti = parseInt(el.getAttribute('tabindex'), 10);
      if (ti > 0) {
        withTabindex.push({ el, tabindex: ti });
      } else {
        naturalOrder.push(el);
      }
    }

    // Tab order: explicit tabindex first (sorted ascending), then natural DOM order
    withTabindex.sort((a, b) => a.tabindex - b.tabindex);
    const tabOrder = [...withTabindex.map(w => w.el), ...naturalOrder];

    // Compare: check if next tab-stop is visually before current
    let mismatches = 0;

    for (let i = 1; i < tabOrder.length; i++) {
      const prevRect = tabOrder[i - 1].getBoundingClientRect();
      const currRect = tabOrder[i].getBoundingClientRect();

      // Reading order: top-to-bottom, left-to-right
      // A mismatch occurs when the next focusable element is visually
      // above the previous one (more than a row-height tolerance)
      const rowTolerance = 10; // px — elements on the same visual row
      if (currRect.top < prevRect.top - rowTolerance) {
        mismatches++;
      } else if (
        Math.abs(currRect.top - prevRect.top) <= rowTolerance &&
        currRect.left < prevRect.left - rowTolerance
      ) {
        // Same row but goes backward (right-to-left in LTR layout)
        mismatches++;
      }
    }

    return {
      focusable_count: tabOrder.length,
      order_mismatches: mismatches,
      pass: mismatches === 0
    };
  }

  // ─── AA-11: Form Field Border Contrast ──────────────────────────

  function aa11_formFieldBorderContrast() {
    const fieldSelector = 'input, select, textarea';
    const skipTypes = ['hidden', 'submit', 'button'];
    const fields = utils.queryVisible(fieldSelector).filter(el => {
      if (!utils.isOnPage(el)) return false;
      const type = (el.getAttribute('type') || '').toLowerCase();
      return !skipTypes.includes(type);
    });

    let adequateContrast = 0;
    const violations = [];

    for (const el of fields) {
      const style = window.getComputedStyle(el);
      const borderColor = utils.parseColor(style.borderColor);
      if (!borderColor || borderColor.a < 0.05) continue;

      const bg = utils.getEffectiveBackground(el);
      if (!bg) continue;

      const contrast = utils.contrastRatio(borderColor, bg);

      if (contrast >= 3) {
        adequateContrast++;
      } else {
        if (violations.length < MAX_ITEMS) {
          violations.push({
            selector: utils.getSelector(el),
            contrast: Math.round(contrast * 100) / 100,
            border_color: `rgb(${borderColor.r},${borderColor.g},${borderColor.b})`,
            background: `rgb(${bg.r},${bg.g},${bg.b})`
          });
        }
      }
    }

    return {
      fields_checked: fields.length,
      adequate_contrast: adequateContrast,
      violations: violations,
      pass: violations.length === 0
    };
  }

  // ─── AA-12: Generic Button Text ──────────────────────────────────

  function aa12_genericButtonText() {
    const BLOCKLIST = [
      'submit', 'ok', 'yes', 'no', 'cancel', 'click here',
      'learn more', 'read more', 'continue', 'next', 'back', 'go', 'send'
    ];

    // Collect all button-like elements
    const buttons = [];

    const btnEls = utils.queryVisible('button, [role="button"]');
    for (const el of btnEls) {
      if (utils.isOnPage(el)) buttons.push(el);
    }

    const links = utils.queryVisible('a');
    for (const el of links) {
      if (!utils.isOnPage(el)) continue;
      const style = window.getComputedStyle(el);
      const bg = utils.parseColor(style.backgroundColor);
      const border = parseFloat(style.borderWidth) || 0;
      if ((bg && bg.a > 0.1) || border >= 1) {
        if (!el.hasAttribute('role') || el.getAttribute('role') !== 'button') {
          buttons.push(el);
        }
      }
    }

    let genericLabels = 0;
    const samples = [];

    for (const el of buttons) {
      const text = (el.textContent || '').trim();
      const normalized = text.toLowerCase();

      if (BLOCKLIST.includes(normalized)) {
        genericLabels++;
        if (samples.length < MAX_ITEMS) {
          samples.push({
            selector: utils.getSelector(el),
            text
          });
        }
      }
    }

    return {
      buttons_checked: buttons.length,
      generic_labels: genericLabels,
      samples,
      pass: genericLabels === 0
    };
  }

  // ─── AA-16: Destructive Action Visual Weight ───────────────────────

  function aa16_destructiveActionWeight() {
    const DESTRUCTIVE_PATTERNS = [
      'delete', 'remove', 'cancel', 'destroy',
      'clear all', 'reset', 'revoke', 'disable'
    ];

    // Detect page theme (same as AA-02)
    const pageBg = utils.getEffectiveBackground(document.body);
    const pageLum = pageBg
      ? utils.relativeLuminance(pageBg.r, pageBg.g, pageBg.b)
      : 0.95;
    const isDarkMode = pageLum < 0.2;

    // Collect all button-like elements (same collection as AA-02)
    const buttons = [];

    const btnEls = utils.queryVisible('button, [role="button"]');
    for (const el of btnEls) {
      if (utils.isOnPage(el)) buttons.push(el);
    }

    const links = utils.queryVisible('a');
    for (const el of links) {
      if (!utils.isOnPage(el)) continue;
      const style = window.getComputedStyle(el);
      const bg = utils.parseColor(style.backgroundColor);
      const border = parseFloat(style.borderWidth) || 0;
      if ((bg && bg.a > 0.1) || border >= 1) {
        if (!el.hasAttribute('role') || el.getAttribute('role') !== 'button') {
          buttons.push(el);
        }
      }
    }

    let destructiveButtons = 0;
    let destructiveAsPrimary = 0;
    const violations = [];

    for (const el of buttons) {
      const text = (el.textContent || '').trim();
      const normalized = text.toLowerCase();

      const isDestructive = DESTRUCTIVE_PATTERNS.some(p => normalized === p);
      if (!isDestructive) continue;

      destructiveButtons++;

      // Check if button is classified as primary (same isPrimary logic as AA-02)
      const style = window.getComputedStyle(el);
      const bg = utils.parseColor(style.backgroundColor);
      const hasVisibleBg = bg && bg.a > 0.1;

      let isPrimary = false;

      if (hasVisibleBg) {
        const bgLum = utils.relativeLuminance(bg.r, bg.g, bg.b);
        const bgHsl = utils.rgbToHsl(bg.r, bg.g, bg.b);

        if (isDarkMode) {
          const contrastVsPage = pageBg
            ? utils.contrastRatio(bg, pageBg)
            : 1;
          isPrimary = contrastVsPage >= 3 && (bgLum > pageLum + 0.1 || bgHsl.s > 30);
        } else {
          const isWhiteBg = bg.r > 240 && bg.g > 240 && bg.b > 240;
          isPrimary = !isWhiteBg && bgHsl.s > 30;
        }
      }

      if (isPrimary) {
        destructiveAsPrimary++;
        if (violations.length < MAX_ITEMS) {
          violations.push({
            selector: utils.getSelector(el),
            text
          });
        }
      }
    }

    return {
      destructive_buttons: destructiveButtons,
      destructive_as_primary: destructiveAsPrimary,
      violations,
      pass: destructiveAsPrimary === 0
    };
  }

  // ─── Execute all checks and assemble result ───────────────────────

  return {
    aa01_visual_weight_ranking: aa01_visualWeightRanking(),
    aa02_button_hierarchy: aa02_buttonHierarchy(),
    aa03_interactive_affordance: aa03_interactiveAffordance(),
    aa04_icon_text_labels: aa04_iconTextLabels(),
    aa05_link_affordance_body: aa05_linkAffordanceInBody(),
    aa06_form_label_presence: aa06_formLabelPresence(),
    aa07_disabled_buttons: aa07_disabledButtons(),
    aa08_generic_link_text: aa08_genericLinkText(),
    aa09_navigation_item_count: aa09_navigationItemCount(),
    aa10_tab_order_visual: aa10_tabOrderVisualOrder(),
    aa11_form_field_border_contrast: aa11_formFieldBorderContrast(),
    aa12_generic_button_text: aa12_genericButtonText(),
    aa16_destructive_action_weight: aa16_destructiveActionWeight()
  };
}

// DPT Layer 5: Coherence
// Design system consistency, token adherence, component drift, animation bounds

function coherence(utils) {

  const MAX_ITEMS = 15;
  const MAX_DRIFT_ELEMENTS = 200;

  const allVisible = utils.queryVisible('*');

  // ─── Shared: Extract CSS Custom Properties ─────────────────────────

  function extractCustomProperties() {
    const colorTokens = new Map();   // name -> {r,g,b,a}
    const spacingTokens = [];        // numeric px values
    const typeTokens = [];           // numeric px values

    // 1. Scan :root computed style for --* properties
    const rootStyle = window.getComputedStyle(document.documentElement);

    // 2. Iterate stylesheets to find declared custom properties
    const declaredProps = new Map(); // prop name -> raw value
    for (const sheet of document.styleSheets) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) continue;
        for (const rule of rules) {
          if (rule.type !== CSSRule.STYLE_RULE) continue;
          // Look at :root, html, body declarations
          if (!rule.selectorText || !rule.selectorText.match(/(:root|html|body)/i)) continue;
          for (let i = 0; i < rule.style.length; i++) {
            const prop = rule.style[i];
            if (prop.startsWith('--')) {
              declaredProps.set(prop, rule.style.getPropertyValue(prop).trim());
            }
          }
        }
      } catch (e) {
        // Cross-origin stylesheet — skip silently
      }
    }

    // Also read from computed style on :root (catches properties set by JS or inline)
    // getComputedStyle doesn't enumerate custom properties directly,
    // so we rely on the stylesheet scan above plus inline style on documentElement
    const inlineStyle = document.documentElement.style;
    for (let i = 0; i < inlineStyle.length; i++) {
      const prop = inlineStyle[i];
      if (prop.startsWith('--')) {
        declaredProps.set(prop, inlineStyle.getPropertyValue(prop).trim());
      }
    }

    // Classify each custom property
    for (const [name, rawValue] of declaredProps) {
      const resolved = rootStyle.getPropertyValue(name).trim() || rawValue;
      const lower = name.toLowerCase();

      // Attempt color parse
      const colorParsed = utils.parseColor(resolved);
      if (colorParsed) {
        colorTokens.set(name, colorParsed);
        continue;
      }

      // Check if it looks like a color token by name heuristic even if parse fails
      // (e.g. references another variable)
      const isColorName = /color|bg|background|border|text|fill|stroke|accent|primary|secondary|success|danger|warning|info|neutral|surface|foreground/i.test(lower);

      // Spacing tokens: numeric px/rem values in spacing/gap/margin/padding named vars
      const isSpacingName = /spacing|space|gap|margin|padding|gutter|indent|size|offset/i.test(lower);
      const pxMatch = resolved.match(/^(-?[\d.]+)\s*px$/);
      const remMatch = resolved.match(/^(-?[\d.]+)\s*rem$/);

      if (isSpacingName && (pxMatch || remMatch)) {
        const px = pxMatch ? parseFloat(pxMatch[1]) : parseFloat(remMatch[1]) * 16;
        spacingTokens.push(px);
        continue;
      }

      // Type scale tokens: font-size related
      const isTypeName = /font-size|type|text-size|heading|body-size|fs-/i.test(lower);
      if (isTypeName && (pxMatch || remMatch)) {
        const px = pxMatch ? parseFloat(pxMatch[1]) : parseFloat(remMatch[1]) * 16;
        typeTokens.push(px);
        continue;
      }

      // If it has a color-like name and we couldn't parse, try evaluating via temp element
      if (isColorName) {
        const temp = document.createElement('div');
        temp.style.color = resolved;
        document.body.appendChild(temp);
        const computed = window.getComputedStyle(temp).color;
        document.body.removeChild(temp);
        const parsed = utils.parseColor(computed);
        if (parsed) {
          colorTokens.set(name, parsed);
        }
      }
    }

    return { colorTokens, spacingTokens, typeTokens };
  }

  const tokens = extractCustomProperties();

  // ─── CO-01: Color Token Consistency ──────────────────────────────

  function co01_colorTokenConsistency() {
    const RGB_TOLERANCE = 2;
    const usedColorMap = new Map(); // hex -> count

    for (const el of allVisible) {
      const style = window.getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderColor', 'outlineColor']) {
        const parsed = utils.parseColor(style[prop]);
        if (!parsed || parsed.a < 0.05) continue;
        const hex = utils.rgbToHex(parsed.r, parsed.g, parsed.b);
        usedColorMap.set(hex, (usedColorMap.get(hex) || 0) + 1);
      }
    }

    const tokenColors = Array.from(tokens.colorTokens.values());
    let tokenized = 0;
    let freestyle = 0;
    const freestyleColors = [];

    for (const [hex, count] of usedColorMap) {
      // Parse hex back to RGB for comparison
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);

      let matchesToken = false;
      for (const tc of tokenColors) {
        if (Math.abs(r - tc.r) <= RGB_TOLERANCE &&
            Math.abs(g - tc.g) <= RGB_TOLERANCE &&
            Math.abs(b - tc.b) <= RGB_TOLERANCE) {
          matchesToken = true;
          break;
        }
      }

      if (matchesToken) {
        tokenized++;
      } else {
        freestyle++;
        freestyleColors.push({ hex, count });
      }
    }

    // Sort freestyle by count descending, cap
    freestyleColors.sort((a, b) => b.count - a.count);

    const totalUsed = usedColorMap.size;
    const ratio = totalUsed > 0
      ? Math.round((tokenized / totalUsed) * 1000) / 1000
      : 1;

    return {
      defined_color_tokens: tokens.colorTokens.size,
      used_colors: totalUsed,
      tokenized,
      freestyle,
      freestyle_colors: freestyleColors.slice(0, MAX_ITEMS),
      tokenization_ratio: ratio
    };
  }

  // ─── CO-02: Spacing Token Consistency ────────────────────────────

  function co02_spacingTokenConsistency() {
    const PX_TOLERANCE = 1;
    const spacingValues = new Map(); // px value -> count

    for (const el of allVisible) {
      const style = window.getComputedStyle(el);
      const props = [
        'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'gap', 'rowGap', 'columnGap'
      ];

      for (const prop of props) {
        const raw = style[prop];
        if (!raw || raw === 'normal' || raw === 'auto') continue;
        const px = parseFloat(raw);
        if (isNaN(px) || px === 0) continue;
        const rounded = Math.round(px * 10) / 10;
        spacingValues.set(rounded, (spacingValues.get(rounded) || 0) + 1);
      }
    }

    const definedTokens = tokens.spacingTokens.slice().sort((a, b) => a - b);
    let onToken = 0;
    let offToken = 0;
    const freestyleSpacing = [];

    for (const [value, count] of spacingValues) {
      let matches = false;
      for (const t of definedTokens) {
        if (Math.abs(value - t) <= PX_TOLERANCE) {
          matches = true;
          break;
        }
      }
      if (matches) {
        onToken++;
      } else {
        offToken++;
        freestyleSpacing.push({ value, count });
      }
    }

    freestyleSpacing.sort((a, b) => b.count - a.count);

    const total = onToken + offToken;
    const ratio = total > 0
      ? Math.round((onToken / total) * 1000) / 1000
      : 1;

    return {
      defined_spacing_tokens: definedTokens,
      freestyle_spacing: freestyleSpacing.slice(0, MAX_ITEMS),
      tokenization_ratio: ratio
    };
  }

  // ─── CO-03: Component Consistency (Drift Detection) ──────────────

  function co03_componentConsistency() {
    const MIN_GROUP_SIZE = 3;
    const CHECKED_PROPS = [
      'fontSize', 'fontWeight', 'color', 'backgroundColor',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderRadius'
    ];

    // Group elements by tag+class pattern
    const groups = new Map(); // pattern -> Element[]

    const sampled = utils.sampleAcrossPage(allVisible, MAX_DRIFT_ELEMENTS);

    for (const el of sampled) {
      const tag = el.tagName.toLowerCase();
      const classes = (typeof el.className === 'string' && el.className.trim())
        ? el.className.trim().split(/\s+/).sort().join('.')
        : '';
      const pattern = classes ? tag + '.' + classes : tag;

      if (!groups.has(pattern)) {
        groups.set(pattern, []);
      }
      groups.get(pattern).push(el);
    }

    let componentsChecked = 0;
    const driftingComponents = [];

    for (const [pattern, elements] of groups) {
      if (elements.length < MIN_GROUP_SIZE) continue;
      componentsChecked++;

      for (const prop of CHECKED_PROPS) {
        const values = elements.map(el => {
          const val = window.getComputedStyle(el)[prop];
          // Normalize to numeric where possible for stddev
          return val;
        });

        // Check if all values are identical
        const unique = [...new Set(values)];
        if (unique.length > 1) {
          if (driftingComponents.length < MAX_ITEMS) {
            driftingComponents.push({
              pattern,
              property: prop,
              values: unique.slice(0, 5) // cap unique value samples
            });
          }
        }
      }
    }

    // Consistency score: ratio of non-drifting component-property pairs
    const totalPairs = componentsChecked * CHECKED_PROPS.length;
    const driftingPairs = driftingComponents.length;
    const score = totalPairs > 0
      ? Math.round(((totalPairs - driftingPairs) / totalPairs) * 1000) / 1000
      : 0.4; // No reusable components found = low, not perfect

    return {
      components_checked: componentsChecked,
      drifting_components: driftingComponents,
      consistency_score: score
    };
  }

  // ─── CO-04: Shadow Direction Consistency ─────────────────────────

  function co04_shadowDirection() {
    const yOffsets = [];
    const xOffsets = [];

    for (const el of allVisible) {
      const shadow = window.getComputedStyle(el).boxShadow;
      if (!shadow || shadow === 'none') continue;

      // boxShadow can contain multiple shadows separated by commas
      // Each shadow: [inset] <x> <y> [blur] [spread] <color>
      // Computed style returns rgb values, so we parse carefully
      const shadowParts = shadow.split(/,(?![^(]*\))/);

      for (const part of shadowParts) {
        const trimmed = part.trim();
        if (trimmed === 'none') continue;

        // Remove color values (rgb/rgba) and 'inset' to isolate numeric offsets
        const cleaned = trimmed
          .replace(/rgba?\([^)]+\)/g, '')
          .replace(/inset/gi, '')
          .trim();

        // Extract numeric values (px)
        const nums = cleaned.match(/-?[\d.]+/g);
        if (nums && nums.length >= 2) {
          const x = parseFloat(nums[0]);
          const y = parseFloat(nums[1]);
          xOffsets.push(x);
          yOffsets.push(y);
        }
      }
    }

    // Check direction consistency
    let directionConsistent = true;

    if (yOffsets.length > 1) {
      const nonZeroY = yOffsets.filter(y => y !== 0);
      if (nonZeroY.length > 1) {
        const allPositive = nonZeroY.every(y => y > 0);
        const allNegative = nonZeroY.every(y => y < 0);
        if (!allPositive && !allNegative) directionConsistent = false;
      }
    }

    if (xOffsets.length > 1 && directionConsistent) {
      const nonZeroX = xOffsets.filter(x => x !== 0);
      if (nonZeroX.length > 1) {
        const allPositive = nonZeroX.every(x => x > 0);
        const allNegative = nonZeroX.every(x => x < 0);
        const allZero = nonZeroX.length === 0;
        if (!allPositive && !allNegative && !allZero) directionConsistent = false;
      }
    }

    return {
      shadows_found: yOffsets.length,
      y_offsets: [...new Set(yOffsets)].slice(0, MAX_ITEMS),
      x_offsets: [...new Set(xOffsets)].slice(0, MAX_ITEMS),
      direction_consistent: directionConsistent
    };
  }

  // ─── CO-05: Animation Duration Bounds ────────────────────────────

  function co05_animationDurationBounds() {
    const FEEDBACK_MAX_MS = 200;
    const LAYOUT_MAX_MS = 800;

    // Properties that are considered "feedback" (hover, color, opacity)
    const feedbackProps = new Set([
      'color', 'background-color', 'background', 'border-color',
      'opacity', 'box-shadow', 'text-shadow', 'outline-color',
      'fill', 'stroke', 'text-decoration-color'
    ]);

    let transitionCount = 0;
    let withinBounds = 0;
    const tooSlow = [];

    function parseDurationToMs(str) {
      if (!str || str === '0s') return 0;
      const val = parseFloat(str);
      if (isNaN(val)) return 0;
      if (str.includes('ms')) return val;
      return val * 1000; // seconds to ms
    }

    for (const el of allVisible) {
      const style = window.getComputedStyle(el);

      // Check transitions
      const tProp = style.transitionProperty;
      const tDur = style.transitionDuration;
      if (tProp && tProp !== 'none' && tDur && tDur !== '0s') {
        const props = tProp.split(',').map(p => p.trim());
        const durs = tDur.split(',').map(d => d.trim());

        for (let i = 0; i < props.length; i++) {
          const prop = props[i];
          const dur = durs[i] || durs[durs.length - 1]; // CSS repeats last
          const ms = parseDurationToMs(dur);
          if (ms === 0) continue;

          transitionCount++;
          const isFeedback = feedbackProps.has(prop) || prop === 'all';
          const bound = isFeedback ? FEEDBACK_MAX_MS : LAYOUT_MAX_MS;

          if (ms <= bound) {
            withinBounds++;
          } else {
            if (tooSlow.length < MAX_ITEMS) {
              tooSlow.push({
                selector: utils.getSelector(el),
                duration_ms: ms,
                property: prop
              });
            }
          }
        }
      }

      // Check animation durations
      const aDur = style.animationDuration;
      const aName = style.animationName;
      if (aName && aName !== 'none' && aDur && aDur !== '0s') {
        const names = aName.split(',').map(n => n.trim());
        const durs = aDur.split(',').map(d => d.trim());

        for (let i = 0; i < names.length; i++) {
          const dur = durs[i] || durs[durs.length - 1];
          const ms = parseDurationToMs(dur);
          if (ms === 0) continue;

          transitionCount++;
          // Animations: use layout bound as general ceiling
          if (ms <= LAYOUT_MAX_MS) {
            withinBounds++;
          } else {
            if (tooSlow.length < MAX_ITEMS) {
              tooSlow.push({
                selector: utils.getSelector(el),
                duration_ms: ms,
                property: 'animation:' + names[i]
              });
            }
          }
        }
      }
    }

    return {
      transition_count: transitionCount,
      within_bounds: withinBounds,
      too_slow: tooSlow,
      pass: tooSlow.length === 0
    };
  }

  // ─── CO-06: Transition Property Specificity ──────────────────────

  function co06_transitionPropertySpecificity() {
    let transitionAllCount = 0;
    let specificCount = 0;

    for (const el of allVisible) {
      const style = window.getComputedStyle(el);
      const tProp = style.transitionProperty;
      const tDur = style.transitionDuration;

      if (!tProp || tProp === 'none' || !tDur || tDur === '0s') continue;

      const props = tProp.split(',').map(p => p.trim());

      for (const prop of props) {
        if (prop === 'all') {
          transitionAllCount++;
        } else {
          specificCount++;
        }
      }
    }

    return {
      transition_all_count: transitionAllCount,
      specific_count: specificCount,
      pass: transitionAllCount === 0
    };
  }

  // ─── CO-07: Font Size Token Consistency ──────────────────────────

  function co07_fontSizeTokenConsistency() {
    const PX_TOLERANCE = 0.5;
    const sizeMap = new Map(); // px size -> count

    for (const el of allVisible) {
      const style = window.getComputedStyle(el);
      const fs = parseFloat(style.fontSize);
      if (isNaN(fs) || fs === 0) continue;
      const rounded = Math.round(fs * 10) / 10;
      sizeMap.set(rounded, (sizeMap.get(rounded) || 0) + 1);
    }

    const definedTokens = tokens.typeTokens.slice().sort((a, b) => a - b);
    let onToken = 0;
    let offToken = 0;
    const freestyleSizes = [];

    for (const [size, count] of sizeMap) {
      let matches = false;
      for (const t of definedTokens) {
        if (Math.abs(size - t) <= PX_TOLERANCE) {
          matches = true;
          break;
        }
      }
      if (matches) {
        onToken++;
      } else {
        offToken++;
        freestyleSizes.push({ size, count });
      }
    }

    freestyleSizes.sort((a, b) => b.count - a.count);

    const total = onToken + offToken;
    const ratio = total > 0
      ? Math.round((onToken / total) * 1000) / 1000
      : 1;

    return {
      defined_type_tokens: definedTokens,
      used_sizes: Array.from(sizeMap.keys()).sort((a, b) => a - b),
      freestyle_sizes: freestyleSizes.slice(0, MAX_ITEMS),
      tokenization_ratio: ratio
    };
  }

  // ─── CO-08: Overall Coherence Score ──────────────────────────────
  // Structural coherence: measured by value concentration, not token presence.
  // A site that uses 5 colors consistently is coherent regardless of whether
  // those colors are defined as CSS custom properties.

  function co08_overallCoherence(co01, co02, co03, co07) {
    // ── Color structural coherence ──
    // How concentrated is the palette? Fewer unique colors = more coherent.
    // Award full marks if ≤ 15 unique colors, penalize up to 50+.
    const usedColors = co01.used_colors || 0;
    const colorConcentration = usedColors <= 15 ? 1
      : usedColors <= 25 ? 0.8
      : usedColors <= 40 ? 0.5
      : 0.2;
    // Blend with token ratio if tokens exist (bonus for explicit system)
    const hasColorTokens = (co01.defined_color_tokens || 0) > 5;
    const colorCoherence = hasColorTokens
      ? co01.tokenization_ratio * 0.4 + colorConcentration * 0.6
      : colorConcentration;

    // ── Spacing structural coherence ──
    // Does spacing conform to a grid? Compute on-grid ratio directly.
    const spacingVals = [];
    for (const el of allVisible.slice(0, 300)) {
      const style = window.getComputedStyle(el);
      for (const prop of ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'gap']) {
        const px = parseFloat(style[prop]);
        if (!isNaN(px) && px > 0) spacingVals.push(Math.round(px));
      }
    }
    let spacingGridScore = 0.3; // No data = low score, not perfect
    if (spacingVals.length >= 5) {
      // Test both 4px and 8px grids, pick the better one
      const onGrid4 = spacingVals.filter(v => v % 4 === 0).length / spacingVals.length;
      const onGrid8 = spacingVals.filter(v => v % 8 === 0).length / spacingVals.length;
      spacingGridScore = Math.max(onGrid4, onGrid8);
    }
    // Blend with token ratio if tokens exist
    const hasSpacingTokens = (co02.defined_spacing_tokens || []).length > 5;
    const spacingCoherence = hasSpacingTokens
      ? co02.tokenization_ratio * 0.3 + spacingGridScore * 0.7
      : spacingGridScore;

    // ── Component consistency (keep as-is) ──
    const componentCoherence = co03.consistency_score;

    // ── Type structural coherence ──
    // Fewer distinct sizes = more coherent. Does the scale look intentional?
    const usedSizes = (co07.used_sizes || []).length;
    const typeConcentration = usedSizes <= 5 ? 1
      : usedSizes <= 7 ? 0.85
      : usedSizes <= 10 ? 0.6
      : usedSizes <= 15 ? 0.35
      : 0.15;
    // Check if ratios between adjacent sizes are consistent (scale discipline)
    const sizes = (co07.used_sizes || []).slice().sort((a, b) => a - b);
    let scaleScore = 0;
    if (sizes.length >= 3) {
      const ratios = [];
      for (let i = 1; i < sizes.length; i++) {
        if (sizes[i - 1] > 0) ratios.push(sizes[i] / sizes[i - 1]);
      }
      if (ratios.length > 0) {
        const avg = ratios.reduce((a, b) => a + b, 0) / ratios.length;
        const variance = utils.stddev(ratios) / avg;
        scaleScore = variance < 0.15 ? 1 : variance < 0.3 ? 0.6 : 0.2;
      }
    }
    const hasTypeTokens = (co07.defined_type_tokens || []).length > 3;
    const typeCoherence = hasTypeTokens
      ? co07.tokenization_ratio * 0.3 + typeConcentration * 0.35 + scaleScore * 0.35
      : typeConcentration * 0.5 + scaleScore * 0.5;

    // Type coherence weighted highest — typographic consistency is the most
    // visible coherence signal (Santa Maria, Lupton).
    const overall = Math.round(
      (colorCoherence * 0.25 +
       spacingCoherence * 0.25 +
       componentCoherence * 0.20 +
       typeCoherence * 0.30) * 100
    );

    return {
      color_coherence: Math.round(colorCoherence * 1000) / 1000,
      spacing_coherence: Math.round(spacingCoherence * 1000) / 1000,
      component_coherence: componentCoherence,
      type_coherence: Math.round(typeCoherence * 1000) / 1000,
      overall
    };
  }

  // ─── Execute all checks and assemble result ───────────────────────

  const co01 = co01_colorTokenConsistency();
  const co02 = co02_spacingTokenConsistency();
  const co03 = co03_componentConsistency();
  const co04 = co04_shadowDirection();
  const co05 = co05_animationDurationBounds();
  const co06 = co06_transitionPropertySpecificity();
  const co07 = co07_fontSizeTokenConsistency();
  const co08 = co08_overallCoherence(co01, co02, co03, co07);

  return {
    co01_color_token_consistency: co01,
    co02_spacing_token_consistency: co02,
    co03_component_consistency: co03,
    co04_shadow_direction: co04,
    co05_animation_duration_bounds: co05,
    co06_transition_property_specificity: co06,
    co07_font_size_token_consistency: co07,
    co08_overall_coherence: co08
  };
}

// DPT Synthesis — Unified quality score from 5 perception layers
// Reads all layer outputs, computes per-dimension grades and overall score
// with hard-floor penalties. Returns structured scoring for any consumer.

function synthesis(cf, ts, sr, aa, co) {

  // ─── Helpers ────────────────────────────────────────────────────

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function grade(score) {
    if (score >= 90) return 'A';
    if (score >= 85) return 'A-';
    if (score >= 80) return 'B+';
    if (score >= 75) return 'B';
    if (score >= 70) return 'B-';
    if (score >= 65) return 'C+';
    if (score >= 60) return 'C';
    if (score >= 55) return 'C-';
    if (score >= 50) return 'D+';
    if (score >= 45) return 'D';
    if (score >= 40) return 'D-';
    return 'F';
  }

  function safe(obj, ...path) {
    let cur = obj;
    for (const k of path) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[k];
    }
    return cur;
  }

  function pctScale(n, total) {
    if (!total || total === 0) return 100;
    return clamp(Math.round((n / total) * 100), 0, 100);
  }

  // ─── Chromatic Field (0-100) ────────────────────────────────────

  const cf01 = cf.cf01_text_contrast || {};
  const cf02 = cf.cf02_palette || {};
  const cf03 = cf.cf03_grey_saturation || {};
  const cf04 = cf.cf04_interactive_primary || {};
  const cf06 = cf.cf06_dark_mode || {};
  const cf08 = cf.cf08_saturation_overuse || {};

  const adjustedRate = cf01.adjusted_pass_rate != null ? cf01.adjusted_pass_rate : (cf01.pass_rate != null ? cf01.pass_rate : 1);
  const contrastScore = clamp(Math.round(adjustedRate * 100), 0, 100);

  const hues = cf02.chromatic_hues || 0;
  const paletteScore = hues <= 4 ? 100 : hues <= 6 ? 75 : hues <= 8 ? 50 : 25;

  const tinted = cf03.tinted_greys || 0;
  const untinted = cf03.untinted_greys || 0;
  const greyTotal = tinted + untinted;
  const untintedRatio = greyTotal === 0 ? 0 : untinted / greyTotal;
  const greyScore = greyTotal === 0 ? 70 : untinted === 0 ? 100 :
    untintedRatio > 0.8 ? 0 : untintedRatio > 0.5 ? 20 : untintedRatio > 0.3 ? 40 : 60;

  const leaks = cf04.non_interactive_leaks || 0;
  const hueScore = leaks === 0 ? 100 : leaks <= 5 ? 70 : leaks <= 15 ? 40 : 10;

  const halation = cf06.halation_risk || false;
  const satEls = cf08.full_saturation_elements || 0;
  const satHues = cf08.full_saturation_hues || 0;
  const miscScore = (halation ? 0 : 50) + (satEls > 10 || satHues > 1 ? 0 : 50);

  // CF-10: Complementary adjacency (generalizes chromostereopsis to all hue pairs)
  const cf10 = cf.cf10_complementary_adjacency || {};
  const compPairs = cf10.complementary_pairs || 0;
  const compScore = compPairs === 0 ? 100 : compPairs <= 2 ? 70 : compPairs <= 5 ? 40 : 10;

  // CF-11: Saturated color area overuse
  const cf11 = cf.cf11_saturated_area || {};
  const overuseHues = cf11.overuse_hues || 0;
  const areaScore = overuseHues === 0 ? 100 : overuseHues === 1 ? 50 : 20;

  // CF-12: Perceived brightness consistency
  const cf12 = cf.cf12_perceived_brightness || {};
  const brightnessScore = (cf12.inconsistent_groups || 0) === 0 ? 100 : 50;

  // CF-09: Body text softness (pure black text is harsh — Santa Maria)
  const cf09 = cf.cf09_body_text_softness || {};
  const pureBlackBody = cf09.pure_black_body_text || 0;
  const softScore = pureBlackBody === 0 ? 100 : 0;

  const chromaticRaw = Math.round(
    contrastScore * 0.33 +
    paletteScore * 0.12 +
    greyScore * 0.11 +
    hueScore * 0.11 +
    miscScore * 0.08 +
    compScore * 0.08 +
    areaScore * 0.07 +
    softScore * 0.05 +
    brightnessScore * 0.05
  );
  const chromaticFloors = [];
  let chromaticScore = chromaticRaw;
  if (halation) { chromaticScore = Math.min(chromaticScore, 60); chromaticFloors.push('halation_risk'); }
  if (compPairs > 5) { chromaticScore = Math.min(chromaticScore, 60); chromaticFloors.push('complementary_adjacency'); }

  // ─── Typographic Skeleton (0-100) ──────────────────────────────

  const ts02 = ts.ts02_absolute_floor || {};
  const ts04 = ts.ts04_body_line_height || {};
  const ts06 = ts.ts06_typeface_family_count || {};
  const ts07 = ts.ts07_font_weight_count || {};
  const ts08 = ts.ts08_type_scale || {};
  const ts09 = ts.ts09_headline_size_jump || {};

  const sub12 = ts02.sub_12px_count || 0;
  const sub12Score = sub12 === 0 ? 100 : sub12 <= 10 ? 60 : sub12 <= 50 ? 30 : 0;

  const bands = ts07.band_count || 0;
  const bandScore = (bands >= 2 && bands <= 3) ? 100 : bands === 1 ? 70 : bands === 4 ? 50 : 0;

  const systematic = ts08.systematic || false;
  let scaleScore = systematic ? 100 : (ts08.detected_ratio ? 60 : 20);
  // Tier 3: anomalous ratio outside standard musical/typographic range caps score
  if (ts08.detected_ratio && (ts08.detected_ratio < 1.067 || ts08.detected_ratio > 1.618)) {
    scaleScore = Math.min(scaleScore, 40);
  }

  const medianLH = ts04.median_ratio || 0;
  const lhScore = (medianLH >= 1.4 && medianLH <= 1.6) ? 100
    : (medianLH >= 1.3 && medianLH <= 1.7) ? 70
    : (medianLH >= 1.2 && medianLH <= 1.8) ? 50 : 20;

  const familyCount = (ts06.families || []).length;
  const familyScore = familyCount <= 2 ? 100 : familyCount === 3 ? 50 : 0;

  // Editorial display scale (to 4.5x) is a ratified choice, not an error
  // (audit 2026-08-22: the 2.0-3.0 hard band scored the exemplar's hero 20).
  const h1Ratio = ts09.ratio || 0;
  const h1Score = (h1Ratio >= 2.0 && h1Ratio <= 4.5) ? 100 : (h1Ratio >= 1.5 && h1Ratio <= 5.5) ? 70 : 20;

  // TS-17: Faux bold/italic (browser-synthesized = quality penalty)
  const ts17 = ts.ts17_faux_bold_italic || {};
  const fauxCount = (ts17.faux_bold || 0) + (ts17.faux_italic || 0);
  const fauxScore = fauxCount === 0 ? 100 : fauxCount <= 3 ? 60 : 20;

  // TS-19: Justified text without hyphenation (universally broken)
  const ts19 = ts.ts19_justified_hyphenation || {};
  const justifiedNoHyph = ts19.without_hyphens || 0;
  const justifiedScore = justifiedNoHyph === 0 ? 100 : 30;

  // TS-21: Typeface distortion (transform stretch/compress)
  const ts21 = ts.ts21_typeface_distortion || {};
  // TS-21 output key: distorted_elements
  const distorted = ts21.distorted_elements || 0;
  const distortionScore = distorted === 0 ? 100 : 0;

  // TS-01: Body text minimum size (< 16px = violation)
  const ts01 = ts.ts01_body_text_min_size || {};
  const bodyMinViols = ts01.violations || 0;
  const bodyMinScore = bodyMinViols === 0 ? 100 : bodyMinViols <= 5 ? 60 : 20;

  // TS-03: Line length violations
  const ts03 = ts.ts03_line_length || {};
  const llChecks = (ts03.checks || []).length;
  const llViols = ts03.violations || 0;
  const lineLengthScore = llChecks === 0 ? 70 : pctScale(llChecks - llViols, llChecks);

  // TS-05: Headline line-height
  const ts05 = ts.ts05_headline_line_height || {};
  const headlineLhScore = ts05.pass ? 100 : 50;

  // TS-13: Heading semantic-visual hierarchy
  const ts13 = ts.ts13_heading_semantic_visual || {};
  const headingHierScore = ts13.pass ? 100 : 30;

  // TS-14: Heading space asymmetry (proximity)
  const ts14 = ts.ts14_heading_space_asymmetry || {};
  const proxViols = ts14.violation_count || 0;
  const proxTotal = (ts14.headings || []).length;
  const headingProxScore = proxTotal === 0 ? 70 : pctScale(proxTotal - proxViols, proxTotal);

  // TS-22: Heading letter-spacing (positive tracking on headings = amateur)
  const ts22 = ts.ts22_heading_letter_spacing || {};
  const headingTrackScore = (ts22.positive_tracking || 0) === 0 ? 100 : 40;

  const typographyRaw = Math.round(
    sub12Score * 0.12 +
    bandScore * 0.13 +
    scaleScore * 0.07 +
    lhScore * 0.11 +
    familyScore * 0.06 +
    h1Score * 0.10 +
    fauxScore * 0.07 +
    justifiedScore * 0.05 +
    distortionScore * 0.05 +
    bodyMinScore * 0.04 +
    lineLengthScore * 0.05 +
    headlineLhScore * 0.03 +
    headingHierScore * 0.04 +
    headingProxScore * 0.05 +
    headingTrackScore * 0.03
  );
  const typographyFloors = [];
  let typographyScore = typographyRaw;
  if (sub12 > 100) typographyFloors.push('sub_12px');
  if (sub12 > 20) typographyFloors.push('sub_12px_severe');
  if (distorted > 0) typographyFloors.push('typeface_distortion');

  // ─── Spatial Rhythm (0-100) ─────────────────────────────────────

  const sr01 = sr.sr01_spacing_scale || {};
  const sr02 = sr.sr02_touch_targets || {};
  const sr04 = sr.sr04_border_radius || {};
  const sr05 = sr.sr05_shadow_elevation || {};
  const sr07 = sr.sr07_alignment_vectors || {};

  const spacingConf = sr01.confidence || 0;
  const spacingScore = clamp(Math.round(spacingConf * 100), 0, 100);

  const totalInteractive = sr02.total_interactive || 0;
  const undersized = sr02.undersized || 0;
  const touchScore = totalInteractive === 0 ? 70 : pctScale(totalInteractive - undersized, totalInteractive);

  const radii = (sr04.distinct_radii || []).length;
  const radiusScore = radii <= 3 ? 100 : radii <= 5 ? 70 : 40;

  const alignScore = sr07.alignment_score != null ? clamp(Math.round(sr07.alignment_score * 100), 0, 100) : 70;

  const shadowConsistent = sr05.direction_consistent != null ? sr05.direction_consistent : true;
  const shadowScore = shadowConsistent ? 100 : 30;

  // SR-09: Body text margin adequacy
  const sr09 = sr.sr09_body_text_margin || {};
  const marginInadequate = sr09.inadequate_margin || 0;
  const marginChecked = sr09.paragraphs_checked || 0;
  const marginScore = marginChecked === 0 ? 70 : pctScale(marginChecked - marginInadequate, marginChecked);

  // SR-06: Container max-width (blowout risk)
  const sr06 = sr.sr06_container_max_width || {};
  const blowouts = (sr06.blowout_risk || []).length;
  const containerScore = blowouts === 0 ? 100 : blowouts <= 2 ? 60 : 30;

  // SR-08: Whitespace density balance
  const sr08 = sr.sr08_whitespace_density || {};
  const whitespaceScore = clamp(Math.round((sr08.balance_score || 0) * 100), 0, 100);

  const spatialRaw = Math.round(
    spacingScore * 0.27 +
    touchScore * 0.16 +
    radiusScore * 0.12 +
    alignScore * 0.16 +
    shadowScore * 0.07 +
    marginScore * 0.12 +
    containerScore * 0.05 +
    whitespaceScore * 0.05
  );
  const spatialFloors = [];
  let spatialScore = spatialRaw;
  if (spacingConf === 0) { spatialScore = Math.min(spatialScore, 25); spatialFloors.push('zero_spacing_confidence'); }

  // ─── Attention Architecture (0-100) ─────────────────────────────

  const aa02 = aa.aa02_button_hierarchy || {};
  const aa03 = aa.aa03_interactive_affordance || {};
  const aa04 = aa.aa04_icon_text_labels || {};
  const aa06 = aa.aa06_form_label_presence || {};
  const aa09 = aa.aa09_navigation_item_count || {};
  const aa10 = aa.aa10_tab_order_visual || {};

  const primary = aa02.primary || 0;
  const secondary = aa02.secondary || 0;
  const btnScore = primary === 1 ? 100 : primary === 0 ? 20 : primary === 2 ? 60 : 30;

  const navItems = (aa09.items_per_nav || []);
  const maxNav = navItems.reduce((mx, n) => Math.max(mx, n.count || 0), 0);
  const navScore = maxNav === 0 ? 50 : (maxNav >= 4 && maxNav <= 6) ? 100 : maxNav === 7 ? 80 : (maxNav >= 8 && maxNav <= 10) ? 50 : 25;

  const affTotal = aa03.total || 0;
  const affWith = aa03.with_affordance || 0;
  const affScore = affTotal === 0 ? 70 : pctScale(affWith, affTotal);

  const iconsFound = aa04.icons_found || 0;
  const iconsLabeled = aa04.with_labels || 0;
  const iconScore = iconsFound === 0 ? 70 : pctScale(iconsLabeled, iconsFound);

  const tabMismatches = aa10.order_mismatches || 0;
  const formFields = aa06.fields || 0;
  const phOnly = aa06.placeholder_only || 0;
  const noLabel = aa06.no_label || 0;
  const formIssues = phOnly + noLabel;
  const tabFormScore = formFields === 0 && tabMismatches === 0
    ? 80
    : clamp(100 - tabMismatches * 10 - formIssues * 20, 0, 100);

  // AA-11: Form field border contrast (3:1 minimum per WCAG)
  const aa11 = aa.aa11_form_field_border_contrast || {};
  const fieldsBorderChecked = aa11.fields_checked || 0;
  const fieldsAdequate = aa11.adequate_contrast || 0;
  const borderContrastScore = fieldsBorderChecked === 0 ? 80 : pctScale(fieldsAdequate, fieldsBorderChecked);

  // AA-08: Generic link text ("click here", "read more", etc.)
  const aa08 = aa.aa08_generic_link_text || {};
  const genericLinks = aa08.generic_links || 0;
  const genericLinkScore = genericLinks === 0 ? 100 : genericLinks <= 3 ? 60 : 20;

  // AA-12: Generic button text ("Submit", "Click here", etc.)
  const aa12 = aa.aa12_generic_button_text || {};
  const genericBtnScore = (aa12.generic_labels || 0) === 0 ? 100 : (aa12.generic_labels <= 2) ? 60 : 20;

  const attentionRaw = Math.round(
    btnScore * 0.21 +
    navScore * 0.17 +
    affScore * 0.13 +
    iconScore * 0.11 +
    tabFormScore * 0.17 +
    borderContrastScore * 0.12 +
    genericLinkScore * 0.05 +
    genericBtnScore * 0.04
  );
  const attentionFloors = [];
  let attentionScore = attentionRaw;
  if (primary === 0 && secondary === 0) { attentionScore = Math.min(attentionScore, 50); attentionFloors.push('no_cta'); }

  // ─── Coherence (0-100) ──────────────────────────────────────────

  const co05 = co.co05_animation_duration_bounds || {};
  const co06 = co.co06_transition_property_specificity || {};
  const co08 = co.co08_overall_coherence || {};

  const coBase = co08.overall || 0;

  const tAll = co06.transition_all_count || 0;
  const tSpec = co06.specific_count || 0;
  const tTotal = tAll + tSpec;
  const transitionScore = tTotal === 0 ? 70 : pctScale(tSpec, tTotal);

  const animTotal = co05.transition_count || 0;
  const animWithin = co05.within_bounds || 0;
  const animScore = animTotal === 0 ? 70 : pctScale(animWithin, animTotal);

  const coherenceScore = Math.round(
    coBase * 0.70 +
    transitionScore * 0.15 +
    animScore * 0.15
  );
  const coherenceFloors = [];

  // ─── Overall Score ──────────────────────────────────────────────
  // Three structural principles:
  //   1. Coherence is a multiplier, not a peer — it scales the mechanical base
  //   2. Floor anchoring — overall can't outrun the weakest dimension by much
  //   3. Variance penalty — scattered passes among failures = no design intent

  const dims = [chromaticScore, typographyScore, spatialScore, attentionScore];
  const dimWeights = [0.20, 0.30, 0.25, 0.25];

  // Weighted average of the four mechanical dimensions
  const base = Math.round(
    dims[0] * dimWeights[0] +
    dims[1] * dimWeights[1] +
    dims[2] * dimWeights[2] +
    dims[3] * dimWeights[3]
  );

  // Coherence as a scaling factor — piecewise, not linear.
  // Above 70: a design system exists. Factor near 1.0.
  // 50-70: system is partial. Discount scales from 0.75 to 1.0.
  // Below 50: no real system. Discount scales from 0.55 to 0.75.
  const coherenceFactor = coherenceScore >= 70
    ? 0.95 + (coherenceScore - 70) * (0.05 / 30)   // 0.95 → 1.0
    : coherenceScore >= 50
      ? 0.75 + (coherenceScore - 50) * (0.20 / 20)  // 0.75 → 0.95
      : 0.55 + (coherenceScore / 50) * 0.20;         // 0.55 → 0.75
  const scaled = Math.round(base * coherenceFactor);

  // Floor anchoring: overall can't outrun the weakest dimension by much.
  // Per-dimension authority: chromatic and typography anchor hard,
  // spatial softer, attention softest (missing CTA on content page is less fatal).
  const dimAuthority = [1.0, 1.0, 0.8, 0.6]; // chromatic, typography, spatial, attention
  let dimMin = Infinity;
  let dimMinAuthority = 1.0;
  for (let i = 0; i < dims.length; i++) {
    if (dims[i] < dimMin) { dimMin = dims[i]; dimMinAuthority = dimAuthority[i]; }
  }
  const floorAnchor = dimMin + Math.round(20 * dimMinAuthority);

  // Variance penalty: standard deviation of the four mechanical dimensions.
  // High spread = scattered passes among failures = no design intent.
  // Kicks in above stdDev 8; penalty steepens with spread.
  const dimMean = dims.reduce((a, b) => a + b, 0) / dims.length;
  const variance = dims.reduce((sum, d) => sum + (d - dimMean) ** 2, 0) / dims.length;
  const stdDev = Math.sqrt(variance);
  const variancePenalty = stdDev > 8 ? Math.round((stdDev - 8) * 0.8) : 0;

  let overall = Math.min(scaled, floorAnchor) - variancePenalty;

  // Hard floor caps (critical failures override everything)
  const criticalFailures = [];
  const hardFloors = [];

  if (sub12 > 100) {
    hardFloors.push({ cap: 35, reason: `${sub12} elements below 12px` });
    criticalFailures.push(`${sub12} elements below 12px`);
  } else if (sub12 > 20) {
    hardFloors.push({ cap: 55, reason: `${sub12} elements below 12px` });
    criticalFailures.push(`${sub12} elements below 12px`);
  }

  const hardFails = cf01.hard_failures || 0;
  if (hardFails > 30) {
    hardFloors.push({ cap: 45, reason: `${hardFails} hard contrast failures` });
    criticalFailures.push(`${hardFails} hard contrast failures`);
  }

  if (spacingConf === 0) {
    hardFloors.push({ cap: 40, reason: 'zero spacing grid confidence' });
  }

  if (halation) {
    criticalFailures.push('halation risk (pure white on pure black)');
  }

  if (pureBlackBody > 20) {
    criticalFailures.push(`${pureBlackBody} pure black (#000) body text elements`);
  }

  if (primary === 0 && secondary === 0) {
    criticalFailures.push('no primary or secondary CTA');
  }

  if (totalInteractive > 0 && undersized === totalInteractive) {
    criticalFailures.push(`${undersized}/${totalInteractive} targets below the ${sr02.floor_px || 24}px minimum (WCAG 2.5.8; inline text links exempt)`);
    if (undersized > 50) {
      hardFloors.push({ cap: 40, reason: `all ${undersized} touch targets undersized` });
    }
  }

  const aa16 = aa.aa16_destructive_action_weight || {};
  if ((aa16.destructive_as_primary || 0) > 0) {
    criticalFailures.push(`${aa16.destructive_as_primary} destructive action(s) styled as primary CTA`);
  }

  for (const floor of hardFloors) {
    overall = Math.min(overall, floor.cap);
  }

  // ─── Top Strengths ─────────────────────────────────────────────

  const topStrengths = [];
  if (adjustedRate >= 0.95) topStrengths.push(`${Math.round(adjustedRate * 100)}% contrast pass rate`);
  if (bands >= 2 && bands <= 3) topStrengths.push(`${bands} weight band${bands > 1 ? 's' : ''}`);
  if (medianLH >= 1.4 && medianLH <= 1.6) topStrengths.push(`${medianLH} body line-height`);
  if (systematic) topStrengths.push('systematic type scale');
  if (spacingConf >= 0.85) topStrengths.push(`${Math.round(spacingConf * 100)}% spacing grid confidence`);
  if (leaks === 0 && safe(cf04, 'primary_hue') != null) topStrengths.push('clean interactive hue containment');
  if (familyCount <= 2 && familyCount > 0) topStrengths.push(`${familyCount} typeface famil${familyCount === 1 ? 'y' : 'ies'}`);
  if (primary === 1) topStrengths.push('single primary CTA');
  if (genericLinks === 0) topStrengths.push('clean link text (no generic labels)');

  // ─── Assemble ──────────────────────────────────────────────────

  const finalScore = clamp(overall, 0, 100);

  return {
    overall_score: finalScore,
    overall_grade: grade(finalScore),
    scoring: {
      base,
      coherence_factor: Math.round(coherenceFactor * 100) / 100,
      scaled,
      floor_anchor: floorAnchor,
      variance_penalty: variancePenalty,
      std_dev: Math.round(stdDev * 10) / 10
    },
    dimensions: {
      chromatic:   { score: clamp(chromaticScore, 0, 100),   grade: grade(chromaticScore),   hard_floors_hit: chromaticFloors },
      typography:  { score: clamp(typographyScore, 0, 100),  grade: grade(typographyScore),  hard_floors_hit: typographyFloors },
      spatial:     { score: clamp(spatialScore, 0, 100),     grade: grade(spatialScore),     hard_floors_hit: spatialFloors },
      attention:   { score: clamp(attentionScore, 0, 100),   grade: grade(attentionScore),   hard_floors_hit: attentionFloors },
      coherence:   { score: clamp(coherenceScore, 0, 100),   grade: grade(coherenceScore),   hard_floors_hit: coherenceFloors }
    },
    critical_failures: criticalFailures,
    top_strengths: topStrengths.slice(0, 5)
  };
}


// ─── Orchestrator ──────────────────────────────────────────────────
const __DPT_START = performance.now();

const result = {
  meta: {
    version: "0.1.0",
    url: window.location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio
    },
    scan_coverage: {
      document_height: Math.round(DPT_UTILS.documentHeight()),
      bands_scanned: Math.max(1, Math.ceil(DPT_UTILS.documentHeight() / window.innerHeight)),
      mode: "full-document"
    },
    timestamp: new Date().toISOString(),
    element_count: document.querySelectorAll('*').length
  }
};

// Execute each layer with error isolation
const layers = [
  ['chromatic_field', chromaticField],
  ['typographic_skeleton', typographicSkeleton],
  ['spatial_rhythm', spatialRhythm],
  ['attention_architecture', attentionArchitecture],
  ['coherence', coherence]
];

for (const [name, fn] of layers) {
  try {
    const layerStart = performance.now();
    result[name] = fn(DPT_UTILS);
    result[name]._timing_ms = Math.round(performance.now() - layerStart);
  } catch (e) {
    result[name] = { _error: e.message, _stack: e.stack?.split('\n').slice(0, 3).join(' | ') };
  }
}

result.meta.rule_count = layers.reduce((count, [name]) => {
  const layer = result[name];
  if (!layer || typeof layer !== 'object') return count;
  return count + Object.keys(layer).filter(key => !key.startsWith('_')).length;
}, 0);
result.meta.color_parse = DPT_UTILS.colorParseDiagnostics();

// Execute synthesis across all layers
try {
  result.synthesis = synthesis(
    result.chromatic_field || {},
    result.typographic_skeleton || {},
    result.spatial_rhythm || {},
    result.attention_architecture || {},
    result.coherence || {}
  );
} catch (e) {
  result.synthesis = { _error: e.message };
}

if (result.meta.color_parse.unparseable_count > 0 && result.synthesis && !result.synthesis._error) {
  const count = result.meta.color_parse.unparseable_count;
  const reason = `${count} CSS color value${count === 1 ? '' : 's'} could not be measured; color and contrast scoring is incomplete`;
  result.synthesis.incomplete = true;
  result.synthesis.overall_score = null;
  result.synthesis.overall_grade = "INCOMPLETE";
  result.synthesis.critical_failures = [
    reason,
    ...(result.synthesis.critical_failures || [])
  ];
  if (result.synthesis.dimensions && result.synthesis.dimensions.chromatic) {
    result.synthesis.dimensions.chromatic.score = null;
    result.synthesis.dimensions.chromatic.grade = "INCOMPLETE";
    result.synthesis.dimensions.chromatic.incomplete = true;
  }
}

result.meta.total_timing_ms = Math.round(performance.now() - __DPT_START);

return result;

} catch (e) {
  return { _fatal_error: e.message, _stack: e.stack };
}
})()
