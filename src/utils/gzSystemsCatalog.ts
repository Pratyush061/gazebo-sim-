import {
  GzSystemCategory,
  GzTopicInfo,
  ParsedWorld,
  SimModel,
} from '../types/simulation';

export interface GzSystemTemplate {
  id: string;
  label: string;
  category: GzSystemCategory;
  filename: string;
  systemName: string;
  scope: 'world' | 'model' | 'sensor';
  githubPath: string;
  summary: string;
  gzMsgType: string;
  ros2MsgType: string;
  defaultTopic: string;
  defaultParams: Record<string, string>;
}

/**
 * Official Gazebo Harmonic (gz-sim8) built-in system plugins from:
 * https://github.com/gazebosim/gz-sim/tree/main/src/systems
 */
export const GZ_SYSTEM_TEMPLATES: GzSystemTemplate[] = [
  // 1. Actuation & Control Systems
  {
    id: 'diff_drive',
    label: 'DiffDrive',
    category: 'actuation',
    filename: 'gz-sim-diff-drive-system',
    systemName: 'gz::sim::systems::DiffDrive',
    scope: 'model',
    githubPath: 'src/systems/diff_drive',
    summary:
      'Differential-drive controller subscribing to Twist commands and publishing wheel odometry & TF.',
    gzMsgType: 'gz.msgs.Twist',
    ros2MsgType: 'geometry_msgs/msg/Twist',
    defaultTopic: '/model/{model}/cmd_vel',
    defaultParams: {
      left_joint: 'left_wheel_joint',
      right_joint: 'right_wheel_joint',
      wheel_separation: '0.54',
      wheel_radius: '0.16',
      odom_publish_frequency: '50',
      topic: '/model/{model}/cmd_vel',
      odom_topic: '/model/{model}/odometry',
      tf_topic: '/model/{model}/tf',
      frame_id: 'odom',
      child_frame_id: 'base_footprint',
    },
  },
  {
    id: 'joint_position_controller',
    label: 'JointPositionController',
    category: 'actuation',
    filename: 'gz-sim-joint-position-controller-system',
    systemName: 'gz::sim::systems::JointPositionController',
    scope: 'model',
    githubPath: 'src/systems/joint_position_controller',
    summary:
      'PID position controller driving a revolute or prismatic joint to target angles/displacements.',
    gzMsgType: 'gz.msgs.Double',
    ros2MsgType: 'std_msgs/msg/Float64',
    defaultTopic: '/model/{model}/joint/{joint}/0/cmd_pos',
    defaultParams: {
      joint_name: '{joint}',
      topic: '/model/{model}/joint/{joint}/cmd_pos',
      p_gain: '25.0',
      i_gain: '0.1',
      d_gain: '1.5',
      i_max: '10.0',
      i_min: '-10.0',
      cmd_max: '80.0',
      cmd_min: '-80.0',
    },
  },
  {
    id: 'joint_velocity_controller',
    label: 'JointVelocityController',
    category: 'actuation',
    filename: 'gz-sim-joint-velocity-controller-system',
    systemName: 'gz::sim::systems::JointVelocityController',
    scope: 'model',
    githubPath: 'src/systems/joint_controller',
    summary:
      'Velocity PID controller regulating angular or linear velocity of a robot joint.',
    gzMsgType: 'gz.msgs.Double',
    ros2MsgType: 'std_msgs/msg/Float64',
    defaultTopic: '/model/{model}/joint/{joint}/cmd_vel',
    defaultParams: {
      joint_name: '{joint}',
      topic: '/model/{model}/joint/{joint}/cmd_vel',
      p_gain: '8.0',
      i_gain: '0.05',
      d_gain: '0.2',
    },
  },
  {
    id: 'joint_controller',
    label: 'JointController (Effort / Force)',
    category: 'actuation',
    filename: 'gz-sim-joint-controller-system',
    systemName: 'gz::sim::systems::JointController',
    scope: 'model',
    githubPath: 'src/systems/joint_controller',
    summary:
      'Direct force/torque or velocity command controller for articulated manipulator & turret joints.',
    gzMsgType: 'gz.msgs.Double',
    ros2MsgType: 'std_msgs/msg/Float64',
    defaultTopic: '/model/{model}/joint/{joint}/cmd_force',
    defaultParams: {
      joint_name: '{joint}',
      use_force_commands: 'true',
      topic: '/model/{model}/joint/{joint}/cmd_force',
    },
  },
  {
    id: 'apply_link_wrench',
    label: 'ApplyLinkWrench',
    category: 'actuation',
    filename: 'gz-sim-apply-link-wrench-system',
    systemName: 'gz::sim::systems::ApplyLinkWrench',
    scope: 'world',
    githubPath: 'src/systems/apply_link_wrench',
    summary:
      'Applies external 3D forces and torques (EntityWrench) directly to links via Gazebo Transport.',
    gzMsgType: 'gz.msgs.EntityWrench',
    ros2MsgType: 'ros_gz_interfaces/msg/EntityWrench',
    defaultTopic: '/world/default/wrench',
    defaultParams: {
      topic: '/world/default/wrench',
    },
  },

  // 2. State & Odometry Publishers
  {
    id: 'joint_state_publisher',
    label: 'JointStatePublisher',
    category: 'publishers',
    filename: 'gz-sim-joint-state-publisher-system',
    systemName: 'gz::sim::systems::JointStatePublisher',
    scope: 'model',
    githubPath: 'src/systems/joint_state_publisher',
    summary:
      'Publishes joint positions, velocities, and efforts to ROS 2 sensor_msgs/msg/JointState via bridge.',
    gzMsgType: 'gz.msgs.Model',
    ros2MsgType: 'sensor_msgs/msg/JointState',
    defaultTopic: '/world/default/model/{model}/joint_state',
    defaultParams: {
      topic: '/world/default/model/{model}/joint_state',
    },
  },
  {
    id: 'odometry_publisher',
    label: 'OdometryPublisher',
    category: 'publishers',
    filename: 'gz-sim-odometry-publisher-system',
    systemName: 'gz::sim::systems::OdometryPublisher',
    scope: 'model',
    githubPath: 'src/systems/odometry_publisher',
    summary:
      'Publishes 2D/3D ground-truth or Gaussian-noise odometry and TF transforms for mobile robots.',
    gzMsgType: 'gz.msgs.Odometry',
    ros2MsgType: 'nav_msgs/msg/Odometry',
    defaultTopic: '/model/{model}/odometry',
    defaultParams: {
      odom_frame: 'odom',
      robot_base_frame: '{canonical_link}',
      odom_publish_frequency: '50',
      odom_topic: '/model/{model}/odometry',
      tf_topic: '/model/{model}/pose',
      dimensions: '3',
    },
  },
  {
    id: 'pose_publisher',
    label: 'PosePublisher',
    category: 'publishers',
    filename: 'gz-sim-pose-publisher-system',
    systemName: 'gz::sim::systems::PosePublisher',
    scope: 'model',
    githubPath: 'src/systems/pose_publisher',
    summary:
      'Publishes link, visual, collision, and nested model 3D poses for TF2 tree broadcasting.',
    gzMsgType: 'gz.msgs.Pose_V',
    ros2MsgType: 'tf2_msgs/msg/TFMessage',
    defaultTopic: '/model/{model}/pose',
    defaultParams: {
      publish_link_pose: 'true',
      publish_nested_model_pose: 'true',
      use_pose_vector_msg: 'true',
      update_frequency: '50',
    },
  },

  // 3. Sensor Systems
  {
    id: 'gpu_lidar',
    label: 'Sensors + GpuLidar',
    category: 'sensors',
    filename: 'gz-sim-sensors-system',
    systemName: 'gz::sim::systems::Sensors',
    scope: 'sensor',
    githubPath: 'src/systems/sensors',
    summary:
      '360-degree 2D/3D laser rangefinder casting rays against world obstacles and publishing LaserScan.',
    gzMsgType: 'gz.msgs.LaserScan',
    ros2MsgType: 'sensor_msgs/msg/LaserScan',
    defaultTopic: '/model/{model}/scan',
    defaultParams: {
      render_engine: 'ogre2',
      sensor_type: 'gpu_lidar',
      update_rate: '20',
      horizontal_samples: '36',
      min_angle: '-3.14159',
      max_angle: '3.14159',
      min_range: '0.12',
      max_range: '8.0',
      topic: '/model/{model}/scan',
    },
  },
  {
    id: 'imu_sensor',
    label: 'Imu Sensor System',
    category: 'sensors',
    filename: 'gz-sim-imu-system',
    systemName: 'gz::sim::systems::Imu',
    scope: 'sensor',
    githubPath: 'src/systems/imu',
    summary:
      '6-axis Inertial Measurement Unit publishing quaternion orientation, angular velocity, and linear acceleration.',
    gzMsgType: 'gz.msgs.IMU',
    ros2MsgType: 'sensor_msgs/msg/Imu',
    defaultTopic: '/model/{model}/imu',
    defaultParams: {
      sensor_type: 'imu',
      update_rate: '100',
      topic: '/model/{model}/imu',
    },
  },
  {
    id: 'contact_sensor',
    label: 'Contact Sensor System',
    category: 'sensors',
    filename: 'gz-sim-contact-system',
    systemName: 'gz::sim::systems::Contact',
    scope: 'sensor',
    githubPath: 'src/systems/contact',
    summary:
      'Detects physical collisions on a target link collision shape and publishes contact wrenches.',
    gzMsgType: 'gz.msgs.Contacts',
    ros2MsgType: 'ros_gz_interfaces/msg/Contacts',
    defaultTopic: '/model/{model}/contact',
    defaultParams: {
      sensor_type: 'contact',
      update_rate: '50',
      topic: '/model/{model}/contact',
    },
  },
  {
    id: 'camera_sensor',
    label: 'RGBD / Optical Camera',
    category: 'sensors',
    filename: 'gz-sim-sensors-system',
    systemName: 'gz::sim::systems::Sensors',
    scope: 'sensor',
    githubPath: 'src/systems/sensors',
    summary:
      'Optical camera sensor publishing Image and CameraInfo streams for vision pipelines.',
    gzMsgType: 'gz.msgs.Image',
    ros2MsgType: 'sensor_msgs/msg/Image',
    defaultTopic: '/model/{model}/camera/image_raw',
    defaultParams: {
      sensor_type: 'camera',
      update_rate: '30',
      horizontal_fov: '1.047',
      width: '640',
      height: '480',
      topic: '/model/{model}/camera/image_raw',
    },
  },
  {
    id: 'navsat_sensor',
    label: 'NavSat (GNSS / GPS)',
    category: 'sensors',
    filename: 'gz-sim-navsat-system',
    systemName: 'gz::sim::systems::NavSat',
    scope: 'sensor',
    githubPath: 'src/systems/navsat',
    summary:
      'Global Navigation Satellite System sensor outputting latitude, longitude, altitude, and velocity.',
    gzMsgType: 'gz.msgs.NavSat',
    ros2MsgType: 'sensor_msgs/msg/NavSatFix',
    defaultTopic: '/model/{model}/navsat',
    defaultParams: {
      sensor_type: 'navsat',
      update_rate: '10',
      topic: '/model/{model}/navsat',
    },
  },
  {
    id: 'magnetometer_sensor',
    label: 'Magnetometer',
    category: 'sensors',
    filename: 'gz-sim-magnetometer-system',
    systemName: 'gz::sim::systems::Magnetometer',
    scope: 'sensor',
    githubPath: 'src/systems/magnetometer',
    summary:
      'Measures the 3D world magnetic field vector in the robot link coordinate frame.',
    gzMsgType: 'gz.msgs.Magnetometer',
    ros2MsgType: 'sensor_msgs/msg/MagneticField',
    defaultTopic: '/model/{model}/magnetic_field',
    defaultParams: {
      sensor_type: 'magnetometer',
      update_rate: '50',
      topic: '/model/{model}/magnetic_field',
    },
  },

  // 4. World & Environment Systems
  {
    id: 'physics_system',
    label: 'Physics System',
    category: 'world',
    filename: 'gz-sim-physics-system',
    systemName: 'gz::sim::systems::Physics',
    scope: 'world',
    githubPath: 'src/systems/physics',
    summary:
      'Core DART / ODE multi-body rigid dynamics, 3D OBB/wheel contact solver, and constraint engine.',
    gzMsgType: 'gz.msgs.Physics',
    ros2MsgType: 'rosgraph_msgs/msg/Clock',
    defaultTopic: '/clock',
    defaultParams: {
      engine_filename: 'gz-physics-dartsim-plugin',
    },
  },
  {
    id: 'scene_broadcaster',
    label: 'SceneBroadcaster',
    category: 'world',
    filename: 'gz-sim-scene-broadcaster-system',
    systemName: 'gz::sim::systems::SceneBroadcaster',
    scope: 'world',
    githubPath: 'src/systems/scene_broadcaster',
    summary:
      'Broadcasts scene graph state, dynamic entity poses, and visual updates to GUI clients.',
    gzMsgType: 'gz.msgs.Pose_V',
    ros2MsgType: 'tf2_msgs/msg/TFMessage',
    defaultTopic: '/world/default/dynamic_pose/info',
    defaultParams: {},
  },
  {
    id: 'user_commands',
    label: 'UserCommands',
    category: 'world',
    filename: 'gz-sim-user-commands-system',
    systemName: 'gz::sim::systems::UserCommands',
    scope: 'world',
    githubPath: 'src/systems/user_commands',
    summary:
      'Handles runtime entity spawning, deletion, pose manipulation, and scaling services.',
    gzMsgType: 'gz.msgs.EntityFactory',
    ros2MsgType: 'ros_gz_interfaces/srv/SpawnEntity',
    defaultTopic: '/world/default/create',
    defaultParams: {},
  },
  {
    id: 'wind_effects',
    label: 'WindEffects',
    category: 'world',
    filename: 'gz-sim-wind-effects-system',
    systemName: 'gz::sim::systems::WindEffects',
    scope: 'world',
    githubPath: 'src/systems/wind_effects',
    summary:
      'Computes aerodynamic drag forces F = 0.5 * rho * Cd * A * |v_rel| * v_rel on wind-enabled links.',
    gzMsgType: 'gz.msgs.Wind',
    ros2MsgType: 'geometry_msgs/msg/Vector3',
    defaultTopic: '/world/default/wind',
    defaultParams: {
      force_approximation_scaling_factor: '1.0',
    },
  },
];

