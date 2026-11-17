import {
  CompilationResult,
  CompilerDiagnostic,
  InertiaMatrix,
  LightSpawnType,
  ParsedWorld,
  Pose6D,
  PrimitiveShapeType,
  SimCollision,
  SimGeometry,
  SimJoint,
  SimLight,
  SimLink,
  SimMaterial,
  SimModel,
  SimPlugin,
  SimSensor,
  SimSensorType,
  SimVisual,
} from '../types/simulation';
import { buildWorldGzTopicsAndRos2Bridge } from './gzSystemsCatalog';

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
  line: number;
  column: number;
}

/**
 * Pure TypeScript XML parser with exact line & column tracking.
 * Works identically in browser and Node.js test environments.
 */
export function parseXmlWithLines(xmlSource: string): {
  root: XmlNode | null;
  diagnostics: CompilerDiagnostic[];
} {
  const diagnostics: CompilerDiagnostic[] = [];
  // Strip XML comments while preserving line breaks so line numbers stay exact
  const cleaned = xmlSource.replace(/<!--[\s\S]*?-->/g, (match) =>
    match.replace(/[^\n]/g, ' ')
  );

  // Strip XML declaration <?xml ... ?> preserving newlines
  const withoutDecl = cleaned.replace(/<\?xml[\s\S]*?\?>/gi, (match) =>
    match.replace(/[^\n]/g, ' ')
  );

  const lineOffsets: number[] = [0];
  for (let i = 0; i < withoutDecl.length; i++) {
    if (withoutDecl[i] === '\n') {
      lineOffsets.push(i + 1);
    }
  }

  const getLineCol = (index: number): { line: number; column: number } => {
    let low = 0;
    let high = lineOffsets.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineOffsets[mid] <= index) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const lineIdx = Math.max(0, low - 1);
    return {
      line: lineIdx + 1,
      column: index - lineOffsets[lineIdx] + 1,
    };
  };

  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;

  const tagRegex = /<\/?([a-zA-Z0-9_:-]+)([^>]*?)(\/?)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(withoutDecl)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1];
    const attrString = match[2] || '';
    const selfClosingSlash = match[3] === '/';
    const isClosing = fullMatch.startsWith('</');
    const pos = getLineCol(match.index);

    // Capture text between previous tag and this tag
    if (stack.length > 0 && match.index > lastIndex) {
      const textSegment = withoutDecl.slice(lastIndex, match.index).trim();
      if (textSegment) {
        stack[stack.length - 1].text +=
          (stack[stack.length - 1].text ? ' ' : '') + textSegment;
      }
    }
    lastIndex = match.index + fullMatch.length;

    if (isClosing) {
      if (stack.length === 0) {
        diagnostics.push({
          line: pos.line,
          column: pos.column,
          severity: 'error',
          code: 'XML_UNEXPECTED_CLOSE',
          message: `Unexpected closing tag </${tagName}> with no matching opening tag.`,
        });
      } else {
        const top = stack[stack.length - 1];
        if (top.tag !== tagName) {
          diagnostics.push({
            line: pos.line,
            column: pos.column,
            severity: 'error',
            code: 'XML_TAG_MISMATCH',
            message: `Mismatched closing tag </${tagName}>; expected </${top.tag}> (opened on line ${top.line}).`,
            suggestion: `Change </${tagName}> to </${top.tag}>`,
          });
          // Attempt recovery if parent matches
          if (stack.length >= 2 && stack[stack.length - 2].tag === tagName) {
            stack.pop();
            stack.pop();
          } else {
            stack.pop();
          }
        } else {
          stack.pop();
        }
      }
    } else {
      // Parse attributes
      const attrs: Record<string, string> = {};
      const attrRegex = /([a-zA-Z0-9_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(attrString)) !== null) {
        attrs[attrMatch[1]] =
          attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3];
      }

      const node: XmlNode = {
        tag: tagName,
        attrs,
        text: '',
        children: [],
        line: pos.line,
        column: pos.column,
      };

      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else if (!root) {
        root = node;
      } else {
        diagnostics.push({
          line: pos.line,
          column: pos.column,
          severity: 'error',
          code: 'XML_MULTIPLE_ROOTS',
          message: `Multiple root elements detected (<${tagName}>). XML document must have a single root element.`,
        });
      }

      if (!selfClosingSlash) {
        stack.push(node);
      }
    }
  }

  // Check for unclosed tags at EOF
  while (stack.length > 0) {
    const unclosed = stack.pop()!;
    diagnostics.push({
      line: unclosed.line,
      column: unclosed.column,
      severity: 'error',
      code: 'XML_UNCLOSED_TAG',
      message: `Unclosed XML tag <${unclosed.tag}> opened at line ${unclosed.line}.`,
      suggestion: `Add closing tag </${unclosed.tag}>`,
    });
  }

  if (!root && diagnostics.length === 0) {
    diagnostics.push({
      line: 1,
      column: 1,
      severity: 'error',
      code: 'XML_EMPTY',
      message: 'Document contains no valid XML elements.',
    });
  }

  return { root, diagnostics };
}

function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

function findChildren(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => c.tag === tag);
}

function serializeXmlNode(node: XmlNode, indent = '      '): string {
  const attrStr = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  if (node.children.length === 0) {
    if (!node.text.trim()) {
      return `${indent}<${node.tag}${attrStr}/>`;
    }
    return `${indent}<${node.tag}${attrStr}>${node.text.trim()}</${node.tag}>`;
  }
  const childLines = node.children
    .map((c) => serializeXmlNode(c, indent + '  '))
    .join('\n');
  return `${indent}<${node.tag}${attrStr}>\n${childLines}\n${indent}</${node.tag}>`;
}

function parsePluginNodes(
  parentNode: XmlNode,
  scope: SimPlugin['scope'],
  targetName?: string
): SimPlugin[] {
  const pluginNodes = findChildren(parentNode, 'plugin');
  return pluginNodes.map((pNode, idx) => {
    const filename = pNode.attrs.filename || 'gz-sim-unknown-system';
    const name = pNode.attrs.name || filename;
    const parameters: Record<string, string> = {};
    for (const child of pNode.children) {
      if (child.text.trim()) {
        parameters[child.tag] = child.text.trim();
      } else if (Object.keys(child.attrs).length > 0) {
        parameters[child.tag] = JSON.stringify(child.attrs);
      }
    }
    return {
      id: `plugin-${scope}-${targetName || 'root'}-${idx}-${filename}`,
      filename,
      name,
      scope,
      targetName,
      parameters,
    };
  });
}

function parseSensorNodes(
  linkNode: XmlNode,
  modelName: string,
  linkName: string,
  diagnostics: CompilerDiagnostic[]
): SimSensor[] {
  const sensorNodes = findChildren(linkNode, 'sensor');
  return sensorNodes.map((sNode, idx) => {
    const sName = sNode.attrs.name || `sensor_${idx}`;
    const rawType = (sNode.attrs.type || 'gpu_lidar').toLowerCase();
    let type: SimSensorType = 'gpu_lidar';
    if (rawType === 'gpu_lidar' || rawType === 'ray' || rawType === 'lidar' || rawType === 'gpu_ray') {
      type = 'gpu_lidar';
    } else if (rawType === 'imu') {
      type = 'imu';
    } else if (rawType === 'contact') {
      type = 'contact';
    } else if (rawType === 'camera' || rawType === 'depth_camera' || rawType === 'rgbd_camera') {
      type = 'camera';
    } else if (rawType === 'navsat' || rawType === 'gps') {
      type = 'navsat';
    } else if (rawType === 'magnetometer') {
      type = 'magnetometer';
    }

    const pose = parsePoseNode(
      findChild(sNode, 'pose'),
      diagnostics,
      `sensor "${modelName}::${linkName}::${sName}"`
    );
    const updateRateText = findChild(sNode, 'update_rate')?.text.trim();
    const updateRate = updateRateText ? Number(updateRateText) || 20 : 20;
    const topicText = findChild(sNode, 'topic')?.text.trim();
    const defaultTopicSuffix =
      type === 'gpu_lidar'
        ? 'scan'
        : type === 'imu'
        ? 'imu'
        : type === 'contact'
        ? 'contact'
        : type === 'camera'
        ? 'camera/image_raw'
        : type;
    const topic = topicText || `/model/${modelName}/${defaultTopicSuffix}`;
    const alwaysOnText = findChild(sNode, 'always_on')?.text.trim();
    const alwaysOn = alwaysOnText !== 'false' && alwaysOnText !== '0';
    const visualizeText = findChild(sNode, 'visualize')?.text.trim();
    const visualize = visualizeText !== 'false' && visualizeText !== '0';

    const sensor: SimSensor = {
      id: `${modelName}::${linkName}::${sName}`,
      name: sName,
      type,
      linkName,
      pose,
      updateRate,
      topic,
      alwaysOn,
      visualize,
    };

    if (type === 'gpu_lidar') {
      const lidarNode = findChild(sNode, 'lidar') || findChild(sNode, 'ray');
      const scanNode = lidarNode ? findChild(lidarNode, 'scan') : undefined;
      const horizNode = scanNode ? findChild(scanNode, 'horizontal') : undefined;
      const rangeNode = lidarNode ? findChild(lidarNode, 'range') : undefined;

      const samples = horizNode && findChild(horizNode, 'samples')
        ? Math.min(180, Math.max(8, Number(findChild(horizNode, 'samples')!.text.trim()) || 36))
        : 36;
      const minAngle = horizNode && findChild(horizNode, 'min_angle')
        ? Number(findChild(horizNode, 'min_angle')!.text.trim()) || -Math.PI
        : -Math.PI;
      const maxAngle = horizNode && findChild(horizNode, 'max_angle')
        ? Number(findChild(horizNode, 'max_angle')!.text.trim()) || Math.PI
        : Math.PI;
      const minRange = rangeNode && findChild(rangeNode, 'min')
        ? Number(findChild(rangeNode, 'min')!.text.trim()) || 0.12
        : 0.12;
      const maxRange = rangeNode && findChild(rangeNode, 'max')
        ? Number(findChild(rangeNode, 'max')!.text.trim()) || 8.0
        : 8.0;

      sensor.lidar = {
        horizontalSamples: samples,
        minAngle,
        maxAngle,
        minRange,
        maxRange,
        ranges: new Array(samples).fill(maxRange),
      };
    } else if (type === 'imu') {
      sensor.imu = {
        orientation: [0, 0, 0, 1],
        angularVelocity: [0, 0, 0],
        linearAcceleration: [0, 0, 9.81],
      };
    } else if (type === 'contact') {
      const contactNode = findChild(sNode, 'contact');
      const colName = contactNode && findChild(contactNode, 'collision')
        ? findChild(contactNode, 'collision')!.text.trim()
        : 'collision';
      sensor.contact = {
        collisionName: colName,
        touching: false,
        contactCount: 0,
        normalForce: 0,
        contactPoints: [],
      };
    }

    return sensor;
  });
}

