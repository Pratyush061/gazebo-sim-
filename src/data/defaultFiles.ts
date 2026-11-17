import { VirtualFile } from '../types/simulation';

export const DEFAULT_FILES: VirtualFile[] = [
  {
    id: 'file-empty-sdf',
    name: 'empty.sdf',
    path: 'worlds/empty.sdf',
    folder: 'worlds',
    description: 'Default Gazebo Harmonic empty world with ground_plane and sun light',
    lastModified: Date.now() - 3600000 * 5,
    content: `<?xml version="1.0" ?>
<sdf version="1.10">
  <world name="default">
    <physics name="1ms" type="ignored">
      <max_step_size>0.001</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>

    <gravity>0 0 -9.81</gravity>
    <magnetic_field>6e-06 2.3e-05 -4.2e-05</magnetic_field>

    <wind>
      <linear_velocity>0.0 0.0 0.0</linear_velocity>
    </wind>

    <light type="directional" name="sun">
      <cast_shadows>true</cast_shadows>
      <pose>0 0 10 0 0 0</pose>
      <diffuse>0.8 0.8 0.8 1</diffuse>
      <specular>0.2 0.2 0.2 1</specular>
      <direction>-0.5 0.1 -0.9</direction>
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
          <surface>
            <friction>
              <ode>
                <mu>1.0</mu>
                <mu2>1.0</mu2>
              </ode>
            </friction>
          </surface>
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
            <specular>0.8 0.8 0.8 1</specular>
          </material>
        </visual>
      </link>
    </model>
  </world>
</sdf>`
  },
  {
    id: 'file-r2d2-sdf',
    name: 'r2d2_starwars.sdf',
    path: 'worlds/r2d2_starwars.sdf',
    folder: 'worlds',
    description: 'Star Wars R2-D2 Astromech Droid with rotating dome, differential drive legs, wind & crates',
    lastModified: Date.now() - 3600000 * 4,
    content: `<?xml version="1.0" ?>
<sdf version="1.10">
  <world name="default">
    <physics name="1ms" type="ode">
      <max_step_size>0.002</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>

    <gravity>0 0 -9.81</gravity>
    <wind>
      <linear_velocity>2.5 1.0 0.0</linear_velocity>
    </wind>

    <light type="directional" name="sun">
      <cast_shadows>true</cast_shadows>
      <pose>0 0 12 0 0 0</pose>
      <diffuse>0.95 0.93 0.88 1</diffuse>
      <specular>0.3 0.3 0.3 1</specular>
      <direction>-0.4 0.3 -0.85</direction>
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
          <surface>
            <friction>
              <ode>
                <mu>0.9</mu>
                <mu2>0.9</mu2>
              </ode>
            </friction>
          </surface>
        </collision>
        <visual name="visual">
          <geometry>
            <plane>
              <normal>0 0 1</normal>
              <size>100 100</size>
            </plane>
          </geometry>
          <material>
            <ambient>0.78 0.78 0.78 1</ambient>
            <diffuse>0.78 0.78 0.78 1</diffuse>
            <specular>0.2 0.2 0.2 1</specular>
          </material>
        </visual>
      </link>
    </model>

    <!-- R2-D2 Astromech Droid Model -->
    <model name="r2d2">
      <static>false</static>
      <self_collide>false</self_collide>
      <pose>0 0 0.0 0 0 0</pose>

      <link name="base_link">
        <pose>0 0 0.52 0 0 0</pose>
        <enable_wind>false</enable_wind>
        <inertial>
          <mass>32.0</mass>
          <pose>0 0 -0.05 0 0 0</pose>
          <inertia>
            <ixx>1.45</ixx>
            <ixy>0.0</ixy>
            <ixz>0.0</ixz>
            <iyy>1.45</iyy>
            <iyz>0.0</iyz>
            <izz>0.85</izz>
          </inertia>
        </inertial>
        <collision name="body_collision">
          <geometry>
            <cylinder>
              <radius>0.26</radius>
              <length>0.64</length>
            </cylinder>
          </geometry>
        </collision>
        <visual name="body_barrel">
          <geometry>
            <cylinder>
              <radius>0.25</radius>
              <length>0.62</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.94 0.95 0.97 1</ambient>
            <diffuse>0.94 0.95 0.97 1</diffuse>
            <specular>0.4 0.4 0.45 1</specular>
          </material>
        </visual>
        <visual name="blue_chest_panel">
          <pose>0.21 0 0.12 0 0 0</pose>
          <geometry>
            <box>
              <size>0.09 0.26 0.24</size>
            </box>
          </geometry>
          <material>
            <ambient>0.11 0.32 0.78 1</ambient>
            <diffuse>0.11 0.32 0.78 1</diffuse>
            <specular>0.6 0.6 0.7 1</specular>
          </material>
        </visual>
        <visual name="center_strut_foot">
          <pose>0.12 0 -0.38 0 0 0</pose>
          <geometry>
            <box>
              <size>0.18 0.12 0.24</size>
            </box>
          </geometry>
          <material>
            <ambient>0.88 0.89 0.92 1</ambient>
            <diffuse>0.88 0.89 0.92 1</diffuse>
            <specular>0.3 0.3 0.3 1</specular>
          </material>
        </visual>
      </link>

      <link name="dome_link">
        <pose>0 0 0.83 0 0 0</pose>
        <inertial>
          <mass>4.5</mass>
          <inertia>
            <ixx>0.12</ixx>
            <ixy>0.0</ixy>
            <ixz>0.0</ixz>
            <iyy>0.12</iyy>
            <iyz>0.0</iyz>
            <izz>0.15</izz>
          </inertia>
        </inertial>
        <collision name="dome_collision">
          <geometry>
            <sphere>
              <radius>0.25</radius>
            </sphere>
          </geometry>
        </collision>
        <visual name="chrome_dome">
          <geometry>
            <sphere>
              <radius>0.248</radius>
            </sphere>
          </geometry>
          <material>
            <ambient>0.75 0.79 0.84 1</ambient>
            <diffuse>0.82 0.85 0.90 1</diffuse>
            <specular>0.95 0.95 0.98 1</specular>
          </material>
        </visual>
        <visual name="photoreceptor_eye">
          <pose>0.22 0 0.08 0 1.57 0</pose>
          <geometry>
            <cylinder>
              <radius>0.045</radius>
              <length>0.06</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.05 0.08 0.15 1</ambient>
            <diffuse>0.08 0.15 0.35 1</diffuse>
            <specular>0.9 0.9 1.0 1</specular>
          </material>
        </visual>
        <visual name="status_logic_lamp">
          <pose>0.23 -0.08 0.03 0 0 0</pose>
          <geometry>
            <sphere>
              <radius>0.022</radius>
            </sphere>
          </geometry>
          <material>
            <ambient>0.9 0.15 0.15 1</ambient>
            <diffuse>0.95 0.2 0.2 1</diffuse>
            <specular>0.8 0.8 0.8 1</specular>
          </material>
        </visual>
      </link>

      <link name="left_leg_link">
        <pose>0 0.31 0.38 0 0 0</pose>
        <inertial>
          <mass>5.0</mass>
          <inertia>
            <ixx>0.18</ixx>
            <ixy>0.0</ixy>
            <ixz>0.0</ixz>
            <iyy>0.18</iyy>
            <iyz>0.0</iyz>
            <izz>0.06</izz>
          </inertia>
        </inertial>
        <collision name="left_leg_col">
          <geometry>
            <box>
              <size>0.22 0.10 0.76</size>
            </box>
          </geometry>
        </collision>
        <visual name="left_leg_strut">
          <geometry>
            <box>
              <size>0.14 0.09 0.62</size>
            </box>
          </geometry>
          <material>
            <ambient>0.92 0.93 0.95 1</ambient>
            <diffuse>0.92 0.93 0.95 1</diffuse>
            <specular>0.4 0.4 0.4 1</specular>
          </material>
        </visual>
        <visual name="left_leg_blue_stripe">
          <pose>0 0.048 0.05 0 0 0</pose>
          <geometry>
            <box>
              <size>0.07 0.015 0.44</size>
            </box>
          </geometry>
          <material>
            <ambient>0.11 0.32 0.78 1</ambient>
            <diffuse>0.11 0.32 0.78 1</diffuse>
            <specular>0.5 0.5 0.6 1</specular>
          </material>
        </visual>
      </link>

      <link name="right_leg_link">
        <pose>0 -0.31 0.38 0 0 0</pose>
        <inertial>
          <mass>5.0</mass>
          <inertia>
            <ixx>0.18</ixx>
            <ixy>0.0</ixy>
            <ixz>0.0</ixz>
            <iyy>0.18</iyy>
            <iyz>0.0</iyz>
            <izz>0.06</izz>
          </inertia>
        </inertial>
        <collision name="right_leg_col">
          <geometry>
            <box>
              <size>0.22 0.10 0.76</size>
            </box>
          </geometry>
        </collision>
        <visual name="right_leg_strut">
          <geometry>
            <box>
              <size>0.14 0.09 0.62</size>
            </box>
          </geometry>
          <material>
            <ambient>0.92 0.93 0.95 1</ambient>
            <diffuse>0.92 0.93 0.95 1</diffuse>
            <specular>0.4 0.4 0.4 1</specular>
          </material>
        </visual>
        <visual name="right_leg_blue_stripe">
          <pose>0 -0.048 0.05 0 0 0</pose>
          <geometry>
            <box>
              <size>0.07 0.015 0.44</size>
            </box>
          </geometry>
          <material>
            <ambient>0.11 0.32 0.78 1</ambient>
            <diffuse>0.11 0.32 0.78 1</diffuse>
            <specular>0.5 0.5 0.6 1</specular>
          </material>
        </visual>
      </link>

      <joint name="dome_swivel_joint" type="revolute">
        <parent>base_link</parent>
        <child>dome_link</child>
        <pose>0 0 0 0 0 0</pose>
        <axis>
          <xyz>0 0 1</xyz>
          <limit>
            <lower>-3.14159</lower>
            <upper>3.14159</upper>
            <effort>25.0</effort>
            <velocity>3.0</velocity>
          </limit>
          <dynamics>
            <damping>0.4</damping>
            <friction>0.1</friction>
          </dynamics>
        </axis>
      </joint>

      <joint name="left_shoulder_joint" type="revolute">
        <parent>base_link</parent>
        <child>left_leg_link</child>
        <axis>
          <xyz>0 1 0</xyz>
          <limit>
            <lower>-0.6</lower>
            <upper>0.6</upper>
            <effort>60.0</effort>
            <velocity>2.0</velocity>
          </limit>
        </axis>
      </joint>

      <joint name="right_shoulder_joint" type="revolute">
        <parent>base_link</parent>
        <child>right_leg_link</child>
        <axis>
          <xyz>0 1 0</xyz>
          <limit>
            <lower>-0.6</lower>
            <upper>0.6</upper>
            <effort>60.0</effort>
            <velocity>2.0</velocity>
          </limit>
        </axis>
      </joint>
    </model>

    <!-- Dynamic Weather Probe Sphere Affected by Wind -->
    <model name="wind_probe_sphere">
      <static>false</static>
      <pose>-1.8 1.5 0.28 0 0 0</pose>
      <link name="probe_link">
        <enable_wind>true</enable_wind>
        <inertial>
          <mass>1.2</mass>
          <inertia>
            <ixx>0.04</ixx>
            <ixy>0.0</ixy>
            <ixz>0.0</ixz>
            <iyy>0.04</iyy>
            <iyz>0.0</iyz>
            <izz>0.04</izz>
          </inertia>
        </inertial>
        <collision name="collision">
          <geometry>
            <sphere>
              <radius>0.28</radius>
            </sphere>
          </geometry>
          <surface>
            <friction>
              <ode>
                <mu>0.4</mu>
                <mu2>0.4</mu2>
              </ode>
            </friction>
          </surface>
        </collision>
        <visual name="visual">
          <geometry>
            <sphere>
              <radius>0.28</radius>
            </sphere>
          </geometry>
          <material>
            <ambient>0.95 0.45 0.08 1</ambient>
            <diffuse>0.95 0.45 0.08 1</diffuse>
            <specular>0.6 0.6 0.6 1</specular>
          </material>
        </visual>
      </link>
    </model>

    <!-- Hangar Cargo Crate -->
    <model name="supply_crate">
      <static>false</static>
      <pose>2.0 -1.2 0.4 0 0 0.35</pose>
      <link name="crate_link">
        <enable_wind>false</enable_wind>
        <inertial>
          <mass>12.0</mass>
          <inertia>
            <ixx>1.2</ixx>
            <ixy>0.0</ixy>
            <ixz>0.0</ixz>
            <iyy>1.2</iyy>
            <iyz>0.0</iyz>
            <izz>1.2</izz>
          </inertia>
        </inertial>
        <collision name="collision">
          <geometry>
            <box>
              <size>0.8 0.8 0.8</size>
            </box>
          </geometry>
        </collision>
        <visual name="visual">
          <geometry>
            <box>
              <size>0.8 0.8 0.8</size>
            </box>
          </geometry>
          <material>
            <ambient>0.35 0.42 0.48 1</ambient>
            <diffuse>0.38 0.46 0.52 1</diffuse>
            <specular>0.3 0.3 0.3 1</specular>
          </material>
        </visual>
      </link>
    </model>
  </world>
</sdf>`
  },
  {
    id: 'file-arm-6dof-sdf',
    name: 'robotic_arm_6dof.sdf',
    path: 'worlds/robotic_arm_6dof.sdf',
    folder: 'worlds',
    description: '6-DOF articulated industrial robotic arm with parallel gripper and calibration cubes',
    lastModified: Date.now() - 3600000 * 3,
    content: `<?xml version="1.0" ?>
<sdf version="1.10">
  <world name="default">
    <physics name="1ms" type="ode">
      <max_step_size>0.002</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>

    <gravity>0 0 -9.81</gravity>
    <wind>
      <linear_velocity>0.0 0.0 0.0</linear_velocity>
    </wind>

    <light type="directional" name="sun">
      <cast_shadows>true</cast_shadows>
      <pose>2 -3 10 0 0 0</pose>
      <diffuse>0.9 0.9 0.9 1</diffuse>
      <specular>0.3 0.3 0.3 1</specular>
      <direction>-0.3 0.4 -0.85</direction>
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

    <!-- 6-DOF Articulated Industrial Manipulator -->
    <model name="kuka_arm_6dof">
      <static>false</static>
      <pose>0 0 0 0 0 0</pose>

      <link name="base_pedestal">
        <pose>0 0 0.15 0 0 0</pose>
        <inertial>
          <mass>45.0</mass>
          <inertia>
            <ixx>1.8</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>1.8</iyy>
            <iyz>0</iyz>
            <izz>2.2</izz>
          </inertia>
        </inertial>
        <collision name="base_col">
          <geometry>
            <cylinder>
              <radius>0.32</radius>
              <length>0.30</length>
            </cylinder>
          </geometry>
        </collision>
        <visual name="base_vis">
          <geometry>
            <cylinder>
              <radius>0.32</radius>
              <length>0.30</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.18 0.20 0.24 1</ambient>
            <diffuse>0.20 0.22 0.26 1</diffuse>
            <specular>0.5 0.5 0.5 1</specular>
          </material>
        </visual>
      </link>

      <link name="shoulder_turret">
        <pose>0 0 0.45 0 0 0</pose>
        <inertial>
          <mass>14.0</mass>
          <inertia>
            <ixx>0.45</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.45</iyy>
            <iyz>0</iyz>
            <izz>0.35</izz>
          </inertia>
        </inertial>
        <collision name="turret_col">
          <geometry>
            <cylinder>
              <radius>0.22</radius>
              <length>0.32</length>
            </cylinder>
          </geometry>
        </collision>
        <visual name="turret_vis">
          <geometry>
            <cylinder>
              <radius>0.22</radius>
              <length>0.32</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.95 0.45 0.05 1</ambient>
            <diffuse>0.96 0.48 0.08 1</diffuse>
            <specular>0.6 0.6 0.6 1</specular>
          </material>
        </visual>
      </link>

      <link name="upper_arm_link">
        <pose>0 0 0.95 0 0.25 0</pose>
        <inertial>
          <mass>9.5</mass>
          <inertia>
            <ixx>0.65</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.65</iyy>
            <iyz>0</iyz>
            <izz>0.12</izz>
          </inertia>
        </inertial>
        <collision name="upper_arm_col">
          <geometry>
            <capsule>
              <radius>0.11</radius>
              <length>0.75</length>
            </capsule>
          </geometry>
        </collision>
        <visual name="upper_arm_vis">
          <geometry>
            <capsule>
              <radius>0.11</radius>
              <length>0.75</length>
            </capsule>
          </geometry>
          <material>
            <ambient>0.95 0.45 0.05 1</ambient>
            <diffuse>0.96 0.48 0.08 1</diffuse>
            <specular>0.6 0.6 0.6 1</specular>
          </material>
        </visual>
      </link>

      <link name="forearm_link">
        <pose>0.28 0 1.42 0 0.85 0</pose>
        <inertial>
          <mass>6.0</mass>
          <inertia>
            <ixx>0.32</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.32</iyy>
            <iyz>0</iyz>
            <izz>0.08</izz>
          </inertia>
        </inertial>
        <collision name="forearm_col">
          <geometry>
            <capsule>
              <radius>0.085</radius>
              <length>0.58</length>
            </capsule>
          </geometry>
        </collision>
        <visual name="forearm_vis">
          <geometry>
            <capsule>
              <radius>0.085</radius>
              <length>0.58</length>
            </capsule>
          </geometry>
          <material>
            <ambient>0.88 0.90 0.92 1</ambient>
            <diffuse>0.88 0.90 0.92 1</diffuse>
            <specular>0.5 0.5 0.5 1</specular>
          </material>
        </visual>
      </link>

      <link name="wrist_gripper_link">
        <pose>0.62 0 1.58 0 1.25 0</pose>
        <inertial>
          <mass>2.2</mass>
          <inertia>
            <ixx>0.05</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.05</iyy>
            <iyz>0</iyz>
            <izz>0.04</izz>
          </inertia>
        </inertial>
        <collision name="wrist_col">
          <geometry>
            <box>
              <size>0.18 0.24 0.12</size>
            </box>
          </geometry>
        </collision>
        <visual name="wrist_housing">
          <geometry>
            <box>
              <size>0.16 0.22 0.10</size>
            </box>
          </geometry>
          <material>
            <ambient>0.15 0.17 0.20 1</ambient>
            <diffuse>0.18 0.20 0.24 1</diffuse>
            <specular>0.7 0.7 0.7 1</specular>
          </material>
        </visual>
        <visual name="left_jaw_finger">
          <pose>0.12 0.08 0 0 0 0</pose>
          <geometry>
            <box>
              <size>0.14 0.03 0.06</size>
            </box>
          </geometry>
          <material>
            <ambient>0.95 0.45 0.05 1</ambient>
            <diffuse>0.96 0.48 0.08 1</diffuse>
            <specular>0.5 0.5 0.5 1</specular>
          </material>
        </visual>
        <visual name="right_jaw_finger">
          <pose>0.12 -0.08 0 0 0 0</pose>
          <geometry>
            <box>
              <size>0.14 0.03 0.06</size>
            </box>
          </geometry>
          <material>
            <ambient>0.95 0.45 0.05 1</ambient>
            <diffuse>0.96 0.48 0.08 1</diffuse>
            <specular>0.5 0.5 0.5 1</specular>
          </material>
        </visual>
      </link>

      <joint name="joint_1_waist_yaw" type="revolute">
        <parent>base_pedestal</parent>
        <child>shoulder_turret</child>
        <pose>0 0 -0.15 0 0 0</pose>
        <axis>
          <xyz>0 0 1</xyz>
          <limit>
            <lower>-3.14</lower>
            <upper>3.14</upper>
            <effort>150.0</effort>
            <velocity>2.5</velocity>
          </limit>
        </axis>
      </joint>

      <joint name="joint_2_shoulder_pitch" type="revolute">
        <parent>shoulder_turret</parent>
        <child>upper_arm_link</child>
        <pose>0 0 -0.35 0 0 0</pose>
        <axis>
          <xyz>0 1 0</xyz>
          <limit>
            <lower>-1.8</lower>
            <upper>1.8</upper>
            <effort>120.0</effort>
            <velocity>2.0</velocity>
          </limit>
        </axis>
      </joint>

      <joint name="joint_3_elbow_pitch" type="revolute">
        <parent>upper_arm_link</parent>
        <child>forearm_link</child>
        <pose>0 0 -0.32 0 0 0</pose>
        <axis>
          <xyz>0 1 0</xyz>
          <limit>
            <lower>-2.2</lower>
            <upper>2.2</upper>
            <effort>90.0</effort>
            <velocity>2.5</velocity>
          </limit>
        </axis>
      </joint>

      <joint name="joint_4_wrist_pitch" type="revolute">
        <parent>forearm_link</parent>
        <child>wrist_gripper_link</child>
        <pose>-0.08 0 0 0 0 0</pose>
        <axis>
          <xyz>0 1 0</xyz>
          <limit>
            <lower>-2.5</lower>
            <upper>2.5</upper>
            <effort>45.0</effort>
            <velocity>3.5</velocity>
          </limit>
        </axis>
      </joint>
    </model>

    <!-- Target Inspection Table & Payload Block -->
    <model name="assembly_pedestal">
      <static>true</static>
      <pose>1.15 0 0.35 0 0 0</pose>
      <link name="table_link">
        <collision name="col">
          <geometry>
            <box>
              <size>0.65 0.85 0.70</size>
            </box>
          </geometry>
        </collision>
        <visual name="vis">
          <geometry>
            <box>
              <size>0.65 0.85 0.70</size>
            </box>
          </geometry>
          <material>
            <ambient>0.32 0.35 0.38 1</ambient>
            <diffuse>0.35 0.38 0.42 1</diffuse>
            <specular>0.2 0.2 0.2 1</specular>
          </material>
        </visual>
      </link>
    </model>

    <model name="payload_cube">
      <static>false</static>
      <pose>1.05 0 0.85 0 0 0</pose>
      <link name="cube_link">
        <enable_wind>true</enable_wind>
        <inertial>
          <mass>0.8</mass>
          <inertia>
            <ixx>0.01</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.01</iyy>
            <iyz>0</iyz>
            <izz>0.01</izz>
          </inertia>
        </inertial>
        <collision name="col">
          <geometry>
            <box>
              <size>0.18 0.18 0.18</size>
            </box>
          </geometry>
        </collision>
        <visual name="vis">
          <geometry>
            <box>
              <size>0.18 0.18 0.18</size>
            </box>
          </geometry>
          <material>
            <ambient>0.12 0.68 0.42 1</ambient>
            <diffuse>0.15 0.75 0.48 1</diffuse>
            <specular>0.5 0.5 0.5 1</specular>
          </material>
        </visual>
      </link>
    </model>
  </world>
</sdf>`
  },
  {
    id: 'file-rover-4wd-sdf',
    name: 'rover_4wd_warehouse.sdf',
    path: 'worlds/rover_4wd_warehouse.sdf',
    folder: 'worlds',
    description: '4-Wheel Differential Drive Ground Rover with LiDAR turret and dynamic obstacle barrels',
    lastModified: Date.now() - 3600000 * 2,
    content: `<?xml version="1.0" ?>
<sdf version="1.10">
  <world name="default">
    <physics name="1ms" type="ode">
      <max_step_size>0.002</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>

    <gravity>0 0 -9.81</gravity>
    <wind>
      <linear_velocity>1.2 -0.8 0.0</linear_velocity>
    </wind>

    <light type="directional" name="sun">
      <cast_shadows>true</cast_shadows>
      <pose>0 0 12 0 0 0</pose>
      <diffuse>0.88 0.88 0.85 1</diffuse>
      <specular>0.3 0.3 0.3 1</specular>
      <direction>-0.5 0.2 -0.85</direction>
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
            <ambient>0.76 0.76 0.76 1</ambient>
            <diffuse>0.76 0.76 0.76 1</diffuse>
            <specular>0.2 0.2 0.2 1</specular>
          </material>
        </visual>
      </link>
    </model>

    <!-- 4WD Differential Drive Autonomous Ground Rover -->
    <model name="husky_rover_4wd">
      <static>false</static>
      <pose>0 0 0.0 0 0 0</pose>

      <link name="chassis_link">
        <pose>0 0 0.28 0 0 0</pose>
        <inertial>
          <mass>28.0</mass>
          <inertia>
            <ixx>1.1</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>1.8</iyy>
            <iyz>0</iyz>
            <izz>2.2</izz>
          </inertia>
        </inertial>
        <collision name="chassis_col">
          <geometry>
            <box>
              <size>0.95 0.58 0.26</size>
            </box>
          </geometry>
        </collision>
        <visual name="main_hull">
          <geometry>
            <box>
              <size>0.92 0.54 0.22</size>
            </box>
          </geometry>
          <material>
            <ambient>0.92 0.72 0.08 1</ambient>
            <diffuse>0.95 0.75 0.10 1</diffuse>
            <specular>0.5 0.5 0.5 1</specular>
          </material>
        </visual>
        <visual name="top_deck_plate">
          <pose>0 0 0.13 0 0 0</pose>
          <geometry>
            <box>
              <size>0.78 0.50 0.04</size>
            </box>
          </geometry>
          <material>
            <ambient>0.16 0.18 0.20 1</ambient>
            <diffuse>0.18 0.20 0.22 1</diffuse>
            <specular>0.6 0.6 0.6 1</specular>
          </material>
        </visual>
        <visual name="front_bumper">
          <pose>0.49 0 -0.02 0 0 0</pose>
          <geometry>
            <box>
              <size>0.08 0.58 0.14</size>
            </box>
          </geometry>
          <material>
            <ambient>0.15 0.15 0.17 1</ambient>
            <diffuse>0.15 0.15 0.17 1</diffuse>
            <specular>0.4 0.4 0.4 1</specular>
          </material>
        </visual>
      </link>

      <link name="lidar_turret_link">
        <pose>0.15 0 0.48 0 0 0</pose>
        <inertial>
          <mass>1.5</mass>
          <inertia>
            <ixx>0.02</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.02</iyy>
            <iyz>0</iyz>
            <izz>0.03</izz>
          </inertia>
        </inertial>
        <collision name="lidar_col">
          <geometry>
            <cylinder>
              <radius>0.09</radius>
              <length>0.14</length>
            </cylinder>
          </geometry>
        </collision>
        <visual name="lidar_puck">
          <geometry>
            <cylinder>
              <radius>0.085</radius>
              <length>0.12</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.12 0.48 0.85 1</ambient>
            <diffuse>0.15 0.55 0.92 1</diffuse>
            <specular>0.8 0.8 0.9 1</specular>
          </material>
        </visual>
        <sensor name="gpu_lidar" type="gpu_lidar">
          <pose>0 0 0.04 0 0 0</pose>
          <topic>/model/husky_rover_4wd/scan</topic>
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
            </range>
          </lidar>
        </sensor>
      </link>

      <link name="front_left_wheel">
        <pose>0.32 0.34 0.18 1.5708 0 0</pose>
        <inertial>
          <mass>2.6</mass>
          <inertia>
            <ixx>0.04</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.04</iyy>
            <iyz>0</iyz>
            <izz>0.07</izz>
          </inertia>
        </inertial>
        <collision name="col">
          <geometry>
            <cylinder>
              <radius>0.18</radius>
              <length>0.12</length>
            </cylinder>
          </geometry>
        </collision>
        <visual name="tire">
          <geometry>
            <cylinder>
              <radius>0.18</radius>
              <length>0.12</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.14 0.15 0.16 1</ambient>
            <diffuse>0.16 0.17 0.18 1</diffuse>
            <specular>0.3 0.3 0.3 1</specular>
          </material>
        </visual>
      </link>

      <link name="front_right_wheel">
        <pose>0.32 -0.34 0.18 1.5708 0 0</pose>
        <inertial>
          <mass>2.6</mass>
          <inertia>
            <ixx>0.04</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.04</iyy>
            <iyz>0</iyz>
            <izz>0.07</izz>
          </inertia>
        </inertial>
        <collision name="col">
          <geometry>
            <cylinder>
              <radius>0.18</radius>
              <length>0.12</length>
            </cylinder>
          </geometry>
        </collision>
        <visual name="tire">
          <geometry>
            <cylinder>
              <radius>0.18</radius>
              <length>0.12</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.14 0.15 0.16 1</ambient>
            <diffuse>0.16 0.17 0.18 1</diffuse>
            <specular>0.3 0.3 0.3 1</specular>
          </material>
        </visual>
      </link>

      <link name="rear_left_wheel">
        <pose>-0.32 0.34 0.18 1.5708 0 0</pose>
        <inertial>
          <mass>2.6</mass>
          <inertia>
            <ixx>0.04</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.04</iyy>
            <iyz>0</iyz>
            <izz>0.07</izz>
          </inertia>
        </inertial>
        <collision name="col">
          <geometry>
            <cylinder>
              <radius>0.18</radius>
              <length>0.12</length>
            </cylinder>
          </geometry>
        </collision>
        <visual name="tire">
          <geometry>
            <cylinder>
              <radius>0.18</radius>
              <length>0.12</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.14 0.15 0.16 1</ambient>
            <diffuse>0.16 0.17 0.18 1</diffuse>
            <specular>0.3 0.3 0.3 1</specular>
          </material>
        </visual>
      </link>

      <link name="rear_right_wheel">
        <pose>-0.32 -0.34 0.18 1.5708 0 0</pose>
        <inertial>
          <mass>2.6</mass>
          <inertia>
            <ixx>0.04</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.04</iyy>
            <iyz>0</iyz>
            <izz>0.07</izz>
          </inertia>
        </inertial>
        <collision name="col">
          <geometry>
            <cylinder>
              <radius>0.18</radius>
              <length>0.12</length>
            </cylinder>
          </geometry>
        </collision>
        <visual name="tire">
          <geometry>
            <cylinder>
              <radius>0.18</radius>
              <length>0.12</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.14 0.15 0.16 1</ambient>
            <diffuse>0.16 0.17 0.18 1</diffuse>
            <specular>0.3 0.3 0.3 1</specular>
          </material>
        </visual>
      </link>

      <joint name="lidar_spin_joint" type="continuous">
        <parent>chassis_link</parent>
        <child>lidar_turret_link</child>
        <axis>
          <xyz>0 0 1</xyz>
          <limit>
            <lower>-100</lower>
            <upper>100</upper>
            <effort>10.0</effort>
            <velocity>12.0</velocity>
          </limit>
        </axis>
      </joint>

      <joint name="front_left_wheel_joint" type="continuous">
        <parent>chassis_link</parent>
        <child>front_left_wheel</child>
        <axis>
          <xyz>0 0 1</xyz>
          <limit>
            <lower>-100</lower>
            <upper>100</upper>
            <effort>45.0</effort>
            <velocity>15.0</velocity>
          </limit>
        </axis>
      </joint>

      <joint name="front_right_wheel_joint" type="continuous">
        <parent>chassis_link</parent>
        <child>front_right_wheel</child>
        <axis>
          <xyz>0 0 1</xyz>
          <limit>
            <lower>-100</lower>
            <upper>100</upper>
            <effort>45.0</effort>
            <velocity>15.0</velocity>
          </limit>
        </axis>
      </joint>
    </model>

    <!-- Warehouse Safety Cones / Barrels -->
    <model name="safety_barrel_1">
      <static>false</static>
      <pose>2.4 1.1 0.45 0 0 0</pose>
      <link name="barrel_link">
        <enable_wind>true</enable_wind>
        <inertial>
          <mass>5.0</mass>
          <inertia>
            <ixx>0.25</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.25</iyy>
            <iyz>0</iyz>
            <izz>0.18</izz>
          </inertia>
        </inertial>
        <collision name="col">
          <geometry>
            <cylinder>
              <radius>0.28</radius>
              <length>0.85</length>
            </cylinder>
          </geometry>
        </collision>
        <visual name="vis">
          <geometry>
            <cylinder>
              <radius>0.28</radius>
              <length>0.85</length>
            </cylinder>
          </geometry>
          <material>
            <ambient>0.95 0.35 0.08 1</ambient>
            <diffuse>0.95 0.38 0.10 1</diffuse>
            <specular>0.4 0.4 0.4 1</specular>
          </material>
        </visual>
      </link>
    </model>
  </world>
</sdf>`
  },
  {
    id: 'file-urdf-sample',
    name: 'simple_manipulator.urdf',
    path: 'urdf/simple_manipulator.urdf',
    folder: 'urdf',
    description: 'ROS 2 URDF articulated inspection manipulator with relative joint origins, multi-visual links & SDF 1.10 conversion',
    lastModified: Date.now() - 3600000,
    content: `<?xml version="1.0"?>
<robot name="ros2_inspection_arm">
  <!-- Robot-level named materials per official ROS URDF specification -->
  <material name="dark_steel">
    <color rgba="0.22 0.25 0.30 1.0"/>
  </material>
  <material name="gazebo_blue">
    <color rgba="0.15 0.52 0.88 1.0"/>
  </material>
  <material name="sensor_orange">
    <color rgba="0.95 0.48 0.12 1.0"/>
  </material>
  <material name="optical_glass">
    <color rgba="0.10 0.82 0.92 1.0"/>
  </material>

  <!-- Root Link: Heavy Pedestal Base sitting flush on ground z=0 -->
  <link name="base_link">
    <inertial>
      <origin xyz="0 0 0.15" rpy="0 0 0"/>
      <mass value="20.0"/>
      <inertia ixx="0.80" ixy="0.0" ixz="0.0" iyy="0.80" iyz="0.0" izz="0.90"/>
    </inertial>
    <visual name="pedestal_drum">
      <origin xyz="0 0 0.15" rpy="0 0 0"/>
      <geometry>
        <cylinder radius="0.28" length="0.30"/>
      </geometry>
      <material name="dark_steel"/>
    </visual>
    <visual name="turret_bearing_ring">
      <origin xyz="0 0 0.31" rpy="0 0 0"/>
      <geometry>
        <cylinder radius="0.18" length="0.04"/>
      </geometry>
      <material name="sensor_orange"/>
    </visual>
    <collision name="base_collision">
      <origin xyz="0 0 0.15" rpy="0 0 0"/>
      <geometry>
        <cylinder radius="0.28" length="0.30"/>
      </geometry>
    </collision>
  </link>

  <!-- Child Link 1: Vertical Mast Column (origin at base_to_mast_yaw joint z=0.30m) -->
  <link name="mast_link">
    <inertial>
      <origin xyz="0 0 0.35" rpy="0 0 0"/>
      <mass value="6.5"/>
      <inertia ixx="0.35" ixy="0.0" ixz="0.0" iyy="0.35" iyz="0.0" izz="0.12"/>
    </inertial>
    <visual name="mast_column">
      <origin xyz="0 0 0.35" rpy="0 0 0"/>
      <geometry>
        <box size="0.16 0.16 0.70"/>
      </geometry>
      <material name="gazebo_blue"/>
    </visual>
    <visual name="pitch_servo_housing">
      <origin xyz="0 0 0.70" rpy="1.5708 0 0"/>
      <geometry>
        <cylinder radius="0.11" length="0.22"/>
      </geometry>
      <material name="dark_steel"/>
    </visual>
    <collision name="mast_collision">
      <origin xyz="0 0 0.35" rpy="0 0 0"/>
      <geometry>
        <box size="0.16 0.16 0.70"/>
      </geometry>
    </collision>
  </link>

  <!-- Child Link 2: Articulated Sensor Head & Boom (origin at mast_to_sensor_pitch joint z=1.00m) -->
  <link name="sensor_head_link">
    <inertial>
      <origin xyz="0.22 0 0.08" rpy="0 0 0"/>
      <mass value="2.4"/>
      <inertia ixx="0.08" ixy="0.0" ixz="0.0" iyy="0.08" iyz="0.0" izz="0.08"/>
    </inertial>
    <visual name="forearm_boom">
      <origin xyz="0.14 0 0.04" rpy="0 1.25 0"/>
      <geometry>
        <cylinder radius="0.055" length="0.34"/>
      </geometry>
      <material name="sensor_orange"/>
    </visual>
    <visual name="camera_gimbal_sphere">
      <origin xyz="0.30 0 0.10" rpy="0 0 0"/>
      <geometry>
        <sphere radius="0.13"/>
      </geometry>
      <material name="sensor_orange"/>
    </visual>
    <visual name="optical_camera_lens">
      <origin xyz="0.42 0 0.10" rpy="0 1.5708 0"/>
      <geometry>
        <cylinder radius="0.065" length="0.06"/>
      </geometry>
      <material name="optical_glass"/>
    </visual>
    <collision name="sensor_head_collision">
      <origin xyz="0.26 0 0.08" rpy="0 0 0"/>
      <geometry>
        <sphere radius="0.15"/>
      </geometry>
    </collision>
  </link>

  <!-- Joint 1: Waist Yaw (rotates mast_link + sensor_head_link around Z at z=0.30m) -->
  <joint name="base_to_mast_yaw" type="revolute">
    <parent link="base_link"/>
    <child link="mast_link"/>
    <origin xyz="0 0 0.30" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="80.0" velocity="2.0"/>
    <dynamics damping="0.35" friction="0.05"/>
  </joint>

  <!-- Joint 2: Shoulder/Wrist Pitch (rotates sensor_head_link around Y at top of mast_link +0.70m -> z=1.00m) -->
  <joint name="mast_to_sensor_pitch" type="revolute">
    <parent link="mast_link"/>
    <child link="sensor_head_link"/>
    <origin xyz="0 0 0.70" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-1.57" upper="1.57" effort="40.0" velocity="3.0"/>
    <dynamics damping="0.25" friction="0.05"/>
  </joint>
</robot>`
  },
  {
    id: 'file-urdf-rover',
    name: 'diff_drive_rover.urdf',
    path: 'urdf/diff_drive_rover.urdf',
    folder: 'urdf',
    description: 'ROS 2 Differential-Drive Mobile Robot in URDF format with base_footprint, continuous wheel joints & LiDAR',
    lastModified: Date.now() - 1800000,
    content: `<?xml version="1.0"?>
<robot name="ros2_urdf_rover">
  <material name="rover_teal">
    <color rgba="0.08 0.62 0.68 1.0"/>
  </material>
  <material name="chassis_dark">
    <color rgba="0.18 0.20 0.24 1.0"/>
  </material>
  <material name="rubber_tire">
    <color rgba="0.15 0.16 0.18 1.0"/>
  </material>
  <material name="lidar_orange">
    <color rgba="0.95 0.45 0.10 1.0"/>
  </material>

  <!-- Standard ROS 2 virtual ground projection frame -->
  <link name="base_footprint"/>

  <joint name="base_footprint_joint" type="fixed">
    <parent link="base_footprint"/>
    <child link="chassis_link"/>
    <origin xyz="0 0 0.16" rpy="0 0 0"/>
  </joint>

  <!-- Main Robot Chassis -->
  <link name="chassis_link">
    <inertial>
      <origin xyz="0 0 0.06" rpy="0 0 0"/>
      <mass value="18.0"/>
      <inertia ixx="0.55" ixy="0" ixz="0" iyy="0.85" iyz="0" izz="1.10"/>
    </inertial>
    <visual name="chassis_hull">
      <origin xyz="0 0 0.06" rpy="0 0 0"/>
      <geometry>
        <box size="0.72 0.44 0.18"/>
      </geometry>
      <material name="rover_teal"/>
    </visual>
    <visual name="top_electronics_bay">
      <origin xyz="-0.04 0 0.17" rpy="0 0 0"/>
      <geometry>
        <box size="0.48 0.36 0.05"/>
      </geometry>
      <material name="chassis_dark"/>
    </visual>
    <visual name="front_caster_support">
      <origin xyz="0.26 0 -0.08" rpy="0 0 0"/>
      <geometry>
        <sphere radius="0.08"/>
      </geometry>
      <material name="chassis_dark"/>
    </visual>
    <collision name="chassis_collision">
      <origin xyz="0 0 0.06" rpy="0 0 0"/>
      <geometry>
        <box size="0.72 0.44 0.18"/>
      </geometry>
    </collision>
    <collision name="caster_collision">
      <origin xyz="0.26 0 -0.08" rpy="0 0 0"/>
      <geometry>
        <sphere radius="0.08"/>
      </geometry>
    </collision>
  </link>

  <!-- Left Drive Wheel (cylinder rotated 90 deg in visual/collision so joint axis is +Y) -->
  <link name="left_wheel_link">
    <inertial>
      <origin xyz="0 0 0" rpy="1.5708 0 0"/>
      <mass value="2.0"/>
      <inertia ixx="0.02" ixy="0" ixz="0" iyy="0.02" iyz="0" izz="0.035"/>
    </inertial>
    <visual name="tire">
      <origin xyz="0 0 0" rpy="1.5708 0 0"/>
      <geometry>
        <cylinder radius="0.16" length="0.09"/>
      </geometry>
      <material name="rubber_tire"/>
    </visual>
    <visual name="hubcap_marker">
      <origin xyz="0.06 0.048 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.08 0.015 0.03"/>
      </geometry>
      <material name="lidar_orange"/>
    </visual>
    <collision name="tire_col">
      <origin xyz="0 0 0" rpy="1.5708 0 0"/>
      <geometry>
        <cylinder radius="0.16" length="0.09"/>
      </geometry>
    </collision>
  </link>

  <!-- Right Drive Wheel -->
  <link name="right_wheel_link">
    <inertial>
      <origin xyz="0 0 0" rpy="1.5708 0 0"/>
      <mass value="2.0"/>
      <inertia ixx="0.02" ixy="0" ixz="0" iyy="0.02" iyz="0" izz="0.035"/>
    </inertial>
    <visual name="tire">
      <origin xyz="0 0 0" rpy="1.5708 0 0"/>
      <geometry>
        <cylinder radius="0.16" length="0.09"/>
      </geometry>
      <material name="rubber_tire"/>
    </visual>
    <visual name="hubcap_marker">
      <origin xyz="0.06 -0.048 0" rpy="0 0 0"/>
      <geometry>
        <box size="0.08 0.015 0.03"/>
      </geometry>
      <material name="lidar_orange"/>
    </visual>
    <collision name="tire_col">
      <origin xyz="0 0 0" rpy="1.5708 0 0"/>
      <geometry>
        <cylinder radius="0.16" length="0.09"/>
      </geometry>
    </collision>
  </link>

  <!-- Rotating 360 LiDAR Scanner Turret -->
  <link name="lidar_link">
    <inertial>
      <origin xyz="0 0 0.04" rpy="0 0 0"/>
      <mass value="0.9"/>
      <inertia ixx="0.01" ixy="0" ixz="0" iyy="0.01" iyz="0" izz="0.015"/>
    </inertial>
    <visual name="lidar_housing">
      <origin xyz="0 0 0.04" rpy="0 0 0"/>
      <geometry>
        <cylinder radius="0.08" length="0.09"/>
      </geometry>
      <material name="lidar_orange"/>
    </visual>
    <visual name="lidar_window">
      <origin xyz="0.065 0 0.04" rpy="0 0 0"/>
      <geometry>
        <box size="0.04 0.06 0.04"/>
      </geometry>
      <material name="chassis_dark"/>
    </visual>
    <collision name="lidar_col">
      <origin xyz="0 0 0.04" rpy="0 0 0"/>
      <geometry>
        <cylinder radius="0.08" length="0.09"/>
      </geometry>
    </collision>
  </link>

  <joint name="left_wheel_joint" type="continuous">
    <parent link="chassis_link"/>
    <child link="left_wheel_link"/>
    <origin xyz="-0.12 0.27 0.0" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit effort="40.0" velocity="15.0"/>
    <dynamics damping="0.15" friction="0.05"/>
  </joint>

  <joint name="right_wheel_joint" type="continuous">
    <parent link="chassis_link"/>
    <child link="right_wheel_link"/>
    <origin xyz="-0.12 -0.27 0.0" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit effort="40.0" velocity="15.0"/>
    <dynamics damping="0.15" friction="0.05"/>
  </joint>

  <joint name="lidar_spin_joint" type="continuous">
    <parent link="chassis_link"/>
    <child link="lidar_link"/>
    <origin xyz="0.14 0 0.19" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit effort="10.0" velocity="12.0"/>
  </joint>

  <!-- Official Gazebo Harmonic (gz-sim8) System Plugins & Sensor Extensions -->
  <gazebo>
    <plugin filename="gz-sim-diff-drive-system" name="gz::sim::systems::DiffDrive">
      <left_joint>left_wheel_joint</left_joint>
      <right_joint>right_wheel_joint</right_joint>
      <wheel_separation>0.54</wheel_separation>
      <wheel_radius>0.16</wheel_radius>
      <odom_publish_frequency>50</odom_publish_frequency>
      <topic>/model/ros2_urdf_rover/cmd_vel</topic>
      <odom_topic>/model/ros2_urdf_rover/odometry</odom_topic>
      <tf_topic>/model/ros2_urdf_rover/tf</tf_topic>
      <frame_id>odom</frame_id>
      <child_frame_id>base_footprint</child_frame_id>
    </plugin>
    <plugin filename="gz-sim-joint-state-publisher-system" name="gz::sim::systems::JointStatePublisher">
      <topic>/world/default/model/ros2_urdf_rover/joint_state</topic>
    </plugin>
  </gazebo>

  <gazebo reference="lidar_link">
    <sensor name="gpu_lidar" type="gpu_lidar">
      <pose>0 0 0.05 0 0 0</pose>
      <topic>/model/ros2_urdf_rover/scan</topic>
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
        </range>
      </lidar>
    </sensor>
  </gazebo>

  <gazebo reference="chassis_link">
    <sensor name="imu_sensor" type="imu">
      <always_on>true</always_on>
      <update_rate>100</update_rate>
      <visualize>true</visualize>
      <topic>/model/ros2_urdf_rover/imu</topic>
    </sensor>
  </gazebo>
</robot>`
  }
];

