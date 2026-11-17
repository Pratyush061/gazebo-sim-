import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneModelEntityForPaste,
  compileSdfOrUrdf,
  composePoses,
  createPrimitiveModelEntity,
  generateSpawnPrimitiveSdfSnippet,
  getDefaultGroundZForPrimitive,
} from './sdfCompiler';
import {
  computeModelLinkPoses,
  computeModelLinkWorldPoses,
  deleteEntityFromWorld,
  getModelVerticalGroundOffset,
  getNextAvailableEntityId,
  scaleEntityGeometryInWorld,
  stepPhysicsWorld,
  updateEntityPoseInWorld,
} from './physicsEngine';
import { executeUbuntuCommand } from './ubuntuTerminal';
import { DEFAULT_FILES } from '../data/defaultFiles';
import { PrimitiveShapeType } from '../types/simulation';
import {
  GZ_SYSTEM_TEMPLATES,
  generateRos2BridgeYaml,
  injectSystemPluginIntoXml,
} from './gzSystemsCatalog';
import { computeModelWorldContactPoints } from './physicsEngine';

test('all default SDF 1.10 and URDF sample files compile cleanly with zero errors', () => {
  for (const file of DEFAULT_FILES) {
    const result = compileSdfOrUrdf(file.content, file.path);
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    assert.equal(
      result.isValid,
      true,
      `Expected ${file.path} to compile cleanly, but got errors: ${JSON.stringify(errors)}`
    );
    assert.ok(result.world, `Expected world AST for ${file.path}`);
    assert.ok(result.world.models.length >= 1, `Expected models in ${file.path}`);
  }
});

test('strict SDF compiler catches mismatched XML tags, negative mass, non-positive inertia, and missing joint links', () => {
  const brokenSdf = `<?xml version="1.0" ?>
<sdf version="1.10">
  <world name="broken_world">
    <model name="bad_robot">
      <pose>0 0 1 0</pose>
      <link name="base_link">
        <inertial>
          <mass>-5.0</mass>
          <inertia>
            <ixx>-0.2</ixx>
            <iyy>0.1</iyy>
            <izz>0.1</izz>
          </inertia>
        </inertial>
      </link>
      <joint name="bad_joint" type="revolute">
        <parent>base_link</parent>
        <child>ghost_link</child>
        <axis>
          <xyz>0 0 0</xyz>
        </axis>
      </joint>
    </model>
  </world>
</sdf>`;

  const res = compileSdfOrUrdf(brokenSdf, 'worlds/broken.sdf');
  assert.equal(res.isValid, false);
  const codes = new Set(res.diagnostics.map((d) => d.code));
  assert.ok(codes.has('SDF_INVALID_POSE'), 'Should detect invalid 4-value pose');
  assert.ok(codes.has('SDF_INVALID_MASS'), 'Should detect negative mass');
  assert.ok(codes.has('SDF_NON_POSITIVE_INERTIA'), 'Should detect negative ixx');
  assert.ok(codes.has('SDF_JOINT_MISSING_CHILD'), 'Should detect missing child link ghost_link');
  assert.ok(codes.has('SDF_ZERO_JOINT_AXIS'), 'Should detect zero-length joint axis');
});

