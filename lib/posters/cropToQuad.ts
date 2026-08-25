/**
 * Perspective-crop a poster photo down to the printed sheet.
 *
 * Gemini returns the four corners of the paper it found in the photo (see
 * `cropCorners` in lib/ai/posterExtraction.ts). Those four points define a
 * homography - the projective transform between the flat sheet and the tilted
 * quadrilateral the camera recorded - and inverting it maps the trapezoid back
 * to a true rectangle. That is what separates this from a plain crop: an
 * axis-aligned box cut around a tilted flyer keeps the background in every
 * corner and leaves the page skewed.
 *
 * sharp cannot do this. Its `affine()` takes a 2x2 matrix, which can shear and
 * rotate but cannot map a trapezoid to a rectangle, and libvips' `mapim` is not
 * bound in the Node API. Hence the hand-rolled warp below.
 *
 * Every rejection path here returns null, and the caller publishes the
 * uncropped image - the behaviour this feature had before it existed.
 */

import sharp from 'sharp';

/** Model coordinates are normalized to this range on both axes. */
const COORD_SCALE = 1000;

/**
 * Slack allowed on model coordinates before a quad is rejected outright.
 * The model routinely returns exactly 1000 for a corner touching an edge, and
 * occasionally a pixel or two beyond it; anything within this band is clamped
 * into the frame rather than thrown away.
 */
const COORD_TOLERANCE = 20;

/**
 * Fraction of the frame the quad must cover to be worth cropping.
 *
 * Deliberately conservative. No geometric test can prove a quad IS the poster,
 * so the floor sits well above the size of things that get mistaken for one - a
 * prominent QR code on a 2048px photo covers about 6%. A legitimate but very
 * small poster loses its crop and publishes whole, which is the harmless
 * direction to fail.
 */
const MIN_COVERAGE = 0.15;

/**
 * Smallest |sin(turn)| accepted at a corner.
 *
 * Below this the quad is degenerate - three points on a line make it a triangle
 * whose homography collapses - and none of the area, side, aspect or output
 * gates notice. Measured: [[100,100],[500,100],[900,100],[100,900]] on a
 * 1000x1000 image passed every other gate and warped to a 766x600 image of one
 * flat colour. The threshold is on the sine of the turn, so it is scale-free;
 * real poster corners sit near a right angle, leaving enormous margin.
 */
const MIN_CORNER_SINE = 0.05;

/**
 * Above this the crop removes nothing worth the warp, so leave the image
 * alone. This doubles as the "already a full-frame poster" guard for the case
 * where the model sets needsCrop but the sheet fills the photo.
 */
const MAX_COVERAGE = 0.94;

/** Shortest side must be at least this fraction of the mean side length. */
const MIN_SIDE_RATIO = 0.25;

/** A crop smaller than this on its short side is too low-resolution to publish. */
const MIN_OUTPUT_SHORT_SIDE = 320;

/** A sheet of paper is never a sliver. */
const MIN_ASPECT = 0.2;
const MAX_ASPECT = 5.0;

/** Matches the pipeline's own ceiling so a crop can never exceed the source. */
const MAX_OUTPUT_DIMENSION = 2048;

const JPEG_QUALITY = 85;

/**
 * Out-of-source samples paint white - poster margins are usually white, and a
 * black wedge in a corner reads as a rendering bug. With a sane quad there are
 * at most a few such pixels.
 */
const OUT_OF_BOUNDS_VALUE = 255;

export type Point = [number, number];

/** Corners in the model's order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

export interface CroppedPoster {
  buffer: Buffer;
  width: number;
  height: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Twice the signed area (the shoelace formula). Positive means clockwise in
 * screen coordinates, where y grows downward.
 */
function signedArea2(quad: Quad): number {
  let sum = 0;

  for (let i = 0; i < 4; i++) {
    const [x0, y0] = quad[i];
    const [x1, y1] = quad[(i + 1) % 4];
    sum += x0 * y1 - x1 * y0;
  }

  return sum;
}

/**
 * True when every turn goes the same way AND none of them is close to straight:
 * no bow-tie, no dent, and no three corners on a line.
 *
 * Tolerating a straight turn is what let a degenerate triangle through - see
 * MIN_CORNER_SINE. Strictness here is also what makes the winding argument in
 * planCrop hold.
 */
function isStrictlyConvex(quad: Quad): boolean {
  let sign = 0;

  for (let i = 0; i < 4; i++) {
    const [ax, ay] = quad[i];
    const [bx, by] = quad[(i + 1) % 4];
    const [cx, cy] = quad[(i + 2) % 4];

    const abx = bx - ax;
    const aby = by - ay;
    const bcx = cx - bx;
    const bcy = cy - by;

    const lengths = Math.hypot(abx, aby) * Math.hypot(bcx, bcy);
    if (lengths === 0) return false; // Coincident corners.

    const cross = abx * bcy - aby * bcx;
    if (Math.abs(cross) / lengths < MIN_CORNER_SINE) return false;

    const current = Math.sign(cross);
    if (sign === 0) sign = current;
    else if (current !== sign) return false;
  }

  return sign !== 0;
}