/**
 * Generates an SDF 1.10 XML snippet for the given system template and target model.
 */
export function generateSdfSystemSnippet(
  template: GzSystemTemplate,
  model?: SimModel | null
): { xml: string; targetTag: 'world' | 'model' | 'link'; targetLinkName?: string } {
  const modelName = model?.name || 'robot';
  const canonicalLink =
    model?.canonicalLink ||
    model?.links.find((l) => l.inertial.mass > 0.05)?.name ||
    model?.links[0]?.name ||
    'base_link';
  const movableJoint =
    model?.joints.find((j) => j.type !== 'fixed')?.name || 'joint_1';
  const leftWheel =
    model?.joints.find((j) => j.name.toLowerCase().includes('left'))?.name ||
    'left_wheel_joint';
  const rightWheel =
    model?.joints.find((j) => j.name.toLowerCase().includes('right'))?.name ||
    'right_wheel_joint';
  const sensorLink =
    model?.links.find((l) => l.name.toLowerCase().includes('lidar') || l.name.toLowerCase().includes('sensor'))?.name ||
    canonicalLink;

  if (template.id === 'diff_drive') {
    return {
      targetTag: 'model',
      xml: `      <plugin filename="${template.filename}" name="${template.systemName}">
        <left_joint>${leftWheel}</left_joint>
        <right_joint>${rightWheel}</right_joint>
        <wheel_separation>0.54</wheel_separation>
        <wheel_radius>0.16</wheel_radius>
        <odom_publish_frequency>50</odom_publish_frequency>
        <topic>/model/${modelName}/cmd_vel</topic>
        <odom_topic>/model/${modelName}/odometry</odom_topic>
        <tf_topic>/model/${modelName}/tf</tf_topic>
        <frame_id>odom</frame_id>
        <child_frame_id>${model?.virtualRootLink || canonicalLink}</child_frame_id>
      </plugin>`,
    };
  }

  if (template.id === 'joint_position_controller') {
    return {
      targetTag: 'model',
      xml: `      <plugin filename="${template.filename}" name="${template.systemName}">
        <joint_name>${movableJoint}</joint_name>
        <topic>/model/${modelName}/joint/${movableJoint}/cmd_pos</topic>
        <p_gain>25.0</p_gain>
        <i_gain>0.1</i_gain>
        <d_gain>1.5</d_gain>
      </plugin>`,
    };
  }

  if (template.id === 'joint_velocity_controller') {
    return {
      targetTag: 'model',
      xml: `      <plugin filename="${template.filename}" name="${template.systemName}">
        <joint_name>${movableJoint}</joint_name>
        <topic>/model/${modelName}/joint/${movableJoint}/cmd_vel</topic>
        <p_gain>8.0</p_gain>
        <i_gain>0.05</i_gain>
        <d_gain>0.2</d_gain>
      </plugin>`,
    };
  }

  if (template.id === 'joint_controller') {
    return {
      targetTag: 'model',
      xml: `      <plugin filename="${template.filename}" name="${template.systemName}">
        <joint_name>${movableJoint}</joint_name>
        <use_force_commands>true</use_force_commands>
        <topic>/model/${modelName}/joint/${movableJoint}/cmd_force</topic>
      </plugin>`,
    };
  }

  if (template.id === 'joint_state_publisher') {
    return {
      targetTag: 'model',
      xml: `      <plugin filename="${template.filename}" name="${template.systemName}">
        <topic>/world/default/model/${modelName}/joint_state</topic>
      </plugin>`,
    };
  }

  if (template.id === 'odometry_publisher') {
    return {
      targetTag: 'model',
      xml: `      <plugin filename="${template.filename}" name="${template.systemName}">
        <odom_frame>odom</odom_frame>
        <robot_base_frame>${model?.virtualRootLink || canonicalLink}</robot_base_frame>
        <odom_publish_frequency>50</odom_publish_frequency>
        <odom_topic>/model/${modelName}/odometry</odom_topic>
        <tf_topic>/model/${modelName}/pose</tf_topic>
        <dimensions>3</dimensions>
      </plugin>`,
    };
  }

  if (template.id === 'pose_publisher') {
    return {
      targetTag: 'model',
      xml: `      <plugin filename="${template.filename}" name="${template.systemName}">
        <publish_link_pose>true</publish_link_pose>
        <publish_nested_model_pose>true</publish_nested_model_pose>
        <use_pose_vector_msg>true</use_pose_vector_msg>
        <update_frequency>50</update_frequency>
      </plugin>`,
    };
  }

  if (template.id === 'gpu_lidar') {
    return {
      targetTag: 'link',
      targetLinkName: sensorLink,
      xml: `        <sensor name="gpu_lidar" type="gpu_lidar">
          <pose>0 0 0.06 0 0 0</pose>
          <topic>/model/${modelName}/scan</topic>
          <update_rate>20</update_rate>
          <always_on>true</always_on>
          <visualize>true</visualize>
          <lidar>
            <scan>
              <horizontal>
                <samples>36</samples>
                <resolution>1</resolution>
                <min_angle>-3.14159</min_angle>
                <max_angle>3.14159</max_angle>
              </horizontal>
            </scan>
            <range>
              <min>0.12</min>
              <max>8.0</max>
              <resolution>0.01</resolution>
            </range>
          </lidar>
        </sensor>`,
    };
  }

  if (template.id === 'imu_sensor') {
    return {
      targetTag: 'link',
      targetLinkName: canonicalLink,
      xml: `        <sensor name="imu_sensor" type="imu">
          <always_on>true</always_on>
          <update_rate>100</update_rate>
          <visualize>true</visualize>
          <topic>/model/${modelName}/imu</topic>
        </sensor>`,
    };
  }

  if (template.id === 'contact_sensor') {
    return {
      targetTag: 'link',
      targetLinkName: canonicalLink,
      xml: `        <sensor name="bumper_contact" type="contact">
          <always_on>true</always_on>
          <update_rate>50</update_rate>
          <visualize>true</visualize>
          <topic>/model/${modelName}/contact</topic>
          <contact>
            <collision>collision</collision>
          </contact>
        </sensor>`,
    };
  }

  if (template.id === 'camera_sensor') {
    return {
      targetTag: 'link',
      targetLinkName: sensorLink,
      xml: `        <sensor name="rgbd_camera" type="camera">
          <always_on>true</always_on>
          <update_rate>30</update_rate>
          <visualize>true</visualize>
          <topic>/model/${modelName}/camera/image_raw</topic>
          <camera>
            <horizontal_fov>1.047</horizontal_fov>
            <image>
              <width>640</width>
              <height>480</height>
            </image>
            <clip>
              <near>0.1</near>
              <far>25.0</far>
            </clip>
          </camera>
        </sensor>`,
    };
  }

  if (template.id === 'navsat_sensor' || template.id === 'magnetometer_sensor') {
    const sType = template.id === 'navsat_sensor' ? 'navsat' : 'magnetometer';
    return {
      targetTag: 'link',
      targetLinkName: canonicalLink,
      xml: `        <sensor name="${sType}_sensor" type="${sType}">
          <always_on>true</always_on>
          <update_rate>20</update_rate>
          <topic>/model/${modelName}/${sType}</topic>
        </sensor>`,
    };
  }

  // World-level plugin fallback
  return {
    targetTag: 'world',
    xml: `    <plugin filename="${template.filename}" name="${template.systemName}">
    </plugin>`,
  };
}