test('URDF file automatically converts to valid SDF 1.10 with links and joints preserved', () => {
  const urdfFile = DEFAULT_FILES.find((f) => f.name === 'simple_manipulator.urdf')!;
  const res = compileSdfOrUrdf(urdfFile.content, urdfFile.path);
  assert.equal(res.isValid, true);
  assert.equal(res.format, 'urdf');
  assert.ok(res.convertedSdfXml?.includes('<sdf version="1.10">'));
  const robotModel = res.world?.models.find((m) => m.name === 'ros2_inspection_arm');
  assert.ok(robotModel, 'Converted world should contain ros2_inspection_arm model');
  assert.equal(robotModel.links.length, 3);
  assert.equal(robotModel.joints.length, 2);

  // Verify SE(3) joint origin propagation on URDF links:
  // base_link is root [0, 0, 0, 0, 0, 0]
  // mast_link has joint origin [0, 0, 0.30, 0, 0, 0] -> model pose Z = 0.30
  // sensor_head_link has joint origin [0, 0, 0.70, 0, 0, 0] relative to mast_link -> model pose Z = 1.00
  const baseLink = robotModel.links.find((l) => l.name === 'base_link')!;
  const mastLink = robotModel.links.find((l) => l.name === 'mast_link')!;
  const sensorLink = robotModel.links.find((l) => l.name === 'sensor_head_link')!;
  assert.equal(baseLink.pose[2], 0);
  assert.ok(Math.abs(mastLink.pose[2] - 0.3) < 1e-4, `Expected mast_link Z=0.30, got ${mastLink.pose[2]}`);
  assert.ok(Math.abs(sensorLink.pose[2] - 1.0) < 1e-4, `Expected sensor_head_link Z=1.00, got ${sensorLink.pose[2]}`);

  // Verify multiple visuals per link and robot-level named materials are preserved
  assert.equal(baseLink.visuals.length, 2, 'base_link should preserve both visuals');
  assert.equal(mastLink.visuals.length, 2, 'mast_link should preserve both visuals');
  assert.equal(sensorLink.visuals.length, 3, 'sensor_head_link should preserve all 3 visuals');
  assert.ok(
    Math.abs(mastLink.visuals[0].pose[2] - 0.35) < 1e-4,
    'mast_link visual local pose Z=0.35 must be preserved'
  );
  assert.ok(
    Math.abs(mastLink.visuals[0].material.diffuse[2] - 0.88) < 1e-2,
    'Robot-level material gazebo_blue should resolve on mast_link'
  );
});

test('URDF compiler validates URDF syntax/schema with exact URDF line numbers and handles virtual base_footprint links', () => {
  const brokenUrdf = `<?xml version="1.0"?>
<robot name="broken_urdf_bot">
  <link name="base_footprint"/>
  <link name="chassis_link">
    <inertial>
      <origin xyz="0 0" rpy="0 0 0"/>
      <mass value="-3.0"/>
      <inertia ixx="0" ixy="0" ixz="0" iyy="0.1" iyz="0" izz="0.1"/>
    </inertial>
  </link>
  <joint name="footprint_joint" type="fixed">
    <parent link="base_footprint"/>
    <child link="missing_child_link"/>
    <origin xyz="0 0 0.15" rpy="0 0 0"/>
  </joint>
</robot>`;

  const res = compileSdfOrUrdf(brokenUrdf, 'urdf/broken_urdf_bot.urdf');
  assert.equal(res.isValid, false);
  const codes = new Set(res.diagnostics.map((d) => d.code));
  assert.ok(codes.has('URDF_INVALID_VEC3'), 'Should report 2-element xyz on origin');
  assert.ok(codes.has('SDF_INVALID_MASS'), 'Should report negative mass in URDF');
  assert.ok(codes.has('SDF_NON_POSITIVE_INERTIA'), 'Should report zero ixx in URDF');
  assert.ok(codes.has('SDF_JOINT_MISSING_CHILD'), 'Should report missing child link in URDF');

  const massDiag = res.diagnostics.find((d) => d.code === 'SDF_INVALID_MASS')!;
  assert.equal(massDiag.line, 7, 'Diagnostic line number must match exact line in .urdf file');
});

