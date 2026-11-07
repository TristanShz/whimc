// The WebGL programs that draw the Map in sigma: a flat disc for Modules (a
// quiet tint of its Churn colour, a crisp 1 px outline, and a ring for the
// focus, a search match or a Changes mark); and for Dependencies, a thin,
// barely curved line, solid, dashed or dotted, drawn above the discs from
// one disc's boundary to the other's, narrowing towards the imported Module
// only around the focus. Both fade between opacities on the GPU (nodes scale
// in a little as they arrive) and take the level blend as a uniform, so that
// zooming and hovering never rebuild the vertex buffers. Nothing animates on
// its own: a frame is drawn only when something changed.
//
// Checked by eye in the browser (spec: the WebGL rendering is not automated).

import { EdgeProgram, NodeProgram } from "sigma/rendering";
import type { RenderParams } from "sigma/types";
import { floatColor } from "sigma/utils";
import type { EdgeAttributes, NodeAttributes } from "./attributes";
import { FADE_SECONDS } from "./attributes";
import { clock, type Frame } from "./frame";

const { UNSIGNED_BYTE, FLOAT, TRIANGLES } = WebGLRenderingContext;

/** The gap between a disc's outline and its ring, in pixels. */
const RING_GAP_PX = 2.5;

// Shared GLSL: the weight of a level and an item's opacity at u_time.
const COMMON = /* glsl */ `
uniform vec3 u_levelWeights;
uniform vec3 u_childReveal;
uniform float u_time;
const float FADE = ${FADE_SECONDS.toFixed(4)};
const float RING_GAP = ${RING_GAP_PX.toFixed(1)};

float levelWeight(float level) {
  if (level < 0.5) return u_levelWeights.x;
  if (level < 1.5) return u_levelWeights.y;
  return u_levelWeights.z;
}

float childReveal(float level) {
  if (level < 0.5) return u_childReveal.x;
  if (level < 1.5) return u_childReveal.y;
  return u_childReveal.z;
}

float fadeAt(vec3 f) {
  float t = clamp((u_time - f.z) / FADE, 0.0, 1.0);
  return mix(f.y, f.x, t * t * (3.0 - 2.0 * t));
}
`;

const NODE_VERTEX = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec4 a_ringColor;
attribute vec2 a_position;
attribute float a_size;
attribute vec3 a_fade;     // target, from, start time
attribute vec3 a_style;    // level, ring (0 none, 1 solid, 2 dashed), hollow
attribute float a_context; // share of the fade kept once the children show
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;
uniform float u_minRadius;
uniform float u_pickLevel;
uniform float u_motion;    // 0 when the user asks for reduced motion
${COMMON}

varying vec4 v_color;
varying vec4 v_ringColor;
varying vec2 v_offset;   // from the centre, in screen pixels
varying float v_radius;  // in screen pixels
varying float v_alpha;
varying float v_ringAlpha;
varying float v_context; // 1 when the node's level is only context
varying vec3 v_style;    // level, ring, hollow

const float bias = 255.0 / 254.0;