/**
 * Generates a ROS 2 URDF <gazebo> or <gazebo reference="..."> XML block for the given system template.
 */
export function generateUrdfGazeboSnippet(
  template: GzSystemTemplate,
  model?: SimModel | null
): string {
  const sdfGen = generateSdfSystemSnippet(template, model);
  if (sdfGen.targetTag === 'link' && sdfGen.targetLinkName) {
    return `\n  <!-- Gazebo Harmonic Sensor Extension (${template.systemName}) -->
  <gazebo reference="${sdfGen.targetLinkName}">
${sdfGen.xml.replace(/^ {4}/gm, '')}
  </gazebo>`;
  }

  return `\n  <!-- Gazebo Harmonic System Plugin (${template.systemName}) -->
  <gazebo>
${sdfGen.xml.replace(/^ {2}/gm, '')}
  </gazebo>`;
}

/**
 * Injects the selected gz-sim system plugin or sensor directly into an SDF or URDF source string.
 */
export function injectSystemPluginIntoXml(
  xmlContent: string,
  format: 'sdf' | 'urdf',
  templateId: string,
  model?: SimModel | null
): string {
  const template =
    GZ_SYSTEM_TEMPLATES.find((t) => t.id === templateId) || GZ_SYSTEM_TEMPLATES[0];

  if (format === 'urdf' || xmlContent.includes('</robot>')) {
    const urdfSnippet = generateUrdfGazeboSnippet(template, model);
    if (xmlContent.includes('</robot>')) {
      return xmlContent.replace('</robot>', `${urdfSnippet}\n</robot>`);
    }
    return `${xmlContent}\n${urdfSnippet}`;
  }

  const sdfGen = generateSdfSystemSnippet(template, model);
  if (sdfGen.targetTag === 'link' && sdfGen.targetLinkName) {
    const linkRegex = new RegExp(
      `(<link\\s+name=["']${sdfGen.targetLinkName}["'][\\s\\S]*?)(<\\/link>)`
    );
    if (linkRegex.test(xmlContent)) {
      return xmlContent.replace(linkRegex, `$1\n${sdfGen.xml}\n      $2`);
    }
  }

  if (sdfGen.targetTag === 'model' && model) {
    const modelRegex = new RegExp(
      `(<model\\s+name=["']${model.name}["'][\\s\\S]*?)(<\\/model>)`
    );
    if (modelRegex.test(xmlContent)) {
      return xmlContent.replace(modelRegex, `$1\n${sdfGen.xml}\n    $2`);
    }
  }

  if (xmlContent.includes('</world>')) {
    return xmlContent.replace('</world>', `${sdfGen.xml}\n  </world>`);
  }

  return `${xmlContent}\n${sdfGen.xml}`;
}