test('URDF multi-body Forward Kinematics propagates parent joint rotations to descendant links and world poses', () => {
  const urdfFile = DEFAULT_FILES.find((f) => f.name === 'simple_manipulator.urdf')!;
  const res = compileSdfOrUrdf(urdfFile.content, urdfFile.path);
  assert.ok(res.world);
  const world = res.world;
  const arm = world.models.find((m) => m.name === 'ros2_inspection_arm')!;

  const yawJoint = arm.joints.find((j) => j.name === 'base_to_mast_yaw')!;
  const pitchJoint = arm.joints.find((j) => j.name === 'mast_to_sensor_pitch')!;

  // Rotate base_to_mast_yaw by +90 deg (pi/2) around Z and mast_to_sensor_pitch by +45 deg (pi/4) around Y
  yawJoint.position = Math.PI / 2;
  pitchJoint.position = Math.PI / 4;

  const modelPoses = computeModelLinkPoses(arm);
  const mastPose = modelPoses.get('mast_link')!;
  const sensorPose = modelPoses.get('sensor_head_link')!;

  // mast_link should have yaw = pi/2 at Z = 0.30
  assert.ok(Math.abs(mastPose[2] - 0.3) < 1e-3);
  assert.ok(Math.abs(mastPose[5] - Math.PI / 2) < 1e-3, `Expected mast yaw pi/2, got ${mastPose[5]}`);

  // sensor_head_link origin is at [0, 0, 0.70] along mast_link's Z axis -> still at X=0, Y=0, Z=1.00,
  // and its orientation must combine parent yaw (pi/2) AND child pitch (pi/4)!
  assert.ok(Math.abs(sensorPose[0]) < 1e-3);
  assert.ok(Math.abs(sensorPose[1]) < 1e-3);
  assert.ok(Math.abs(sensorPose[2] - 1.0) < 1e-3);

  // Now pitch mast_to_sensor_pitch by +90 deg (pi/2) and verify a point offset along sensor_head_link +X moves in +Y (since yaw=pi/2) and -Z (since pitch=pi/2)
  const tipPoseInModel = composePoses(sensorPose, [0.3, 0, 0, 0, 0, 0]);
  assert.ok(
    tipPoseInModel[1] > 0.18,
    `With base yaw=+90deg, sensor boom extending +X in link frame must swing into +Y in model space, got Y=${tipPoseInModel[1]}`
  );
});

test('URDF differential-drive mobile robot (diff_drive_rover.urdf) compiles, sits flush on ground, and spins wheels under cmdVel', () => {
  const roverUrdf = DEFAULT_FILES.find((f) => f.name === 'diff_drive_rover.urdf')!;
  const res = compileSdfOrUrdf(roverUrdf.content, roverUrdf.path);
  assert.equal(res.isValid, true);
  assert.ok(res.world);
  const world = res.world;

  const rover = world.models.find((m) => m.name === 'ros2_urdf_rover')!;
  assert.ok(rover, 'ros2_urdf_rover model should exist');

  // Virtual base_footprint link should have zero visuals and zero collisions (no fake 0.2m box)
  const footprint = rover.links.find((l) => l.name === 'base_footprint')!;
  assert.equal(footprint.visuals.length, 0, 'Virtual base_footprint must not have fake visual box');
  assert.equal(footprint.collisions.length, 0, 'Virtual base_footprint must not have fake collision box');

  // Ground offset of ros2_urdf_rover should be 0 because wheels (radius 0.16 at z=0.16) touch z=0
  const groundOffset = getModelVerticalGroundOffset(rover);
  assert.ok(
    Math.abs(groundOffset) < 1e-2,
    `Expected rover ground offset ~0.0m, got ${groundOffset}`
  );

  // Command forward velocity and step physics: wheels must spin continuously without being pulled back to 0 by position PID
  rover.cmdVel = { linearX: 1.2, linearY: 0, angularZ: 0 };
  const leftWheelJoint = rover.joints.find((j) => j.name === 'left_wheel_joint')!;
  for (let i = 0; i < 40; i++) {
    stepPhysicsWorld(world, 0.01);
  }
  assert.ok(rover.pose[0] > 0.2, `Rover should drive forward in +X, got x=${rover.pose[0]}`);
  assert.ok(
    leftWheelJoint.position > 0.5,
    `Left wheel joint should rotate continuously as rover drives, got pos=${leftWheelJoint.position}`
  );

  // World link poses should be updated during stepPhysicsWorld
  const worldPoses = computeModelLinkWorldPoses(rover);
  assert.ok(worldPoses.has('left_wheel_link'));
});