function parsePoseNode(
  node: XmlNode | undefined,
  diagnostics: CompilerDiagnostic[],
  contextName: string
): Pose6D {
  if (!node || !node.text.trim()) {
    return [0, 0, 0, 0, 0, 0];
  }
  const parts = node.text
    .trim()
    .split(/\s+/)
    .map((v) => Number(v));
  if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) {
    diagnostics.push({
      line: node.line,
      column: node.column,
      severity: 'error',
      code: 'SDF_INVALID_POSE',
      message: `Invalid <pose> in ${contextName}: expected 6 space-separated numbers "x y z roll pitch yaw", got "${node.text}".`,
      suggestion: 'Use 6 numeric values, e.g. <pose>0 0 0.5 0 0 0</pose>',
    });
    return [0, 0, 0, 0, 0, 0];
  }
  return [parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]];
}

function parseVec3(
  text: string | undefined,
  fallback: [number, number, number]
): [number, number, number] {
  if (!text) return fallback;
  const parts = text
    .trim()
    .split(/\s+/)
    .map((v) => Number(v));
  if (parts.length >= 3 && !parts.slice(0, 3).some((n) => Number.isNaN(n))) {
    return [parts[0], parts[1], parts[2]];
  }
  return fallback;
}

function parseColor4(
  text: string | undefined,
  fallback: [number, number, number, number]
): [number, number, number, number] {
  if (!text) return fallback;
  const parts = text
    .trim()
    .split(/\s+/)
    .map((v) => Number(v));
  if (parts.length >= 4 && !parts.slice(0, 4).some((n) => Number.isNaN(n))) {
    return [parts[0], parts[1], parts[2], parts[3]];
  }
  return fallback;
}

function parseVec3Attr(
  raw: string | undefined,
  fallback: [number, number, number],
  diagnostics?: CompilerDiagnostic[],
  line?: number,
  column?: number,
  attrName?: string,
  contextName?: string
): [number, number, number] {
  if (!raw || !raw.trim()) return fallback;
  const parts = raw
    .trim()
    .split(/\s+/)
    .map((v) => Number(v));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    if (diagnostics && line !== undefined && column !== undefined) {
      diagnostics.push({
        line,
        column,
        severity: 'error',
        code: 'URDF_INVALID_VEC3',
        message: `Invalid ${attrName || 'vector'}="${raw}" in ${contextName || 'URDF'}: expected 3 space-separated numbers.`,
        suggestion: `Use 3 numeric values, e.g. ${attrName || 'xyz'}="0 0 0"`,
      });
    }
    return fallback;
  }
  return [parts[0], parts[1], parts[2]];
}

/**
 * 4x4 Homogeneous Matrix (row-major length 16) for exact SE(3) 3D pose composition.
 */
export type Mat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export function poseToMatrix4(pose: Pose6D): Mat4 {
  const [x, y, z, roll, pitch, yaw] = pose;
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);

  // R = Rz(yaw) * Ry(pitch) * Rx(roll) (Standard URDF & SDF extrinsic X-Y-Z / intrinsic Z-Y-X)
  const r00 = cy * cp;
  const r01 = cy * sp * sr - sy * cr;
  const r02 = cy * sp * cr + sy * sr;

  const r10 = sy * cp;
  const r11 = sy * sp * sr + cy * cr;
  const r12 = sy * sp * cr - cy * sr;

  const r20 = -sp;
  const r21 = cp * sr;
  const r22 = cp * cr;

  return [
    r00, r01, r02, x,
    r10, r11, r12, y,
    r20, r21, r22, z,
    0, 0, 0, 1,
  ];
}

export function multiplyMatrix4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0) as unknown as Mat4;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] =
        a[r * 4 + 0] * b[0 * 4 + c] +
        a[r * 4 + 1] * b[1 * 4 + c] +
        a[r * 4 + 2] * b[2 * 4 + c] +
        a[r * 4 + 3] * b[3 * 4 + c];
    }
  }
  return out;
}

export function invertRigidMatrix4(m: Mat4): Mat4 {
  // For rigid SE(3) matrix [R | t; 0 | 1], inverse is [R^T | -R^T * t; 0 | 1]
  const r00 = m[0], r01 = m[1], r02 = m[2], tx = m[3];
  const r10 = m[4], r11 = m[5], r12 = m[6], ty = m[7];
  const r20 = m[8], r21 = m[9], r22 = m[10], tz = m[11];

  const itx = -(r00 * tx + r10 * ty + r20 * tz);
  const ity = -(r01 * tx + r11 * ty + r21 * tz);
  const itz = -(r02 * tx + r12 * ty + r22 * tz);

  return [
    r00, r10, r20, itx,
    r01, r11, r21, ity,
    r02, r12, r22, itz,
    0, 0, 0, 1,
  ];
}

