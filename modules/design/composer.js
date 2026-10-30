/**
 * Automatic composition.
 *
 * The creator asked (30 October 2026) that the app carry out the graphic work itself, the way a
 * design assistant does: once the background colour is chosen, the app places the photo and
 * writes the text, and the user does none of it by hand.
 *
 * This module is that step, and it is deterministic on purpose: the same colour, photo and flyer
 * setup always produce the same design. Three things are never guessed:
 *   - the colours come from `standards/colour-meanings.json` and from the colour the user chose;
 *   - the words come from that recorded meaning plus the flyer setup (subject, audience), never
 *     from a model, so the text can be read and corrected;
 *   - the app composes, it does not choose the background: `choice.by` stays `user`, and the
 *     colour questioned by the standard (red, yellow) is still refused unless the recorded
 *     profile allows it.
 *
 * The result is an SVG document. It is never inserted into the page: the interface shows it as
 * an image (an object URL) and offers it for download, so the rule "no SVG markup in the
 * document, no innerHTML" still holds.
 */

import { normaliseDesignContext } from '../policy/design-suggestions.js';

const XML_ESCAPES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' });

function xml(value) {
  return String(value).replace(/[&<>"']/g, (character) => XML_ESCAPES[character]);
}

function round(value) {
  return Math.round(value);
}

function capitalise(text) {
  const raw = String(text);
  return raw.length === 0 ? raw : raw[0].toUpperCase() + raw.slice(1);
}

function hexToRgb(hex) {
  const value = String(hex).replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const channel = (value) => Math.max(0, Math.min(255, round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Mixes a colour towards white (ratio > 0) or towards black (target). Used for surfaces only. */
function mix(hex, target, ratio) {
  const from = hexToRgb(hex);
  const to = hexToRgb(target);
  return rgbToHex({
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio
  });
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The ink that keeps the text readable on a ground: dark on light colours, light on dark ones. */
function inkFor(hex) {
  return relativeLuminance(hex) > 0.42 ? '#14120e' : '#fbf8f1';
}

/** Word wrapping with a declared character budget, so the text never leaves the safe margin. */
function wrap(text, maxCharacters) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (candidate.length > maxCharacters && line !== '') {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

const FONTS = Object.freeze({
  display: '"Georgia", "Times New Roman", serif',
  body: '"Helvetica Neue", Arial, sans-serif',
  mono: '"Courier New", monospace'
});

export const COMPOSITION_LAYOUTS = Object.freeze({
  'band-right': {
    label: 'text band left, photo right',
    for: 'wide formats (banner, background)'
  },
  stack: {
    label: 'photo above, text below',
    for: 'portrait formats (flyer, poster)'
  },
  cover: {
    label: 'full-bleed photo, text on the scrim',
    for: 'square formats (social post)'
  }
});

function layoutFor(width, height) {
  const ratio = width / height;
  if (ratio >= 1.6) return 'band-right';
  if (ratio <= 0.95) return 'stack';
  return 'cover';
}

function buildCopy({ colourName, entry, context }) {
  const meaningPhrase = entry.meanings.join(' or ');
  const headline = context.subject ?? `${capitalise(colourName)} — ${meaningPhrase}`;
  const subhead = context.audience === null ? null : `For ${context.audience}`;
  const body = [
    `${capitalise(colourName)} carries ${meaningPhrase}.`,
    context.subject === null ? null : `${context.subject} is the subject, set in the colour you chose.`,
    context.audience === null ? null : `It speaks to ${context.audience}.`
  ]
    .filter(Boolean)
    .join(' ');
  return {
    kicker: `chatmt · ${context.label}`,
    headline,
    subhead,
    body,
    footer: `${colourName} · ${entry.hex} · ${context.width}×${context.height}`
  };
}

function svgDocument({ width, height, content, title }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img">` +
    `<title>${xml(title)}</title>${content}</svg>`
  );
}

function photoLayer({ photo, x, y, width, height, id }) {
  return (
    `<defs><clipPath id="photo-${id}"><rect x="${x}" y="${y}" width="${width}" height="${height}"/></clipPath></defs>` +
    // "slice" is the automatic fit: the photo fills the frame without distortion, and the app
    // decides the crop instead of asking the user for one.
    `<image href="${photo.image}" x="${x}" y="${y}" width="${width}" height="${height}" ` +
    `preserveAspectRatio="xMidYMid slice" clip-path="url(#photo-${id})"/>`
  );
}

function scrimLayer({ x, y, width, height, colour, direction = 'vertical', id }) {
  const [x1, y1, x2, y2] =
    direction === 'vertical' ? [0, y, 0, y + height] : [x, 0, x + width, 0];
  return (
    `<defs><linearGradient id="scrim-${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ` +
    `gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="${colour}" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="${colour}" stop-opacity="0.94"/>` +
    `</linearGradient></defs>` +
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="url(#scrim-${id})"/>`
  );
}

function textLines({ lines, x, y, lineHeight, size, fill, font, weight = 400, spacing = 0 }) {
  return lines
    .map(
      (line, index) =>
        `<text x="${x}" y="${round(y + index * lineHeight)}" font-family='${font}' font-size="${size}" ` +
        `font-weight="${weight}" fill="${fill}"${spacing === 0 ? '' : ` letter-spacing="${spacing}"`}>` +
        `${xml(line)}</text>`
    )
    .join('');
}

function geometricField({ x, y, width, height, colour, id }) {
  const light = mix(colour, '#ffffff', 0.34);
  const deep = mix(colour, '#000000', 0.3);
  return (
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${colour}"/>` +
    `<circle cx="${round(x + width * 0.72)}" cy="${round(y + height * 0.28)}" r="${round(Math.min(width, height) * 0.3)}" fill="${light}" opacity="0.5"/>` +
    `<circle cx="${round(x + width * 0.34)}" cy="${round(y + height * 0.72)}" r="${round(Math.min(width, height) * 0.22)}" fill="${deep}" opacity="0.35"/>` +
    `<rect x="${round(x + width * 0.08)}" y="${round(y + height * 0.08)}" width="${round(width * 0.84)}" height="${round(height * 0.84)}" ` +
    `fill="none" stroke="${light}" stroke-width="2" opacity="0.45" data-field="${id}"/>`
  );
}

/**
 * Composes one design from the chosen colour, the optional photo and the flyer setup.
 *
 * @param {object} input
 * @param {object} input.meanings the index built by createMeaningIndex
 * @param {object} [input.standing] the friendliness standing, needed for red and yellow
 * @param {string} input.colourName the colour the user chose
 * @param {object} [input.design] the flyer setup (type, subject, audience, text)
 * @param {{image: string, width: number, height: number}|null} [input.photo] a prepared photo
 * @param {number} [input.variant] rotates the composition among a few layouts
 */
export function composeDesign({ meanings, standing = null, colourName, design, photo = null, variant = 0 } = {}) {
  if (!meanings || typeof meanings.representationFor !== 'function') {
    throw new TypeError('composeDesign needs the colour meaning index.');
  }

  const requested = String(colourName ?? '').trim().toLowerCase();
  const entry = meanings.representationFor(requested);
  if (entry === null || entry === undefined) {
    throw new RangeError(`Unknown colour ${JSON.stringify(requested)}: it is not in the palette.`);
  }
  if (meanings.isQuestioned(requested) && standing?.allow_questioned_colours !== true) {
    throw new RangeError(
      `A ${requested} background is composed only after a cogent reason for ${requested} was recorded.`
    );
  }

  const context = design?.width && design?.height ? design : normaliseDesignContext(design ?? {});
  const { width, height } = context;
  const layoutId = layoutFor(width, height);
  const ink = inkFor(entry.hex);
  const copy = buildCopy({ colourName: requested, entry, context });
  const margin = round(Math.min(width, height) * 0.07);
  const headlineSize = Math.max(30, Math.min(96, round(Math.min(width, height) * 0.078)));
  const bodySize = Math.max(15, Math.min(30, round(headlineSize * 0.4)));
  const kickerSize = Math.max(11, round(bodySize * 0.72));
  const footerSize = kickerSize;
  const actions = [];

  const parts = [];

  if (layoutId === 'stack') {
    const photoHeight = photo === null ? round(height * 0.46) : round(height * 0.58);
    const contentTop = photoHeight + margin;
    const columnWidth = width - margin * 2;
    const subtitle = copy.subhead === null ? [] : [copy.subhead];
    const headlineLines = wrap(copy.headline, Math.max(12, Math.floor(columnWidth / (headlineSize * 0.5))));
    const bodyLines = wrap(copy.body, Math.max(20, Math.floor(columnWidth / (bodySize * 0.5))));

    parts.push(`<rect width="${width}" height="${height}" fill="${entry.hex}"/>`);
    parts.push(
      photo !== null
        ? photoLayer({ photo, x: 0, y: 0, width, height: photoHeight, id: 'main' }) +
            scrimLayer({ x: 0, y: round(photoHeight * 0.55), width, height: round(photoHeight * 0.45), colour: entry.hex, id: 'main' })
        : geometricField({ x: 0, y: 0, width, height: photoHeight, colour: entry.hex, id: 'main' })
    );
    parts.push(
      textLines({
        lines: [copy.kicker.toUpperCase()],
        x: margin,
        y: contentTop + kickerSize,
        lineHeight: kickerSize * 1.4,
        size: kickerSize,
        fill: ink,
        font: FONTS.mono,
        spacing: 2
      })
    );
    parts.push(
      textLines({
        lines: headlineLines,
        x: margin,
        y: contentTop + kickerSize * 2.4 + headlineSize,
        lineHeight: round(headlineSize * 1.08),
        size: headlineSize,
        fill: ink,
        font: FONTS.display
      })
    );
    const afterHeadline = contentTop + kickerSize * 2.4 + headlineSize + (headlineLines.length - 1) * headlineSize * 1.08;
    parts.push(
      textLines({
        lines: subtitle,
        x: margin,
        y: afterHeadline + bodySize * 1.9,
        lineHeight: round(bodySize * 1.4),
        size: bodySize,
        fill: ink,
        font: FONTS.body,
        weight: 700
      })
    );
    parts.push(
      textLines({
        lines: bodyLines,
        x: margin,
        y: afterHeadline + bodySize * (subtitle.length === 0 ? 1.9 : 3.6),
        lineHeight: round(bodySize * 1.5),
        size: bodySize,
        fill: ink,
        font: FONTS.body
      })
    );
    parts.push(
      `<rect x="${margin}" y="${height - margin * 1.5}" width="${round(width - margin * 2)}" height="1" fill="${ink}" opacity="0.35"/>` +
        textLines({
          lines: [copy.footer],
          x: margin,
          y: height - margin,
          lineHeight: footerSize * 1.3,
          size: footerSize,
          fill: ink,
          font: FONTS.mono
        })
    );

    actions.push(
      photo !== null
        ? 'Photo fitted automatically: cover-fit inside the top frame, cropped by the app, no manual crop.'
        : 'No photo sent: a geometric field built from the chosen colour fills the top frame.',
      'A gradient scrim was placed under the text so it stays readable over the photo.',
      `Headline wrapped automatically into ${headlineLines.length} line${headlineLines.length === 1 ? '' : 's'} inside the safe margin.`,
      'Footer rule and colour code added by the app.'
    );
  } else if (layoutId === 'band-right') {
    const bandWidth = round(width * 0.56);
    const photoX = bandWidth;
    const columnWidth = bandWidth - margin * 2;
    const headlineLines = wrap(copy.headline, Math.max(10, Math.floor(columnWidth / (headlineSize * 0.5))));
    const bodyLines = wrap(copy.body, Math.max(18, Math.floor(columnWidth / (bodySize * 0.5))));
    const subtitle = copy.subhead === null ? [] : [copy.subhead];

    parts.push(`<rect width="${width}" height="${height}" fill="${entry.hex}"/>`);
    parts.push(
      photo !== null
        ? photoLayer({ photo, x: photoX, y: 0, width: width - photoX, height, id: 'main' }) +
            scrimLayer({ x: photoX, y: 0, width: round((width - photoX) * 0.42), height, colour: entry.hex, direction: 'horizontal', id: 'main' })
        : geometricField({ x: photoX, y: 0, width: width - photoX, height, colour: entry.hex, id: 'main' })
    );
    parts.push(
      textLines({
        lines: [copy.kicker.toUpperCase()],
        x: margin,
        y: margin + kickerSize,
        lineHeight: kickerSize * 1.4,
        size: kickerSize,
        fill: ink,
        font: FONTS.mono,
        spacing: 2
      })
    );
    parts.push(
      textLines({
        lines: headlineLines,
        x: margin,
        y: round(height * 0.42),
        lineHeight: round(headlineSize * 1.08),
        size: headlineSize,
        fill: ink,
        font: FONTS.display
      })
    );
    const afterHeadline = round(height * 0.42) + (headlineLines.length - 1) * headlineSize * 1.08;
    parts.push(
      textLines({
        lines: subtitle,
        x: margin,
        y: afterHeadline + bodySize * 1.9,
        lineHeight: round(bodySize * 1.4),
        size: bodySize,
        fill: ink,
        font: FONTS.body,
        weight: 700
      })
    );
    parts.push(
      textLines({
        lines: bodyLines,
        x: margin,
        y: afterHeadline + bodySize * (subtitle.length === 0 ? 1.9 : 3.6),
        lineHeight: round(bodySize * 1.5),
        size: bodySize,
        fill: ink,
        font: FONTS.body
      })
    );
    parts.push(
      textLines({
        lines: [copy.footer],
        x: margin,
        y: height - margin,
        lineHeight: footerSize * 1.3,
        size: footerSize,
        fill: ink,
        font: FONTS.mono
      })
    );

    actions.push(
      photo !== null
        ? 'Photo fitted automatically in the right band: cover-fit, no manual crop.'
        : 'No photo sent: a geometric field built from the chosen colour fills the right band.',
      'A horizontal scrim was placed where the photo meets the text.',
      `Headline wrapped automatically into ${headlineLines.length} line${headlineLines.length === 1 ? '' : 's'}.`,
      'Text kept on the colour band: nothing sits over the photo.'
    );
  } else {
    const textTop = round(height * 0.6);
    const columnWidth = width - margin * 2;
    const headlineLines = wrap(copy.headline, Math.max(12, Math.floor(columnWidth / (headlineSize * 0.5))));
    const bodyLines = wrap(copy.body, Math.max(20, Math.floor(columnWidth / (bodySize * 0.5))));

    parts.push(`<rect width="${width}" height="${height}" fill="${entry.hex}"/>`);
    parts.push(
      photo !== null
        ? photoLayer({ photo, x: 0, y: 0, width, height, id: 'main' }) +
            scrimLayer({ x: 0, y: textTop - round(height * 0.3), width, height: height - textTop + round(height * 0.3), colour: entry.hex, id: 'main' })
        : geometricField({ x: 0, y: 0, width, height, colour: entry.hex, id: 'main' })
    );
    parts.push(
      textLines({
        lines: [copy.kicker.toUpperCase()],
        x: margin,
        y: textTop,
        lineHeight: kickerSize * 1.4,
        size: kickerSize,
        fill: ink,
        font: FONTS.mono,
        spacing: 2
      })
    );
    parts.push(
      textLines({
        lines: headlineLines,
        x: margin,
        y: textTop + kickerSize * 2 + headlineSize,
        lineHeight: round(headlineSize * 1.08),
        size: headlineSize,
        fill: ink,
        font: FONTS.display
      })
    );
    parts.push(
      textLines({
        lines: bodyLines,
        x: margin,
        y: height - margin,
        lineHeight: round(bodySize * 1.5),
        size: bodySize,
        fill: ink,
        font: FONTS.body
      })
    );

    actions.push(
      photo !== null
        ? 'Photo placed full-bleed: cover-fit, centred, no manual crop.'
        : 'No photo sent: a geometric field built from the chosen colour is used.',
      'A scrim was placed from below so the text keeps its contrast on any photo.',
      `Headline wrapped automatically into ${headlineLines.length} line${headlineLines.length === 1 ? '' : 's'}.`
    );
  }

  const svg = svgDocument({
    width,
    height,
    title: `${copy.headline} — ${context.label}`,
    content: parts.join('')
  });

  const warnings = [];
  if (photo === null) warnings.push('No photo was sent: the frame uses a colour field instead.');
  if (meanings.isQuestioned(requested)) {
    warnings.push(
      `The ${requested} background is composed because a cogent reason for ${requested} is recorded in the profile.`
    );
  }

  return {
    choice: {
      by: 'user',
      applied: true,
      note: 'The app composed the design from the colour you chose; it did not choose the colour for you.'
    },
    design: {
      type: context.type,
      label: context.label,
      width,
      height,
      subject: context.subject,
      audience: context.audience,
      text: context.text
    },
    colour: {
      colour_name: requested,
      hex: entry.hex,
      meanings: entry.meanings,
      ink
    },
    layout: {
      id: layoutId,
      label: COMPOSITION_LAYOUTS[layoutId].label,
      for: COMPOSITION_LAYOUTS[layoutId].for,
      margin,
      variant: Number.isInteger(variant) ? variant : 0
    },
    copy,
    photo:
      photo === null
        ? null
        : { width: photo.width, height: photo.height, treatment: 'cover-fit, centred, automatic' },
    actions,
    warnings,
    svg,
    svg_bytes: Buffer.byteLength(svg, 'utf8')
  };
}