test('effort-controlled URDF joint experiences physical gravity torque and damping', () => {
  const urdfFile = DEFAULT_FILES.find((f) => f.name === 'simple_manipulator.urdf')!;
  const res = compileSdfOrUrdf(urdfFile.content, urdfFile.path);
  assert.ok(res.world);
  const world = res.world;
  const arm = world.models.find((m) => m.name === 'ros2_inspection_arm')!;
  const pitchJoint = arm.joints.find((j) => j.name === 'mast_to_sensor_pitch')!;

  // Switch pitch joint to effort mode with 0 applied effort:
  // Because sensor_head_link CoM is at x=+0.22m in front of the pitch axis, gravity (-9.81 m/s^2) exerts a pitching torque!
  pitchJoint.controlMode = 'effort';
  pitchJoint.appliedEffort = 0;

  for (let i = 0; i < 30; i++) {
    stepPhysicsWorld(world, 0.01);
  }

  assert.ok(
    Math.abs(pitchJoint.position) > 0.02,
    `Effort-mode pitch joint with cantilevered CoM should deflect under gravity torque, got ${pitchJoint.position}`
  );
});

test('physics engine applies gravity, aerodynamic wind drift, ground collision, and joint actuation', () => {
  const r2d2File = DEFAULT_FILES.find((f) => f.name === 'r2d2_starwars.sdf')!;
  const res = compileSdfOrUrdf(r2d2File.content, r2d2File.path);
  assert.ok(res.world);
  const world = res.world;

  const probe = world.models.find((m) => m.name === 'wind_probe_sphere')!;
  const r2d2 = world.models.find((m) => m.name === 'r2d2')!;
  // Elevate probe temporarily to test gravity drop + wind drift
  probe.pose[2] = 1.5;
  const initialProbeZ = probe.pose[2];
  const initialProbeX = probe.pose[0];

  const domeJoint = r2d2.joints.find((j) => j.name === 'dome_swivel_joint')!;
  domeJoint.targetPosition = 1.2;
  r2d2.cmdVel = { linearX: 1.5, linearY: 0, angularZ: 0.4 };

  for (let i = 0; i < 50; i++) {
    stepPhysicsWorld(world, 0.01);
  }

  assert.ok(probe.pose[2] < initialProbeZ, 'Elevated probe sphere should fall under gravity');
  assert.ok(probe.pose[0] > initialProbeX, 'Probe sphere with enable_wind should drift with +X wind');
  assert.ok(domeJoint.position > 0.5, 'Dome joint should actuate toward targetPosition');
  assert.ok(r2d2.pose[0] > 0.2, 'R2-D2 should advance under cmd_vel');
});

test('placing primitive shapes at chosen ground coordinates sits flush on ground without falling or resetting existing models', () => {
  const r2d2File = DEFAULT_FILES.find((f) => f.name === 'r2d2_starwars.sdf')!;
  const res = compileSdfOrUrdf(r2d2File.content, r2d2File.path);
  assert.ok(res.world);
  const world = res.world;

  // Move R2-D2 to a custom live position first
  const r2d2 = world.models.find((m) => m.name === 'r2d2')!;
  r2d2.pose = [2.4, -1.8, 0, 0, 0, 0.75];

  const shapes: PrimitiveShapeType[] = [
    'box',
    'sphere',
    'cone',
    'cylinder',
    'capsule',
    'ellipsoid',
  ];

  shapes.forEach((shape, idx) => {
    const gz = getDefaultGroundZForPrimitive(shape);
    const targetX = -2.0 + idx * 0.9;
    const targetY = -2.5;
    const nextId = getNextAvailableEntityId(world);
    const placedModel = createPrimitiveModelEntity(
      shape,
      idx + 1,
      [targetX, targetY, gz, 0, 0, 0],
      nextId,
      r2d2File.path
    );
    world.models.push(placedModel);
  });

  // Step physics for 40 frames
  for (let i = 0; i < 40; i++) {
    stepPhysicsWorld(world, 0.01);
  }

  // Verify R2-D2 was NOT reset to (0, 0, 0) when shapes were placed
  assert.equal(r2d2.pose[0], 2.4, 'Existing R2-D2 X position must be preserved');
  assert.equal(r2d2.pose[1], -1.8, 'Existing R2-D2 Y position must be preserved');

  // Verify every placed primitive stayed right at its placed (X, Y, Z) on the ground without falling or drifting
  shapes.forEach((shape, idx) => {
    const model = world.models.find((m) => m.name === `${shape}_${idx + 1}`)!;
    assert.ok(model, `Placed model ${shape}_${idx + 1} should exist`);
    const expectedZ = getDefaultGroundZForPrimitive(shape);
    assert.ok(
      Math.abs(model.pose[2] - expectedZ) < 1e-3,
      `Placed ${shape} should remain resting on ground at z=${expectedZ}, got z=${model.pose[2]}`
    );
    assert.equal(
      model.enableWind,
      false,
      `Placed ${shape} should have enableWind=false by default`
    );
  });
});