export function matrix4ToPose(m: Mat4): Pose6D {
  const x = m[3];
  const y = m[7];
  const z = m[11];

  const r00 = m[0], r01 = m[1], r02 = m[2];
  const r10 = m[4], r11 = m[5], r12 = m[6];
  const r20 = m[8], r21 = m[9], r22 = m[10];

  const sy = Math.hypot(r00, r10);
  let roll = 0;
  let pitch = 0;
  let yaw = 0;

  if (sy > 1e-6) {
    roll = Math.atan2(r21, r22);
    pitch = Math.atan2(-r20, sy);
    yaw = Math.atan2(r10, r00);
  } else {
    roll = Math.atan2(-r12, r11);
    pitch = Math.atan2(-r20, sy);
    yaw = 0;
  }

  const clean = (n: number) => {
    const rounded = Number(n.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
  };

  return [clean(x), clean(y), clean(z), clean(roll), clean(pitch), clean(yaw)];
}

export function composePoses(parentPose: Pose6D, localPose: Pose6D): Pose6D {
  return matrix4ToPose(multiplyMatrix4(poseToMatrix4(parentPose), poseToMatrix4(localPose)));
}

function formatPose6D(pose: Pose6D): string {
  return pose.map((n) => Number(n.toFixed(5))).join(' ');
}

function parseUrdfOriginNode(
  originNode: XmlNode | undefined,
  diagnostics?: CompilerDiagnostic[],
  contextName?: string
): Pose6D {
  if (!originNode) return [0, 0, 0, 0, 0, 0];
  const xyz = parseVec3Attr(
    originNode.attrs.xyz,
    [0, 0, 0],
    diagnostics,
    originNode.line,
    originNode.column,
    'xyz',
    contextName
  );
  const rpy = parseVec3Attr(
    originNode.attrs.rpy,
    [0, 0, 0],
    diagnostics,
    originNode.line,
    originNode.column,
    'rpy',
    contextName
  );
  return [xyz[0], xyz[1], xyz[2], rpy[0], rpy[1], rpy[2]];
}

/**
 * Converts a ROS URDF <robot> XML tree into a full Gazebo Harmonic SDF 1.10 XML string.
 * Implements official ROS URDF & SDFormat kinematic frame rules:
 * - Child link frame origin is at the parent->child <joint><origin xyz="..." rpy="..."/>
 * - Link <visual>, <collision>, and <inertial> <origin> tags are preserved as local <pose> offsets relative to the link frame
 * - Supports multiple <visual> and <collision> elements per link
 * - Resolves top-level <material name="..."><color rgba="..."/></material> definitions
 * - Handles virtual frame links (e.g. world, base_footprint, tool0) without adding fake box meshes
 * - Converts <gazebo> and <gazebo reference="..."> blocks into SDF 1.10 <plugin> and <sensor> elements
 */
export function convertUrdfToSdfXml(
  urdfRoot: XmlNode,
  urdfDiagnostics?: CompilerDiagnostic[]
): string {
  const robotName = urdfRoot.attrs.name || 'converted_urdf_robot';
  const rawLinks = findChildren(urdfRoot, 'link');
  const rawJoints = findChildren(urdfRoot, 'joint');
  const topMaterials = findChildren(urdfRoot, 'material');
  const gazeboBlocks = findChildren(urdfRoot, 'gazebo');

  // Collect <gazebo> model plugins and <gazebo reference="link_name"> sensor/plugin extensions
  const urdfModelPluginXmls: string[] = [];
  const urdfLinkSensorAndPluginXmlMap = new Map<string, string[]>();

  for (const gzNode of gazeboBlocks) {
    const refLink = gzNode.attrs.reference?.trim();
    if (!refLink) {
      for (const child of gzNode.children) {
        if (child.tag === 'plugin') {
          urdfModelPluginXmls.push(serializeXmlNode(child, '      '));
        }
      }
    } else {
      const list = urdfLinkSensorAndPluginXmlMap.get(refLink) || [];
      for (const child of gzNode.children) {
        if (child.tag === 'sensor' || child.tag === 'plugin') {
          list.push(serializeXmlNode(child, '        '));
        }
      }
      urdfLinkSensorAndPluginXmlMap.set(refLink, list);
    }
  }

  // 1. Build robot-level named material color palette
  const materialPalette = new Map<string, string>();
  for (const matNode of topMaterials) {
    const matName = matNode.attrs.name;
    const colorNode = findChild(matNode, 'color');
    if (matName && colorNode?.attrs.rgba) {
      materialPalette.set(matName, colorNode.attrs.rgba.trim());
    }
  }

  // 2. Identify virtual "world" link if used to anchor a fixed-base manipulator
  const isWorldLinkName = (name: string) =>
    name === 'world' || name === 'world_link';

  const linkMap = new Map<string, XmlNode>();
  for (const lk of rawLinks) {
    const lkName = lk.attrs.name || '';
    if (!lkName) {
      urdfDiagnostics?.push({
        line: lk.line,
        column: lk.column,
        severity: 'error',
        code: 'URDF_LINK_MISSING_NAME',
        message: 'URDF <link> element is missing required "name" attribute.',
      });
    } else if (linkMap.has(lkName)) {
      urdfDiagnostics?.push({
        line: lk.line,
        column: lk.column,
        severity: 'error',
        code: 'URDF_DUPLICATE_LINK',
        message: `Duplicate <link name="${lkName}"> in URDF robot "${robotName}".`,
      });
    } else {
      linkMap.set(lkName, lk);
    }
  }

  // 3. Parse URDF joints, validate parent/child references on URDF line numbers, and build kinematic tree
  interface ParsedUrdfJoint {
    node: XmlNode;
    name: string;
    type: string;
    parent: string;
    child: string;
    originPose: Pose6D;
    axisXyz: [number, number, number];
    lower: string;
    upper: string;
    effort: string;
    velocity: string;
    damping: string;
    friction: string;
  }

  const validUrdfJointTypes = [
    'revolute',
    'continuous',
    'prismatic',
    'fixed',
    'floating',
    'planar',
  ];
  const parsedJoints: ParsedUrdfJoint[] = [];
  const incomingJointByChild = new Map<string, ParsedUrdfJoint>();
  const childrenByParent = new Map<string, ParsedUrdfJoint[]>();
  let isAnchoredToWorld = false;

  for (const jNode of rawJoints) {
    const jName = jNode.attrs.name || `joint_${parsedJoints.length + 1}`;
    const rawType = jNode.attrs.type || '';
    if (!rawType || !validUrdfJointTypes.includes(rawType)) {
      urdfDiagnostics?.push({
        line: jNode.line,
        column: jNode.column,
        severity: 'error',
        code: 'SDF_INVALID_JOINT_TYPE',
        message: `Invalid or missing URDF joint type "${rawType}" on joint "${jName}". Allowed: ${validUrdfJointTypes.join(', ')}.`,
      });
    }

    const parentNode = findChild(jNode, 'parent');
    const childNode = findChild(jNode, 'child');
    const parentLink = parentNode?.attrs.link?.trim() || parentNode?.text.trim() || '';
    const childLink = childNode?.attrs.link?.trim() || childNode?.text.trim() || '';

    if (!parentLink || (!linkMap.has(parentLink) && !isWorldLinkName(parentLink))) {
      urdfDiagnostics?.push({
        line: parentNode?.line || jNode.line,
        column: parentNode?.column || jNode.column,
        severity: 'error',
        code: 'SDF_JOINT_MISSING_PARENT',
        message: `URDF joint "${jName}" references non-existent parent link "${parentLink}".`,
        suggestion: `Available links: ${Array.from(linkMap.keys()).join(', ')}`,
      });
    }

    if (!childLink || !linkMap.has(childLink)) {
      urdfDiagnostics?.push({
        line: childNode?.line || jNode.line,
        column: childNode?.column || jNode.column,
        severity: 'error',
        code: 'SDF_JOINT_MISSING_CHILD',
        message: `URDF joint "${jName}" references non-existent child link "${childLink}".`,
        suggestion: `Available links: ${Array.from(linkMap.keys()).join(', ')}`,
      });
    }

    if (parentLink && parentLink === childLink) {
      urdfDiagnostics?.push({
        line: jNode.line,
        column: jNode.column,
        severity: 'error',
        code: 'SDF_JOINT_SELF_LOOP',
        message: `URDF joint "${jName}" connects link "${parentLink}" to itself.`,
      });
    }

    if (isWorldLinkName(parentLink) && rawType === 'fixed') {
      isAnchoredToWorld = true;
    }

    const originPose = parseUrdfOriginNode(
      findChild(jNode, 'origin'),
      urdfDiagnostics,
      `joint "${jName}"`
    );

    const axisNode = findChild(jNode, 'axis');
    const axisXyz = parseVec3Attr(
      axisNode?.attrs.xyz || axisNode?.text,
      [1, 0, 0], // Official URDF default <axis> is (1, 0, 0) when omitted
      urdfDiagnostics,
      axisNode?.line || jNode.line,
      axisNode?.column || jNode.column,
      'xyz',
      `joint "${jName}" axis`
    );
    const resolvedAxis: [number, number, number] = axisNode ? axisXyz : [1, 0, 0];
    if (
      rawType !== 'fixed' &&
      rawType !== 'floating' &&
      Math.hypot(resolvedAxis[0], resolvedAxis[1], resolvedAxis[2]) < 1e-6
    ) {
      urdfDiagnostics?.push({
        line: axisNode?.line || jNode.line,
        column: axisNode?.column || jNode.column,
        severity: 'error',
        code: 'SDF_ZERO_JOINT_AXIS',
        message: `URDF joint "${jName}" has a zero-length <axis xyz="0 0 0"/> vector.`,
      });
    }

    const limitNode = findChild(jNode, 'limit');
    const lower =
      rawType === 'continuous'
        ? '-1000'
        : limitNode?.attrs.lower ?? '-3.14159';
    const upper =
      rawType === 'continuous'
        ? '1000'
        : limitNode?.attrs.upper ?? '3.14159';
    const effort = limitNode?.attrs.effort ?? '60.0';
    const velocity = limitNode?.attrs.velocity ?? '3.0';

    const dynNode = findChild(jNode, 'dynamics');
    const damping = dynNode?.attrs.damping ?? '0.2';
    const friction = dynNode?.attrs.friction ?? '0.05';

    const mappedSdfType =
      rawType === 'floating'
        ? 'ball'
        : rawType === 'planar'
        ? 'prismatic'
        : validUrdfJointTypes.includes(rawType)
        ? rawType
        : 'revolute';

    const pj: ParsedUrdfJoint = {
      node: jNode,
      name: jName,
      type: mappedSdfType,
      parent: parentLink,
      child: childLink,
      originPose,
      axisXyz: resolvedAxis,
      lower,
      upper,
      effort,
      velocity,
      damping,
      friction,
    };

    parsedJoints.push(pj);
    if (childLink) {
      incomingJointByChild.set(childLink, pj);
    }
    if (parentLink) {
      const list = childrenByParent.get(parentLink) || [];
      list.push(pj);
      childrenByParent.set(parentLink, list);
    }
  }

  // 4. Compute model-space <pose> for every URDF link by propagating <joint><origin> down the kinematic tree
  const linkModelPoseMap = new Map<string, Pose6D>();
  const visitedLinks = new Set<string>();

  const propagateFromLink = (linkName: string, currentModelPose: Pose6D) => {
    if (visitedLinks.has(linkName)) return;
    visitedLinks.add(linkName);
    linkModelPoseMap.set(linkName, currentModelPose);

    const outgoing = childrenByParent.get(linkName) || [];
    for (const j of outgoing) {
      if (j.child && !visitedLinks.has(j.child)) {
        const childModelPose = composePoses(currentModelPose, j.originPose);
        propagateFromLink(j.child, childModelPose);
      }
    }
  };

  for (const wName of ['world', 'world_link']) {
    const worldJoints = childrenByParent.get(wName) || [];
    for (const wj of worldJoints) {
      if (wj.child) {
        propagateFromLink(wj.child, wj.originPose);
      }
    }
  }

  for (const lk of rawLinks) {
    const lkName = lk.attrs.name || '';
    if (!lkName || isWorldLinkName(lkName)) continue;
    if (!incomingJointByChild.has(lkName) && !visitedLinks.has(lkName)) {
      propagateFromLink(lkName, [0, 0, 0, 0, 0, 0]);
    }
  }

  for (const lk of rawLinks) {
    const lkName = lk.attrs.name || '';
    if (lkName && !isWorldLinkName(lkName) && !linkModelPoseMap.has(lkName)) {
      linkModelPoseMap.set(lkName, [0, 0, 0, 0, 0, 0]);
    }
  }

  const buildGeomXmlAndExtent = (
    geomParent: XmlNode,
    contextName: string
  ): { xml: string; halfZ: number } => {
    const geom = findChild(geomParent, 'geometry');
    if (!geom) {
      return { xml: `<box><size>0.2 0.2 0.2</size></box>`, halfZ: 0.1 };
    }
    const box = findChild(geom, 'box');
    if (box) {
      const sizeStr = box.attrs.size || box.text.trim() || '0.2 0.2 0.2';
      const sz = parseVec3Attr(
        sizeStr,
        [0.2, 0.2, 0.2],
        urdfDiagnostics,
        box.line,
        box.column,
        'size',
        contextName
      );
      if (sz[0] <= 0 || sz[1] <= 0 || sz[2] <= 0) {
        urdfDiagnostics?.push({
          line: box.line,
          column: box.column,
          severity: 'error',
          code: 'SDF_NON_POSITIVE_DIMENSION',
          message: `URDF box size in ${contextName} must have positive dimensions, got "${sizeStr}".`,
        });
      }
      return {
        xml: `<box><size>${sz[0]} ${sz[1]} ${sz[2]}</size></box>`,
        halfZ: Math.max(0.01, sz[2] * 0.5),
      };
    }
    const cyl = findChild(geom, 'cylinder');
    if (cyl) {
      const r = Number(cyl.attrs.radius ?? findChild(cyl, 'radius')?.text ?? 0.15);
      const l = Number(cyl.attrs.length ?? findChild(cyl, 'length')?.text ?? 0.3);
      if (Number.isNaN(r) || r <= 0 || Number.isNaN(l) || l <= 0) {
        urdfDiagnostics?.push({
          line: cyl.line,
          column: cyl.column,
          severity: 'error',
          code: 'SDF_INVALID_CYLINDER',
          message: `URDF cylinder in ${contextName} must have positive radius and length.`,
        });
      }
      const safeR = r > 0 ? r : 0.15;
      const safeL = l > 0 ? l : 0.3;
      return {
        xml: `<cylinder><radius>${safeR}</radius><length>${safeL}</length></cylinder>`,
        halfZ: Math.max(safeR, safeL * 0.5),
      };
    }
    const sph = findChild(geom, 'sphere');
    if (sph) {
      const r = Number(sph.attrs.radius ?? findChild(sph, 'radius')?.text ?? 0.15);
      if (Number.isNaN(r) || r <= 0) {
        urdfDiagnostics?.push({
          line: sph.line,
          column: sph.column,
          severity: 'error',
          code: 'SDF_INVALID_RADIUS',
          message: `URDF sphere in ${contextName} must have positive radius.`,
        });
      }
      const safeR = r > 0 ? r : 0.15;
      return {
        xml: `<sphere><radius>${safeR}</radius></sphere>`,
        halfZ: safeR,
      };
    }
    const cap = findChild(geom, 'capsule');
    if (cap) {
      const r = Number(cap.attrs.radius ?? findChild(cap, 'radius')?.text ?? 0.12);
      const l = Number(cap.attrs.length ?? findChild(cap, 'length')?.text ?? 0.4);
      const safeR = r > 0 ? r : 0.12;
      const safeL = l > 0 ? l : 0.4;
      return {
        xml: `<capsule><radius>${safeR}</radius><length>${safeL}</length></capsule>`,
        halfZ: safeL * 0.5 + safeR,
      };
    }
    const mesh = findChild(geom, 'mesh');
    if (mesh) {
      const scale = parseVec3Attr(mesh.attrs.scale, [0.3, 0.3, 0.3]);
      const sx = Math.max(0.05, Math.abs(scale[0]));
      const sy = Math.max(0.05, Math.abs(scale[1]));
      const sz = Math.max(0.05, Math.abs(scale[2]));
      return {
        xml: `<box><size>${sx} ${sy} ${sz}</size></box>`,
        halfZ: sz * 0.5,
      };
    }
    return { xml: `<box><size>0.2 0.2 0.2</size></box>`, halfZ: 0.1 };
  };

  // 5. Build SDF <link> blocks and track minimum world Z so the URDF robot never spawns underground
  const linkLines: string[] = [];
  let minRobotWorldZ = Infinity;

  const physicalLinks = rawLinks.filter(
    (lk) => !isWorldLinkName(lk.attrs.name || '')
  );

  if (physicalLinks.length === 0) {
    urdfDiagnostics?.push({
      line: urdfRoot.line,
      column: urdfRoot.column,
      severity: 'error',
      code: 'SDF_MODEL_NO_LINKS',
      message: `URDF robot "${robotName}" contains no physical <link> elements.`,
    });
  }

  for (const link of physicalLinks) {
    const linkName = link.attrs.name || 'unnamed_link';
    const linkModelPose = linkModelPoseMap.get(linkName) || [0, 0, 0, 0, 0, 0];

    const inertial = findChild(link, 'inertial');
    const visuals = findChildren(link, 'visual');
    const collisions = findChildren(link, 'collision');

    const inOriginPose = parseUrdfOriginNode(
      inertial ? findChild(inertial, 'origin') : undefined,
      urdfDiagnostics,
      `link "${linkName}" inertial`
    );

    let massVal = '1.0';
    let ixx = '0.08',
      ixy = '0.0',
      ixz = '0.0',
      iyy = '0.08',
      iyz = '0.0',
      izz = '0.08';

    if (inertial) {
      const massNode = findChild(inertial, 'mass');
      const rawMass = massNode?.attrs.value ?? massNode?.text.trim();
      if (rawMass !== undefined && rawMass !== '') {
        massVal = rawMass;
        const numMass = Number(rawMass);
        if (Number.isNaN(numMass) || numMass <= 0) {
          urdfDiagnostics?.push({
            line: massNode?.line || inertial.line,
            column: massNode?.column || inertial.column,
            severity: 'error',
            code: 'SDF_INVALID_MASS',
            message: `URDF link "${linkName}" has invalid mass="${rawMass}". Mass must be > 0.`,
          });
        }
      }
      const inNode = findChild(inertial, 'inertia');
      if (inNode) {
        ixx = inNode.attrs.ixx ?? findChild(inNode, 'ixx')?.text.trim() ?? '0.08';
        ixy = inNode.attrs.ixy ?? findChild(inNode, 'ixy')?.text.trim() ?? '0.0';
        ixz = inNode.attrs.ixz ?? findChild(inNode, 'ixz')?.text.trim() ?? '0.0';
        iyy = inNode.attrs.iyy ?? findChild(inNode, 'iyy')?.text.trim() ?? '0.08';
        iyz = inNode.attrs.iyz ?? findChild(inNode, 'iyz')?.text.trim() ?? '0.0';
        izz = inNode.attrs.izz ?? findChild(inNode, 'izz')?.text.trim() ?? '0.08';

        const nIxx = Number(ixx);
        const nIyy = Number(iyy);
        const nIzz = Number(izz);
        if (
          Number.isNaN(nIxx) ||
          Number.isNaN(nIyy) ||
          Number.isNaN(nIzz) ||
          nIxx <= 0 ||
          nIyy <= 0 ||
          nIzz <= 0
        ) {
          urdfDiagnostics?.push({
            line: inNode.line,
            column: inNode.column,
            severity: 'error',
            code: 'SDF_NON_POSITIVE_INERTIA',
            message: `Principal inertia moments (ixx=${ixx}, iyy=${iyy}, izz=${izz}) in URDF link "${linkName}" must all be > 0.`,
          });
        } else {
          const eps = 1e-5;
          if (
            nIxx + nIyy + eps < nIzz ||
            nIxx + nIzz + eps < nIyy ||
            nIyy + nIzz + eps < nIxx
          ) {
            urdfDiagnostics?.push({
              line: inNode.line,
              column: inNode.column,
              severity: 'warning',
              code: 'SDF_INERTIA_TRIANGLE_INEQUALITY',
              message: `Inertia tensor of URDF link "${linkName}" violates physical triangle inequality (ixx=${nIxx}, iyy=${nIyy}, izz=${nIzz}).`,
            });
          }
        }
      }
    } else if (visuals.length === 0 && collisions.length === 0) {
      // Virtual coordinate frame link (e.g. base_footprint, tool0, ee_link): assign minimal mass & inertia
      massVal = '0.001';
      ixx = '0.0001';
      iyy = '0.0001';
      izz = '0.0001';
    }

    const collisionXmlBlocks: string[] = collisions.map((colNode, idx) => {
      const colName = colNode.attrs.name || `${linkName}_collision_${idx}`;
      const colPose = parseUrdfOriginNode(
        findChild(colNode, 'origin'),
        urdfDiagnostics,
        `collision "${linkName}::${colName}"`
      );
      const { xml: geomXml, halfZ } = buildGeomXmlAndExtent(
        colNode,
        `collision "${linkName}::${colName}"`
      );
      const worldColPose = composePoses(linkModelPose, colPose);
      const geomNode = findChild(colNode, 'geometry');
      const cylNode = geomNode ? findChild(geomNode, 'cylinder') : undefined;
      let verticalExtent = halfZ;
      if (cylNode) {
        const r = Number(cylNode.attrs.radius ?? 0.15);
        const l = Number(cylNode.attrs.length ?? 0.3);
        const roll = Math.abs(worldColPose[3]);
        const pitch = Math.abs(worldColPose[4]);
        const isWheel =
          Math.abs(roll - Math.PI / 2) < 0.4 || Math.abs(pitch - Math.PI / 2) < 0.4;
        verticalExtent = isWheel ? r : l * 0.5;
      }
      minRobotWorldZ = Math.min(minRobotWorldZ, worldColPose[2] - verticalExtent);

      return `        <collision name="${colName}">
          <pose>${formatPose6D(colPose)}</pose>
          <geometry>
            ${geomXml}
          </geometry>
        </collision>`;
    });

    const visualXmlBlocks: string[] = visuals.map((visNode, idx) => {
      const visName = visNode.attrs.name || `${linkName}_visual_${idx}`;
      const visPose = parseUrdfOriginNode(
        findChild(visNode, 'origin'),
        urdfDiagnostics,
        `visual "${linkName}::${visName}"`
      );
      const { xml: geomXml, halfZ } = buildGeomXmlAndExtent(
        visNode,
        `visual "${linkName}::${visName}"`
      );
      const worldVisPose = composePoses(linkModelPose, visPose);
      const geomNode = findChild(visNode, 'geometry');
      const cylNode = geomNode ? findChild(geomNode, 'cylinder') : undefined;
      let verticalExtent = halfZ;
      if (cylNode) {
        const r = Number(cylNode.attrs.radius ?? 0.15);
        const l = Number(cylNode.attrs.length ?? 0.3);
        const roll = Math.abs(worldVisPose[3]);
        const pitch = Math.abs(worldVisPose[4]);
        const isWheel =
          Math.abs(roll - Math.PI / 2) < 0.4 || Math.abs(pitch - Math.PI / 2) < 0.4;
        verticalExtent = isWheel ? r : l * 0.5;
      }
      minRobotWorldZ = Math.min(minRobotWorldZ, worldVisPose[2] - verticalExtent);

      let colorRgba = '0.2 0.55 0.85 1.0';
      const matNode = findChild(visNode, 'material');
      if (matNode) {
        const colNode = findChild(matNode, 'color');
        if (colNode?.attrs.rgba) {
          colorRgba = colNode.attrs.rgba.trim();
        } else if (matNode.attrs.name && materialPalette.has(matNode.attrs.name)) {
          colorRgba = materialPalette.get(matNode.attrs.name)!;
        }
      }

      return `        <visual name="${visName}">
          <pose>${formatPose6D(visPose)}</pose>
          <geometry>
            ${geomXml}
          </geometry>
          <material>
            <ambient>${colorRgba}</ambient>
            <diffuse>${colorRgba}</diffuse>
            <specular>0.4 0.4 0.4 1</specular>
          </material>
        </visual>`;
    });

    const extraLinkExtensions = urdfLinkSensorAndPluginXmlMap.get(linkName) || [];

    linkLines.push(`      <link name="${linkName}">
        <pose>${formatPose6D(linkModelPose)}</pose>
        <inertial>
          <pose>${formatPose6D(inOriginPose)}</pose>
          <mass>${massVal}</mass>
          <inertia>
            <ixx>${ixx}</ixx>
            <ixy>${ixy}</ixy>
            <ixz>${ixz}</ixz>
            <iyy>${iyy}</iyy>
            <iyz>${iyz}</iyz>
            <izz>${izz}</izz>
          </inertia>
        </inertial>${collisionXmlBlocks.length > 0 ? '\n' + collisionXmlBlocks.join('\n') : ''}${visualXmlBlocks.length > 0 ? '\n' + visualXmlBlocks.join('\n') : ''}${extraLinkExtensions.length > 0 ? '\n' + extraLinkExtensions.join('\n') : ''}
      </link>`);
  }

  // 6. Build SDF <joint> blocks
  const jointLines: string[] = [];
  for (const pj of parsedJoints) {
    if (isWorldLinkName(pj.parent)) {
      continue;
    }
    const axisStr = pj.axisXyz.join(' ');
    jointLines.push(`      <joint name="${pj.name}" type="${pj.type}">
        <parent>${pj.parent}</parent>
        <child>${pj.child}</child>
        <pose>0 0 0 0 0 0</pose>
        <axis>
          <xyz>${axisStr}</xyz>
          <limit>
            <lower>${pj.lower}</lower>
            <upper>${pj.upper}</upper>
            <effort>${pj.effort}</effort>
            <velocity>${pj.velocity}</velocity>
          </limit>
          <dynamics>
            <damping>${pj.damping}</damping>
            <friction>${pj.friction}</friction>
          </dynamics>
        </axis>
      </joint>`);
  }

  const modelSpawnZ =
    Number.isFinite(minRobotWorldZ) && minRobotWorldZ < -1e-4
      ? Number((-minRobotWorldZ).toFixed(4))
      : 0;

  return `<?xml version="1.0" ?>
<sdf version="1.10">
  <world name="default">
    <physics name="1ms" type="ode">
      <max_step_size>0.002</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>
    <plugin filename="gz-sim-physics-system" name="gz::sim::systems::Physics"/>
    <plugin filename="gz-sim-scene-broadcaster-system" name="gz::sim::systems::SceneBroadcaster"/>
    <plugin filename="gz-sim-user-commands-system" name="gz::sim::systems::UserCommands"/>
    <plugin filename="gz-sim-sensors-system" name="gz::sim::systems::Sensors">
      <render_engine>ogre2</render_engine>
    </plugin>
    <plugin filename="gz-sim-imu-system" name="gz::sim::systems::Imu"/>
    <plugin filename="gz-sim-contact-system" name="gz::sim::systems::Contact"/>
    <gravity>0 0 -9.81</gravity>
    <wind>
      <linear_velocity>0.0 0.0 0.0</linear_velocity>
    </wind>
    <light type="directional" name="sun">
      <cast_shadows>true</cast_shadows>
      <pose>0 0 10 0 0 0</pose>
      <diffuse>0.85 0.85 0.85 1</diffuse>
      <specular>0.3 0.3 0.3 1</specular>
      <direction>-0.5 0.2 -0.9</direction>
    </light>
    <model name="ground_plane">
      <static>true</static>
      <pose>0 0 0 0 0 0</pose>
      <link name="link">
        <collision name="collision">
          <geometry>
            <plane>
              <normal>0 0 1</normal>
              <size>100 100</size>
            </plane>
          </geometry>
        </collision>
        <visual name="visual">
          <geometry>
            <plane>
              <normal>0 0 1</normal>
              <size>100 100</size>
            </plane>
          </geometry>
          <material>
            <ambient>0.8 0.8 0.8 1</ambient>
            <diffuse>0.8 0.8 0.8 1</diffuse>
            <specular>0.2 0.2 0.2 1</specular>
          </material>
        </visual>
      </link>
    </model>
    <model name="${robotName}">
      <static>${isAnchoredToWorld ? 'true' : 'false'}</static>
      <pose>0 0 ${modelSpawnZ} 0 0 0</pose>
${linkLines.join('\n')}
${jointLines.join('\n')}${urdfModelPluginXmls.length > 0 ? '\n' + urdfModelPluginXmls.join('\n') : ''}
    </model>
  </world>
</sdf>`;
}

function parseGeometryNode(
  geomNode: XmlNode | undefined,
  diagnostics: CompilerDiagnostic[],
  contextName: string
): SimGeometry {
  if (!geomNode) {
    diagnostics.push({
      line: 1,
      column: 1,
      severity: 'warning',
      code: 'SDF_MISSING_GEOMETRY',
      message: `Missing <geometry> in ${contextName}; defaulting to 0.2m box.`,
    });
    return { type: 'box', size: [0.2, 0.2, 0.2] };
  }

  const box = findChild(geomNode, 'box');
  if (box) {
    const sizeNode = findChild(box, 'size');
    const sizeText = sizeNode?.text || box.attrs.size;
    const size = parseVec3(sizeText, [0.5, 0.5, 0.5]);
    if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) {
      diagnostics.push({
        line: sizeNode?.line || box.line,
        column: sizeNode?.column || box.column,
        severity: 'error',
        code: 'SDF_NON_POSITIVE_DIMENSION',
        message: `Box <size> in ${contextName} must have strictly positive dimensions, got [${size.join(', ')}].`,
      });
    }
    return { type: 'box', size };
  }

  const sphere = findChild(geomNode, 'sphere');
  if (sphere) {
    const rNode = findChild(sphere, 'radius');
    const rawR = rNode ? rNode.text.trim() : sphere.attrs.radius;
    const radius = rawR !== undefined ? Number(rawR) : 0.25;
    if (Number.isNaN(radius) || radius <= 0) {
      diagnostics.push({
        line: rNode?.line || sphere.line,
        column: rNode?.column || sphere.column,
        severity: 'error',
        code: 'SDF_INVALID_RADIUS',
        message: `Sphere <radius> in ${contextName} must be > 0, got "${rawR}".`,
      });
    }
    return { type: 'sphere', radius: radius > 0 ? radius : 0.25 };
  }

  const cylinder = findChild(geomNode, 'cylinder');
  if (cylinder) {
    const rNode = findChild(cylinder, 'radius');
    const lNode = findChild(cylinder, 'length');
    const rawR = rNode ? rNode.text.trim() : cylinder.attrs.radius;
    const rawL = lNode ? lNode.text.trim() : cylinder.attrs.length;
    const radius = rawR !== undefined ? Number(rawR) : 0.2;
    const length = rawL !== undefined ? Number(rawL) : 0.5;
    if (Number.isNaN(radius) || radius <= 0 || Number.isNaN(length) || length <= 0) {
      diagnostics.push({
        line: cylinder.line,
        column: cylinder.column,
        severity: 'error',
        code: 'SDF_INVALID_CYLINDER',
        message: `Cylinder <radius> and <length> in ${contextName} must be positive numbers.`,
      });
    }
    return {
      type: 'cylinder',
      radius: radius > 0 ? radius : 0.2,
      length: length > 0 ? length : 0.5,
    };
  }

  const capsule = findChild(geomNode, 'capsule');
  if (capsule) {
    const rNode = findChild(capsule, 'radius');
    const lNode = findChild(capsule, 'length');
    const rawR = rNode ? rNode.text.trim() : capsule.attrs.radius;
    const rawL = lNode ? lNode.text.trim() : capsule.attrs.length;
    const radius = rawR !== undefined ? Number(rawR) : 0.12;
    const length = rawL !== undefined ? Number(rawL) : 0.5;
    return {
      type: 'capsule',
      radius: radius > 0 ? radius : 0.12,
      length: length > 0 ? length : 0.5,
    };
  }

  const cone = findChild(geomNode, 'cone');
  if (cone) {
    const rNode = findChild(cone, 'radius');
    const lNode = findChild(cone, 'length');
    const rawR = rNode ? rNode.text.trim() : cone.attrs.radius;
    const rawL = lNode ? lNode.text.trim() : cone.attrs.length;
    const radius = rawR !== undefined ? Number(rawR) : 0.25;
    const length = rawL !== undefined ? Number(rawL) : 0.6;
    return {
      type: 'cone',
      radius: radius > 0 ? radius : 0.25,
      length: length > 0 ? length : 0.6,
    };
  }

  const ellipsoid = findChild(geomNode, 'ellipsoid');
  if (ellipsoid) {
    const radiiNode = findChild(ellipsoid, 'radii');
    const radii = parseVec3(radiiNode?.text || ellipsoid.attrs.radii, [0.3, 0.2, 0.15]);
    return { type: 'ellipsoid', radii };
  }

  const plane = findChild(geomNode, 'plane');
  if (plane) {
    const sizeNode = findChild(plane, 'size');
    const parts = sizeNode?.text.trim().split(/\s+/).map(Number) || [100, 100];
    return {
      type: 'plane',
      size: [parts[0] || 100, parts[1] || 100, 1],
    };
  }

  const mesh = findChild(geomNode, 'mesh');
  if (mesh) {
    const scaleNode = findChild(mesh, 'scale');
    const scale = parseVec3(scaleNode?.text || mesh.attrs.scale, [0.3, 0.3, 0.3]);
    return {
      type: 'box',
      size: [Math.abs(scale[0]) || 0.3, Math.abs(scale[1]) || 0.3, Math.abs(scale[2]) || 0.3],
    };
  }

  diagnostics.push({
    line: geomNode.line,
    column: geomNode.column,
    severity: 'warning',
    code: 'SDF_UNKNOWN_GEOMETRY',
    message: `Unsupported geometry child in ${contextName}; defaulting to 0.25m box.`,
  });
  return { type: 'box', size: [0.25, 0.25, 0.25] };
}

