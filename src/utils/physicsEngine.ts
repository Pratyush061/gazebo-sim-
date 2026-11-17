import {
  ParsedWorld,
  Pose6D,
  SimCollision,
  SimGeometry,
  SimLink,
  SimModel,
} from '../types/simulation';
import {
  Mat4,
  invertRigidMatrix4,
  matrix4ToPose,
  multiplyMatrix4,
  poseToMatrix4,
} from './sdfCompiler';
import { buildWorldGzTopicsAndRos2Bridge } from './gzSystemsCatalog';

/**
 * Rodrigues' rotation matrix around unit axis [ax, ay, az] by angle `theta` (radians).
 */
export function axisAngleMatrix4(
  axis: [number, number, number],
  theta: number
): Mat4 {
  const mag = Math.hypot(axis[0], axis[1], axis[2]);
  if (mag < 1e-8 || Math.abs(theta) < 1e-9) {
    return [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
  }
  const ux = axis[0] / mag;
  const uy = axis[1] / mag;
  const uz = axis[2] / mag;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const t = 1 - c;

  return [
    t * ux * ux + c,      t * ux * uy - s * uz, t * ux * uz + s * uy, 0,
    t * ux * uy + s * uz, t * uy * uy + c,      t * uy * uz - s * ux, 0,
    t * ux * uz - s * uy, t * uy * uz + s * ux, t * uz * uz + c,      0,
    0,                    0,                    0,                    1,
  ];
}

export function translationMatrix4(dx: number, dy: number, dz: number): Mat4 {
  return [
    1, 0, 0, dx,
    0, 1, 0, dy,
    0, 0, 1, dz,
    0, 0, 0, 1,
  ];
}

/**
 * Transforms a 3D point [x, y, z] by a 4x4 homogeneous SE(3) matrix.
 */
export function transformPoint3D(
  m: Mat4,
  p: [number, number, number]
): [number, number, number] {
  const [x, y, z] = p;
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

/**
 * Converts Euler Roll-Pitch-Yaw (extrinsic X-Y-Z / intrinsic Z-Y-X) to a unit quaternion [x, y, z, w].
 */
export function eulerToQuaternion(
  roll: number,
  pitch: number,
  yaw: number
): [number, number, number, number] {
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);

  const qx = sr * cp * cy - cr * sp * sy;
  const qy = cr * sp * cy + sr * cp * sy;
  const qz = cr * cp * sy - sr * sp * cy;
  const qw = cr * cp * cy + sr * sp * sy;
  return [
    Number(qx.toFixed(5)),
    Number(qy.toFixed(5)),
    Number(qz.toFixed(5)),
    Number(qw.toFixed(5)),
  ];
}

/**
 * Computes the live model-space Pose6D for every link in a SimModel by propagating
 * joint rotations (revolute/continuous) and translations (prismatic) down the
 * parent -> child kinematic tree:
 *   M_child = M_parent * M_{parent -> J, 0} * M_motion(q) * M_{child -> J, 0}^{-1}
 */
export function computeModelLinkPoses(model: SimModel): Map<string, Pose6D> {
  const result = new Map<string, Pose6D>();
  if (model.links.length === 0) return result;

  if (model.joints.length === 0) {
    for (const lk of model.links) {
      result.set(lk.name, [...lk.pose]);
    }
    return result;
  }

  const restMatrixMap = new Map<string, Mat4>();
  for (const lk of model.links) {
    restMatrixMap.set(lk.name, poseToMatrix4(lk.pose));
  }

  const liveMatrixMap = new Map<string, Mat4>();
  const childrenByParent = new Map<string, typeof model.joints>();
  const hasIncomingFromModelLink = new Set<string>();

  for (const j of model.joints) {
    if (restMatrixMap.has(j.parent) && restMatrixMap.has(j.child)) {
      hasIncomingFromModelLink.add(j.child);
      const list = childrenByParent.get(j.parent) || [];
      list.push(j);
      childrenByParent.set(j.parent, list);
    }
  }

  const visited = new Set<string>();

  const traverseFrom = (linkName: string, currentMat: Mat4) => {
    if (visited.has(linkName)) return;
    visited.add(linkName);
    liveMatrixMap.set(linkName, currentMat);
    result.set(linkName, matrix4ToPose(currentMat));

    const parentRestMat =
      restMatrixMap.get(linkName) || poseToMatrix4([0, 0, 0, 0, 0, 0]);
    const parentRestInv = invertRigidMatrix4(parentRestMat);

    const outgoing = childrenByParent.get(linkName) || [];
    for (const joint of outgoing) {
      if (visited.has(joint.child)) continue;
      const childRestMat = restMatrixMap.get(joint.child);
      if (!childRestMat) continue;

      const childToJointMat = poseToMatrix4(joint.pose);
      const jointToChildMat = invertRigidMatrix4(childToJointMat);
      const jointRestMat = multiplyMatrix4(childRestMat, childToJointMat);
      const parentToJointMat = multiplyMatrix4(parentRestInv, jointRestMat);

      let motionMat: Mat4;
      if (joint.type === 'revolute' || joint.type === 'continuous') {
        motionMat = axisAngleMatrix4(joint.axis.xyz, joint.position);
      } else if (joint.type === 'prismatic') {
        const [ax, ay, az] = joint.axis.xyz;
        motionMat = translationMatrix4(
          ax * joint.position,
          ay * joint.position,
          az * joint.position
        );
      } else {
        motionMat = [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ];
      }

      const liveJointMat = multiplyMatrix4(
        multiplyMatrix4(currentMat, parentToJointMat),
        motionMat
      );
      const liveChildMat = multiplyMatrix4(liveJointMat, jointToChildMat);

      traverseFrom(joint.child, liveChildMat);
    }
  };

  for (const lk of model.links) {
    if (!hasIncomingFromModelLink.has(lk.name) && !visited.has(lk.name)) {
      const rootMat = restMatrixMap.get(lk.name)!;
      traverseFrom(lk.name, rootMat);
    }
  }

  for (const lk of model.links) {
    if (!result.has(lk.name)) {
      result.set(lk.name, [...lk.pose]);
    }
  }

  return result;
}

/**
 * Computes the world-space Pose6D for every link in a SimModel (composing model.pose with link model-space pose).
 */
export function computeModelLinkWorldPoses(model: SimModel): Map<string, Pose6D> {
  const modelMat = poseToMatrix4(model.pose);
  const localPoses = computeModelLinkPoses(model);
  const worldPoses = new Map<string, Pose6D>();
  for (const [linkName, localPose] of localPoses.entries()) {
    const worldMat = multiplyMatrix4(modelMat, poseToMatrix4(localPose));
    worldPoses.set(linkName, matrix4ToPose(worldMat));
  }
  return worldPoses;
}

/**
 * Generates exact 3D analytical and polyhedral contact points in world space for a given SimGeometry.
 * Uses analytical nadir calculation for spheres, capsules, and cylinders so spinning wheels
 * are 100% invariant to joint rotation angle and never bob or shiver on polygon facets.
 */
function sampleShapeLocalContactPoints(
  geom: SimGeometry,
  shapeWorldMat: Mat4
): [number, number, number][] {
  if (geom.type === 'plane') return [];

  if (geom.type === 'box') {
    const [sx, sy, sz] = geom.size || [0.5, 0.5, 0.5];
    const hx = sx * 0.5;
    const hy = sy * 0.5;
    const hz = sz * 0.5;
    return [
      [-hx, -hy, -hz],
      [-hx, -hy,  hz],
      [-hx,  hy, -hz],
      [-hx,  hy,  hz],
      [ hx, -hy, -hz],
      [ hx, -hy,  hz],
      [ hx,  hy, -hz],
      [ hx,  hy,  hz],
    ].map((pt) => transformPoint3D(shapeWorldMat, pt as [number, number, number]));
  }

  if (geom.type === 'sphere') {
    const r = geom.radius || 0.25;
    const cx = shapeWorldMat[3];
    const cy = shapeWorldMat[7];
    const cz = shapeWorldMat[11];
    // A sphere's lowest point on a horizontal ground plane is always its exact nadir [cx, cy, cz - r]
    return [[cx, cy, cz - r]];
  }

  if (geom.type === 'cylinder') {
    const r = geom.radius || 0.2;
    const hz = (geom.length || 0.5) * 0.5;
    const cx = shapeWorldMat[3];
    const cy = shapeWorldMat[7];
    const cz = shapeWorldMat[11];

    // Orthonormal basis of the cylinder in world space: u = local X, v = local Y, w = local Z (cylinder axis)
    const ux = shapeWorldMat[0], uy = shapeWorldMat[4], uz = shapeWorldMat[8];
    const vx = shapeWorldMat[1], vy = shapeWorldMat[5], vz = shapeWorldMat[9];
    const wx = shapeWorldMat[2], wy = shapeWorldMat[6], wz = shapeWorldMat[10];

    const radialDownMag = Math.hypot(uz, vz);
    const pts: [number, number, number][] = [];

    if (radialDownMag > 1e-4) {
      // Exact unit vector in the cylinder's circular cross-section pointing steepest downward (-Z)
      const dx = (-uz * ux - vz * vx) / radialDownMag;
      const dy = (-uz * uy - vz * vy) / radialDownMag;
      const dz = (-uz * uz - vz * vz) / radialDownMag;

      // Orthogonal tangent vector in the circular disk: s = w x d
      const sx = wy * dz - wz * dy;
      const sy = wz * dx - wx * dz;
      const sz = wx * dy - wy * dx;

      // Snap tiny 1.5708 vs pi/2 rounding (~3.67e-6) when cylinder is horizontal so wheel rims sit flat
      const effWz = Math.abs(wz) < 1e-3 ? 0 : wz;

      // Always include the exact analytical nadir points on both rims (alpha = 0) and zenith (alpha = PI),
      // plus 8 samples around the rim so tilted/sideways cylinder impacts are exact
      const angles = [
        0,
        Math.PI / 6,
        -Math.PI / 6,
        Math.PI / 3,
        -Math.PI / 3,
        Math.PI / 2,
        -Math.PI / 2,
        Math.PI,
      ];
      for (const ang of angles) {
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const rx = r * (ca * dx + sa * sx);
        const ry = r * (ca * dy + sa * sy);
        const rz = r * (ca * dz + sa * sz);

        pts.push([
          cx + hz * wx + rx,
          cy + hz * wy + ry,
          cz + hz * effWz + rz,
        ]);
        pts.push([
          cx - hz * wx + rx,
          cy - hz * wy + ry,
          cz - hz * effWz + rz,
        ]);
      }
    } else {
      // Cylinder axis w is vertical (|wz| ~ 1): sample 8 points around top and bottom circular faces
      for (let i = 0; i < 8; i++) {
        const ang = (i * 2 * Math.PI) / 8;
        const lx = r * Math.cos(ang);
        const ly = r * Math.sin(ang);
        pts.push(transformPoint3D(shapeWorldMat, [lx, ly, -hz]));
        pts.push(transformPoint3D(shapeWorldMat, [lx, ly, hz]));
      }
    }
    return pts;
  }

  if (geom.type === 'capsule') {
    const r = geom.radius || 0.15;
    const hz = (geom.length || 0.4) * 0.5;
    const topCenter = transformPoint3D(shapeWorldMat, [0, 0, hz]);
    const botCenter = transformPoint3D(shapeWorldMat, [0, 0, -hz]);
    return [
      [topCenter[0], topCenter[1], topCenter[2] - r],
      [botCenter[0], botCenter[1], botCenter[2] - r],
    ];
  }

  if (geom.type === 'cone') {
    const r = geom.radius || 0.25;
    const hz = (geom.length || 0.6) * 0.5;
    const pts: [number, number, number][] = [
      transformPoint3D(shapeWorldMat, [0, 0, hz]), // apex
    ];
    const numSamples = 12;
    for (let i = 0; i < numSamples; i++) {
      const ang = (i * 2 * Math.PI) / numSamples;
      pts.push(transformPoint3D(shapeWorldMat, [r * Math.cos(ang), r * Math.sin(ang), -hz]));
    }
    return pts;
  }

  if (geom.type === 'ellipsoid') {
    const [rx, ry, rz] = geom.radii || [0.35, 0.25, 0.2];
    const pts: [number, number, number][] = [
      [rx, 0, 0],
      [-rx, 0, 0],
      [0, ry, 0],
      [0, -ry, 0],
      [0, 0, rz],
      [0, 0, -rz],
    ];
    for (const sx of [-0.57735, 0.57735]) {
      for (const sy of [-0.57735, 0.57735]) {
        for (const sz of [-0.57735, 0.57735]) {
          pts.push([sx * rx, sy * ry, sz * rz]);
        }
      }
    }
    return pts.map((pt) => transformPoint3D(shapeWorldMat, pt));
  }

  return [];
}

/**
 * Computes all 3D world-space contact candidate points across all links of a SimModel
 * at its current `model.pose` and joint positions.
 * Per official Gazebo / SDFormat physics rules, `<collision>` elements define the physical
 * contact geometry (falling back to `<visual>` only if a model has zero `<collision>` elements).
 */
export function computeModelWorldContactPoints(model: SimModel): {
  allPoints: [number, number, number][];
  minZ: number;
  lowestPoints: [number, number, number][];
} {
  const modelMat = poseToMatrix4(model.pose);
  const linkPoses = computeModelLinkPoses(model);
  const allPoints: [number, number, number][] = [];
  let minZ = Infinity;

  const modelHasAnyCollisions = model.links.some((l) => l.collisions.length > 0);

  for (const link of model.links) {
    const linkLocalPose = linkPoses.get(link.name) || link.pose;
    const linkWorldMat = multiplyMatrix4(modelMat, poseToMatrix4(linkLocalPose));

    const shapesToSample: { pose: Pose6D; geometry: SimGeometry }[] =
      modelHasAnyCollisions ? link.collisions : link.visuals;

    for (const item of shapesToSample) {
      if (item.geometry.type === 'plane') continue;
      const shapeWorldMat = multiplyMatrix4(linkWorldMat, poseToMatrix4(item.pose));
      const pts = sampleShapeLocalContactPoints(item.geometry, shapeWorldMat);
      for (const pt of pts) {
        allPoints.push(pt);
        if (pt[2] < minZ) {
          minZ = pt[2];
        }
      }
    }
  }

  if (!Number.isFinite(minZ)) {
    return { allPoints: [], minZ: model.pose[2], lowestPoints: [] };
  }

  // Contact manifold: points within 8 mm (0.008 m) of the lowest contact point
  const contactThreshold = minZ + 0.008;
  const lowestPoints = allPoints.filter((pt) => pt[2] <= contactThreshold);

  return { allPoints, minZ, lowestPoints };
}

/**
 * Computes the composite mass, 3D world-space Center of Mass (CoM), model-local CoM,
 * and parallel-axis rotational inertia tensor (Ixx, Iyy, Izz) for a single-body or articulated multi-body model.
 */
export function computeModelCompositeInertial(model: SimModel): {
  totalMass: number;
  comWorld: [number, number, number];
  comLocal: [number, number, number];
  ixx: number;
  iyy: number;
  izz: number;
} {
  const modelMat = poseToMatrix4(model.pose);
  const linkPoses = computeModelLinkPoses(model);

  let totalMass = 0;
  let sumLocalMx = 0;
  let sumLocalMy = 0;
  let sumLocalMz = 0;

  const linkComs: {
    mass: number;
    comLocal: [number, number, number];
    comWorld: [number, number, number];
    ixx: number;
    iyy: number;
    izz: number;
  }[] = [];

  for (const link of model.links) {
    // Skip virtual massless frames (e.g. base_footprint) when summing physical inertia
    if (
      link.collisions.length === 0 &&
      link.visuals.length === 0 &&
      link.inertial.mass <= 0.005
    ) {
      continue;
    }
    const m = Math.max(0.01, link.inertial.mass);
    const linkLocalPose = linkPoses.get(link.name) || link.pose;
    const linkLocalMat = poseToMatrix4(linkLocalPose);
    const comLocal = transformPoint3D(linkLocalMat, [
      link.inertial.pose[0],
      link.inertial.pose[1],
      link.inertial.pose[2],
    ]);
    const comWorld = transformPoint3D(modelMat, comLocal);

    totalMass += m;
    sumLocalMx += m * comLocal[0];
    sumLocalMy += m * comLocal[1];
    sumLocalMz += m * comLocal[2];

    linkComs.push({
      mass: m,
      comLocal,
      comWorld,
      ixx: Math.max(0.005, link.inertial.inertia.ixx),
      iyy: Math.max(0.005, link.inertial.inertia.iyy),
      izz: Math.max(0.005, link.inertial.inertia.izz),
    });
  }

  if (totalMass <= 1e-5) {
    return {
      totalMass: 1.0,
      comLocal: [0, 0, 0],
      comWorld: [model.pose[0], model.pose[1], model.pose[2]],
      ixx: 0.1,
      iyy: 0.1,
      izz: 0.1,
    };
  }

  const comLocal: [number, number, number] = [
    sumLocalMx / totalMass,
    sumLocalMy / totalMass,
    sumLocalMz / totalMass,
  ];
  const comWorld = transformPoint3D(modelMat, comLocal);

  let ixx = 0;
  let iyy = 0;
  let izz = 0;

  // Parallel-axis theorem in the model frame: I_total = sum(I_i + m_i * ((r_i . r_i) I - r_i (x) r_i))
  for (const item of linkComs) {
    const dx = item.comLocal[0] - comLocal[0];
    const dy = item.comLocal[1] - comLocal[1];
    const dz = item.comLocal[2] - comLocal[2];
    ixx += item.ixx + item.mass * (dy * dy + dz * dz);
    iyy += item.iyy + item.mass * (dx * dx + dz * dz);
    izz += item.izz + item.mass * (dx * dx + dy * dy);
  }

  return {
    totalMass,
    comWorld,
    comLocal,
    ixx: Math.max(0.02, ixx),
    iyy: Math.max(0.02, iyy),
    izz: Math.max(0.02, izz),
  };
}

/**
 * Computes approximate bounding half-height (distance from link origin down to lowest point of link geometry
 * in Gazebo Z-up coordinates) for upright ground offset estimation.
 */
export function getLinkVerticalHalfExtent(link: SimLink): number {
  const sourceList = link.collisions.length > 0 ? link.collisions : link.visuals;
  if (sourceList.length === 0) return 0;

  let maxBottomOffset = -Infinity;
  for (const item of sourceList) {
    const g = item.geometry;
    const localZ = item.pose[2];
    let extent = 0.2;
    if (g.type === 'plane') {
      extent = 0;
    } else if (g.type === 'box' && g.size) {
      extent = g.size[2] * 0.5;
    } else if (g.type === 'sphere' && g.radius) {
      extent = g.radius;
    } else if ((g.type === 'cylinder' || g.type === 'cone') && g.length && g.radius) {
      const roll = Math.abs(link.pose[3] + item.pose[3]);
      const pitch = Math.abs(link.pose[4] + item.pose[4]);
      const isWheelOrientation =
        Math.abs(roll - Math.PI / 2) < 0.4 || Math.abs(pitch - Math.PI / 2) < 0.4;
      extent = isWheelOrientation ? g.radius : g.length * 0.5;
    } else if (g.type === 'capsule' && g.length && g.radius) {
      const roll = Math.abs(link.pose[3] + item.pose[3]);
      const pitch = Math.abs(link.pose[4] + item.pose[4]);
      const isHorizontal =
        Math.abs(roll - Math.PI / 2) < 0.4 || Math.abs(pitch - Math.PI / 2) < 0.4;
      extent = isHorizontal ? g.radius : g.length * 0.5 + g.radius;
    } else if (g.type === 'ellipsoid' && g.radii) {
      extent = g.radii[2];
    }
    maxBottomOffset = Math.max(maxBottomOffset, extent - localZ);
  }
  return Number.isFinite(maxBottomOffset) ? maxBottomOffset : 0.2;
}

/**
 * Computes the upright resting model.pose[2] height for any single-link or multi-link model
 * so its lowest collision point sits flush on the ground plane (z = 0) when roll=0, pitch=0.
 */
export function getModelVerticalGroundOffset(model: SimModel): number {
  const savedPose: Pose6D = [...model.pose];
  model.pose = [0, 0, 0, 0, 0, 0];
  const { minZ } = computeModelWorldContactPoints(model);
  model.pose = savedPose;
  if (!Number.isFinite(minZ)) return 0;
  return Math.max(0, Number((-minZ).toFixed(4)));
}

/**
 * Computes aerodynamic cross-sectional area estimate for wind drag calculation.
 */
export function getLinkCrossSectionArea(link: SimLink): number {
  const sourceList = link.collisions.length > 0 ? link.collisions : link.visuals;
  if (sourceList.length === 0) return 0.25;
  const g = sourceList[0].geometry;
  if (g.type === 'sphere' && g.radius) {
    return Math.PI * g.radius * g.radius;
  }
  if (g.type === 'box' && g.size) {
    return g.size[0] * g.size[2];
  }
  if (g.type === 'cylinder' && g.radius && g.length) {
    return 2 * g.radius * g.length;
  }
  return 0.35;
}

/**
 * Normalizes an angle in radians to the interval [-PI, PI].
 */
function wrapAnglePi(angle: number): number {
  let a = (angle + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/**
 * Simulates live Gazebo Harmonic sensor systems (`gpu_lidar`, `imu`, `contact`) on all models.
 */
function updateWorldSensors(world: ParsedWorld): void {
  const obstacles: {
    modelId: string;
    cx: number;
    cy: number;
    zMin: number;
    zMax: number;
    radius: number;
  }[] = [];

  for (const m of world.models) {
    if (m.name === 'ground_plane') continue;
    for (const lk of m.links) {
      const wp = lk.worldPosition || [
        m.pose[0] + lk.pose[0],
        m.pose[1] + lk.pose[1],
        m.pose[2] + lk.pose[2],
      ];
      for (const item of lk.collisions.length > 0 ? lk.collisions : lk.visuals) {
        const g = item.geometry;
        if (g.type === 'plane') continue;
        let r = 0.25;
        let hz = 0.25;
        if (g.type === 'box' && g.size) {
          r = Math.hypot(g.size[0] * 0.5, g.size[1] * 0.5);
          hz = g.size[2] * 0.5;
        } else if (g.type === 'sphere' && g.radius) {
          r = g.radius;
          hz = g.radius;
        } else if (
          (g.type === 'cylinder' || g.type === 'cone' || g.type === 'capsule') &&
          g.radius
        ) {
          r = g.radius;
          hz = (g.length || 0.4) * 0.5;
        } else if (g.type === 'ellipsoid' && g.radii) {
          r = Math.max(g.radii[0], g.radii[1]);
          hz = g.radii[2];
        }
        obstacles.push({
          modelId: m.id,
          cx: wp[0] + item.pose[0],
          cy: wp[1] + item.pose[1],
          zMin: wp[2] + item.pose[2] - hz,
          zMax: wp[2] + item.pose[2] + hz,
          radius: r,
        });
      }
    }
  }

  for (const model of world.models) {
    if (model.name === 'ground_plane') continue;
    for (const link of model.links) {
      if (!link.sensors || link.sensors.length === 0) continue;
      const lPos = link.worldPosition || [
        model.pose[0] + link.pose[0],
        model.pose[1] + link.pose[1],
        model.pose[2] + link.pose[2],
      ];
      const lRot = link.worldRotation || [
        model.pose[3] + link.pose[3],
        model.pose[4] + link.pose[4],
        model.pose[5] + link.pose[5],
      ];

      for (const sensor of link.sensors) {
        if (sensor.type === 'gpu_lidar' && sensor.lidar) {
          const { horizontalSamples, minAngle, maxAngle, minRange, maxRange } =
            sensor.lidar;
          const sx = lPos[0] + sensor.pose[0];
          const sy = lPos[1] + sensor.pose[1];
          const sz = lPos[2] + sensor.pose[2];
          const baseYaw = lRot[2] + sensor.pose[5];
          const basePitch = lRot[1] + sensor.pose[4];

          const ranges: number[] = [];
          for (let i = 0; i < horizontalSamples; i++) {
            const frac =
              horizontalSamples > 1 ? i / (horizontalSamples - 1) : 0;
            const localYaw = minAngle + frac * (maxAngle - minAngle);
            const rayYaw = baseYaw + localYaw;
            const dx = Math.cos(rayYaw) * Math.cos(basePitch);
            const dy = Math.sin(rayYaw) * Math.cos(basePitch);
            const dz = -Math.sin(basePitch);

            let bestDist = maxRange;

            if (dz < -1e-4 && sz > 0) {
              const tGround = -sz / dz;
              if (tGround >= minRange && tGround < bestDist) {
                bestDist = tGround;
              }
            }

            for (const obs of obstacles) {
              if (obs.modelId === model.id) continue;
              const ocx = obs.cx - sx;
              const ocy = obs.cy - sy;
              const proj = ocx * dx + ocy * dy;
              if (proj <= 0) continue;
              const perpSq = ocx * ocx + ocy * ocy - proj * proj;
              const rSq = obs.radius * obs.radius;
              if (perpSq <= rSq) {
                const hitDist = proj - Math.sqrt(rSq - perpSq);
                if (hitDist >= minRange && hitDist < bestDist) {
                  const hitZ = sz + dz * hitDist;
                  if (hitZ >= obs.zMin - 0.1 && hitZ <= obs.zMax + 0.1) {
                    bestDist = hitDist;
                  }
                }
              }
            }

            ranges.push(Number(bestDist.toFixed(3)));
          }
          sensor.lidar.ranges = ranges;
        } else if (sensor.type === 'imu' && sensor.imu) {
          sensor.imu.orientation = eulerToQuaternion(
            lRot[0],
            lRot[1],
            lRot[2]
          );
          sensor.imu.angularVelocity = [
            Number(model.angularVelocity[0].toFixed(4)),
            Number(model.angularVelocity[1].toFixed(4)),
            Number(model.angularVelocity[2].toFixed(4)),
          ];
          const roll = lRot[0];
          const pitch = lRot[1];
          const gReactionX = -Math.sin(pitch) * Math.abs(world.gravity[2]);
          const gReactionY =
            Math.sin(roll) * Math.cos(pitch) * Math.abs(world.gravity[2]);
          const gReactionZ =
            Math.cos(roll) * Math.cos(pitch) * Math.abs(world.gravity[2]);
          sensor.imu.linearAcceleration = [
            Number(gReactionX.toFixed(3)),
            Number(gReactionY.toFixed(3)),
            Number(gReactionZ.toFixed(3)),
          ];
        } else if (sensor.type === 'contact' && sensor.contact) {
          const pts = model.activeContactPoints || [];
          const touching = pts.length > 0 && pts.some((p) => p[2] <= 0.02);
          const { totalMass } = computeModelCompositeInertial(model);
          sensor.contact.touching = touching;
          sensor.contact.contactCount = touching ? pts.length : 0;
          sensor.contact.normalForce = touching
            ? Number((totalMass * Math.abs(world.gravity[2])).toFixed(2))
            : 0;
          sensor.contact.contactPoints = pts.slice(0, 8);
        }
      }
    }
  }
}

/**
 * Computes the 2D convex hull of ground contact offsets `{(rFwd, rLat)}` relative to the
 * horizontal projection of the Center of Mass `(0, 0)`, checks whether `(0, 0)` lies strictly
 * inside the 2D support polygon with stability margin >= 4 mm, and returns the exact closest
 * pivot point `(rPivotFwd, rPivotLat)` on the support polygon when `(0, 0)` is outside.
 */
function analyze2DSupportPolygon(offsets: { rFwd: number; rLat: number }[]): {
  comInsidePolygon: boolean;
  rPivotFwd: number;
  rPivotLat: number;
} {
  if (offsets.length === 0) {
    return { comInsidePolygon: false, rPivotFwd: 0, rPivotLat: 0 };
  }

  // Deduplicate points within 1 mm and sort lexicographically by (rFwd, rLat)
  const sorted = [...offsets].sort((a, b) =>
    Math.abs(a.rFwd - b.rFwd) > 1e-4 ? a.rFwd - b.rFwd : a.rLat - b.rLat
  );
  const unique: { rFwd: number; rLat: number }[] = [];
  for (const pt of sorted) {
    const last = unique[unique.length - 1];
    if (!last || Math.hypot(pt.rFwd - last.rFwd, pt.rLat - last.rLat) > 1e-3) {
      unique.push(pt);
    }
  }

  if (unique.length === 1) {
    return {
      comInsidePolygon: false,
      rPivotFwd: unique[0].rFwd,
      rPivotLat: unique[0].rLat,
    };
  }

  const cross = (
    o: { rFwd: number; rLat: number },
    a: { rFwd: number; rLat: number },
    b: { rFwd: number; rLat: number }
  ) => (a.rFwd - o.rFwd) * (b.rLat - o.rLat) - (a.rLat - o.rLat) * (b.rFwd - o.rFwd);

  const lower: { rFwd: number; rLat: number }[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-7) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: { rFwd: number; rLat: number }[] = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-7) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);

  const closestOnSegment = (
    a: { rFwd: number; rLat: number },
    b: { rFwd: number; rLat: number }
  ) => {
    const ex = b.rFwd - a.rFwd;
    const ey = b.rLat - a.rLat;
    const lenSq = ex * ex + ey * ey;
    if (lenSq < 1e-8) return { rFwd: a.rFwd, rLat: a.rLat };
    const t = Math.max(0, Math.min(1, -(a.rFwd * ex + a.rLat * ey) / lenSq));
    return { rFwd: a.rFwd + t * ex, rLat: a.rLat + t * ey };
  };

  if (hull.length <= 2) {
    const segPt =
      hull.length === 2 ? closestOnSegment(hull[0], hull[1]) : unique[0];
    return {
      comInsidePolygon: false,
      rPivotFwd: segPt.rFwd,
      rPivotLat: segPt.rLat,
    };
  }

  // Check signed inward distance of origin (0, 0) to every CCW hull edge a -> b
  let minInwardDist = Infinity;
  let bestPivot = { rFwd: hull[0].rFwd, rLat: hull[0].rLat };
  let bestDistSq = Infinity;

  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b.rFwd - a.rFwd;
    const ey = b.rLat - a.rLat;
    const len = Math.hypot(ex, ey);
    if (len < 1e-5) continue;

    // For CCW hull, cross(a, b, origin) = ex * (-a.rLat) - ey * (-a.rFwd) = a.rFwd * ey - a.rLat * ex > 0 when origin is strictly inside
    const inwardDist = (a.rFwd * ey - a.rLat * ex) / len;
    if (inwardDist < minInwardDist) {
      minInwardDist = inwardDist;
    }

    // Track closest point on boundary edges that the origin is outside of (or within 4mm margin of)
    if (inwardDist < 0.004) {
      const segPt = closestOnSegment(a, b);
      const dSq = segPt.rFwd * segPt.rFwd + segPt.rLat * segPt.rLat;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestPivot = segPt;
      }
    }
  }

  // Also check total 2D polygon area so collinear 3-point strips don't count as 2D polygons
  let doubleArea = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    doubleArea += a.rFwd * b.rLat - b.rFwd * a.rLat;
  }

  if (minInwardDist >= 0.004 && Math.abs(doubleArea) >= 0.001) {
    return { comInsidePolygon: true, rPivotFwd: 0, rPivotLat: 0 };
  }

  return {
    comInsidePolygon: false,
    rPivotFwd: bestPivot.rFwd,
    rPivotLat: bestPivot.rLat,
  };
}