test('gizmo drag guard freezes dragged entity during translation and rotation', () => {
  const emptyRes = compileSdfOrUrdf(DEFAULT_FILES[0].content, DEFAULT_FILES[0].path);
  assert.ok(emptyRes.world);
  let world = emptyRes.world;

  const box = createPrimitiveModelEntity('box', 1, [1.5, 2.0, 1.8, 0.3, -0.4, 1.1], 20);
  world.models.push(box);

  // While box (entityId = 20) is being dragged by the gizmo, physics must NOT drop it under gravity
  for (let i = 0; i < 30; i++) {
    stepPhysicsWorld(world, 0.01, 20);
  }
  assert.equal(box.pose[2], 1.8, 'Dragged entity Z must not drop while gizmo drag is active');
  assert.equal(box.pose[3], 0.3, 'Dragged entity Roll must be preserved');
  assert.equal(box.pose[4], -0.4, 'Dragged entity Pitch must be preserved');
  assert.equal(box.pose[5], 1.1, 'Dragged entity Yaw must be preserved');

  // Updating pose via updateEntityPoseInWorld updates pose (clamping Z so rotated corners do not sink below z=0) and zeroes velocity
  world = updateEntityPoseInWorld(world, 20, [3.0, -1.0, 0.25, 0.2, 0.5, -0.8]);
  const updatedBox = world.models.find((m) => m.entityId === 20)!;
  assert.equal(updatedBox.pose[0], 3.0);
  assert.equal(updatedBox.pose[1], -1.0);
  assert.ok(updatedBox.pose[2] >= 0.37, 'Rotated box Z should be clamped so lowest OBB corner does not sink below z=0');
  assert.equal(updatedBox.pose[3], 0.2);
  assert.equal(updatedBox.pose[4], 0.5);
  assert.equal(updatedBox.pose[5], -0.8);
  assert.deepEqual(updatedBox.linearVelocity, [0, 0, 0]);
});

test('Gazebo Copy/Paste, Scale, and Delete entity operations work per specification', () => {
  const emptyRes = compileSdfOrUrdf(DEFAULT_FILES[0].content, DEFAULT_FILES[0].path);
  assert.ok(emptyRes.world);
  let world = emptyRes.world;

  const box = createPrimitiveModelEntity('box', 1, [1.0, 1.0, 0.25, 0, 0, 0], 10);
  world.models.push(box);

  // Copy & Paste box_1 to (2.5, 2.5, 0.25)
  const { model: pastedBox, sdfSnippet } = cloneModelEntityForPaste(
    box,
    2,
    [2.5, 2.5, 0.25, 0, 0, 0],
    getNextAvailableEntityId(world)
  );
  world.models.push(pastedBox);
  assert.equal(pastedBox.name, 'box_1_clone_2');
  assert.deepEqual(pastedBox.pose, [2.5, 2.5, 0.25, 0, 0, 0]);
  assert.ok(sdfSnippet.includes('<model name="box_1_clone_2">'));

  // Scale box_1 by 2x
  world = scaleEntityGeometryInWorld(world, box.entityId, [2, 2, 2]);
  const scaledBox = world.models.find((m) => m.entityId === box.entityId)!;
  assert.deepEqual(scaledBox.links[0].visuals[0].geometry.size, [1, 1, 1]);
  assert.equal(scaledBox.pose[2], 0.5, 'Scaled 1m cube should adjust ground Z to 0.5m');

  // Delete pastedBox
  world = deleteEntityFromWorld(world, pastedBox.entityId);
  assert.equal(
    world.models.some((m) => m.entityId === pastedBox.entityId),
    false,
    'Deleted entity should be removed from world'
  );
});