/**
 * Compiles and validates an SDF 1.10 or URDF XML source string into a ParsedWorld AST.
 */
export function compileSdfOrUrdf(
  xmlSource: string,
  sourceFilePath = 'worlds/empty.sdf'
): CompilationResult {
  const startTime = performance.now();
  const { root, diagnostics } = parseXmlWithLines(xmlSource);

  if (!root) {
    return {
      isValid: false,
      format: sourceFilePath.endsWith('.urdf') ? 'urdf' : 'sdf',
      diagnostics,
      world: null,
      compileTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
    };
  }

  let format: 'sdf' | 'urdf' = 'sdf';
  let convertedSdfXml: string | undefined;
  let sdfRoot = root;
  const xmlSyntaxDiagnostics = [...diagnostics];
  const urdfDirectDiagnostics: CompilerDiagnostic[] = [];

  if (root.tag === 'robot') {
    format = 'urdf';
    if (!root.attrs.name) {
      urdfDirectDiagnostics.push({
        line: root.line,
        column: root.column,
        severity: 'warning',
        code: 'URDF_MISSING_NAME',
        message: 'URDF <robot> tag is missing a "name" attribute.',
      });
    }
    convertedSdfXml = convertUrdfToSdfXml(root, urdfDirectDiagnostics);
    const convertedParsed = parseXmlWithLines(convertedSdfXml);
    if (convertedParsed.root) {
      sdfRoot = convertedParsed.root;
    }
    urdfDirectDiagnostics.push({
      line: root.line,
      column: root.column,
      severity: 'info',
      code: 'URDF_AUTO_CONVERTED',
      message: `URDF robot "${root.attrs.name || 'robot'}" automatically converted to Gazebo Harmonic SDF 1.10 world.`,
    });
  } else if (root.tag !== 'sdf') {
    diagnostics.push({
      line: root.line,
      column: root.column,
      severity: 'error',
      code: 'SDF_INVALID_ROOT',
      message: `Invalid root element <${root.tag}>. Expected <sdf version="1.10"> or URDF <robot>.`,
      suggestion: 'Wrap your simulation definition in <sdf version="1.10">...</sdf>',
    });
    return {
      isValid: false,
      format: 'sdf',
      diagnostics,
      world: null,
      compileTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
    };
  }

  const sdfVersion = sdfRoot.attrs.version;
  if (!sdfVersion) {
    diagnostics.push({
      line: sdfRoot.line,
      column: sdfRoot.column,
      severity: 'warning',
      code: 'SDF_MISSING_VERSION',
      message: '<sdf> root element is missing version attribute; assuming version="1.10".',
      suggestion: 'Use <sdf version="1.10">',
    });
  }

  // Support both <world> inside <sdf> or standalone <model> inside <sdf>
  const worldNode = findChild(sdfRoot, 'world');
  const standaloneModels = findChildren(sdfRoot, 'model');

  if (!worldNode && standaloneModels.length === 0) {
    diagnostics.push({
      line: sdfRoot.line,
      column: sdfRoot.column,
      severity: 'error',
      code: 'SDF_EMPTY_ROOT',
      message: '<sdf> element must contain either a <world> or at least one <model> element.',
    });
    return {
      isValid: false,
      format,
      convertedSdfXml,
      diagnostics,
      world: null,
      compileTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
    };
  }

  let nextEntityId = 1;
  const worldEntityId = nextEntityId++;
  const worldName = worldNode?.attrs.name || 'default';

  if (worldNode && !worldNode.attrs.name) {
    diagnostics.push({
      line: worldNode.line,
      column: worldNode.column,
      severity: 'warning',
      code: 'SDF_WORLD_NO_NAME',
      message: '<world> tag is missing a "name" attribute; defaulting to "default".',
    });
  }

  const worldPlugins: SimPlugin[] = worldNode
    ? parsePluginNodes(worldNode, 'world', worldName)
    : [];

  // Ensure standard core gz-sim world systems are represented if none explicitly declared
  if (worldPlugins.length === 0) {
    worldPlugins.push(
      {
        id: `plugin-world-${worldName}-physics`,
        filename: 'gz-sim-physics-system',
        name: 'gz::sim::systems::Physics',
        scope: 'world',
        targetName: worldName,
        parameters: {},
      },
      {
        id: `plugin-world-${worldName}-scene-broadcaster`,
        filename: 'gz-sim-scene-broadcaster-system',
        name: 'gz::sim::systems::SceneBroadcaster',
        scope: 'world',
        targetName: worldName,
        parameters: {},
      },
      {
        id: `plugin-world-${worldName}-user-commands`,
        filename: 'gz-sim-user-commands-system',
        name: 'gz::sim::systems::UserCommands',
        scope: 'world',
        targetName: worldName,
        parameters: {},
      }
    );
  }

  const gravityNode = worldNode ? findChild(worldNode, 'gravity') : undefined;
  const gravity = parseVec3(gravityNode?.text, [0, 0, -9.81]);

  const windNode = worldNode ? findChild(worldNode, 'wind') : undefined;
  const windVelNode = windNode ? findChild(windNode, 'linear_velocity') : undefined;
  const windVel = parseVec3(windVelNode?.text, [0, 0, 0]);

  const magNode = worldNode ? findChild(worldNode, 'magnetic_field') : undefined;
  const magneticField = parseVec3(magNode?.text, [6e-6, 2.3e-5, -4.2e-5]);

  const physicsNode = worldNode ? findChild(worldNode, 'physics') : undefined;
  const maxStepNode = physicsNode ? findChild(physicsNode, 'max_step_size') : undefined;
  const rtfNode = physicsNode ? findChild(physicsNode, 'real_time_factor') : undefined;
  const maxStepSize = maxStepNode ? Number(maxStepNode.text.trim()) : 0.001;
  const realTimeFactor = rtfNode ? Number(rtfNode.text.trim()) : 1.0;

  if (Number.isNaN(maxStepSize) || maxStepSize <= 0 || maxStepSize > 0.5) {
    diagnostics.push({
      line: maxStepNode?.line || physicsNode?.line || 1,
      column: maxStepNode?.column || 1,
      severity: 'error',
      code: 'SDF_INVALID_STEP_SIZE',
      message: `Invalid <max_step_size> "${maxStepNode?.text}". Must be between 0.0001 and 0.5 seconds.`,
    });
  }

  // Parse lights
  const lightNodes = worldNode ? findChildren(worldNode, 'light') : [];
  const lights: SimLight[] = [];
  for (const lNode of lightNodes) {
    const lName = lNode.attrs.name || `light_${lights.length + 1}`;
    const lTypeRaw = lNode.attrs.type || 'directional';
    const lType =
      lTypeRaw === 'point' || lTypeRaw === 'spot' ? lTypeRaw : 'directional';
    const pose = parsePoseNode(findChild(lNode, 'pose'), diagnostics, `light "${lName}"`);
    const diffuse = parseColor4(findChild(lNode, 'diffuse')?.text, [0.8, 0.8, 0.8, 1]);
    const specular = parseColor4(findChild(lNode, 'specular')?.text, [0.2, 0.2, 0.2, 1]);
    const direction = parseVec3(findChild(lNode, 'direction')?.text, [-0.5, 0.1, -0.9]);
    const castShadowsText = findChild(lNode, 'cast_shadows')?.text.trim();
    const castShadows = castShadowsText !== 'false' && castShadowsText !== '0';

    lights.push({
      id: `light-${lName}-${nextEntityId}`,
      entityId: nextEntityId++,
      name: lName,
      type: lType,
      pose,
      diffuse,
      specular,
      direction,
      castShadows,
      intensity: 1.0,
      range: 30,
    });
  }

  // Parse models
  const modelNodes = worldNode ? findChildren(worldNode, 'model') : standaloneModels;
  const models: SimModel[] = [];
  const seenModelNames = new Set<string>();

  for (const mNode of modelNodes) {
    const mName = mNode.attrs.name || '';
    if (!mName) {
      diagnostics.push({
        line: mNode.line,
        column: mNode.column,
        severity: 'error',
        code: 'SDF_MODEL_MISSING_NAME',
        message: '<model> element is missing required "name" attribute.',
      });
    } else if (seenModelNames.has(mName)) {
      diagnostics.push({
        line: mNode.line,
        column: mNode.column,
        severity: 'error',
        code: 'SDF_DUPLICATE_MODEL',
        message: `Duplicate model name "${mName}" in world "${worldName}".`,
      });
    }
    seenModelNames.add(mName);

    const modelEntityId = nextEntityId++;
    const pose = parsePoseNode(findChild(mNode, 'pose'), diagnostics, `model "${mName}"`);
    const staticText = findChild(mNode, 'static')?.text.trim();
    const isStatic = staticText === 'true' || staticText === '1';
    const selfCollideText = findChild(mNode, 'self_collide')?.text.trim();
    const selfCollide = selfCollideText === 'true' || selfCollideText === '1';
    const modelWindText = findChild(mNode, 'enable_wind')?.text.trim();
    const modelEnableWind = modelWindText === 'true' || modelWindText === '1';

    const modelPlugins: SimPlugin[] = parsePluginNodes(mNode, 'model', mName);

    const linkNodes = findChildren(mNode, 'link');
    if (linkNodes.length === 0) {
      diagnostics.push({
        line: mNode.line,
        column: mNode.column,
        severity: 'error',
        code: 'SDF_MODEL_NO_LINKS',
        message: `Model "${mName || 'unnamed'}" contains no <link> elements. Every model requires at least one link.`,
      });
    }

    const links: SimLink[] = [];
    const linkNameMap = new Map<string, SimLink>();

    for (const lkNode of linkNodes) {
      const lkName = lkNode.attrs.name || '';
      if (!lkName) {
        diagnostics.push({
          line: lkNode.line,
          column: lkNode.column,
          severity: 'error',
          code: 'SDF_LINK_MISSING_NAME',
          message: `<link> inside model "${mName}" is missing a "name" attribute.`,
        });
      } else if (linkNameMap.has(lkName)) {
        diagnostics.push({
          line: lkNode.line,
          column: lkNode.column,
          severity: 'error',
          code: 'SDF_DUPLICATE_LINK',
          message: `Duplicate link name "${lkName}" inside model "${mName}".`,
        });
      }

      const lkEntityId = nextEntityId++;
      const lkPose = parsePoseNode(
        findChild(lkNode, 'pose'),
        diagnostics,
        `link "${mName}::${lkName}"`
      );
      const lkWindText = findChild(lkNode, 'enable_wind')?.text.trim();
      const enableWind =
        modelEnableWind || lkWindText === 'true' || lkWindText === '1';
      const lkSelfCollide =
        selfCollide || findChild(lkNode, 'self_collide')?.text.trim() === 'true';
      const kinematic = findChild(lkNode, 'kinematic')?.text.trim() === 'true';

      // Parse inertial & validate physics math
      const inertialNode = findChild(lkNode, 'inertial');
      let mass = 1.0;
      let inertialPose: Pose6D = [0, 0, 0, 0, 0, 0];
      const inertia: InertiaMatrix = {
        ixx: 0.1,
        ixy: 0,
        ixz: 0,
        iyy: 0.1,
        iyz: 0,
        izz: 0.1,
      };

      if (inertialNode) {
        inertialPose = parsePoseNode(
          findChild(inertialNode, 'pose'),
          diagnostics,
          `inertial of "${mName}::${lkName}"`
        );
        const massNode = findChild(inertialNode, 'mass');
        if (massNode) {
          mass = Number(massNode.text.trim());
          if (Number.isNaN(mass) || (!isStatic && mass <= 0)) {
            diagnostics.push({
              line: massNode.line,
              column: massNode.column,
              severity: 'error',
              code: 'SDF_INVALID_MASS',
              message: `Non-static link "${mName}::${lkName}" has invalid <mass> (${massNode.text}). Mass must be strictly positive (> 0).`,
              suggestion: 'Set <mass> to a positive value in kg, e.g. <mass>1.5</mass>',
            });
          }
        }

        const inertiaNode = findChild(inertialNode, 'inertia');
        if (inertiaNode) {
          const readComp = (tag: keyof InertiaMatrix, def: number) => {
            const c = findChild(inertiaNode, tag);
            if (!c) return def;
            const val = Number(c.text.trim());
            if (Number.isNaN(val)) {
              diagnostics.push({
                line: c.line,
                column: c.column,
                severity: 'error',
                code: 'SDF_NAN_INERTIA',
                message: `Inertia component <${tag}> in "${mName}::${lkName}" is not a valid number.`,
              });
              return def;
            }
            return val;
          };
          inertia.ixx = readComp('ixx', 0.1);
          inertia.ixy = readComp('ixy', 0.0);
          inertia.ixz = readComp('ixz', 0.0);
          inertia.iyy = readComp('iyy', 0.1);
          inertia.iyz = readComp('iyz', 0.0);
          inertia.izz = readComp('izz', 0.1);

          if (!isStatic) {
            if (inertia.ixx <= 0 || inertia.iyy <= 0 || inertia.izz <= 0) {
              diagnostics.push({
                line: inertiaNode.line,
                column: inertiaNode.column,
                severity: 'error',
                code: 'SDF_NON_POSITIVE_INERTIA',
                message: `Principal moments of inertia (ixx=${inertia.ixx}, iyy=${inertia.iyy}, izz=${inertia.izz}) in "${mName}::${lkName}" must all be > 0.`,
                suggestion: 'Ensure <ixx>, <iyy>, and <izz> are strictly positive.',
              });
            } else {
              const eps = 1e-5;
              if (
                inertia.ixx + inertia.iyy + eps < inertia.izz ||
                inertia.ixx + inertia.izz + eps < inertia.iyy ||
                inertia.iyy + inertia.izz + eps < inertia.ixx
              ) {
                diagnostics.push({
                  line: inertiaNode.line,
                  column: inertiaNode.column,
                  severity: 'warning',
                  code: 'SDF_INERTIA_TRIANGLE_INEQUALITY',
                  message: `Inertia tensor of "${mName}::${lkName}" violates physical triangle inequality (ixx=${inertia.ixx}, iyy=${inertia.iyy}, izz=${inertia.izz}). The sum of any two principal moments should be >= the third.`,
                });
              }
            }
          }
        }
      }

      // Parse visuals
      const visualNodes = findChildren(lkNode, 'visual');
      const visuals: SimVisual[] = visualNodes.map((vNode, idx) => {
        const vName = vNode.attrs.name || `visual_${idx}`;
        const vPose = parsePoseNode(
          findChild(vNode, 'pose'),
          diagnostics,
          `visual "${mName}::${lkName}::${vName}"`
        );
        const geometry = parseGeometryNode(
          findChild(vNode, 'geometry'),
          diagnostics,
          `visual "${mName}::${lkName}::${vName}"`
        );
        const matNode = findChild(vNode, 'material');
        const material: SimMaterial = {
          ambient: parseColor4(findChild(matNode || vNode, 'ambient')?.text, [0.7, 0.7, 0.7, 1]),
          diffuse: parseColor4(findChild(matNode || vNode, 'diffuse')?.text, [0.75, 0.75, 0.75, 1]),
          specular: parseColor4(findChild(matNode || vNode, 'specular')?.text, [0.3, 0.3, 0.3, 1]),
        };
        return {
          id: `${mName}-${lkName}-${vName}-${idx}`,
          name: vName,
          pose: vPose,
          geometry,
          material,
        };
      });

      // Parse collisions
      const collisionNodes = findChildren(lkNode, 'collision');
      const collisions: SimCollision[] = collisionNodes.map((cNode, idx) => {
        const cName = cNode.attrs.name || `collision_${idx}`;
        const cPose = parsePoseNode(
          findChild(cNode, 'pose'),
          diagnostics,
          `collision "${mName}::${lkName}::${cName}"`
        );
        const geometry = parseGeometryNode(
          findChild(cNode, 'geometry'),
          diagnostics,
          `collision "${mName}::${lkName}::${cName}"`
        );
        const surfaceNode = findChild(cNode, 'surface');
        const frictionNode = surfaceNode ? findChild(surfaceNode, 'friction') : undefined;
        const odeNode = frictionNode ? findChild(frictionNode, 'ode') : undefined;
        const mu = odeNode && findChild(odeNode, 'mu') ? Number(findChild(odeNode, 'mu')!.text) : 0.8;
        const mu2 = odeNode && findChild(odeNode, 'mu2') ? Number(findChild(odeNode, 'mu2')!.text) : 0.8;

        return {
          id: `${mName}-${lkName}-${cName}-${idx}`,
          name: cName,
          pose: cPose,
          geometry,
          friction: {
            mu: Number.isNaN(mu) ? 0.8 : mu,
            mu2: Number.isNaN(mu2) ? 0.8 : mu2,
            restitution: 0.25,
          },
        };
      });

      // Parse link sensors & link plugins
      const sensors = parseSensorNodes(lkNode, mName, lkName, diagnostics);
      const linkPlugins = parsePluginNodes(lkNode, 'link', `${mName}::${lkName}`);
      modelPlugins.push(...linkPlugins);

      const simLink: SimLink = {
        id: `${mName}::${lkName}`,
        entityId: lkEntityId,
        name: lkName,
        pose: lkPose,
        inertial: {
          mass: mass > 0 ? mass : 1.0,
          pose: inertialPose,
          inertia,
        },
        visuals,
        collisions,
        sensors,
        enableWind,
        selfCollide: lkSelfCollide,
        kinematic,
        linearVelocity: [0, 0, 0],
        angularVelocity: [0, 0, 0],
        appliedForce: [0, 0, 0],
      };

      links.push(simLink);
      if (lkName) {
        linkNameMap.set(lkName, simLink);
      }
    }

    // Parse joints & validate link references
    const jointNodes = findChildren(mNode, 'joint');
    const joints: SimJoint[] = [];

    for (const jNode of jointNodes) {
      const jName = jNode.attrs.name || `joint_${joints.length + 1}`;
      const jTypeRaw = jNode.attrs.type || 'revolute';
      const validTypes = ['revolute', 'continuous', 'prismatic', 'fixed', 'ball'];
      if (!validTypes.includes(jTypeRaw)) {
        diagnostics.push({
          line: jNode.line,
          column: jNode.column,
          severity: 'error',
          code: 'SDF_INVALID_JOINT_TYPE',
          message: `Invalid joint type "${jTypeRaw}" on joint "${jName}". Allowed types: ${validTypes.join(', ')}.`,
        });
      }
      const jType = (validTypes.includes(jTypeRaw) ? jTypeRaw : 'revolute') as SimJoint['type'];

      const parentNode = findChild(jNode, 'parent');
      const childNode = findChild(jNode, 'child');
      const parentName = parentNode?.text.trim() || '';
      const childName = childNode?.text.trim() || '';

      if (!parentName || !linkNameMap.has(parentName)) {
        diagnostics.push({
          line: parentNode?.line || jNode.line,
          column: parentNode?.column || jNode.column,
          severity: 'error',
          code: 'SDF_JOINT_MISSING_PARENT',
          message: `Joint "${mName}::${jName}" references non-existent <parent> link "${parentName}".`,
          suggestion: `Available links in "${mName}": ${Array.from(linkNameMap.keys()).join(', ')}`,
        });
      }

      if (!childName || !linkNameMap.has(childName)) {
        diagnostics.push({
          line: childNode?.line || jNode.line,
          column: childNode?.column || jNode.column,
          severity: 'error',
          code: 'SDF_JOINT_MISSING_CHILD',
          message: `Joint "${mName}::${jName}" references non-existent <child> link "${childName}".`,
          suggestion: `Available links in "${mName}": ${Array.from(linkNameMap.keys()).join(', ')}`,
        });
      }

      if (parentName && parentName === childName) {
        diagnostics.push({
          line: jNode.line,
          column: jNode.column,
          severity: 'error',
          code: 'SDF_JOINT_SELF_LOOP',
          message: `Joint "${mName}::${jName}" connects link "${parentName}" to itself.`,
        });
      }

      const jPose = parsePoseNode(
        findChild(jNode, 'pose'),
        diagnostics,
        `joint "${mName}::${jName}"`
      );
      const axisNode = findChild(jNode, 'axis');
      const xyzNode = axisNode ? findChild(axisNode, 'xyz') : undefined;
      const xyz = parseVec3(xyzNode?.text, [0, 0, 1]);
      const axisMag = Math.hypot(xyz[0], xyz[1], xyz[2]);
      if (jType !== 'fixed' && axisMag < 1e-6) {
        diagnostics.push({
          line: xyzNode?.line || jNode.line,
          column: xyzNode?.column || jNode.column,
          severity: 'error',
          code: 'SDF_ZERO_JOINT_AXIS',
          message: `Joint "${mName}::${jName}" has a zero-length <axis><xyz> vector.`,
        });
      }

      const limitNode = axisNode ? findChild(axisNode, 'limit') : undefined;
      const lower =
        limitNode && findChild(limitNode, 'lower')
          ? Number(findChild(limitNode, 'lower')!.text)
          : -Math.PI;
      const upper =
        limitNode && findChild(limitNode, 'upper')
          ? Number(findChild(limitNode, 'upper')!.text)
          : Math.PI;
      const effort =
        limitNode && findChild(limitNode, 'effort')
          ? Number(findChild(limitNode, 'effort')!.text)
          : 50;
      const velocity =
        limitNode && findChild(limitNode, 'velocity')
          ? Number(findChild(limitNode, 'velocity')!.text)
          : 2.5;

      const dynNode = axisNode ? findChild(axisNode, 'dynamics') : undefined;
      const damping =
        dynNode && findChild(dynNode, 'damping')
          ? Number(findChild(dynNode, 'damping')!.text)
          : 0.2;
      const friction =
        dynNode && findChild(dynNode, 'friction')
          ? Number(findChild(dynNode, 'friction')!.text)
          : 0.05;

      joints.push({
        id: `${mName}::${jName}`,
        entityId: nextEntityId++,
        name: jName,
        type: jType,
        parent: parentName,
        child: childName,
        pose: jPose,
        axis: {
          xyz: axisMag > 1e-6 ? [xyz[0] / axisMag, xyz[1] / axisMag, xyz[2] / axisMag] : [0, 0, 1],
          lower: Number.isNaN(lower) ? -Math.PI : lower,
          upper: Number.isNaN(upper) ? Math.PI : upper,
          effort: Number.isNaN(effort) ? 50 : effort,
          velocity: Number.isNaN(velocity) ? 2.5 : velocity,
          damping: Number.isNaN(damping) ? 0.2 : damping,
          friction: Number.isNaN(friction) ? 0.05 : friction,
        },
        position: 0,
        velocity: 0,
        targetPosition: 0,
        targetVelocity: 0,
        appliedEffort: 0,
        controlMode: 'position',
      });
    }

    // Canonical link resolution:
    // If links[0] is a massless virtual frame (like base_footprint with no visuals/collisions),
    // promote the first physical link (e.g. chassis_link) as the canonical link and record virtualRootLink.
    let canonicalLink = links[0]?.name || 'link';
    let virtualRootLink: string | undefined;

    if (links.length > 1) {
      const firstLink = links[0];
      const isVirtualFrame =
        firstLink.visuals.length === 0 &&
        firstLink.collisions.length === 0 &&
        (firstLink.inertial.mass <= 0.06 ||
          firstLink.name === 'base_footprint' ||
          firstLink.name === 'base_frame');

      if (isVirtualFrame) {
        const physicalChild = links.find(
          (l) =>
            l.name !== firstLink.name &&
            (l.visuals.length > 0 || l.collisions.length > 0 || l.inertial.mass > 0.06)
        );
        if (physicalChild) {
          virtualRootLink = firstLink.name;
          canonicalLink = physicalChild.name;
        }
      }
    }

    // Auto-attach default DiffDrive & JointStatePublisher plugins on mobile robots if none specified
    if (!isStatic && mName !== 'ground_plane' && modelPlugins.length === 0 && joints.length > 0) {
      const hasWheels = joints.some((j) => j.name.toLowerCase().includes('wheel'));
      if (hasWheels) {
        const leftJ = joints.find((j) => j.name.toLowerCase().includes('left'))?.name || 'left_wheel_joint';
        const rightJ = joints.find((j) => j.name.toLowerCase().includes('right'))?.name || 'right_wheel_joint';
        modelPlugins.push(
          {
            id: `plugin-model-${mName}-diff-drive`,
            filename: 'gz-sim-diff-drive-system',
            name: 'gz::sim::systems::DiffDrive',
            scope: 'model',
            targetName: mName,
            parameters: {
              left_joint: leftJ,
              right_joint: rightJ,
              wheel_separation: '0.54',
              wheel_radius: '0.16',
              topic: `/model/${mName}/cmd_vel`,
              odom_topic: `/model/${mName}/odometry`,
            },
          },
          {
            id: `plugin-model-${mName}-joint-state-pub`,
            filename: 'gz-sim-joint-state-publisher-system',
            name: 'gz::sim::systems::JointStatePublisher',
            scope: 'model',
            targetName: mName,
            parameters: {
              topic: `/world/${worldName}/model/${mName}/joint_state`,
            },
          }
        );
      } else {
        modelPlugins.push({
          id: `plugin-model-${mName}-joint-state-pub`,
          filename: 'gz-sim-joint-state-publisher-system',
          name: 'gz::sim::systems::JointStatePublisher',
          scope: 'model',
          targetName: mName,
          parameters: {
            topic: `/world/${worldName}/model/${mName}/joint_state`,
          },
        });
      }
    }

    models.push({
      id: `model-${mName}-${modelEntityId}`,
      entityId: modelEntityId,
      name: mName || `model_${models.length + 1}`,
      sourceFilePath: `/usr/share/gz/gz-sim8/${sourceFilePath}`,
      canonicalLink,
      virtualRootLink,
      pose,
      isStatic,
      selfCollide,
      enableWind: modelEnableWind || links.some((l) => l.enableWind),
      links,
      joints,
      plugins: modelPlugins,
      linearVelocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      cmdVel: { linearX: 0, linearY: 0, angularZ: 0 },
    });
  }

  const finalDiagnostics =
    format === 'urdf'
      ? [...xmlSyntaxDiagnostics, ...urdfDirectDiagnostics]
      : diagnostics;
  const hasErrors = finalDiagnostics.some((d) => d.severity === 'error');

  const world: ParsedWorld = {
    entityId: worldEntityId,
    name: worldName,
    sourceFilePath: `/usr/share/gz/gz-sim8/${sourceFilePath}`,
    gravity,
    wind: {
      enabled: Math.hypot(windVel[0], windVel[1], windVel[2]) > 0.001,
      linearVelocity: windVel,
    },
    magneticField,
    physics: {
      name: physicsNode?.attrs.name || '1ms',
      type: physicsNode?.attrs.type || 'ode',
      maxStepSize: Number.isNaN(maxStepSize) || maxStepSize <= 0 ? 0.001 : maxStepSize,
      realTimeFactor: Number.isNaN(realTimeFactor) || realTimeFactor <= 0 ? 1.0 : realTimeFactor,
      realTimeUpdateRate: 1000,
    },
    lights,
    models,
    plugins: worldPlugins,
  };

  world.topics = buildWorldGzTopicsAndRos2Bridge(world);

  return {
    isValid: !hasErrors,
    format,
    convertedSdfXml,
    diagnostics: finalDiagnostics,
    world: hasErrors ? null : world,
    compileTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
  };
}