void main() {
  float weight = levelWeight(a_style.x);
  float reveal = childReveal(a_style.x);
  float fade = fadeAt(a_fade);
  // A parent fades back as its children are revealed, highlight or not ...
  float alpha = fade * mix(1.0, a_context, reveal) * weight;
  // ... and keeps its ring (focus, match, change) as the highlight.
  float ringAlpha = fade * max(weight, 0.8 * reveal);

  // A node arriving scales into place as it fades in; one leaving shrinks a
  // little as it fades out.
  float t = clamp((u_time - a_fade.z) / FADE, 0.0, 1.0);
  float arriving = a_fade.y < 0.01 && a_fade.x > 0.0 ? 1.0 : 0.0;
  float leaving = a_fade.x < 0.001 && a_fade.y > 0.0 ? 1.0 : 0.0;
  float out3 = 1.0 - pow(1.0 - t, 3.0);
  float scale = mix(1.0, mix(0.85, 1.0, out3), arriving * u_motion)
    * mix(1.0, mix(1.0, 0.92, t), leaving * u_motion);

  float radius = max(a_size / u_sizeRatio, u_minRadius) * scale;
  float extent = radius + (a_style.y > 0.5 ? RING_GAP + 2.0 : 0.0) + 1.5;
  bool drawn = max(alpha, a_style.y > 0.5 ? ringAlpha : 0.0) > 0.004;

  #ifdef PICKING_MODE
  // Only the level in view is hovered and clicked, ghosts aside, and small
  // discs have a hit area larger than they look.
  extent = max(radius, 6.0);
  drawn = alpha > 0.004 && abs(a_style.x - u_pickLevel) < 0.5 && a_style.z < 0.5;
  #endif

  // The triangle around the disc: its inradius is half its circumradius.
  vec2 offset = extent * 2.0 * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + offset * u_correctionRatio * 2.0;
  gl_Position = drawn
    ? vec4((u_matrix * vec3(position, 1)).xy, 0, 1)
    : vec4(2.0, 2.0, 2.0, 1.0);

  v_offset = offset;
  v_radius = radius;
  v_alpha = alpha;
  v_ringAlpha = ringAlpha;
  v_context = 1.0 - weight;
  v_style = a_style;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
  v_ringColor = a_ringColor;
}
`;

const NODE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying vec4 v_ringColor;
varying vec2 v_offset;
varying float v_radius;
varying float v_alpha;
varying float v_ringAlpha;
varying float v_context;
varying vec3 v_style;

uniform float u_fill;

const float PI = 3.14159265;
const float RING_GAP = ${RING_GAP_PX.toFixed(1)};

// Coverage of a line of width w centred at c, a pixel of antialiasing.
float line(float d, float c, float w) {
  return 1.0 - smoothstep(w * 0.5 - 0.5, w * 0.5 + 0.5, abs(d - c));
}

void main() {
  float d = length(v_offset);
  float r = v_radius;

  #ifdef PICKING_MODE
  if (d > max(r, 6.0)) discard;
  gl_FragColor = v_color;
  #else
  bool hollow = v_style.z > 0.5;
  float inside = 1.0 - smoothstep(r - 0.5, r + 0.5, d);

  // Flat: a quiet tint of the Churn colour, firmer on the small discs so
  // that they still read, and a crisp 1 px outline in the colour itself.
  float fill = hollow ? 0.0 : mix(0.55, u_fill, smoothstep(3.0, 10.0, r));
  float fillA = inside * fill * v_alpha;
  // A level drawn as context keeps its outline (a Package's territory) as
  // its fill goes.
  float outlineA = hollow ? 0.0
    : line(d, r - 0.5, 1.0) * min(1.0, v_alpha * mix(0.9, 2.6, v_context));

  // Ring: the focus, a search match or a Changes mark, just outside the
  // outline; a ghost's dashed ring is its outline.
  float ringA = 0.0;
  if (v_style.y > 0.5) {
    float rr = hollow ? r - 0.75 : r + RING_GAP;
    ringA = line(d, rr, 1.5);
    if (v_style.y > 1.5) {
      float arc = (atan(v_offset.y, v_offset.x) + PI) * rr;
      float m = mod(arc, 6.0);
      ringA *= smoothstep(0.0, 0.6, m) * (1.0 - smoothstep(3.4, 4.0, m));
    }
    ringA *= max(v_ringAlpha, 0.0);
  }

  // Premultiplied, back to front: fill, outline, ring.
  vec3 base = v_color.rgb;
  vec4 c = vec4(base * fillA, fillA);
  c = vec4(base * outlineA, outlineA) + c * (1.0 - outlineA);
  c = vec4(v_ringColor.rgb * ringA, ringA) + c * (1.0 - ringA);
  gl_FragColor = c;
  #endif
}
`;

const NODE_UNIFORMS = [
  "u_motion",
  "u_matrix",
  "u_sizeRatio",
  "u_correctionRatio",
  "u_minRadius",
  "u_pickLevel",
  "u_levelWeights",
  "u_childReveal",
  "u_time",
  "u_fill",
] as const;