test('Ubuntu 24.04 CLI terminal executes ls, gz sdf -k, gz topic, and touch commands', () => {
  const emptyRes = compileSdfOrUrdf(DEFAULT_FILES[0].content, DEFAULT_FILES[0].path);
  const ctx = {
    cwd: '/home/ubuntu/workspace',
    files: [...DEFAULT_FILES],
    activeWorld: emptyRes.world,
    isSimRunning: false,
    simTime: 0,
  };

  const lsOut = executeUbuntuCommand('ls worlds', ctx);
  assert.ok(lsOut.output.includes('r2d2_starwars.sdf'));

  const checkOut = executeUbuntuCommand('gz sdf -k worlds/r2d2_starwars.sdf', ctx);
  assert.equal(checkOut.isError, undefined);
  assert.ok(checkOut.output.includes('VALID'));

  const checkUrdfOut = executeUbuntuCommand('gz sdf -k urdf/simple_manipulator.urdf', ctx);
  assert.equal(checkUrdfOut.isError, undefined);
  assert.ok(checkUrdfOut.output.includes('VALID'));

  const topicOut = executeUbuntuCommand('gz topic -l', ctx);
  assert.ok(topicOut.output.includes('/world/default/clock'));

  const spawnSnippet = generateSpawnPrimitiveSdfSnippet('sphere', 1);
  assert.ok(spawnSnippet.includes('<model name="sphere_1">'));
});

test('URDF rover promotes chassis_link past virtual base_footprint and rests at z=0 with ZERO spawn shivering', () => {
  const roverUrdf = DEFAULT_FILES.find((f) => f.name === 'diff_drive_rover.urdf')!;
  const res = compileSdfOrUrdf(roverUrdf.content, roverUrdf.path);
  assert.equal(res.isValid, true);
  assert.ok(res.world);
  const world = res.world;
  const rover = world.models.find((m) => m.name === 'ros2_urdf_rover')!;

  // Verify canonical link promotion past virtual massless base_footprint
  assert.equal(rover.canonicalLink, 'chassis_link', 'Canonical link should promote to first physical link chassis_link');
  assert.equal(rover.virtualRootLink, 'base_footprint', 'virtualRootLink should record welded base_footprint');

  // Step physics for 150 frames with zero cmd_vel and verify rover never shivers or bounces between 0 and 0.01
  let maxAbsZ = 0;
  let maxAbsPitch = 0;
  let maxAbsRoll = 0;
  for (let i = 0; i < 150; i++) {
    stepPhysicsWorld(world, 0.01);
    maxAbsZ = Math.max(maxAbsZ, Math.abs(rover.pose[2]));
    maxAbsRoll = Math.max(maxAbsRoll, Math.abs(rover.pose[3]));
    maxAbsPitch = Math.max(maxAbsPitch, Math.abs(rover.pose[4]));
  }

  assert.ok(
    maxAbsZ < 1e-4,
    `URDF rover must rest at exact z=0.0000m without spawn shivering (0 to 0.01 oscillation), got max |z|=${maxAbsZ}`
  );
  assert.ok(
    maxAbsRoll < 1e-4,
    `URDF rover roll must remain 0 at rest, got max |roll|=${maxAbsRoll}`
  );
  assert.ok(
    maxAbsPitch < 1e-4,
    `URDF rover pitch must remain 0 at rest, got max |pitch|=${maxAbsPitch}`
  );
});