/**
 * Returns the exact resting Z coordinate on the ground plane (z = 0)
 * for each Gazebo Harmonic primitive shape so placed shapes sit flush on the ground.
 */
export function getDefaultGroundZForPrimitive(shape: PrimitiveShapeType): number {
  switch (shape) {
    case 'box':
      return 0.25;
    case 'sphere':
      return 0.25;
    case 'cylinder':
      return 0.3;
    case 'cone':
      return 0.3;
    case 'capsule':
      return 0.4;
    case 'ellipsoid':
      return 0.2;
    default:
      return 0.25;
  }
}

export function getPrimitiveDefaultGeometry(shape: PrimitiveShapeType): SimGeometry {
  switch (shape) {
    case 'box':
      return { type: 'box', size: [0.5, 0.5, 0.5] };
    case 'sphere':
      return { type: 'sphere', radius: 0.25 };
    case 'cylinder':
      return { type: 'cylinder', radius: 0.25, length: 0.6 };
    case 'cone':
      return { type: 'cone', radius: 0.25, length: 0.6 };
    case 'capsule':
      return { type: 'capsule', radius: 0.18, length: 0.44 };
    case 'ellipsoid':
      return { type: 'ellipsoid', radii: [0.35, 0.25, 0.2] };
  }
}

export function serializeGeometryToXml(geom: SimGeometry, indent = '            '): string {
  switch (geom.type) {
    case 'box': {
      const [sx, sy, sz] = geom.size || [0.5, 0.5, 0.5];
      return `<box>\n${indent}  <size>${sx} ${sy} ${sz}</size>\n${indent}</box>`;
    }
    case 'sphere':
      return `<sphere>\n${indent}  <radius>${geom.radius ?? 0.25}</radius>\n${indent}</sphere>`;
    case 'cylinder':
      return `<cylinder>\n${indent}  <radius>${geom.radius ?? 0.25}</radius>\n${indent}  <length>${geom.length ?? 0.6}</length>\n${indent}</cylinder>`;
    case 'cone':
      return `<cone>\n${indent}  <radius>${geom.radius ?? 0.25}</radius>\n${indent}  <length>${geom.length ?? 0.6}</length>\n${indent}</cone>`;
    case 'capsule':
      return `<capsule>\n${indent}  <radius>${geom.radius ?? 0.18}</radius>\n${indent}  <length>${geom.length ?? 0.44}</length>\n${indent}</capsule>`;
    case 'ellipsoid': {
      const [rx, ry, rz] = geom.radii || [0.35, 0.25, 0.2];
      return `<ellipsoid>\n${indent}  <radii>${rx} ${ry} ${rz}</radii>\n${indent}</ellipsoid>`;
    }
    case 'plane': {
      const [px, py] = geom.size || [100, 100, 1];
      return `<plane>\n${indent}  <normal>0 0 1</normal>\n${indent}  <size>${px} ${py}</size>\n${indent}</plane>`;
    }
  }
}