/**
 * Advances the Gazebo Harmonic world physics by `dt` seconds using multi-substep
 * rigid-body & articulated multi-body contact mechanics:
 * - Analytical 3D wheel cylinder rim, sphere nadir, capsule, and OBB vertex contact manifold at z = 0
 * - Strict non-penetration projection (no model or wheel ever sinks below z = 0)
 * - Support-Polygon Pivot Mechanics & Impulse-Momentum Contact Solver:
 *   * When CoM projection lies strictly inside the active ground contact support span [r_min, r_max],
 *     normal reactions balance statically (zero shivering at spawn or rest on any stable face/side/roof).
 *   * When tilted so only one wheel/edge contacts the ground (or CoM overhangs the contact pivot),
 *     exact gravitational pivot acceleration alpha = (M * g * r_pivot) / (I_CoM + M * r_pivot^2)
 *     either rights the model onto its wheels (when CoM is inboard of the wheel) or tips it onto
 *     its side/roof (when tilted past the critical tipping angle).
 * - Aerodynamic wind drag F_w = 0.5 * rho * C_d * A * |v_wind - v| * (v_wind - v) and wind overturning moment
 * - Articulated joint PID position / velocity / effort actuation, gravity torque & damping
 * - Differential drive / Twist `cmd_vel` mobile robot kinematics
 */