/**
 * Builds the live Gazebo Transport topic table and maps every topic to its ROS 2 `ros_gz_bridge` equivalent.
 */
export function buildWorldGzTopicsAndRos2Bridge(world: ParsedWorld | null): GzTopicInfo[] {
  if (!world) return [];
  const topics: GzTopicInfo[] = [
    {
      gzTopic: '/clock',
      rosTopic: '/clock',
      gzMsgType: 'gz.msgs.Clock',
      rosMsgType: 'rosgraph_msgs/msg/Clock',
      direction: 'GZ_TO_ROS',
      frequencyHz: 1000,
      sourcePlugin: 'gz::sim::systems::Physics',
      lastPayload: `{ sim: { sec: 0, nsec: 0 } }`,
    },
    {
      gzTopic: `/world/${world.name}/dynamic_pose/info`,
      rosTopic: '/tf',
      gzMsgType: 'gz.msgs.Pose_V',
      rosMsgType: 'tf2_msgs/msg/TFMessage',
      direction: 'GZ_TO_ROS',
      frequencyHz: 60,
      sourcePlugin: 'gz::sim::systems::SceneBroadcaster',
      lastPayload: `poses_count: ${world.models.length}`,
    },
  ];

  if (world.wind.enabled) {
    topics.push({
      gzTopic: `/world/${world.name}/wind`,
      rosTopic: '/wind',
      gzMsgType: 'gz.msgs.Wind',
      rosMsgType: 'geometry_msgs/msg/Vector3',
      direction: 'ROS_TO_GZ',
      frequencyHz: 10,
      sourcePlugin: 'gz::sim::systems::WindEffects',
      lastPayload: `linear_velocity: [${world.wind.linearVelocity.map((v) => v.toFixed(2)).join(', ')}]`,
    });
  }

  for (const model of world.models) {
    if (model.isStatic || model.name === 'ground_plane') continue;

    // Velocity command topic (DiffDrive / mobile base)
    topics.push({
      gzTopic: `/model/${model.name}/cmd_vel`,
      rosTopic: `/${model.name}/cmd_vel`,
      gzMsgType: 'gz.msgs.Twist',
      rosMsgType: 'geometry_msgs/msg/Twist',
      direction: 'ROS_TO_GZ',
      frequencyHz: 50,
      sourcePlugin: 'gz::sim::systems::DiffDrive',
      lastPayload: `linear: {x: ${model.cmdVel.linearX.toFixed(2)}}, angular: {z: ${model.cmdVel.angularZ.toFixed(2)}}`,
    });

    // Odometry topic
    topics.push({
      gzTopic: `/model/${model.name}/odometry`,
      rosTopic: `/${model.name}/odom`,
      gzMsgType: 'gz.msgs.Odometry',
      rosMsgType: 'nav_msgs/msg/Odometry',
      direction: 'GZ_TO_ROS',
      frequencyHz: 50,
      sourcePlugin: 'gz::sim::systems::OdometryPublisher',
      lastPayload: `pose: [${model.pose.slice(0, 3).map((v) => v.toFixed(2)).join(', ')}], rpy: [${model.pose.slice(3).map((v) => v.toFixed(2)).join(', ')}]`,
    });

    if (model.joints.some((j) => j.type !== 'fixed')) {
      topics.push({
        gzTopic: `/world/${world.name}/model/${model.name}/joint_state`,
        rosTopic: `/${model.name}/joint_states`,
        gzMsgType: 'gz.msgs.Model',
        rosMsgType: 'sensor_msgs/msg/JointState',
        direction: 'GZ_TO_ROS',
        frequencyHz: 50,
        sourcePlugin: 'gz::sim::systems::JointStatePublisher',
        lastPayload: model.joints
          .filter((j) => j.type !== 'fixed')
          .map((j) => `${j.name}: ${j.position.toFixed(2)}`)
          .join(', '),
      });
    }

    // Link sensors
    for (const link of model.links) {
      for (const sensor of link.sensors || []) {
        if (sensor.type === 'gpu_lidar') {
          const minHit =
            sensor.lidar && sensor.lidar.ranges.length > 0
              ? Math.min(...sensor.lidar.ranges).toFixed(2)
              : '8.00';
          topics.push({
            gzTopic: sensor.topic || `/model/${model.name}/scan`,
            rosTopic: `/${model.name}/scan`,
            gzMsgType: 'gz.msgs.LaserScan',
            rosMsgType: 'sensor_msgs/msg/LaserScan',
            direction: 'GZ_TO_ROS',
            frequencyHz: sensor.updateRate || 20,
            sourcePlugin: 'gz::sim::systems::Sensors (GpuLidar)',
            lastPayload: `samples: ${sensor.lidar?.horizontalSamples || 36}, min_dist: ${minHit}m`,
          });
        } else if (sensor.type === 'imu') {
          const acc = sensor.imu?.linearAcceleration || [0, 0, 9.81];
          topics.push({
            gzTopic: sensor.topic || `/model/${model.name}/imu`,
            rosTopic: `/${model.name}/imu`,
            gzMsgType: 'gz.msgs.IMU',
            rosMsgType: 'sensor_msgs/msg/Imu',
            direction: 'GZ_TO_ROS',
            frequencyHz: sensor.updateRate || 100,
            sourcePlugin: 'gz::sim::systems::Imu',
            lastPayload: `accel: [${acc.map((v) => v.toFixed(2)).join(', ')}] m/s²`,
          });
        } else if (sensor.type === 'contact') {
          topics.push({
            gzTopic: sensor.topic || `/model/${model.name}/contact`,
            rosTopic: `/${model.name}/contact`,
            gzMsgType: 'gz.msgs.Contacts',
            rosMsgType: 'ros_gz_interfaces/msg/Contacts',
            direction: 'GZ_TO_ROS',
            frequencyHz: sensor.updateRate || 50,
            sourcePlugin: 'gz::sim::systems::Contact',
            lastPayload: `touching: ${Boolean(sensor.contact?.touching)}, F_n: ${(sensor.contact?.normalForce || 0).toFixed(1)}N`,
          });
        } else if (sensor.type === 'camera') {
          topics.push({
            gzTopic: sensor.topic || `/model/${model.name}/camera/image_raw`,
            rosTopic: `/${model.name}/camera/image_raw`,
            gzMsgType: 'gz.msgs.Image',
            rosMsgType: 'sensor_msgs/msg/Image',
            direction: 'GZ_TO_ROS',
            frequencyHz: sensor.updateRate || 30,
            sourcePlugin: 'gz::sim::systems::Sensors (Camera)',
            lastPayload: `640x480 RGB8 @ ${sensor.updateRate || 30}Hz`,
          });
        }
      }
    }
  }

  return topics;
}

