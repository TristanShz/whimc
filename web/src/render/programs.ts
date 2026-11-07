// The WebGL programs that draw the Map in sigma: a disc with a lens shading,
// a rim, a Churn glow and a focus or Changes ring for Modules, and a line
// with a solid, dashed or dotted pattern for Dependencies. Both fade between
// opacities on the GPU and take the level blend as a uniform, so that zooming
// and hovering never rebuild the vertex buffers.
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
${COMMON}

varying vec4 v_color;
varying vec4 v_ringColor;
varying vec2 v_offset;   // from the centre, in screen pixels
varying float v_radius;  // in screen pixels
varying float v_alpha;
varying float v_ringAlpha;
varying float v_context; // 1 when the node's level is only context
varying vec4 v_style;    // level, glow extent (px), ring, hollow

const float bias = 255.0 / 254.0;

void main() {
  float weight = levelWeight(a_style.x);
  float reveal = childReveal(a_style.x);
  float fade = fadeAt(a_fade);
  // A parent fades back as its children are revealed, highlight or not ...
  float alpha = fade * mix(1.0, a_context, reveal) * weight;
  // ... and keeps its ring (focus, match, change) as the highlight.
  float ringAlpha = fade * max(weight, 0.8 * reveal);

  float radius = max(a_size / u_sizeRatio, u_minRadius);
  float glowPx = a_style.y * clamp(radius * 0.9, 7.0, 48.0);
  float ringPx = a_style.z > 0.5 ? 6.0 : 0.0;
  float extent = radius + max(glowPx, ringPx) + 1.5;
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

uniform float u_dark;

const float PI = 3.14159265;

void main() {
  float d = length(v_offset);
  float r = v_radius;

  #ifdef PICKING_MODE
  if (d > max(r, 6.0)) discard;
  gl_FragColor = v_color;
  #else
  float inside = 1.0 - smoothstep(r - 1.0, r, d);

  // Body: a soft lens, a touch lighter at the heart, with a crisp rim that
  // carries the outline of a level drawn as context (a Package's territory).
  float k = clamp(d / r, 0.0, 1.0);
  vec3 body = v_color.rgb * (1.07 - 0.14 * k * k);
  float rimWidth = min(1.4, r * 0.35);
  float rim = inside * smoothstep(r - rimWidth - 1.0, r - rimWidth, d);
  vec3 rimColor = u_dark > 0.5 ? mix(body, vec3(1.0), 0.22) : mix(body, vec3(0.0), 0.18);
  float fillAlpha = v_style.w > 0.5 ? 0.06 : 1.0;
  float bodyA = inside * v_alpha * mix(fillAlpha, min(1.0, mix(1.0, 3.2, v_context)), rim);
  vec3 bodyColor = mix(body, rimColor, rim);

  // Glow: a gaussian halo outside the disc, mostly additive on dark themes.
  float glowA = 0.0;
  if (v_style.y > 0.0) {
    float x = max(d - r, 0.0) / v_style.y;
    glowA = exp(-x * x * 3.5) * (1.0 - inside) * 0.55 * v_alpha;
  }
  vec3 glowColor = min(v_color.rgb * 1.25, vec3(1.0));

  // Ring: the focus, a search match or a Changes mark.
  float ringA = 0.0;
  if (v_style.z > 0.5) {
    float rr = r + 3.5;
    ringA = 1.0 - smoothstep(0.6, 1.5, abs(d - rr));
    if (v_style.z > 1.5) {
      float arc = (atan(v_offset.y, v_offset.x) + PI) * rr;
      float m = mod(arc, 7.0);
      ringA *= smoothstep(0.0, 0.8, m) * (1.0 - smoothstep(3.8, 4.6, m));
    }
    ringA *= max(v_ringAlpha, 0.0);
  }

  // Premultiplied, back to front: glow, body, ring.
  vec4 c = vec4(glowColor * glowA, glowA * (u_dark > 0.5 ? 0.25 : 0.9));
  c = vec4(bodyColor * bodyA, bodyA) + c * (1.0 - bodyA);
  c = vec4(v_ringColor.rgb * ringA, ringA) + c * (1.0 - ringA);
  gl_FragColor = c;
  #endif
}
`;

const NODE_UNIFORMS = [
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

const EDGE_VERTEX = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute vec2 a_normal;       // unit
attribute float a_thickness;   // screen pixels
attribute vec3 a_fade;
attribute vec2 a_style;        // level, kind (0 runtime, 1 type-only, 2 dynamic)
attribute float a_positionCoef;
attribute float a_normalCoef;

uniform mat3 u_matrix;
uniform float u_correctionRatio;
uniform vec2 u_dimensions;
${COMMON}

varying vec4 v_color;
varying float v_alpha;
varying float v_along;   // pixels from the source
varying float v_across;  // pixels from the axis
varying float v_half;    // half width, pixels
varying float v_kind;

const float bias = 255.0 / 254.0;

void main() {
  float alpha = fadeAt(a_fade) * levelWeight(a_style.x);
  float width = a_style.y > 1.5 ? max(a_thickness, 2.2) : a_thickness;
  float halfPx = width * 0.5 + 1.0;

  vec2 position = mix(a_positionStart, a_positionEnd, a_positionCoef);
  vec2 normal = a_normal * a_normalCoef;
  gl_Position = alpha > 0.004
    ? vec4((u_matrix * vec3(position + normal * halfPx * u_correctionRatio * 2.0, 1)).xy, 0, 1)
    : vec4(2.0, 2.0, 2.0, 1.0);

  vec2 s = (u_matrix * vec3(a_positionStart, 1)).xy;
  vec2 e = (u_matrix * vec3(a_positionEnd, 1)).xy;
  v_along = a_positionCoef * length((e - s) * u_dimensions * 0.5);
  v_across = a_normalCoef * halfPx;
  v_half = width * 0.5;
  v_kind = a_style.y;
  v_alpha = alpha;

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

const EDGE_UNIFORMS = [
  "u_matrix",
  "u_correctionRatio",
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
        VERTICES: 6,
        VERTEX_SHADER_SOURCE: EDGE_VERTEX,
        FRAGMENT_SHADER_SOURCE: EDGE_FRAGMENT,
        METHOD: TRIANGLES,
        UNIFORMS: EDGE_UNIFORMS,
        ATTRIBUTES: [
          { name: "a_positionStart", size: 2, type: FLOAT },
          { name: "a_positionEnd", size: 2, type: FLOAT },
          { name: "a_normal", size: 2, type: FLOAT },
          { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
          { name: "a_thickness", size: 1, type: FLOAT },
          { name: "a_fade", size: 3, type: FLOAT },
          { name: "a_style", size: 2, type: FLOAT },
        ],
        CONSTANT_ATTRIBUTES: [
          { name: "a_positionCoef", size: 1, type: FLOAT },
          { name: "a_normalCoef", size: 1, type: FLOAT },
        ],
        CONSTANT_DATA: [
          [0, 1],
          [0, -1],
          [1, 1],
          [1, 1],
          [0, -1],
          [1, -1],
        ],
      };
    }

    processVisibleItem(
      edgeIndex: number,
      startIndex: number,
      source: { x: number; y: number },
      target: { x: number; y: number },
      data: object,
    ) {
      const d = data as EdgeAttributes;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const len = Math.hypot(dx, dy) || 1;
      const a = this.array;
      let i = startIndex;
      a[i++] = source.x;
      a[i++] = source.y;
      a[i++] = target.x;
      a[i++] = target.y;
      a[i++] = -dy / len;
      a[i++] = dx / len;
      a[i++] = floatColor(d.color);
      a[i++] = edgeIndex;
      a[i++] = d.size;
      a[i++] = d.fade;
      a[i++] = d.fadeFrom;
      a[i++] = d.fadeAt;
      a[i++] = d.level;
      a[i++] = d.kind;
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
      gl.uniform2f(u.u_dimensions!, params.width, params.height);
      gl.uniform3fv(u.u_levelWeights!, frame.levelWeights);
      gl.uniform1f(u.u_time!, clock());
    }
  };
}
