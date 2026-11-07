// The WebGL programs that draw the Map in sigma: a disc lit as a soft dome
// (rim light, a shadow on paper), with a breathing Churn bloom and a focus or
// Changes ring, for Modules; and for Dependencies, an arc tapering from the
// importer to the imported Module, solid, dashed or dotted, drawn above the
// discs from one disc's boundary to the other's. Both fade between opacities
// on the GPU (nodes grow in as they arrive) and take the level blend as a
// uniform, so that zooming and hovering never rebuild the vertex buffers.
//
// Checked by eye in the browser (spec: the WebGL rendering is not automated).

import { EdgeProgram, NodeProgram } from "sigma/rendering";
import type { RenderParams } from "sigma/types";
import { floatColor } from "sigma/utils";
import type { EdgeAttributes, NodeAttributes } from "./attributes";
import { FADE_SECONDS } from "./attributes";
import { clock, type Frame } from "./frame";

const { UNSIGNED_BYTE, FLOAT, TRIANGLES } = WebGLRenderingContext;

// Shared GLSL: the weight of a level and an item's opacity at u_time.
const COMMON = /* glsl */ `
uniform vec3 u_levelWeights;
uniform vec3 u_childReveal;
uniform float u_time;
const float FADE = ${FADE_SECONDS.toFixed(4)};

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
attribute vec4 a_style;    // level, glow, ring (0 none, 1 solid, 2 dashed), hollow
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
varying vec4 v_style;    // level, glow extent (px), ring, hollow
varying float v_pulse;   // the glow's breath, around 1

const float bias = 255.0 / 254.0;
const float TAU = 6.2831853;

void main() {
  float weight = levelWeight(a_style.x);
  float reveal = childReveal(a_style.x);
  float fade = fadeAt(a_fade);
  // A parent fades back as its children are revealed, highlight or not ...
  float alpha = fade * mix(1.0, a_context, reveal) * weight;
  // ... and keeps its ring (focus, match, change) as the highlight.
  float ringAlpha = fade * max(weight, 0.8 * reveal);

  // A node arriving grows into place as it fades in; one leaving shrinks a
  // little as it fades out.
  float t = clamp((u_time - a_fade.z) / FADE, 0.0, 1.0);
  float arriving = a_fade.y < 0.01 && a_fade.x > 0.0 ? 1.0 : 0.0;
  float leaving = a_fade.x < 0.001 && a_fade.y > 0.0 ? 1.0 : 0.0;
  float out3 = 1.0 - pow(1.0 - t, 3.0);
  float scale = mix(1.0, mix(0.55, 1.0, out3), arriving * u_motion)
    * mix(1.0, mix(1.0, 0.82, t), leaving * u_motion);

  float radius = max(a_size / u_sizeRatio, u_minRadius) * scale;
  float glowPx = a_style.y * clamp(radius * 0.9, 8.0, 56.0);
  float ringPx = a_style.z > 0.5 ? 7.0 : 0.0;
  float shadowPx = min(10.0, 2.0 + radius * 0.2);
  float extent = radius + max(max(glowPx, ringPx), shadowPx) + 1.5;
  bool drawn = max(alpha, a_style.z > 0.5 ? ringAlpha : 0.0) > 0.004;

  #ifdef PICKING_MODE
  // Only the level in view is hovered and clicked, ghosts aside, and small
  // discs have a hit area larger than they look.
  extent = max(radius, 6.0);
  drawn = alpha > 0.004 && abs(a_style.x - u_pickLevel) < 0.5 && a_style.w < 0.5;
  #endif

  // The triangle around the disc: its inradius is half its circumradius.
  vec2 offset = extent * 2.0 * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + offset * u_correctionRatio * 2.0;
  gl_Position = drawn
    ? vec4((u_matrix * vec3(position, 1)).xy, 0, 1)
    : vec4(2.0, 2.0, 2.0, 1.0);

  // Each glowing node breathes at its own phase, slowly.
  float phase = fract(sin(dot(a_position, vec2(12.9898, 78.233))) * 43758.5453);
  v_pulse = 1.0 + u_motion * 0.22 * sin(u_time * TAU / 3.2 + phase * TAU);

  v_offset = offset;
  v_radius = radius;
  v_alpha = alpha;
  v_ringAlpha = ringAlpha;
  v_context = 1.0 - weight;
  v_style = vec4(a_style.x, glowPx, a_style.z, a_style.w);

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
varying vec4 v_style;
varying float v_pulse;

uniform float u_dark;

const float PI = 3.14159265;
// Light from the top left, as on a chart lit from the window.
const vec3 LIGHT = vec3(-0.42, 0.52, 0.74);

void main() {
  float d = length(v_offset);
  float r = v_radius;

  #ifdef PICKING_MODE
  if (d > max(r, 6.0)) discard;
  gl_FragColor = v_color;
  #else
  bool dark = u_dark > 0.5;
  float inside = 1.0 - smoothstep(r - 1.0, r, d);

  // Body: a soft dome, lit from the top left, a touch darker at its limb,
  // with a faint sheen; flat enough that its colour still reads as Churn.
  vec2 n2 = v_offset / max(r, 1.0);
  float k2 = min(dot(n2, n2), 1.0);
  vec3 normal = vec3(n2, sqrt(1.0 - k2));
  float lambert = max(dot(normal, normalize(LIGHT)), 0.0);
  vec3 base = v_color.rgb;
  vec3 body = base * (0.88 + 0.2 * lambert);
  body *= 1.0 - 0.07 * smoothstep(0.7, 1.0, sqrt(k2));
  float sheen = pow(lambert, 24.0) * (dark ? 0.16 : 0.12) * smoothstep(5.0, 14.0, r);
  body = mix(body, vec3(1.0), sheen);

  // Rim light: a thin bright band inside the edge on the lit side.
  float band = max(1.2, min(3.0, r * 0.08));
  float edge = smoothstep(r - band - 1.0, r - 0.6, d) * inside;
  float lit = clamp(dot(normalize(v_offset + vec2(1e-4)), normalize(LIGHT.xy)) * 0.5 + 0.5, 0.0, 1.0);
  body = mix(body, mix(body, vec3(1.0), dark ? 0.42 : 0.26), edge * lit * lit);

  // A crisp rim that carries the outline of a level drawn as context (a
  // Package's territory).
  float rimWidth = min(1.4, r * 0.35);
  float rim = inside * smoothstep(r - rimWidth - 1.0, r - rimWidth, d);
  vec3 rimColor = dark ? mix(base, vec3(1.0), 0.28) : mix(base, vec3(0.0), 0.22);
  float fillAlpha = v_style.w > 0.5 ? 0.06 : 1.0;
  float bodyA = inside * v_alpha * mix(fillAlpha, min(1.0, mix(1.0, 3.2, v_context)), rim);
  vec3 bodyColor = mix(body, rimColor, rim);

  // Glow: a bloom outside the disc, a bright core and a wide halo, that
  // breathes; mostly additive on the dark theme.
  float glowA = 0.0;
  if (v_style.y > 0.0) {
    float x = max(d - r, 0.0);
    float g = v_style.y * mix(0.92, 1.08, v_pulse - 0.78);
    float core = exp(-pow(x / (g * 0.28), 2.0));
    float halo = exp(-x / (g * 0.4));
    glowA = (core * 0.42 + halo * 0.3) * v_pulse * (1.0 - inside) * v_alpha;
  }
  vec3 glowColor = min(v_color.rgb * 1.3 + 0.06, vec3(1.0));

  // Shadow: on paper, a disc stands a little off the page.
  float shadowA = 0.0;
  if (!dark && v_style.w < 0.5) {
    float blur = min(8.0, 1.5 + r * 0.15);
    float ds = length(v_offset - vec2(0.0, -min(3.0, 0.8 + r * 0.04)));
    shadowA = (1.0 - smoothstep(r - blur, r + blur, ds)) * (1.0 - inside) * 0.16 * v_alpha * (1.0 - v_context);
  }

  // Ring: the focus, a search match or a Changes mark.
  float ringA = 0.0;
  if (v_style.z > 0.5) {
    float rr = r + 3.5;
    ringA = 1.0 - smoothstep(0.7, 1.6, abs(d - rr));
    if (v_style.z > 1.5) {
      float arc = (atan(v_offset.y, v_offset.x) + PI) * rr;
      float m = mod(arc, 7.0);
      ringA *= smoothstep(0.0, 0.8, m) * (1.0 - smoothstep(3.8, 4.6, m));
    }
    ringA *= max(v_ringAlpha, 0.0);
  }

  // Premultiplied, back to front: shadow, glow, body, ring.
  vec4 c = vec4(vec3(0.05, 0.08, 0.16) * shadowA, shadowA);
  vec4 glow = vec4(glowColor * glowA, glowA * (dark ? 0.22 : 0.85));
  c = glow + c * (1.0 - glow.a);
  c = vec4(bodyColor * bodyA, bodyA) + c * (1.0 - bodyA);
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
  "u_dark",
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
          { name: "a_style", size: 4, type: FLOAT },
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
      a[i++] = d.glow;
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
      gl.uniform1f(u.u_dark!, frame.palette.dark ? 1 : 0);
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
const EDGE_SEGMENTS = 14;

const EDGE_VERTEX = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_thickness;   // screen pixels
attribute vec3 a_fade;
attribute vec2 a_style;        // level, kind (0 runtime, 1 type-only, 2 dynamic)
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
// How far a Dependency bows to its left, as a share of its length: the two
// directions between two Modules take two arcs.
const float BEND = 0.14;
// Its width at the imported end, as a share of the importer's: the taper
// that tells the direction.
const float TAPER = 0.4;

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

  // A quadratic arc bowing to the left of the direction.
  vec2 chord = end - start;
  float len = length(chord);
  vec2 left = vec2(-dir.y, dir.x);
  vec2 ctrl = (start + end) * 0.5 + left * len * bend;
  float t = a_t;
  vec2 p = mix(mix(start, ctrl, t), mix(ctrl, end, t), t);
  vec2 tangent = 2.0 * (1.0 - t) * (ctrl - start) + 2.0 * t * (end - ctrl);
  tangent = length(tangent) > 0.0 ? normalize(tangent) : dir;
  vec2 normal = vec2(-tangent.y, tangent.x);

  float base = a_style.y > 1.5 ? max(a_thickness, 2.2) : a_thickness;
  float width = max(base * mix(1.0, TAPER, t), 0.75);
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
  v_alpha = alpha * mix(0.72, 1.0, t);

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
    // Dynamic: round dots.
    float period = 2.0 * v_half + 3.5;
    vec2 q = vec2(mod(v_along, period) - period * 0.5, v_across);
    body = 1.0 - smoothstep(v_half - 0.5, v_half + 0.5, length(q));
  } else if (v_kind > 0.5) {
    // Type-only: dashes.
    float m = mod(v_along, 9.0);
    body *= smoothstep(0.0, 0.8, m) * (1.0 - smoothstep(5.2, 6.0, m));
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
          { name: "a_style", size: 2, type: FLOAT },
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