export function generateSpawnPrimitiveSdfSnippet(
  shape: PrimitiveShapeType,
  index: number,
  pose?: Pose6D
): string {
  const defaultZ = getDefaultGroundZForPrimitive(shape);
  const resolvedPose: Pose6D = pose || [0, 0, defaultZ, 0, 0, 0];
  const name = `${shape}_${index}`;
  const poseStr = resolvedPose.map((n) => Number(n.toFixed(3))).join(' ');
  const geom = getPrimitiveDefaultGeometry(shape);
  const geomXml = serializeGeometryToXml(geom, '            ');

  return `
    <model name="${name}">
      <static>false</static>
      <pose>${poseStr}</pose>
      <link name="${name}_link">
        <enable_wind>false</enable_wind>
        <inertial>
          <mass>2.0</mass>
          <inertia>
            <ixx>0.12</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.12</iyy>
            <iyz>0</iyz>
            <izz>0.12</izz>
          </inertia>
        </inertial>
        <collision name="collision">
          <geometry>
            ${geomXml}
          </geometry>
        </collision>
        <visual name="visual">
          <geometry>
            ${geomXml}
          </geometry>
          <material>
            <ambient>0.22 0.58 0.88 1</ambient>
            <diffuse>0.25 0.62 0.92 1</diffuse>
            <specular>0.5 0.5 0.5 1</specular>
          </material>
        </visual>
      </link>
    </model>`;
}