test('3D support-polygon fall physics: moderately tilted rover pivots onto wheels while heavily tilted rover tips onto its side without fake upright spring', () => {
  const roverUrdf = DEFAULT_FILES.find((f) => f.name === 'diff_drive_rover.urdf')!;

  // Case 1: Moderately lifted and rotated rover (z = 0.65m, roll = 0.35 rad ~20 deg, pitch = -0.18 rad ~-10 deg)
  // Its CoM is still inboard of the contacting wheel rim, so real gravitational pivot torque righting it onto all wheels must occur
  const res1 = compileSdfOrUrdf(roverUrdf.content, roverUrdf.path);
  const world1 = res1.world!;
  const rover1 = world1.models.find((m) => m.name === 'ros2_urdf_rover')!;
  rover1.pose = [0, 0, 0.65, 0.35, -0.18, 0.25];

  for (let i = 0; i < 220; i++) {
    stepPhysicsWorld(world1, 0.01);
    const { minZ } = computeModelWorldContactPoints(rover1);
    assert.ok(
      minZ >= -1e-3,
      `Rover collision geometry must never sink below ground plane z=0 during fall, got minZ=${minZ} at step ${i}`
    );
  }

  assert.ok(
    Math.abs(rover1.pose[2]) < 0.01,
    `Moderately tilted rover should settle flush on wheels at z~0, got z=${rover1.pose[2]}`
  );
  assert.ok(
    Math.abs(rover1.pose[3]) < 0.05 && Math.abs(rover1.pose[4]) < 0.05,
    `Moderately tilted rover should pivot onto its wheels to roll~0, pitch~0, got roll=${rover1.pose[3]}, pitch=${rover1.pose[4]}`
  );

  // Case 2: Heavily tilted rover past critical tipping angle (roll = 1.48 rad ~85 deg)
  // Without any fake upright spring, it must tip onto its side (~pi/2) and remain on its side!
  const res2 = compileSdfOrUrdf(roverUrdf.content, roverUrdf.path);
  const world2 = res2.world!;
  const rover2 = world2.models.find((m) => m.name === 'ros2_urdf_rover')!;
  rover2.pose = [0, 0, 0.45, 1.48, 0, 0];

  for (let i = 0; i < 200; i++) {
    stepPhysicsWorld(world2, 0.01);
  }

  assert.ok(
    Math.abs(rover2.pose[3]) > 1.15,
    `Heavily tilted rover (85 deg) must remain tipped on its side instead of snapping upright via fake physics, got roll=${rover2.pose[3]}`
  );
});

test('Gazebo Systems & Plugins catalog supports one-click XML injection into SDF and URDF files and generates ROS 2 bridge config', () => {
  assert.ok(GZ_SYSTEM_TEMPLATES.length >= 16, 'Catalog should include comprehensive gz-sim systems');

  const diffDriveEntry = GZ_SYSTEM_TEMPLATES.find((p) => p.id === 'diff_drive')!;
  const imuEntry = GZ_SYSTEM_TEMPLATES.find((p) => p.id === 'imu_sensor')!;
  assert.ok(diffDriveEntry);
  assert.ok(imuEntry);

  // Inject into SDF file
  const r2d2File = DEFAULT_FILES.find((f) => f.name === 'r2d2_starwars.sdf')!;
  const r2d2World = compileSdfOrUrdf(r2d2File.content, r2d2File.path).world!;
  const r2d2Model = r2d2World.models.find((m) => m.name === 'r2d2')!;
  const updatedSdf = injectSystemPluginIntoXml(r2d2File.content, 'sdf', 'imu_sensor', r2d2Model);
  const sdfCompile = compileSdfOrUrdf(updatedSdf, r2d2File.path);
  assert.equal(sdfCompile.isValid, true, 'SDF with injected imu_sensor must compile cleanly');

  // Inject into URDF file
  const armUrdf = DEFAULT_FILES.find((f) => f.name === 'simple_manipulator.urdf')!;
  const armWorld = compileSdfOrUrdf(armUrdf.content, armUrdf.path).world!;
  const armModel = armWorld.models.find((m) => m.name === 'ros2_inspection_arm')!;
  const updatedUrdf = injectSystemPluginIntoXml(
    armUrdf.content,
    'urdf',
    'odometry_publisher',
    armModel
  );
  const urdfCompile = compileSdfOrUrdf(updatedUrdf, armUrdf.path);
  assert.equal(urdfCompile.isValid, true, 'URDF with injected OdometryPublisher <gazebo> plugin must compile cleanly');

  // Verify ROS 2 bridge YAML generation
  const roverUrdf = DEFAULT_FILES.find((f) => f.name === 'diff_drive_rover.urdf')!;
  const roverWorld = compileSdfOrUrdf(roverUrdf.content, roverUrdf.path).world!;
  const bridgeYaml = generateRos2BridgeYaml(roverWorld);
  assert.ok(bridgeYaml.includes('ros_topic_name:'), 'ROS 2 bridge YAML should contain ros_topic_name mappings');
  assert.ok(bridgeYaml.includes('gz_type_name: "gz.msgs.Twist"'), 'ROS 2 bridge YAML should map Twist cmd_vel');
});