/**
 * Convert the model's 0-1000 corners into pixel coordinates, or null when the
 * payload is not four numeric pairs inside the tolerated range.
 *
 * Normalization is per-axis: x scales by width and y by height. A square
 * interpretation would be wrong by hundreds of pixels on a non-square image.
 */
export function toPixelQuad(corners: unknown, width: number, height: number): Quad | null {
  if (!Array.isArray(corners) || corners.length !== 4) return null;

  const points: Point[] = [];
  const lower = -COORD_TOLERANCE;
  const upper = COORD_SCALE + COORD_TOLERANCE;

  for (const corner of corners as unknown[]) {
    if (!Array.isArray(corner) || corner.length !== 2) return null;

    const rawX: unknown = corner[0];
    const rawY: unknown = corner[1];
    if (typeof rawX !== 'number' || typeof rawY !== 'number') return null;
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
    if (rawX < lower || rawX > upper || rawY < lower || rawY > upper) return null;

    // Inside the tolerance band but outside the frame: clamp rather than reject.
    const x = Math.min(Math.max(rawX, 0), COORD_SCALE) * (width / COORD_SCALE);
    const y = Math.min(Math.max(rawY, 0), COORD_SCALE) * (height / COORD_SCALE);

    points.push([x, y]);
  }

  return points as Quad;
}

export type QuadRejection =
  | 'degenerate'
  | 'wound-anticlockwise'
  | 'not-convex'
  | 'coverage-too-small'
  | 'coverage-no-gain'
  | 'sliver-side'
  | 'bad-aspect'
  | 'output-too-small';

export interface QuadPlan {
  quad: Quad;
  outputWidth: number;
  outputHeight: number;
}

/**
 * Decide whether a pixel-space quad is safe to warp, and size the output.
 *
 * Output dimensions are the mean of each pair of opposite sides, which
 * preserves the sheet's true aspect ratio far better than taking the longest
 * side of each axis.
 *
 * Note what is deliberately NOT checked: that the model labelled the corners in
 * the same rotation we would have. The model names corners by the poster's own
 * orientation, so a sideways flyer comes back cyclically shifted - and warping
 * with its labels rights the image for free. Any convex, clockwise ordering of
 * four points in STRICTLY convex position is a cyclic shift of the geometric
 * one, so the winding and convexity checks already admit exactly those four
 * while rejecting the other twenty permutations. That equivalence is why
 * isStrictlyConvex may not tolerate collinear turns.
 */
export function planCrop(
  quad: Quad,
  width: number,
  height: number
): { ok: true; plan: QuadPlan } | { ok: false; reason: QuadRejection } {
  const area2 = signedArea2(quad);

  if (Math.abs(area2) < 1) return { ok: false, reason: 'degenerate' };

  // Anticlockwise means the corner order was reversed, which would warp the
  // poster mirrored. Observed in the wild when thinking level is lowered.
  if (area2 < 0) return { ok: false, reason: 'wound-anticlockwise' };

  if (!isStrictlyConvex(quad)) return { ok: false, reason: 'not-convex' };

  const coverage = Math.abs(area2) / 2 / (width * height);
  if (coverage < MIN_COVERAGE) return { ok: false, reason: 'coverage-too-small' };
  if (coverage > MAX_COVERAGE) return { ok: false, reason: 'coverage-no-gain' };

  const [tl, tr, br, bl] = quad;
  const top = distance(tl, tr);
  const bottom = distance(bl, br);
  const left = distance(tl, bl);
  const right = distance(tr, br);

  const sides = [top, bottom, left, right];
  const meanSide = sides.reduce((sum, side) => sum + side, 0) / 4;
  if (Math.min(...sides) < meanSide * MIN_SIDE_RATIO) {
    return { ok: false, reason: 'sliver-side' };
  }

  const targetWidth = (top + bottom) / 2;
  const targetHeight = (left + right) / 2;
  if (targetWidth < 1 || targetHeight < 1) return { ok: false, reason: 'degenerate' };

  const aspect = targetWidth / targetHeight;
  if (aspect < MIN_ASPECT || aspect > MAX_ASPECT) return { ok: false, reason: 'bad-aspect' };

  // Never upscale past the pipeline's ceiling. The crop is a subset of an
  // already-bounded image, so this only bites on near-full-frame quads.
  const scale = Math.min(1, MAX_OUTPUT_DIMENSION / Math.max(targetWidth, targetHeight));
  const outputWidth = Math.round(targetWidth * scale);
  const outputHeight = Math.round(targetHeight * scale);

  if (Math.min(outputWidth, outputHeight) < MIN_OUTPUT_SHORT_SIDE) {
    return { ok: false, reason: 'output-too-small' };
  }

  return { ok: true, plan: { quad, outputWidth, outputHeight } };
}