export function stepPhysicsWorld(
  world: ParsedWorld,
  dt: number,
  draggedEntityId?: number | null
): void {
  const totalDt = Math.min(Math.max(dt, 0.0005), 0.05);
  const numSubSteps = Math.max(1, Math.min(8, Math.ceil(totalDt / 0.004)));
  const subDt = totalDt / numSubSteps;

  const [gx, gy, gz] = world.gravity;
  const [wx, wy, wz] = world.wind.enabled ? world.wind.linearVelocity : [0, 0, 0];
  const airDensity = 1.225; // kg/m^3
  const dragCoeff = 1.05;

  for (let step = 0; step < numSubSteps; step++) {
    for (const model of world.models) {
      if (model.isStatic || model.name === 'ground_plane') {
        continue;
      }

      // If user is actively dragging this model (or one of its links) with the 3D Transform Gizmo,
      // freeze its velocity and skip gravity/wind integration so translation & rotation are 100% smooth
      if (
        draggedEntityId !== undefined &&
        draggedEntityId !== null &&
        (model.entityId === draggedEntityId ||
          model.links.some((l) => l.entityId === draggedEntityId))
      ) {
        model.linearVelocity = [0, 0, 0];
        model.angularVelocity = [0, 0, 0];
        model.links.forEach((l) => {
          l.linearVelocity = [0, 0, 0];
          l.angularVelocity = [0, 0, 0];
        });
        const { lowestPoints } = computeModelWorldContactPoints(model);
        model.activeContactPoints = lowestPoints;
        continue;
      }

      const isArticulatedRobot = model.joints.length > 0;
      const rootLink =
        model.links.find((l) => l.name === model.canonicalLink) || model.links[0];
      if (!rootLink) continue;

      // 1. Mobile robot differential drive / cmd_vel integration (only drives when upright on wheels)
      const isUpright =
        Math.abs(model.pose[3]) < 0.75 && Math.abs(model.pose[4]) < 0.75;
      const hasCmdVel =
        isUpright &&
        (Math.abs(model.cmdVel.linearX) > 1e-4 ||
          Math.abs(model.cmdVel.linearY) > 1e-4 ||
          Math.abs(model.cmdVel.angularZ) > 1e-4);

      const diffDrivePlugin = model.plugins?.find(
        (p) => p.filename.includes('diff-drive') || p.name.includes('DiffDrive')
      );
      const wheelRadius = Number(diffDrivePlugin?.parameters?.wheel_radius) || 0.16;
      const wheelSep = Number(diffDrivePlugin?.parameters?.wheel_separation) || 0.54;

      if (hasCmdVel) {
        const yaw = model.pose[5];
        const vx =
          model.cmdVel.linearX * Math.cos(yaw) -
          model.cmdVel.linearY * Math.sin(yaw);
        const vy =
          model.cmdVel.linearX * Math.sin(yaw) +
          model.cmdVel.linearY * Math.cos(yaw);

        model.linearVelocity[0] = vx;
        model.linearVelocity[1] = vy;
        model.angularVelocity[2] = model.cmdVel.angularZ;

        model.pose[0] += vx * subDt;
        model.pose[1] += vy * subDt;
        model.pose[5] = wrapAnglePi(model.pose[5] + model.cmdVel.angularZ * subDt);

        for (const joint of model.joints) {
          if (joint.name.toLowerCase().includes('wheel')) {
            const isLeft = joint.name.toLowerCase().includes('left');
            const isRight = joint.name.toLowerCase().includes('right');
            const wheelDiff = isLeft
              ? -model.cmdVel.angularZ * (wheelSep * 0.5)
              : isRight
              ? model.cmdVel.angularZ * (wheelSep * 0.5)
              : 0;
            const wheelOmega =
              (model.cmdVel.linearX + wheelDiff) / Math.max(0.04, wheelRadius);
            joint.velocity = wheelOmega;
            joint.position += wheelOmega * subDt;
            joint.targetPosition = joint.position;
          }
        }
      } else if (isArticulatedRobot) {
        model.linearVelocity[0] *= Math.exp(-6 * subDt);
        model.linearVelocity[1] *= Math.exp(-6 * subDt);
        model.angularVelocity[2] *= Math.exp(-8 * subDt);
        model.pose[0] += model.linearVelocity[0] * subDt;
        model.pose[1] += model.linearVelocity[1] * subDt;
        model.pose[5] = wrapAnglePi(model.pose[5] + model.angularVelocity[2] * subDt);
      }

      // 2. Articulated Joint Dynamics (PID Position, Velocity, or Effort control with gravity torque)
      for (const joint of model.joints) {
        if (joint.type === 'fixed') continue;
        if (hasCmdVel && joint.name.toLowerCase().includes('wheel')) continue;

        const { lower, upper, effort, velocity: maxVel, damping, friction } =
          joint.axis;

        if (joint.controlMode === 'position') {
          const posError = joint.targetPosition - joint.position;
          const kp = 14.0;
          const desiredVel = Math.max(-maxVel, Math.min(maxVel, posError * kp));
          joint.velocity += (desiredVel - joint.velocity) * Math.min(1, 18 * subDt);
        } else if (joint.controlMode === 'velocity') {
          const targetV = Math.max(-maxVel, Math.min(maxVel, joint.targetVelocity));
          joint.velocity += (targetV - joint.velocity) * Math.min(1, 12 * subDt);
        } else if (joint.controlMode === 'effort') {
          const clampedEffort = Math.max(
            -effort,
            Math.min(effort, joint.appliedEffort)
          );
          const childLink = model.links.find((l) => l.name === joint.child);
          const childMass = childLink ? Math.max(0.05, childLink.inertial.mass) : 1.0;
          const rx = childLink ? childLink.inertial.pose[0] - joint.pose[0] : 0;
          const ry = childLink ? childLink.inertial.pose[1] - joint.pose[1] : 0;
          const rz = childLink ? childLink.inertial.pose[2] - joint.pose[2] : -0.2;
          const comOffset = Math.hypot(rx, ry, rz) || 0.2;
          const baseInertia = childLink
            ? Math.max(
                0.02,
                childLink.inertial.inertia.izz + childLink.inertial.inertia.iyy
              )
            : 0.15;
          const effInertia = baseInertia + childMass * comOffset * comOffset;

          let gravityTorque = 0;
          if (joint.type === 'revolute' || joint.type === 'continuous') {
            const cq = Math.cos(joint.position);
            const sq = Math.sin(joint.position);
            const [ax, ay] = joint.axis.xyz;
            const leverX = rx * cq + rz * sq;
            const tauY = -childMass * gz * leverX;
            const leverY = ry * cq - rz * sq;
            const tauX = childMass * gz * leverY;
            gravityTorque = ax * tauX + ay * tauY;
          }

          const coulombFriction =
            Math.abs(joint.velocity) > 1e-3
              ? Math.sign(joint.velocity) * (friction || 0.02)
              : 0;

          const netTorque =
            clampedEffort +
            gravityTorque -
            damping * joint.velocity -
            coulombFriction;
          const accel = netTorque / effInertia;
          joint.velocity = Math.max(
            -maxVel,
            Math.min(maxVel, joint.velocity + accel * subDt)
          );
        }

        joint.position += joint.velocity * subDt;

        if (joint.type === 'revolute' || joint.type === 'prismatic') {
          if (joint.position < lower) {
            joint.position = lower;
            joint.velocity = 0;
          } else if (joint.position > upper) {
            joint.position = upper;
            joint.velocity = 0;
          }
        }
      }

      // 3. 3D Rigid & Multi-Body Gravity, Wind, and Support-Polygon Ground Contact Mechanics
      const composite = computeModelCompositeInertial(model);
      const mass = composite.totalMass;

      // Aerodynamic wind drag force & overturning moment
      let windForceX = 0;
      let windForceY = 0;
      let windForceZ = 0;
      if (model.enableWind || model.links.some((l) => l.enableWind)) {
        const relVx = wx - model.linearVelocity[0];
        const relVy = wy - model.linearVelocity[1];
        const relVz = wz - model.linearVelocity[2];
        const relSpeed = Math.hypot(relVx, relVy, relVz);
        const area = getLinkCrossSectionArea(rootLink);
        const factor = 0.5 * airDensity * dragCoeff * area * relSpeed;
        windForceX = factor * relVx;
        windForceY = factor * relVy;
        windForceZ = factor * relVz;
      }

      if (!isArticulatedRobot || (windForceX !== 0 || windForceY !== 0)) {
        const totalFx = (!isArticulatedRobot ? mass * gx : 0) + windForceX + rootLink.appliedForce[0];
        const totalFy = (!isArticulatedRobot ? mass * gy : 0) + windForceY + rootLink.appliedForce[1];
        model.linearVelocity[0] += (totalFx / mass) * subDt;
        model.linearVelocity[1] += (totalFy / mass) * subDt;
        if (!isArticulatedRobot) {
          model.pose[0] += model.linearVelocity[0] * subDt;
          model.pose[1] += model.linearVelocity[1] * subDt;
        }
      }

      // Check current ground contact before integrating downward gravity so resting models don't micro-fall
      const preCheck = computeModelWorldContactPoints(model);
      const isRestingOnGround =
        Math.abs(preCheck.minZ) <= 0.0015 &&
        Math.abs(model.linearVelocity[2]) < 0.02 &&
        Math.abs(model.angularVelocity[0]) < 0.02 &&
        Math.abs(model.angularVelocity[1]) < 0.02;

      if (!isRestingOnGround || windForceZ + rootLink.appliedForce[2] > 0) {
        const totalFz = mass * gz + windForceZ + rootLink.appliedForce[2];
        model.linearVelocity[2] += (totalFz / mass) * subDt;
        model.pose[2] += model.linearVelocity[2] * subDt;
      } else {
        model.linearVelocity[2] = 0;
        if (Math.abs(preCheck.minZ) > 1e-6) {
          model.pose[2] += -preCheck.minZ;
        }
      }

      // Integrate angular velocity (roll & pitch) around the model's Center of Mass
      if (
        Math.abs(model.angularVelocity[0]) > 1e-6 ||
        Math.abs(model.angularVelocity[1]) > 1e-6
      ) {
        const comBefore = computeModelCompositeInertial(model);
        const targetComWorld: [number, number, number] = [...comBefore.comWorld];

        // Gyroscopic Euler coupling term: -(I_zz - I_yy) * wy * wz, etc.
        const wxVel = model.angularVelocity[0];
        const wyVel = model.angularVelocity[1];
        const wzVel = model.angularVelocity[2];
        const gyroRoll =
          -((comBefore.izz - comBefore.iyy) * wyVel * wzVel) / comBefore.ixx;
        const gyroPitch =
          -((comBefore.ixx - comBefore.izz) * wzVel * wxVel) / comBefore.iyy;

        model.angularVelocity[0] += gyroRoll * subDt;
        model.angularVelocity[1] += gyroPitch * subDt;

        model.pose[3] = wrapAnglePi(
          model.pose[3] + model.angularVelocity[0] * subDt
        );
        model.pose[4] = wrapAnglePi(
          model.pose[4] + model.angularVelocity[1] * subDt
        );

        // Keep CoM world XY position consistent during rotation, and if in ground contact,
        // keep the pivoting wheel/edge planted on the ground (z = 0) instead of lifting the pivot into mid-air
        const newMat = poseToMatrix4([
          0,
          0,
          0,
          model.pose[3],
          model.pose[4],
          model.pose[5],
        ]);
        const rotatedComOffset = transformPoint3D(newMat, comBefore.comLocal);
        model.pose[0] = targetComWorld[0] - rotatedComOffset[0];
        model.pose[1] = targetComWorld[1] - rotatedComOffset[1];
        model.pose[2] = targetComWorld[2] - rotatedComOffset[2];

        if (preCheck.minZ <= 0.003 && model.linearVelocity[2] <= 0.05) {
          const postRotContact = computeModelWorldContactPoints(model);
          if (postRotContact.minZ > 0 && postRotContact.minZ < 0.05) {
            model.pose[2] -= postRotContact.minZ;
          }
        }
      }

      // Evaluate exact 3D contact manifold across all collision shapes
      const contactNow = computeModelWorldContactPoints(model);

      if (contactNow.minZ <= 0.002) {
        // STRICT NON-PENETRATION: Project model upward immediately so minZ === 0
        if (contactNow.minZ < 0) {
          model.pose[2] += -contactNow.minZ;
        }

        const col: SimCollision | undefined = rootLink.collisions[0];
        const rawRestitution = col ? col.friction.restitution : 0.15;
        const mu = col ? col.friction.mu : 0.75;

        const pts = contactNow.lowestPoints;
        const updatedComp = computeModelCompositeInertial(model);
        const com = updatedComp.comWorld;
        const yaw = model.pose[5];
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);

        const isSphere =
          !isArticulatedRobot &&
          model.links.length === 1 &&
          rootLink.visuals[0]?.geometry.type === 'sphere';

        if (pts.length > 0 && !isSphere) {
          const contactOffsets: { rFwd: number; rLat: number }[] = [];

          for (const p of pts) {
            const rx = p[0] - com[0];
            const ry = p[1] - com[1];
            const rFwd = cy * rx + sy * ry;
            const rLat = -sy * rx + cy * ry;
            contactOffsets.push({ rFwd, rLat });
          }

          // 3a. Multi-Point Rigid-Body Contact Impulse Solver for points moving downward into z = 0
          const nc = contactOffsets.length;
          for (const { rFwd, rLat } of contactOffsets) {
            const vzPoint =
              model.linearVelocity[2] +
              model.angularVelocity[0] * rLat -
              model.angularVelocity[1] * rFwd;

            if (vzPoint < 0) {
              const effRestitution = vzPoint < -0.55 ? rawRestitution * 0.45 : 0;
              const kInvMass =
                1 / mass +
                (rLat * rLat) / updatedComp.ixx +
                (rFwd * rFwd) / updatedComp.iyy;
              const jn = (-(1 + effRestitution) * vzPoint) / (kInvMass * nc);

              model.linearVelocity[2] += jn / mass;
              model.angularVelocity[0] += (rLat * jn) / updatedComp.ixx;
              model.angularVelocity[1] -= (rFwd * jn) / updatedComp.iyy;
            }
          }

          if (model.linearVelocity[2] < 0) {
            model.linearVelocity[2] = 0;
          }

          // 3b. 2D Convex-Hull Support-Polygon Pivot Mechanics:
          // Determine whether the CoM horizontal projection (0, 0) lies strictly inside the 2D convex hull
          // of ground contact points {(rFwd, rLat)} with stability margin >= 4 mm.
          // If inside, normal forces statically balance gravity.
          // If outside (e.g. resting on 1 wheel, or on a diagonal hinge line between 1 rear wheel and front caster),
          // compute the exact closest point (rPivotFwd, rPivotLat) on the 2D support hull to (0, 0) and apply
          // gravitational pivot acceleration alpha = (M * |gz| * r_pivot) / (I_CoM + M * r_pivot^2).
          const support = analyze2DSupportPolygon(contactOffsets);

          if (support.comInsidePolygon) {
            model.angularVelocity[0] *= Math.exp(-18.0 * subDt);
            model.angularVelocity[1] *= Math.exp(-18.0 * subDt);

            const nearestQuarterRoll =
              Math.round(model.pose[3] / (Math.PI / 2)) * (Math.PI / 2);
            const rollDiff = wrapAnglePi(model.pose[3] - nearestQuarterRoll);
            if (Math.abs(rollDiff) < 0.045) {
              model.pose[3] = wrapAnglePi(
                model.pose[3] - rollDiff * Math.min(1, 25 * subDt)
              );
              if (
                Math.abs(rollDiff) < 0.002 &&
                Math.abs(model.angularVelocity[0]) < 0.015
              ) {
                model.pose[3] = nearestQuarterRoll;
                model.angularVelocity[0] = 0;
              }
            } else if (Math.abs(model.angularVelocity[0]) < 0.015) {
              model.angularVelocity[0] = 0;
            }

            const nearestQuarterPitch =
              Math.round(model.pose[4] / (Math.PI / 2)) * (Math.PI / 2);
            const pitchDiff = wrapAnglePi(model.pose[4] - nearestQuarterPitch);
            if (Math.abs(pitchDiff) < 0.045) {
              model.pose[4] = wrapAnglePi(
                model.pose[4] - pitchDiff * Math.min(1, 25 * subDt)
              );
              if (
                Math.abs(pitchDiff) < 0.002 &&
                Math.abs(model.angularVelocity[1]) < 0.015
              ) {
                model.pose[4] = nearestQuarterPitch;
                model.angularVelocity[1] = 0;
              }
            } else if (Math.abs(model.angularVelocity[1]) < 0.015) {
              model.angularVelocity[1] = 0;
            }
          } else {
            const { rPivotFwd, rPivotLat } = support;
            const rSq = rPivotFwd * rPivotFwd + rPivotLat * rPivotLat;

            if (Math.abs(rPivotLat) > 1e-4) {
              const iPivotRoll = updatedComp.ixx + mass * rSq;
              const alphaRoll = (mass * Math.abs(gz) * rPivotLat) / iPivotRoll;
              model.angularVelocity[0] += alphaRoll * subDt;
              model.angularVelocity[0] *= Math.exp(-2.5 * subDt);
            } else {
              model.angularVelocity[0] *= Math.exp(-12.0 * subDt);
            }

            if (Math.abs(rPivotFwd) > 1e-4) {
              const iPivotPitch = updatedComp.iyy + mass * rSq;
              const alphaPitch = (-mass * Math.abs(gz) * rPivotFwd) / iPivotPitch;
              model.angularVelocity[1] += alphaPitch * subDt;
              model.angularVelocity[1] *= Math.exp(-2.5 * subDt);
            } else {
              model.angularVelocity[1] *= Math.exp(-12.0 * subDt);
            }
          }

          // Clamp angular velocity for numerical stability
          model.angularVelocity[0] = Math.max(
            -10,
            Math.min(10, model.angularVelocity[0])
          );
          model.angularVelocity[1] = Math.max(
            -10,
            Math.min(10, model.angularVelocity[1])
          );
        } else if (isSphere) {
          if (model.linearVelocity[2] < -0.25) {
            model.linearVelocity[2] = -model.linearVelocity[2] * rawRestitution;
          } else if (model.linearVelocity[2] < 0) {
            model.linearVelocity[2] = 0;
          }
        }

        // Ground Coulomb friction on XY linear velocity
        if (!hasCmdVel) {
          const frictionDecay = Math.exp(-mu * 5.0 * subDt);
          model.linearVelocity[0] *= frictionDecay;
          model.linearVelocity[1] *= frictionDecay;

          if (isSphere) {
            const r = rootLink.visuals[0]?.geometry.radius || 0.25;
            model.pose[3] = wrapAnglePi(
              model.pose[3] - (model.linearVelocity[1] / r) * subDt
            );
            model.pose[4] = wrapAnglePi(
              model.pose[4] + (model.linearVelocity[0] / r) * subDt
            );
          }
        }

        // Final post-rotation non-penetration projection so roll/pitch updates never push a corner below z = 0
        const contactAfter = computeModelWorldContactPoints(model);
        if (contactAfter.minZ < 0 || Math.abs(contactAfter.minZ) < 1e-4) {
          model.pose[2] = Number((model.pose[2] - contactAfter.minZ).toFixed(5));
        }
        model.activeContactPoints = contactAfter.lowestPoints.map((p) => [
          p[0],
          p[1],
          Math.max(0, p[2]),
        ]);
      } else {
        // Airborne: minimal air rotational drag
        model.angularVelocity[0] *= Math.exp(-0.15 * subDt);
        model.angularVelocity[1] *= Math.exp(-0.15 * subDt);
        model.activeContactPoints = [];
      }

      // 4. Update live world-space link poses & velocities via SE(3) forward kinematics
      const worldLinkPoses = computeModelLinkWorldPoses(model);
      for (const link of model.links) {
        const wp = worldLinkPoses.get(link.name);
        if (wp) {
          link.worldPosition = [wp[0], wp[1], wp[2]];
          link.worldRotation = [wp[3], wp[4], wp[5]];
        }
        link.linearVelocity = [...model.linearVelocity];
        link.angularVelocity = [...model.angularVelocity];
      }
    }
  }

  // 5. Horizontal Pairwise Model Collision Resolution (Rover/R2-D2 pushing crates/spheres)
  const isAnchoredArm = (m: SimModel) =>
    m.name.includes('arm') ||
    m.links[0]?.name.includes('pedestal') ||
    m.links[0]?.name.includes('base_pedestal');

  for (let i = 0; i < world.models.length; i++) {
    const mA = world.models[i];
    if (mA.name === 'ground_plane') continue;
    for (let j = i + 1; j < world.models.length; j++) {
      const mB = world.models[j];
      if (mB.name === 'ground_plane') continue;
      const aStatic = mA.isStatic || isAnchoredArm(mA);
      const bStatic = mB.isStatic || isAnchoredArm(mB);
      if (aStatic && bStatic) continue;

      const dx = mB.pose[0] - mA.pose[0];
      const dy = mB.pose[1] - mA.pose[1];
      const dz = mB.pose[2] - mA.pose[2];
      const distXY = Math.hypot(dx, dy);
      const minSep = 0.58;

      if (distXY > 1e-4 && distXY < minSep && Math.abs(dz) < 0.45) {
        const overlap = minSep - distXY;
        const nx = dx / distXY;
        const ny = dy / distXY;

        if (!aStatic && !bStatic) {
          mA.pose[0] -= nx * overlap * 0.5;
          mA.pose[1] -= ny * overlap * 0.5;
          mB.pose[0] += nx * overlap * 0.5;
          mB.pose[1] += ny * overlap * 0.5;

          const impulse = 1.5;
          mB.linearVelocity[0] += nx * impulse;
          mB.linearVelocity[1] += ny * impulse;
        } else if (aStatic && !bStatic) {
          mB.pose[0] += nx * overlap;
          mB.pose[1] += ny * overlap;
          mB.linearVelocity[0] *= -0.3;
          mB.linearVelocity[1] *= -0.3;
        } else if (!aStatic && bStatic) {
          mA.pose[0] -= nx * overlap;
          mA.pose[1] -= ny * overlap;
          mA.linearVelocity[0] *= -0.3;
          mA.linearVelocity[1] *= -0.3;
        }
      }
    }
  }

  // 6. Update all Gazebo Harmonic sensors (GpuLidar rays, IMU, Contact) and refresh live gz.msgs topics
  updateWorldSensors(world);
  world.topics = buildWorldGzTopicsAndRos2Bridge(world);
}