export function createPrimitiveModelEntity(
  shape: PrimitiveShapeType,
  index: number,
  pose: Pose6D,
  startEntityId: number,
  sourceFilePath = 'worlds/empty.sdf'
): SimModel {
  const name = `${shape}_${index}`;
  const linkName = `${name}_link`;
  const geom = getPrimitiveDefaultGeometry(shape);
  const modelEntityId = startEntityId;
  const linkEntityId = startEntityId + 1;

  const link: SimLink = {
    id: `${name}::${linkName}`,
    entityId: linkEntityId,
    name: linkName,
    pose: [0, 0, 0, 0, 0, 0],
    inertial: {
      mass: 2.0,
      pose: [0, 0, 0, 0, 0, 0],
      inertia: { ixx: 0.12, ixy: 0, ixz: 0, iyy: 0.12, iyz: 0, izz: 0.12 },
    },
    visuals: [
      {
        id: `${name}-${linkName}-visual-0`,
        name: 'visual',
        pose: [0, 0, 0, 0, 0, 0],
        geometry: JSON.parse(JSON.stringify(geom)),
        material: {
          ambient: [0.22, 0.58, 0.88, 1],
          diffuse: [0.25, 0.62, 0.92, 1],
          specular: [0.5, 0.5, 0.5, 1],
        },
      },
    ],
    collisions: [
      {
        id: `${name}-${linkName}-collision-0`,
        name: 'collision',
        pose: [0, 0, 0, 0, 0, 0],
        geometry: JSON.parse(JSON.stringify(geom)),
        friction: { mu: 0.8, mu2: 0.8, restitution: 0.2 },
      },
    ],
    sensors: [],
    enableWind: false,
    selfCollide: false,
    kinematic: false,
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    appliedForce: [0, 0, 0],
  };

  return {
    id: `model-${name}-${modelEntityId}`,
    entityId: modelEntityId,
    name,
    sourceFilePath: `/usr/share/gz/gz-sim8/${sourceFilePath}`,
    canonicalLink: linkName,
    pose: [...pose],
    isStatic: false,
    selfCollide: false,
    enableWind: false,
    links: [link],
    joints: [],
    plugins: [],
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    cmdVel: { linearX: 0, linearY: 0, angularZ: 0 },
  };
}