/**
 * Generates a ready-to-use ROS 2 `ros_gz_bridge` YAML configuration file
 * (`ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=ros_gz_bridge.yaml`).
 */
export function generateRos2BridgeYaml(world: ParsedWorld | null): string {
  const topics = buildWorldGzTopicsAndRos2Bridge(world);
  const lines: string[] = [
    '# Auto-generated ROS 2 <-> Gazebo Harmonic (gz-sim8) Bridge Configuration',
    '# Usage: ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=ros_gz_bridge.yaml',
    '',
  ];

  for (const t of topics) {
    lines.push(`- ros_topic_name: "${t.rosTopic}"`);
    lines.push(`  gz_topic_name: "${t.gzTopic}"`);
    lines.push(`  ros_type_name: "${t.rosMsgType}"`);
    lines.push(`  gz_type_name: "${t.gzMsgType}"`);
    lines.push(`  direction: ${t.direction}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Generates the CLI command for `ros2 run ros_gz_bridge parameter_bridge` arguments.
 */
export function generateRos2BridgeCliCommand(world: ParsedWorld | null): string {
  const topics = buildWorldGzTopicsAndRos2Bridge(world);
  const args = topics.map((t) => {
    const dirSymbol =
      t.direction === 'GZ_TO_ROS'
        ? '['
        : t.direction === 'ROS_TO_GZ'
        ? ']'
        : '@';
    return `${t.gzTopic}${dirSymbol}${t.rosMsgType}${dirSymbol}${t.gzMsgType}`;
  });
  return `ros2 run ros_gz_bridge parameter_bridge \\\n  ${args.join(' \\\n  ')}`;
}