/**
 * Resets a ParsedWorld back to initial poses and zero velocities.
 */
export function cloneParsedWorld(world: ParsedWorld): ParsedWorld {
  return JSON.parse(JSON.stringify(world));
}

export function updateEntityPoseInWorld(
  world: ParsedWorld,
  entityId: number,
  newPose: Pose6D
): ParsedWorld {
  const next = cloneParsedWorld(world);
  for (const m of next.models) {
    if (m.entityId === entityId) {
      m.pose = [...newPose];
      m.linearVelocity = [0, 0, 0];
      m.angularVelocity = [0, 0, 0];
      m.links.forEach((l) => {
        l.linearVelocity = [0, 0, 0];
        l.angularVelocity = [0, 0, 0];
      });
      // Prevent manual translation from pushing a model underground below z = 0
      const { minZ, lowestPoints } = computeModelWorldContactPoints(m);
      if (minZ < 0) {
        m.pose[2] = Number((m.pose[2] - minZ).toFixed(4));
      }
      m.activeContactPoints = lowestPoints;
      return next;
    }
    for (const l of m.links) {
      if (l.entityId === entityId) {
        l.pose = [...newPose];
        l.linearVelocity = [0, 0, 0];
        l.angularVelocity = [0, 0, 0];
        return next;
      }
    }
  }
  for (const light of next.lights) {
    if (light.entityId === entityId) {
      light.pose = [...newPose];
      return next;
    }
  }
  return next;
}

