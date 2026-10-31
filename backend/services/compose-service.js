/**
 * Composition service.
 *
 * The HTTP face of modules/design/composer.js: it resolves the colour, reads the recorded
 * profile (which is what unlocks red and yellow), prepares the uploaded photo and returns the
 * composed SVG. The rules stay where they were: the colour comes from the palette, the meaning
 * from the standard file, and the permission for a questioned colour from the stored profile,
 * never from a flag in the request.
 */

import { createMeaningIndex } from '../../modules/meaning/colour-meanings.js';
import { composeDesign } from '../../modules/design/composer.js';
import { badRequest } from '../errors.js';

const MAX_PHOTO_WIDTH = 1600;

function resolveColour(palette, colour) {
  if (colour === null || typeof colour !== 'object') {
    throw badRequest('colour_required', 'A colour is required to compose the design.');
  }
  const wantedName =
    typeof colour.name === 'string' && colour.name.trim() !== '' ? colour.name.trim().toLowerCase() : null;
  const wantedHex =
    typeof colour.hex === 'string' && colour.hex.trim() !== '' ? colour.hex.trim().toUpperCase() : null;

  if (wantedName === null && wantedHex === null) {
    throw badRequest('colour_required', 'A colour is required to compose the design.');
  }
  const byName = wantedName === null ? null : palette.find((entry) => entry.name === wantedName) ?? null;
  const byHex = wantedHex === null ? null : palette.find((entry) => entry.hex.toUpperCase() === wantedHex) ?? null;
  if (wantedName !== null && byName === null) {
    throw badRequest('unknown_colour', `${JSON.stringify(wantedName)} is not in the palette.`);
  }
  if (wantedHex !== null && byHex === null) {
    throw badRequest('unknown_colour', `${wantedHex} is not in the palette.`);
  }
  if (byName !== null && byHex !== null && byName.name !== byHex.name) {
    throw badRequest(
      'colour_mismatch',
      `The name ${byName.name} and the value ${wantedHex} point to different palette colours.`
    );
  }
  return byName ?? byHex;
}

/**
 * @param {object} options
 * @param {object} options.meaningStandard the parsed colour-meanings standard
 * @param {ReadonlyArray<object>} options.palette
 * @param {(userId: string) => object} options.standingFor the profile of one user
 * @param {object} options.images the image service, for prepare()
 */
export function createComposeService({ meaningStandard, palette, standingFor, images, backgroundImages = null }) {
  if (!Array.isArray(palette) || palette.length === 0) throw new TypeError('The compose service needs the palette.');
  if (typeof standingFor !== 'function') throw new TypeError('The compose service needs a standing reader.');
  if (!images || typeof images.prepare !== 'function') {
    throw new TypeError('The compose service needs the image service.');
  }

  const meanings = createMeaningIndex(meaningStandard, { palette });

  async function prepareImage(image) {
    if (typeof image !== 'string' || image.trim() === '') return null;
    return images.prepare({ image, maxWidth: MAX_PHOTO_WIDTH });
  }

  function svgDataUrl(svg) {
    return `data:image/svg+xml;base64,${Buffer.from(String(svg), 'utf8').toString('base64')}`;
  }

  /**
   * @param {{userId: string, colour: object, design?: object, image?: string|null, photo?: object|null, background?: object|null, variant?: number}} input
   */
  async function compose({ userId, colour, design, image = null, photo = null, background = null, variant = 0 } = {}) {
    const entry = resolveColour(palette, colour);
    const standing = standingFor(userId);

    const preparedPhoto = photo ?? (await prepareImage(image));
    const backgroundRecord =
      background === null || background === undefined
        ? null
        : {
            id: background.id ?? null,
            label: background.label ?? null,
            fallback: background.fallback === true,
            image:
              typeof background.image === 'string' && background.image.startsWith('data:image/')
                ? background.image
                : typeof background.svg === 'string'
                  ? svgDataUrl(background.svg)
                  : null
          };

    const result = composeDesign({
      meanings,
      standing,
      colourName: entry.name,
      design,
      photo: preparedPhoto,
      backgroundImage: backgroundRecord?.image ?? null,
      variant
    });

    return {
      ...result,
      background: backgroundRecord,
      photo:
        preparedPhoto === null
          ? null
          : {
              ...result.photo,
              source: preparedPhoto.source,
              resized: preparedPhoto.resized,
              bytes: preparedPhoto.bytes,
              treatment: 'cover-fit, centred, automatic: no manual crop'
            },
      stored: null,
      note: 'Nothing is written by a composition: it is a design produced from data already chosen.'
    };
  }

  return Object.freeze({ compose, prepareImage, meanings });
}
