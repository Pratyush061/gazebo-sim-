export type Pose6D = [number, number, number, number, number, number]; // [x, y, z, roll, pitch, yaw]

export interface InertiaMatrix {
  ixx: number;
  ixy: number;
  ixz: number;
  iyy: number;
  iyz: number;
  izz: number;
}

export interface SimGeometry {
  type: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'cone' | 'ellipsoid' | 'plane';
  size?: [number, number, number]; // box [x, y, z] or plane [x, y, 1]
  radius?: number;
  length?: number;
  radii?: [number, number, number]; // ellipsoid [rx, ry, rz]
}

export interface SimMaterial {
  ambient: [number, number, number, number];
  diffuse: [number, number, number, number];
  specular: [number, number, number, number];
  emissive?: [number, number, number, number];
  metalness?: number;
  roughness?: number;
}

export interface SimVisual {
  id: string;
  name: string;
  pose: Pose6D;
  geometry: SimGeometry;
  material: SimMaterial;
  castShadows?: boolean;
}

export interface SimSurfaceFriction {
  mu: number;
  mu2: number;
  restitution: number;
}

export interface SimCollision {
  id: string;
  name: string;
  pose: Pose6D;
  geometry: SimGeometry;
  friction: SimSurfaceFriction;
}

export interface SimInertial {
  mass: number;
  pose: Pose6D;
  inertia: InertiaMatrix;
}

export type GzSystemCategory =
  | 'actuation'
  | 'publishers'
  | 'sensors'
  | 'world';

export interface SimPlugin {
  id: string;
  filename: string; // e.g. 'gz-sim-diff-drive-system'
  name: string; // e.g. 'gz::sim::systems::DiffDrive'
  scope: 'world' | 'model' | 'link' | 'sensor';
  targetName?: string;
  parameters: Record<string, string>;
}

export type SimSensorType =
  | 'gpu_lidar'
  | 'imu'
  | 'contact'
  | 'camera'
  | 'navsat'
  | 'magnetometer';

export interface SimLidarState {
  horizontalSamples: number;
  minAngle: number;
  maxAngle: number;
  minRange: number;
  maxRange: number;
  ranges: number[];
}

export interface SimImuState {
  orientation: [number, number, number, number]; // [x, y, z, w]
  angularVelocity: [number, number, number];
  linearAcceleration: [number, number, number];
}

export interface SimContactState {
  collisionName: string;
  touching: boolean;
  contactCount: number;
  normalForce: number;
  contactPoints: [number, number, number][];
}

export interface SimSensor {
  id: string;
  name: string;
  type: SimSensorType;
  linkName: string;
  pose: Pose6D;
  updateRate: number;
  topic: string;
  alwaysOn: boolean;
  visualize: boolean;
  lidar?: SimLidarState;
  imu?: SimImuState;
  contact?: SimContactState;
}

export interface GzTopicInfo {
  gzTopic: string;
  rosTopic: string;
  gzMsgType: string;
  rosMsgType: string;
  direction: 'GZ_TO_ROS' | 'ROS_TO_GZ' | 'BIDIRECTIONAL';
  frequencyHz: number;
  sourcePlugin: string;
  lastPayload: string;
}

export interface SimLink {
  id: string;
  entityId: number;
  name: string;
  pose: Pose6D;
  inertial: SimInertial;
  visuals: SimVisual[];
  collisions: SimCollision[];
  sensors?: SimSensor[];
  enableWind: boolean;
  selfCollide: boolean;
  kinematic: boolean;
  // Runtime dynamic state
  worldPosition?: [number, number, number];
  worldRotation?: [number, number, number];
  linearVelocity: [number, number, number];
  angularVelocity: [number, number, number];
  appliedForce: [number, number, number];
}

export interface SimJoint {
  id: string;
  entityId: number;
  name: string;
  type: 'revolute' | 'continuous' | 'prismatic' | 'fixed' | 'ball';
  parent: string;
  child: string;
  pose: Pose6D;
  axis: {
    xyz: [number, number, number];
    lower: number;
    upper: number;
    effort: number;
    velocity: number;
    damping: number;
    friction: number;
  };
  // Runtime state
  position: number; // angle (rad) or displacement (m)
  velocity: number;
  targetPosition: number;
  targetVelocity: number;
  appliedEffort: number;
  controlMode: 'position' | 'velocity' | 'effort';
}

export interface SimModel {
  id: string;
  entityId: number;
  name: string;
  sourceFilePath: string;
  canonicalLink: string;
  virtualRootLink?: string;
  pose: Pose6D;
  isStatic: boolean;
  selfCollide: boolean;
  enableWind: boolean;
  links: SimLink[];
  joints: SimJoint[];
  plugins?: SimPlugin[];
  // Runtime model state
  linearVelocity: [number, number, number];
  angularVelocity: [number, number, number];
  cmdVel: {
    linearX: number;
    linearY: number;
    angularZ: number;
  };
  activeContactPoints?: [number, number, number][];
}

export interface SimLight {
  id: string;
  entityId: number;
  name: string;
  type: 'directional' | 'point' | 'spot';
  pose: Pose6D;
  diffuse: [number, number, number, number];
  specular: [number, number, number, number];
  direction: [number, number, number];
  castShadows: boolean;
  intensity: number;
  range: number;
}

export interface ParsedWorld {
  entityId: number;
  name: string;
  sourceFilePath: string;
  gravity: [number, number, number]; // Gazebo Z-up: [0, 0, -9.81]
  wind: {
    enabled: boolean;
    linearVelocity: [number, number, number];
  };
  magneticField: [number, number, number];
  physics: {
    name: string;
    type: string;
    maxStepSize: number;
    realTimeFactor: number;
    realTimeUpdateRate: number;
  };
  lights: SimLight[];
  models: SimModel[];
  plugins?: SimPlugin[];
  topics?: GzTopicInfo[];
}

export interface CompilerDiagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  suggestion?: string;
}

export interface CompilationResult {
  isValid: boolean;
  format: 'sdf' | 'urdf';
  convertedSdfXml?: string;
  diagnostics: CompilerDiagnostic[];
  world: ParsedWorld | null;
  compileTimeMs: number;
}

export interface VirtualFile {
  id: string;
  name: string;
  path: string; // e.g. 'worlds/empty.sdf'
  folder: string; // e.g. 'worlds' or 'models' or 'urdf'
  content: string;
  lastModified: number;
  description?: string;
}

export interface DebugOverlaySettings {
  showGrid: boolean;
  showCollisionWireframes: boolean;
  showInertiaAndCoM: boolean;
  showJointAxesAndFrames: boolean;
  showWindVectors: boolean;
  showLightFrustums: boolean;
  wireframeMode: boolean;
  showLidarRays?: boolean;
  showContactPoints?: boolean;
}

export type TransformGizmoMode = 'select' | 'translate' | 'rotate' | 'scale';

export type TransformSpace = 'world' | 'local';

export type PrimitiveShapeType =
  | 'box'
  | 'sphere'
  | 'cone'
  | 'cylinder'
  | 'capsule'
  | 'ellipsoid';

export type LightSpawnType = 'point' | 'directional' | 'spot';

export type PlacementToolState =
  | { kind: 'primitive'; shape: PrimitiveShapeType }
  | { kind: 'light'; lightType: LightSpawnType }
  | { kind: 'paste'; sourceEntityId: number; sourceName: string }
  | null;

export interface TerminalHistoryEntry {
  id: string;
  command: string;
  cwd: string;
  output: string;
  isError?: boolean;
  timestamp: number;
}