/**
 * Scales the visual and collision geometry dimensions of a model or link when using Gazebo Scale mode.
 */
export function scaleEntityGeometryInWorld(
  world: ParsedWorld,
  entityId: number,
  scaleFactors: [number, number, number]
): ParsedWorld {
  const [sx, sy, sz] = scaleFactors.map((s) => Math.max(0.15, Math.min(8.0, s)));
  const next = cloneParsedWorld(world);

  const applyScaleToLinks = (links: SimLink[]) => {
    for (const link of links) {
      for (const item of [...link.visuals, ...link.collisions]) {
        const g = item.geometry;
        if (g.type === 'box' && g.size) {
          g.size = [
            Number((g.size[0] * sx).toFixed(3)),
            Number((g.size[1] * sy).toFixed(3)),
            Number((g.size[2] * sz).toFixed(3)),
          ];
        } else if (g.type === 'sphere' && g.radius) {
          const avg = (sx + sy + sz) / 3;
          g.radius = Number((g.radius * avg).toFixed(3));
        } else if (
          (g.type === 'cylinder' || g.type === 'cone' || g.type === 'capsule') &&
          g.radius &&
          g.length
        ) {
          const radScale = (sx + sy) * 0.5;
          g.radius = Number((g.radius * radScale).toFixed(3));
          g.length = Number((g.length * sz).toFixed(3));
        } else if (g.type === 'ellipsoid' && g.radii) {
          g.radii = [
            Number((g.radii[0] * sx).toFixed(3)),
            Number((g.radii[1] * sy).toFixed(3)),
            Number((g.radii[2] * sz).toFixed(3)),
          ];
        }
      }
    }
  };

  for (const m of next.models) {
    if (m.entityId === entityId) {
      applyScaleToLinks(m.links);
      const { minZ } = computeModelWorldContactPoints(m);
      if (minZ < 0) {
        m.pose[2] = Number((m.pose[2] - minZ).toFixed(4));
      }
      return next;
    }
    for (const l of m.links) {
      if (l.entityId === entityId) {
        applyScaleToLinks([l]);
        return next;
      }
    }
  }
  return next;
}

/**
 * Deletes a Model or Light from a ParsedWorld by entityId.
 * Prevents deleting the static ground_plane.
 */
export function deleteEntityFromWorld(
  world: ParsedWorld,
  entityId: number
): ParsedWorld {
  const next = cloneParsedWorld(world);
  next.models = next.models.filter(
    (m) => m.name === 'ground_plane' || m.entityId !== entityId
  );
  next.lights = next.lights.filter((l) => l.entityId !== entityId);
  return next;
}

/**
 * Computes the next available unique entityId in a ParsedWorld.
 */
export function getNextAvailableEntityId(world: ParsedWorld): number {
  let maxId = 4;
  for (const l of world.lights) {
    if (l.entityId > maxId) maxId = l.entityId;
  }
  for (const m of world.models) {
    if (m.entityId > maxId) maxId = m.entityId;
    for (const lk of m.links) {
      if (lk.entityId > maxId) maxId = lk.entityId;
    }
    for (const j of m.joints) {
      if (j.entityId > maxId) maxId = j.entityId;
    }
  }
  return maxId + 1;
}