/**
 * Solve the eight homography parameters mapping the unit square onto `src`,
 * by Gauss-Jordan elimination with partial pivoting.
 *
 * Each corner contributes two equations:
 *   x = (h0*u + h1*v + h2) / (h6*u + h7*v + 1)
 *   y = (h3*u + h4*v + h5) / (h6*u + h7*v + 1)
 * cross-multiplied into linear form. Four corners give the eight rows needed.
 */
function solveHomography(src: Quad): number[] | null {
  const unit: Quad = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [u, v] = unit[i];
    const [x, y] = src[i];
    a.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);
    b.push(x);
    a.push([0, 0, 0, u, v, 1, -u * y, -v * y]);
    b.push(y);
  }

  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }

    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];

    const pivotValue = a[col][col];
    // A singular system means the four corners do not define a projective map.
    // Carrying on with a partially reduced row would return numbers that look
    // like a solution and warp to garbage, so refuse instead.
    if (!Number.isFinite(pivotValue) || Math.abs(pivotValue) < 1e-9) return null;

    for (let j = col; j < 8; j++) a[col][j] /= pivotValue;
    b[col] /= pivotValue;

    for (let row = 0; row < 8; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = col; j < 8; j++) a[row][j] -= factor * a[col][j];
      b[row] -= factor * b[col];
    }
  }

  return b.every((value) => Number.isFinite(value)) ? b : null;
}

/**
 * Warp the quad out of `input` into an upright rectangle.
 *
 * Runs backwards on purpose: for every pixel of the OUTPUT it computes where
 * that pixel came from in the source and samples there (bilinear, so edges do
 * not stair-step). Mapping forwards instead would leave unclaimed holes
 * wherever the source stretches.
 */
export async function warpQuad(input: Buffer, plan: QuadPlan): Promise<CroppedPoster> {
  const { quad, outputWidth, outputHeight } = plan;

  const { data: src, info } = await sharp(input)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const srcWidth = info.width;
  const srcHeight = info.height;
  const channels = info.channels;

  const h = solveHomography(quad);
  // cropToQuad catches this and publishes the original uncropped.
  if (!h) throw new Error('Homography is singular for this quad');

  const out = Buffer.allocUnsafe(outputWidth * outputHeight * channels);

  for (let j = 0; j < outputHeight; j++) {
    // Sample from pixel centres so the crop is not shifted half a pixel.
    const v = (j + 0.5) / outputHeight;

    for (let i = 0; i < outputWidth; i++) {
      const u = (i + 0.5) / outputWidth;

      const w = h[6] * u + h[7] * v + 1;
      const x = (h[0] * u + h[1] * v + h[2]) / w;
      const y = (h[3] * u + h[4] * v + h[5]) / w;

      const target = (j * outputWidth + i) * channels;

      if (!(x >= 0 && y >= 0 && x <= srcWidth && y <= srcHeight)) {
        out.fill(OUT_OF_BOUNDS_VALUE, target, target + channels);
        continue;
      }

      // Corners arrive in BOUNDARY coordinates, where 0..width spans the whole
      // image, but the raw buffer is a grid of pixel CENTRES at 0.5..width-0.5.
      // Without this half-pixel shift the outermost strip of a quad that
      // reaches the frame edge reads as out of bounds and paints white.
      const sx = Math.min(Math.max(x - 0.5, 0), srcWidth - 1);
      const sy = Math.min(Math.max(y - 0.5, 0), srcHeight - 1);

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);
      const fx = sx - x0;
      const fy = sy - y0;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const i00 = (y0 * srcWidth + x0) * channels;
      const i10 = (y0 * srcWidth + x1) * channels;
      const i01 = (y1 * srcWidth + x0) * channels;
      const i11 = (y1 * srcWidth + x1) * channels;

      for (let c = 0; c < channels; c++) {
        out[target + c] =
          src[i00 + c] * w00 + src[i10 + c] * w10 + src[i01 + c] * w01 + src[i11 + c] * w11 + 0.5;
      }
    }
  }

  const buffer = await sharp(out, {
    raw: { width: outputWidth, height: outputHeight, channels },
  })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  return { buffer, width: outputWidth, height: outputHeight };
}

/**
 * Full crop attempt: validate the model's corners, then warp.
 *
 * Returns null for every "do not crop" outcome - a missing or malformed quad, a
 * failed gate, or a warp that threw. Callers publish the original in that case.
 */
export async function cropToQuad(
  input: Buffer,
  corners: unknown,
  width: number,
  height: number
): Promise<CroppedPoster | null> {
  const quad = toPixelQuad(corners, width, height);
  if (!quad) {
    console.warn('[Posters] Crop corners were not four usable points; publishing uncropped.');
    return null;
  }

  const planned = planCrop(quad, width, height);
  if (!planned.ok) {
    console.warn(`[Posters] Crop rejected (${planned.reason}); publishing uncropped.`);
    return null;
  }

  try {
    return await warpQuad(input, planned.plan);
  } catch (error) {
    // A crop is an enhancement, never a reason to fail an upload.
    console.error('[Posters] Crop warp failed; publishing uncropped:', error);
    return null;
  }
}