/** The disc program, reading the frame it is given at each render. */
export function createNodeProgram(frame: Frame) {
  return class NodeDiscProgram extends NodeProgram<
    (typeof NODE_UNIFORMS)[number]
  > {
    getDefinition() {
      return {
        VERTICES: 3,
        VERTEX_SHADER_SOURCE: NODE_VERTEX,
        FRAGMENT_SHADER_SOURCE: NODE_FRAGMENT,
        METHOD: TRIANGLES,
        UNIFORMS: NODE_UNIFORMS,
        ATTRIBUTES: [
          { name: "a_position", size: 2, type: FLOAT },
          { name: "a_size", size: 1, type: FLOAT },
          { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
          {
            name: "a_ringColor",
            size: 4,
            type: UNSIGNED_BYTE,
            normalized: true,
          },
          { name: "a_fade", size: 3, type: FLOAT },
          { name: "a_style", size: 3, type: FLOAT },
          { name: "a_context", size: 1, type: FLOAT },
        ],
        CONSTANT_ATTRIBUTES: [{ name: "a_angle", size: 1, type: FLOAT }],
        CONSTANT_DATA: [[0], [(2 * Math.PI) / 3], [(4 * Math.PI) / 3]],
      };
    }

    processVisibleItem(nodeIndex: number, startIndex: number, data: object) {
      const d = data as NodeAttributes;
      const a = this.array;
      let i = startIndex;
      a[i++] = d.x;
      a[i++] = d.y;
      a[i++] = d.size;
      a[i++] = floatColor(d.color);
      a[i++] = nodeIndex;
      a[i++] = floatColor(d.ringColor);
      a[i++] = d.fade;
      a[i++] = d.fadeFrom;
      a[i++] = d.fadeAt;
      a[i++] = d.level;
      a[i++] = d.ring;
      a[i++] = d.hollow;
      a[i++] = d.context;
    }

    setUniforms(
      params: RenderParams,
      {
        gl,
        uniformLocations: u,
      }: {
        gl: WebGLRenderingContext;
        uniformLocations: Record<string, WebGLUniformLocation>;
      },
    ) {
      gl.uniformMatrix3fv(u.u_matrix!, false, params.matrix);
      gl.uniform1f(u.u_sizeRatio!, params.sizeRatio);
      gl.uniform1f(u.u_correctionRatio!, params.correctionRatio);
      gl.uniform1f(u.u_minRadius!, frame.minRadiusPx);
      gl.uniform1f(u.u_pickLevel!, frame.pickLevel);
      gl.uniform3fv(u.u_levelWeights!, frame.levelWeights);
      gl.uniform3fv(u.u_childReveal!, frame.childReveal);
      gl.uniform1f(u.u_time!, clock());
      // The tint of a disc: a touch firmer on dark, where it reads less.
      gl.uniform1f(u.u_fill!, frame.palette.dark ? 0.16 : 0.13);
      gl.uniform1f(u.u_motion!, frame.motion);
    }
  };
}

/**
 * The program sigma draws the hovered node with, over every other: it draws
 * nothing, so that a hovered parent never covers its children.
 */
export function createHoverNodeProgram(frame: Frame) {
  return class NodeHoverProgram extends createNodeProgram(frame) {
    render() {}
  };
}

/** Segments a Dependency's curve is drawn with. */
const EDGE_SEGMENTS = 8;

const EDGE_VERTEX = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_thickness;   // screen pixels
attribute vec3 a_fade;
attribute vec3 a_style;        // level, kind (0 runtime, 1 type-only, 2 dynamic), taper
attribute vec2 a_radii;        // of the source and target discs, map units
attribute float a_t;           // 0 at the importer, 1 at the imported
attribute float a_side;        // -1 or 1 across

uniform mat3 u_matrix;
uniform float u_correctionRatio;
uniform float u_sizeRatio;
uniform float u_minRadius;
uniform vec2 u_dimensions;
${COMMON}

// The shortest a Dependency is drawn, in pixels: between discs that touch
// or overlap, a stub across the point where they meet.
const float MIN_LENGTH = 16.0;
// The gap left between a Dependency's end and its disc, in pixels.
const float END_GAP = 1.5;
// How far a Dependency bows to its left, as a share of its length: barely,
// but enough that the two directions between two Modules take two lines.
const float BEND = 0.06;
// Its width at the imported end, as a share of the importer's, when its
// direction shows (around the focus).
const float TAPER = 0.35;

varying vec4 v_color;
varying float v_alpha;
varying float v_along;   // pixels from the source
varying float v_across;  // pixels from the axis
varying float v_half;    // half width, pixels
varying float v_kind;

const float bias = 255.0 / 254.0;

void main() {
  float alpha = fadeAt(a_fade) * levelWeight(a_style.x);

  // From disc boundary to disc boundary, so that a Dependency is drawn
  // where it can be seen, above the discs, without covering its own ends.
  float px = u_correctionRatio * 2.0;
  vec2 axis = a_positionEnd - a_positionStart;
  float d = length(axis);
  vec2 dir = d > 0.0 ? axis / d : vec2(1.0, 0.0);
  float rs = (max(a_radii.x / u_sizeRatio, u_minRadius) + END_GAP) * px;
  float rt = (max(a_radii.y / u_sizeRatio, u_minRadius) + END_GAP) * px;
  float gap = d - rs - rt;
  float minLength = MIN_LENGTH * px;
  vec2 start = a_positionStart + dir * rs;
  vec2 end = a_positionEnd - dir * rt;
  float bend = BEND;
  if (gap < minLength) {
    vec2 middle = a_positionStart + dir * (rs + gap * 0.5);
    start = middle - dir * minLength * 0.5;
    end = middle + dir * minLength * 0.5;
    bend = 0.0;
  }

  // A quadratic curve bowing a little to the left of the direction.
  vec2 chord = end - start;
  float len = length(chord);
  vec2 left = vec2(-dir.y, dir.x);
  vec2 ctrl = (start + end) * 0.5 + left * len * bend;
  float t = a_t;
  vec2 p = mix(mix(start, ctrl, t), mix(ctrl, end, t), t);
  vec2 tangent = 2.0 * (1.0 - t) * (ctrl - start) + 2.0 * t * (end - ctrl);
  tangent = length(tangent) > 0.0 ? normalize(tangent) : dir;
  vec2 normal = vec2(-tangent.y, tangent.x);

  float taper = a_style.z;
  float width = max(a_thickness * mix(1.0, TAPER, t * taper), 0.75);
  float halfPx = width * 0.5 + 1.0;

  gl_Position = alpha > 0.004
    ? vec4((u_matrix * vec3(p + normal * a_side * halfPx * px, 1)).xy, 0, 1)
    : vec4(2.0, 2.0, 2.0, 1.0);

  // Arc length on screen, near enough for the dash pattern.
  vec2 s = (u_matrix * vec3(start, 1)).xy;
  vec2 e = (u_matrix * vec3(end, 1)).xy;
  float lengthPx = length((e - s) * u_dimensions * 0.5) * (1.0 + 2.667 * bend * bend);
  v_along = t * lengthPx;
  v_across = a_side * halfPx;
  v_half = width * 0.5;
  v_kind = a_style.y;
  // A little stronger towards the imported end, with the taper.
  v_alpha = alpha * mix(1.0, mix(0.7, 1.0, t), taper);

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif
  v_color.a *= bias;
}
`;

const EDGE_FRAGMENT = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying float v_alpha;
varying float v_along;
varying float v_across;
varying float v_half;
varying float v_kind;

void main() {
  #ifdef PICKING_MODE
  gl_FragColor = v_color;
  #else
  float body = 1.0 - smoothstep(v_half - 0.5, v_half + 0.5, abs(v_across));
  if (v_kind > 1.5) {
    // Dynamic: dots, as short as the line is wide.
    float period = max(2.0 * v_half, 1.0) + 3.0;
    float m = mod(v_along, period);
    float on = max(2.0 * v_half, 1.0);
    body *= smoothstep(0.0, 0.5, m) * (1.0 - smoothstep(on, on + 0.5, m));
  } else if (v_kind > 0.5) {
    // Type-only: dashes.
    float m = mod(v_along, 7.0);
    body *= smoothstep(0.0, 0.6, m) * (1.0 - smoothstep(4.0, 4.6, m));
  }
  float a = body * v_alpha;
  gl_FragColor = vec4(v_color.rgb * a, a);
  #endif
}
`;

/** Per vertex: where along the arc (t) and on which side. */
function edgeVertices(): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < EDGE_SEGMENTS; i++) {
    const t0 = i / EDGE_SEGMENTS;
    const t1 = (i + 1) / EDGE_SEGMENTS;
    out.push([t0, 1], [t0, -1], [t1, 1], [t1, 1], [t0, -1], [t1, -1]);
  }
  return out;
}
const EDGE_VERTEX_DATA = edgeVertices();