export function generateSpawnLightSdfSnippet(
  lightType: LightSpawnType,
  index: number,
  pose: Pose6D = [0, 0, 3.0, 0, 0, 0]
): string {
  const name = `${lightType}_light_${index}`;
  const poseStr = pose.map((n) => Number(n.toFixed(3))).join(' ');
  return `
    <light type="${lightType}" name="${name}">
      <cast_shadows>true</cast_shadows>
      <pose>${poseStr}</pose>
      <diffuse>0.95 0.92 0.82 1</diffuse>
      <specular>0.35 0.35 0.35 1</specular>
      <direction>-0.2 0.2 -0.9</direction>
    </light>`;
}

export function createSpawnLightEntity(
  lightType: LightSpawnType,
  index: number,
  pose: Pose6D,
  entityId: number
): SimLight {
  const name = `${lightType}_light_${index}`;
  return {
    id: `light-${name}-${entityId}`,
    entityId,
    name,
    type: lightType,
    pose: [...pose],
    diffuse: [0.95, 0.92, 0.82, 1],
    specular: [0.35, 0.35, 0.35, 1],
    direction: [-0.2, 0.2, -0.9],
    castShadows: true,
    intensity: 1.2,
    range: 25,
  };
}

export function cloneModelEntityForPaste(
  sourceModel: SimModel,
  cloneIndex: number,
  targetPose: Pose6D,
  startEntityId: number
): { model: SimModel; sdfSnippet: string } {
  let nextId = startEntityId;
  const newModelEntityId = nextId++;
  const baseName = sourceModel.name.replace(/_clone_\d+$/, '');
  const newName = `${baseName}_clone_${cloneIndex}`;

  const clonedLinks: SimLink[] = sourceModel.links.map((lk) => {
    const lkEntityId = nextId++;
    return {
      ...JSON.parse(JSON.stringify(lk)),
      id: `${newName}::${lk.name}`,
      entityId: lkEntityId,
      linearVelocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      appliedForce: [0, 0, 0],
    };
  });

  const clonedJoints: SimJoint[] = sourceModel.joints.map((j) => {
    const jEntityId = nextId++;
    return {
      ...JSON.parse(JSON.stringify(j)),
      id: `${newName}::${j.name}`,
      entityId: jEntityId,
    };
  });

  const clonedModel: SimModel = {
    ...JSON.parse(JSON.stringify(sourceModel)),
    id: `model-${newName}-${newModelEntityId}`,
    entityId: newModelEntityId,
    name: newName,
    pose: [...targetPose],
    links: clonedLinks,
    joints: clonedJoints,
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    cmdVel: { linearX: 0, linearY: 0, angularZ: 0 },
  };

  const poseStr = targetPose.map((n) => Number(n.toFixed(3))).join(' ');
  const linkXmlBlocks = clonedLinks.map((lk) => {
    const lkPoseStr = lk.pose.map((n) => Number(n.toFixed(3))).join(' ');
    const visXml = lk.visuals
      .map((v) => {
        const vp = v.pose.map((n) => Number(n.toFixed(3))).join(' ');
        const amb = v.material.ambient.join(' ');
        const dif = v.material.diffuse.join(' ');
        const spc = v.material.specular.join(' ');
        return `        <visual name="${v.name}">
          <pose>${vp}</pose>
          <geometry>
            ${serializeGeometryToXml(v.geometry, '            ')}
          </geometry>
          <material>
            <ambient>${amb}</ambient>
            <diffuse>${dif}</diffuse>
            <specular>${spc}</specular>
          </material>
        </visual>`;
      })
      .join('\n');

    const colXml = lk.collisions
      .map((c) => {
        const cp = c.pose.map((n) => Number(n.toFixed(3))).join(' ');
        return `        <collision name="${c.name}">
          <pose>${cp}</pose>
          <geometry>
            ${serializeGeometryToXml(c.geometry, '            ')}
          </geometry>
        </collision>`;
      })
      .join('\n');

    const { ixx, ixy, ixz, iyy, iyz, izz } = lk.inertial.inertia;
    return `      <link name="${lk.name}">
        <pose>${lkPoseStr}</pose>
        <enable_wind>${lk.enableWind}</enable_wind>
        <inertial>
          <mass>${lk.inertial.mass}</mass>
          <inertia>
            <ixx>${ixx}</ixx>
            <ixy>${ixy}</ixy>
            <ixz>${ixz}</ixz>
            <iyy>${iyy}</iyy>
            <iyz>${iyz}</iyz>
            <izz>${izz}</izz>
          </inertia>
        </inertial>
${colXml}
${visXml}
      </link>`;
  });

  const jointXmlBlocks = clonedJoints.map((j) => {
    const ax = j.axis.xyz.map((n) => Number(n.toFixed(3))).join(' ');
    return `      <joint name="${j.name}" type="${j.type}">
        <parent>${j.parent}</parent>
        <child>${j.child}</child>
        <axis>
          <xyz>${ax}</xyz>
          <limit>
            <lower>${j.axis.lower}</lower>
            <upper>${j.axis.upper}</upper>
            <effort>${j.axis.effort}</effort>
            <velocity>${j.axis.velocity}</velocity>
          </limit>
        </axis>
      </joint>`;
  });

  const sdfSnippet = `
    <model name="${newName}">
      <static>${clonedModel.isStatic}</static>
      <self_collide>${clonedModel.selfCollide}</self_collide>
      <pose>${poseStr}</pose>
${linkXmlBlocks.join('\n')}
${jointXmlBlocks.join('\n')}
    </model>`;

  return { model: clonedModel, sdfSnippet };
}