const EDGE_UNIFORMS = [
  "u_matrix",
  "u_correctionRatio",
  "u_sizeRatio",
  "u_minRadius",
  "u_dimensions",
  "u_levelWeights",
  "u_time",
] as const;

export function createEdgeProgram(frame: Frame) {
  return class EdgeDependencyProgram extends EdgeProgram<
    (typeof EDGE_UNIFORMS)[number]
  > {
    getDefinition() {
      return {
        VERTICES: EDGE_VERTEX_DATA.length,
        VERTEX_SHADER_SOURCE: EDGE_VERTEX,
        FRAGMENT_SHADER_SOURCE: EDGE_FRAGMENT,
        METHOD: TRIANGLES,
        UNIFORMS: EDGE_UNIFORMS,
        ATTRIBUTES: [
          { name: "a_positionStart", size: 2, type: FLOAT },
          { name: "a_positionEnd", size: 2, type: FLOAT },
          { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_thickness", size: 1, type: FLOAT },
          { name: "a_fade", size: 3, type: FLOAT },
          { name: "a_style", size: 3, type: FLOAT },
          { name: "a_radii", size: 2, type: FLOAT },
        ],
        CONSTANT_ATTRIBUTES: [
          { name: "a_t", size: 1, type: FLOAT },
          { name: "a_side", size: 1, type: FLOAT },
        ],
        CONSTANT_DATA: EDGE_VERTEX_DATA,
      };
    }

    processVisibleItem(
      edgeIndex: number,
      startIndex: number,
      source: { x: number; y: number; size: number },
      target: { x: number; y: number; size: number },
      data: object,
    ) {
      const d = data as EdgeAttributes;
      const a = this.array;
      let i = startIndex;
      a[i++] = source.x;
      a[i++] = source.y;
      a[i++] = target.x;
      a[i++] = target.y;
      a[i++] = floatColor(d.color);
      a[i++] = edgeIndex;
      a[i++] = d.size;
      a[i++] = d.fade;
      a[i++] = d.fadeFrom;
      a[i++] = d.fadeAt;
      a[i++] = d.level;
      a[i++] = d.kind;
      a[i++] = d.taper;
      a[i++] = source.size;
      a[i++] = target.size;
    }

    setUniforms(
      params: RenderParams,
      {
        gl,
        uniformLocations: u,
      }: {
        gl: WebGLRenderingContext;
        uniformLocations: Record<string, WebGLUniformLocation>;
      },
    ) {
      gl.uniformMatrix3fv(u.u_matrix!, false, params.matrix);
      gl.uniform1f(u.u_correctionRatio!, params.correctionRatio);
      gl.uniform1f(u.u_sizeRatio!, params.sizeRatio);
      gl.uniform1f(u.u_minRadius!, frame.minRadiusPx);
      gl.uniform2f(u.u_dimensions!, params.width, params.height);
      gl.uniform3fv(u.u_levelWeights!, frame.levelWeights);
      gl.uniform1f(u.u_time!, clock());
    }
  };
}
