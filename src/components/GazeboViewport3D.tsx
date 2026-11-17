import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {
  DebugOverlaySettings,
  ParsedWorld,
  PlacementToolState,
  Pose6D,
  SimGeometry,
  TransformGizmoMode,
  TransformSpace,
} from '../types/simulation';
import {
  computeModelLinkPoses,
  stepPhysicsWorld,
} from '../utils/physicsEngine';
import {
  getDefaultGroundZForPrimitive,
  getPrimitiveDefaultGeometry,
} from '../utils/sdfCompiler';

interface GazeboViewport3DProps {
  world: ParsedWorld | null;
  isSimRunning: boolean;
  stepTrigger: number;
  selectedEntityId: number | null;
  onSelectEntity: (entityId: number) => void;
  onUpdateEntityPose: (entityId: number, newPose: Pose6D) => void;
  onScaleEntity?: (entityId: number, scaleFactors: [number, number, number]) => void;
  gizmoMode: TransformGizmoMode;
  transformSpace: TransformSpace;
  snapToGrid: boolean;
  placementTool: PlacementToolState;
  previewPose: Pose6D;
  onPreviewPoseChange: (pose: Pose6D) => void;
  onConfirmPlacement: (pose: Pose6D) => void;
  onCancelPlacement: () => void;
  debugOverlays: DebugOverlaySettings;
  cameraPresetTrigger: {
    preset: 'iso' | 'top' | 'front' | 'side' | 'follow';
    seq: number;
  };
  onTelemetryUpdate: (
    simTime: number,
    realTime: number,
    rtf: number,
    iterations: number
  ) => void;
  canvasRefOut?: React.MutableRefObject<HTMLCanvasElement | null>;
}

const isSoftwareGl = (() => {
  if (typeof document === 'undefined') return true;
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
})();

/**
 * Converts Gazebo SDF / ROS URDF Z-up coordinates [x, y, z, roll, pitch, yaw]
 * (intrinsic ZYX / extrinsic XYZ rotation R = Rz(yaw) * Ry(pitch) * Rx(roll))
 * to Three.js Y-up coordinates:
 *   Three.X = SDF.X (forward)
 *   Three.Y = SDF.Z (up / elevation)
 *   Three.Z = -SDF.Y (right)
 * Under this basis change C, C * Rz(yaw) * Ry(pitch) * Rx(roll) * C^T
 * = Ry_three(yaw) * Rz_three(-pitch) * Rx_three(roll), which is intrinsic 'YZX' order.
 */
export function applySdfPoseToObject(obj: THREE.Object3D, pose: Pose6D): void {
  const [x, y, z, roll, pitch, yaw] = pose;
  obj.position.set(x, z, -y);
  obj.rotation.order = 'YZX';
  obj.rotation.set(roll, yaw, -pitch, 'YZX');
}

export function extractSdfPoseFromObject(obj: THREE.Object3D): Pose6D {
  const euler = new THREE.Euler().setFromQuaternion(obj.quaternion, 'YZX');
  return [
    Number(obj.position.x.toFixed(3)),
    Number((-obj.position.z).toFixed(3)),
    Number(obj.position.y.toFixed(3)),
    Number(euler.x.toFixed(3)),
    Number((-euler.z).toFixed(3)),
    Number(euler.y.toFixed(3)),
  ];
}

function sdfVectorToThree(vec: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(vec[0], vec[2], -vec[1]);
}

function createSdfGeometry(geom: SimGeometry): THREE.BufferGeometry {
  switch (geom.type) {
    case 'box': {
      // SDF size: [x (length), y (width), z (height)] -> Three: [x, z, y]
      const [sx, sy, sz] = geom.size || [0.5, 0.5, 0.5];
      return new THREE.BoxGeometry(sx, sz, sy);
    }
    case 'sphere': {
      const r = geom.radius || 0.25;
      return new THREE.SphereGeometry(r, 24, 18);
    }
    case 'cylinder': {
      const r = geom.radius || 0.25;
      const len = geom.length || 0.6;
      return new THREE.CylinderGeometry(r, r, len, 24);
    }
    case 'capsule': {
      const r = geom.radius || 0.18;
      const len = geom.length || 0.44;
      return new THREE.CapsuleGeometry(r, len, 12, 20);
    }
    case 'cone': {
      const r = geom.radius || 0.25;
      const len = geom.length || 0.6;
      return new THREE.ConeGeometry(r, len, 24);
    }
    case 'ellipsoid': {
      const [rx, ry, rz] = geom.radii || [0.35, 0.25, 0.2];
      const g = new THREE.SphereGeometry(1, 24, 18);
      g.scale(rx, rz, ry);
      return g;
    }
    case 'plane': {
      const [sx, sy] = geom.size || [100, 100, 1];
      const g = new THREE.PlaneGeometry(sx, sy);
      g.rotateX(-Math.PI / 2);
      return g;
    }
    default:
      return new THREE.BoxGeometry(0.3, 0.3, 0.3);
  }
}

/**
 * Computes a structural signature of the world + debugOverlays so that pose-only updates
 * (from TransformControls dragging or Inspector Pose inputs) update 3D transforms in-place
 * without tearing down and rebuilding Three.js meshes.
 */
function getWorldStructureSignature(
  w: ParsedWorld | null,
  ov: DebugOverlaySettings
): string {
  if (!w) return 'empty';
  const modelsKey = w.models
    .map(
      (m) =>
        `${m.id}:${m.entityId}:${m.isStatic}:${m.links
          .map(
            (l) =>
              `${l.id}:${l.entityId}:${l.visuals
                .map((v) => JSON.stringify(v.geometry))
                .join(',')}`
          )
          .join('|')}:${m.joints
          .map((j) => `${j.id}:${j.parent}->${j.child}:${j.type}`)
          .join('|')}`
    )
    .join(';');
  const lightsKey = w.lights.map((l) => `${l.id}:${l.entityId}:${l.type}`).join(';');
  const ovKey = `${ov.showCollisionWireframes}:${ov.showInertiaAndCoM}:${ov.showJointAxesAndFrames}:${ov.showLightFrustums}:${ov.wireframeMode}:${ov.showLidarRays}:${ov.showContactPoints}`;
  return `${w.name}::${modelsKey}::${lightsKey}::${ovKey}`;
}

export const GazeboViewport3D: React.FC<GazeboViewport3DProps> = ({
  world,
  isSimRunning,
  stepTrigger,
  selectedEntityId,
  onSelectEntity,
  onUpdateEntityPose,
  onScaleEntity,
  gizmoMode,
  transformSpace,
  snapToGrid,
  placementTool,
  previewPose,
  onPreviewPoseChange,
  onConfirmPlacement,
  onCancelPlacement,
  debugOverlays,
  cameraPresetTrigger,
  onTelemetryUpdate,
  canvasRefOut,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  const worldRef = useRef<ParsedWorld | null>(world);
  const isRunningRef = useRef<boolean>(isSimRunning);
  const selectedIdRef = useRef<number | null>(selectedEntityId);
  const gizmoModeRef = useRef<TransformGizmoMode>(gizmoMode);
  const transformSpaceRef = useRef<TransformSpace>(transformSpace);
  const snapToGridRef = useRef<boolean>(snapToGrid);
  const placementToolRef = useRef<PlacementToolState>(placementTool);
  const previewPoseRef = useRef<Pose6D>(previewPose);
  const overlaysRef = useRef<DebugOverlaySettings>(debugOverlays);
  const draggedEntityIdRef = useRef<number | null>(null);
  const lastStructureSigRef = useRef<string>('');

  const onSelectRef = useRef(onSelectEntity);
  const onUpdatePoseRef = useRef(onUpdateEntityPose);
  const onScaleEntityRef = useRef(onScaleEntity);
  const onPreviewPoseChangeRef = useRef(onPreviewPoseChange);
  const onConfirmPlacementRef = useRef(onConfirmPlacement);
  const onCancelPlacementRef = useRef(onCancelPlacement);
  const onTelemetryRef = useRef(onTelemetryUpdate);

  worldRef.current = world;
  isRunningRef.current = isSimRunning;
  selectedIdRef.current = selectedEntityId;
  gizmoModeRef.current = gizmoMode;
  transformSpaceRef.current = transformSpace;
  snapToGridRef.current = snapToGrid;
  placementToolRef.current = placementTool;
  previewPoseRef.current = previewPose;
  overlaysRef.current = debugOverlays;
  onSelectRef.current = onSelectEntity;
  onUpdatePoseRef.current = onUpdateEntityPose;
  onScaleEntityRef.current = onScaleEntity;
  onPreviewPoseChangeRef.current = onPreviewPoseChange;
  onConfirmPlacementRef.current = onConfirmPlacement;
  onCancelPlacementRef.current = onCancelPlacement;
  onTelemetryRef.current = onTelemetryUpdate;

  const sceneObjectsRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    transformControls: TransformControls;
    gridGroup: THREE.Group;
    worldRootGroup: THREE.Group;
    windArrowsGroup: THREE.Group;
    sensorOverlayGroup: THREE.Group;
    placementPreviewGroup: THREE.Group;
    selectionRingMesh: THREE.Mesh;
    entityObjectMap: Map<number, THREE.Object3D>;
    modelGroupMap: Map<string, THREE.Group>;
    modelShadowDiscMap: Map<string, THREE.Mesh>;
    linkGroupMap: Map<string, THREE.Group>;
    linkInitialPoseMap: Map<string, Pose6D>;
    clickableMeshes: THREE.Object3D[];
    renderNow: () => void;
    rebuildSceneFromWorld: (w: ParsedWorld | null) => void;
    syncDynamicPoses: (w: ParsedWorld | null) => void;
    rebuildPlacementPreview: (tool: PlacementToolState, pose: Pose6D) => void;
    updateSelectionHighlight: (selId: number | null) => void;
  } | null>(null);

  const simMetricsRef = useRef({
    simTime: 0,
    realTime: 0,
    iterations: 0,
    lastTelemetryPush: 0,
  });

  // 1. Initialize WebGLRenderer, Scene, Camera, Grid, Placement Ghost, and Gizmo ONCE
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = Math.max(container.clientWidth, 640);
    const height = Math.max(container.clientHeight, 480);

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    if (canvasRefOut) {
      canvasRefOut.current = renderer.domElement;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xc8c8c8);
    scene.fog = new THREE.Fog(0xc8c8c8, 16, 48);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.05, 200);
    camera.position.set(3.4, 2.2, 3.6);
    camera.lookAt(0, 0.45, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.target.set(0, 0.45, 0);
    controls.minDistance = 0.5;
    controls.maxDistance = 60;
    controls.update();

    // Balanced 3-Point + Hemisphere Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x8b929a, 0.95);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfffcf5, 1.45);
    sunLight.position.set(6, 12, 7);
    sunLight.castShadow = !isSoftwareGl;
    sunLight.shadow.mapSize.set(1024, 1024);
    sunLight.shadow.bias = -0.0005;
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.55);
    fillLight.position.set(-6, 6, -5);
    scene.add(fillLight);

    // Authentic Gazebo Ground Plane & Crisp Metric Grid
    const gridGroup = new THREE.Group();
    const groundGeo = new THREE.PlaneGeometry(36, 36);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xbcbcbc,
      roughness: 0.9,
      metalness: 0.05,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.receiveShadow = !isSoftwareGl;
    gridGroup.add(groundMesh);

    const gridHelper = new THREE.GridHelper(24, 24, 0x444444, 0x686868);
    gridHelper.position.y = 0.003;
    gridGroup.add(gridHelper);
    scene.add(gridGroup);

    const worldRootGroup = new THREE.Group();
    scene.add(worldRootGroup);

    // Selection Ground Highlight Ring around currently selected entity
    const selRingGeo = new THREE.RingGeometry(0.38, 0.44, 32);
    selRingGeo.rotateX(-Math.PI / 2);
    const selRingMat = new THREE.MeshBasicMaterial({
      color: 0xf26522,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const selectionRingMesh = new THREE.Mesh(selRingGeo, selRingMat);
    selectionRingMesh.position.y = 0.008;
    selectionRingMesh.visible = false;
    scene.add(selectionRingMesh);

    // Interactive Placement Ghost Preview Group (Gazebo Harmonic Spawn Preview)
    const placementPreviewGroup = new THREE.Group();
    placementPreviewGroup.visible = false;
    scene.add(placementPreviewGroup);

    // Wind Vector Field Arrows
    const windArrowsGroup = new THREE.Group();
    for (let ix = -2; ix <= 2; ix += 2) {
      for (let iz = -2; iz <= 2; iz += 2) {
        const arrow = new THREE.ArrowHelper(
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(ix * 1.1, 1.35, iz * 1.1),
          0.65,
          0x0284c7,
          0.16,
          0.09
        );
        windArrowsGroup.add(arrow);
      }
    }
    scene.add(windArrowsGroup);

    // Live 3D Sensor Rays (GpuLidar) & Ground Contact Points Overlay Group
    const sensorOverlayGroup = new THREE.Group();
    scene.add(sensorOverlayGroup);

    // TransformControls Gizmo
    const transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.setSize(0.85);
    scene.add(transformControls.getHelper());

    const entityObjectMap = new Map<number, THREE.Object3D>();
    const modelGroupMap = new Map<string, THREE.Group>();
    const modelShadowDiscMap = new Map<string, THREE.Mesh>();
    const linkGroupMap = new Map<string, THREE.Group>();
    const linkInitialPoseMap = new Map<string, Pose6D>();
    const clickableMeshes: THREE.Object3D[] = [];

    let isRenderingNow = false;
    const renderNow = () => {
      if (isRenderingNow) return;
      isRenderingNow = true;
      try {
        renderer.render(scene, camera);
      } finally {
        isRenderingNow = false;
      }
    };

    const updateSelectionHighlight = (selId: number | null) => {
      if (selId === null) {
        selectionRingMesh.visible = false;
        return;
      }
      const obj = entityObjectMap.get(selId);
      if (!obj || obj === gridGroup) {
        selectionRingMesh.visible = false;
        return;
      }
      const worldPos = new THREE.Vector3();
      obj.getWorldPosition(worldPos);
      selectionRingMesh.position.set(worldPos.x, 0.008, worldPos.z);
      selectionRingMesh.visible = true;
    };

    transformControls.addEventListener('dragging-changed', (event) => {
      const isDragging = Boolean(event.value);
      controls.enabled = !isDragging;

      const obj = transformControls.object;
      const entityId = obj?.userData?.entityId as number | undefined;

      if (isDragging && entityId !== undefined) {
        draggedEntityIdRef.current = entityId;
      } else {
        draggedEntityIdRef.current = null;
        if (obj && entityId !== undefined) {
          if (gizmoModeRef.current === 'scale' && onScaleEntityRef.current) {
            const sx = Number(obj.scale.x.toFixed(3));
            const sy = Number(obj.scale.z.toFixed(3));
            const sz = Number(obj.scale.y.toFixed(3));
            obj.scale.set(1, 1, 1);
            if (Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01 || Math.abs(sz - 1) > 0.01) {
              onScaleEntityRef.current(entityId, [sx, sy, sz]);
            }
          } else {
            onUpdatePoseRef.current(entityId, extractSdfPoseFromObject(obj));
          }
        }
      }
      renderNow();
    });

    transformControls.addEventListener('change', () => {
      const obj = transformControls.object;
      if (transformControls.dragging && obj) {
        const entityId = obj.userData.entityId as number | undefined;
        if (entityId !== undefined && gizmoModeRef.current !== 'scale') {
          const livePose = extractSdfPoseFromObject(obj);
          // Live-update worldRef so physics loop and shadow disc stay synced mid-drag
          const w = worldRef.current;
          if (w) {
            for (const m of w.models) {
              if (m.entityId === entityId) {
                m.pose = [...livePose];
                m.linearVelocity = [0, 0, 0];
                m.angularVelocity = [0, 0, 0];
                const disc = modelShadowDiscMap.get(m.id);
                if (disc) {
                  disc.position.set(0, Math.max(0.012, -m.pose[2] + 0.012), 0);
                }
                break;
              }
              for (const lk of m.links) {
                if (lk.entityId === entityId) {
                  lk.pose = [...livePose];
                  lk.linearVelocity = [0, 0, 0];
                  lk.angularVelocity = [0, 0, 0];
                  break;
                }
              }
            }
            for (const light of w.lights) {
              if (light.entityId === entityId) {
                light.pose = [...livePose];
                break;
              }
            }
          }
          updateSelectionHighlight(entityId);
          onUpdatePoseRef.current(entityId, livePose);
        }
      }
      renderNow();
    });

    controls.addEventListener('change', renderNow);

    const rebuildPlacementPreview = (tool: PlacementToolState, pose: Pose6D) => {
      placementPreviewGroup.clear();
      if (!tool) {
        placementPreviewGroup.visible = false;
        renderNow();
        return;
      }

      const ghostMat = new THREE.MeshStandardMaterial({
        color: 0xf26522,
        emissive: 0xf26522,
        emissiveIntensity: 0.25,
        transparent: true,
        opacity: 0.58,
        roughness: 0.35,
      });
      const wireMat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.75,
      });

      if (tool.kind === 'primitive') {
        const geom = createSdfGeometry(getPrimitiveDefaultGeometry(tool.shape));
        placementPreviewGroup.add(new THREE.Mesh(geom, ghostMat));
        placementPreviewGroup.add(new THREE.Mesh(geom, wireMat));
      } else if (tool.kind === 'light') {
        const bulbGeom = new THREE.SphereGeometry(0.2, 16, 16);
        const lightMat = new THREE.MeshBasicMaterial({
          color: 0xfacc15,
          transparent: true,
          opacity: 0.85,
        });
        placementPreviewGroup.add(new THREE.Mesh(bulbGeom, lightMat));
        const coneGeom = new THREE.ConeGeometry(0.28, 0.55, 16);
        coneGeom.translate(0, -0.35, 0);
        placementPreviewGroup.add(new THREE.Mesh(coneGeom, wireMat));
      } else if (tool.kind === 'paste') {
        const srcModel = worldRef.current?.models.find(
          (m) => m.entityId === tool.sourceEntityId
        );
        if (srcModel) {
          const fkMap = computeModelLinkPoses(srcModel);
          for (const lk of srcModel.links) {
            const lkGrp = new THREE.Group();
            applySdfPoseToObject(lkGrp, fkMap.get(lk.name) || lk.pose);
            for (const vis of lk.visuals) {
              const g = createSdfGeometry(vis.geometry);
              const m = new THREE.Mesh(g, ghostMat);
              applySdfPoseToObject(m, vis.pose);
              lkGrp.add(m);
            }
            placementPreviewGroup.add(lkGrp);
          }
        } else {
          const fallbackGeom = new THREE.BoxGeometry(0.5, 0.5, 0.5);
          placementPreviewGroup.add(new THREE.Mesh(fallbackGeom, ghostMat));
        }
      }

      // Ground target ring under preview object
      const ringGeo = new THREE.RingGeometry(0.32, 0.38, 28);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0xf26522,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.9,
        })
      );
      ringMesh.position.set(0, -pose[2] + 0.01, 0);
      ringMesh.name = 'ground_target_ring';
      placementPreviewGroup.add(ringMesh);

      applySdfPoseToObject(placementPreviewGroup, pose);
      placementPreviewGroup.visible = true;
      renderNow();
    };

    const syncWindAndGridOverlays = (w: ParsedWorld | null) => {
      if (!w) return;
      const ov = overlaysRef.current;
      gridGroup.visible = ov.showGrid;
      const [wx, wy, wz] = w.wind.linearVelocity;
      const windMag = Math.hypot(wx, wy, wz);
      windArrowsGroup.visible = ov.showWindVectors && (w.wind.enabled || windMag > 0.01);
      if (windMag > 0.01) {
        const dir = sdfVectorToThree([wx, wy, wz]).normalize();
        const len = Math.min(1.2, Math.max(0.45, windMag * 0.25));
        windArrowsGroup.children.forEach((child) => {
          if (child instanceof THREE.ArrowHelper) {
            child.setDirection(dir);
            child.setLength(len, 0.16, 0.09);
          }
        });
      }
    };

    const rebuildSceneFromWorld = (w: ParsedWorld | null) => {
      transformControls.detach();
      worldRootGroup.clear();
      entityObjectMap.clear();
      modelGroupMap.clear();
      modelShadowDiscMap.clear();
      linkGroupMap.clear();
      linkInitialPoseMap.clear();
      clickableMeshes.length = 0;

      if (!w) {
        selectionRingMesh.visible = false;
        renderNow();
        return;
      }

      const ov = overlaysRef.current;
      syncWindAndGridOverlays(w);

      // Lights
      for (const light of w.lights) {
        const lGroup = new THREE.Group();
        applySdfPoseToObject(lGroup, light.pose);
        lGroup.userData = { entityId: light.entityId, entityName: light.name };

        // Always render a clickable/selectable light gizmo bulb for user-spawned point/spot lights or when showLightFrustums is enabled
        if (ov.showLightFrustums || light.name !== 'sun') {
          const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.16, 14, 14),
            new THREE.MeshBasicMaterial({ color: 0xfacc15 })
          );
          bulb.userData = { entityId: light.entityId };
          lGroup.add(bulb);
          clickableMeshes.push(bulb);
        }
        worldRootGroup.add(lGroup);
        entityObjectMap.set(light.entityId, lGroup);
      }

      // Models & Links
      for (const model of w.models) {
        if (model.name === 'ground_plane') {
          entityObjectMap.set(model.entityId, gridGroup);
          for (const lk of model.links) {
            entityObjectMap.set(lk.entityId, gridGroup);
          }
          continue;
        }

        const modelGroup = new THREE.Group();
        modelGroup.name = model.name;
        applySdfPoseToObject(modelGroup, model.pose);
        modelGroup.userData = { entityId: model.entityId, entityName: model.name };

        // Soft Contact Shadow Disc under dynamic models
        const shadowDiscGeo = new THREE.CircleGeometry(0.4, 24);
        shadowDiscGeo.rotateX(-Math.PI / 2);
        const shadowDiscMat = new THREE.MeshBasicMaterial({
          color: 0x1f2937,
          transparent: true,
          opacity: 0.26,
          depthWrite: false,
        });
        const shadowDisc = new THREE.Mesh(shadowDiscGeo, shadowDiscMat);
        shadowDisc.position.set(0, Math.max(0.012, -model.pose[2] + 0.012), 0);
        modelGroup.add(shadowDisc);
        modelShadowDiscMap.set(model.id, shadowDisc);

        const fkLinkPoses = computeModelLinkPoses(model);

        for (const link of model.links) {
          const linkGroup = new THREE.Group();
          linkGroup.name = link.name;
          const activeLinkPose = fkLinkPoses.get(link.name) || link.pose;
          applySdfPoseToObject(linkGroup, activeLinkPose);
          linkGroup.userData = {
            entityId: link.entityId,
            modelEntityId: model.entityId,
          };

          linkInitialPoseMap.set(`${model.id}::${link.name}`, [...link.pose]);

          for (const vis of link.visuals) {
            const geom = createSdfGeometry(vis.geometry);
            const [r, g, b, a] = vis.material.diffuse;
            const [sr, sg, sb] = vis.material.specular;
            const specAvg = (sr + sg + sb) / 3;
            const mat = new THREE.MeshStandardMaterial({
              color: new THREE.Color(r, g, b),
              roughness: Math.max(0.2, 0.85 - specAvg * 0.55),
              metalness: Math.min(0.25, specAvg * 0.35),
              transparent: a < 0.99,
              opacity: a,
              wireframe: ov.wireframeMode,
            });
            const mesh = new THREE.Mesh(geom, mat);
            applySdfPoseToObject(mesh, vis.pose);
            mesh.castShadow = !isSoftwareGl;
            mesh.receiveShadow = !isSoftwareGl;
            mesh.userData = {
              entityId: model.entityId,
              linkEntityId: link.entityId,
            };
            linkGroup.add(mesh);
            clickableMeshes.push(mesh);
          }

          // Debug Overlay: Collision Wireframes
          if (ov.showCollisionWireframes) {
            for (const col of link.collisions) {
              const cGeom = createSdfGeometry(col.geometry);
              const cMat = new THREE.MeshBasicMaterial({
                color: 0xf97316,
                wireframe: true,
                transparent: true,
                opacity: 0.85,
              });
              const cMesh = new THREE.Mesh(cGeom, cMat);
              applySdfPoseToObject(cMesh, col.pose);
              linkGroup.add(cMesh);
            }
          }

          // Debug Overlay: Center of Mass (CoM) & Principal Inertia Box
          if (ov.showInertiaAndCoM && !model.isStatic && link.inertial.mass > 0.005) {
            const comGroup = new THREE.Group();
            applySdfPoseToObject(comGroup, link.inertial.pose);

            const comSphere = new THREE.Mesh(
              new THREE.SphereGeometry(0.06, 12, 12),
              new THREE.MeshBasicMaterial({ color: 0xd946ef, depthTest: false })
            );
            comSphere.renderOrder = 15;
            comGroup.add(comSphere);

            const m = Math.max(0.1, link.inertial.mass);
            const { ixx, iyy, izz } = link.inertial.inertia;
            const bx = Math.min(
              0.85,
              Math.max(0.14, Math.sqrt((6 * (iyy + izz - ixx)) / m) * 0.32 || 0.24)
            );
            const by = Math.min(
              0.85,
              Math.max(0.14, Math.sqrt((6 * (ixx + izz - iyy)) / m) * 0.32 || 0.24)
            );
            const bz = Math.min(
              0.85,
              Math.max(0.14, Math.sqrt((6 * (ixx + iyy - izz)) / m) * 0.32 || 0.24)
            );

            const inertiaBox = new THREE.Mesh(
              new THREE.BoxGeometry(bx, bz, by),
              new THREE.MeshBasicMaterial({
                color: 0x9333ea,
                wireframe: true,
                transparent: true,
                opacity: 0.85,
              })
            );
            comGroup.add(inertiaBox);
            linkGroup.add(comGroup);
          }

          // Debug Overlay: Link Coordinate Frames
          if (ov.showJointAxesAndFrames) {
            const axes = new THREE.AxesHelper(0.32);
            linkGroup.add(axes);
          }

          modelGroup.add(linkGroup);
          entityObjectMap.set(link.entityId, linkGroup);
          linkGroupMap.set(`${model.id}::${link.name}`, linkGroup);
        }

        // Debug Overlay: Joint Axis Vectors at the exact Joint Frame Origin inside Child Link
        if (ov.showJointAxesAndFrames) {
          for (const joint of model.joints) {
            const childGroup = linkGroupMap.get(`${model.id}::${joint.child}`);
            if (childGroup) {
              const axisVec = sdfVectorToThree(joint.axis.xyz).normalize();
              const originVec = sdfVectorToThree([
                joint.pose[0],
                joint.pose[1],
                joint.pose[2],
              ]);
              const jArrow = new THREE.ArrowHelper(
                axisVec,
                originVec,
                0.42,
                0xeab308,
                0.12,
                0.08
              );
              childGroup.add(jArrow);
            }
          }
        }

        worldRootGroup.add(modelGroup);
        entityObjectMap.set(model.entityId, modelGroup);
        modelGroupMap.set(model.id, modelGroup);
      }

      if (
        selectedIdRef.current !== null &&
        gizmoModeRef.current !== 'select' &&
        !placementToolRef.current
      ) {
        const targetObj = entityObjectMap.get(selectedIdRef.current);
        if (targetObj && targetObj !== gridGroup) {
          transformControls.setMode(gizmoModeRef.current);
          transformControls.setSpace(transformSpaceRef.current);
          transformControls.attach(targetObj);
        }
      }

      updateSelectionHighlight(selectedIdRef.current);
      renderNow();
    };

    const syncDynamicPoses = (w: ParsedWorld | null) => {
      if (!w) return;
      syncWindAndGridOverlays(w);

      for (const light of w.lights) {
        if (draggedEntityIdRef.current === light.entityId) continue;
        const lGroup = entityObjectMap.get(light.entityId);
        if (lGroup) {
          applySdfPoseToObject(lGroup, light.pose);
        }
      }

      for (const model of w.models) {
        if (model.name === 'ground_plane') continue;
        const mGroup = modelGroupMap.get(model.id);
        if (!mGroup) continue;

        if (draggedEntityIdRef.current !== model.entityId) {
          applySdfPoseToObject(mGroup, model.pose);
        }

        const disc = modelShadowDiscMap.get(model.id);
        if (disc) {
          disc.position.set(0, Math.max(0.012, -model.pose[2] + 0.012), 0);
        }

        // Compute exact multi-body hierarchical Forward Kinematics for all links in the model
        const fkLinkPoses = computeModelLinkPoses(model);
        for (const link of model.links) {
          if (draggedEntityIdRef.current === link.entityId) continue;
          const lGroup = linkGroupMap.get(`${model.id}::${link.name}`);
          if (lGroup) {
            const nextPose = fkLinkPoses.get(link.name) || link.pose;
            applySdfPoseToObject(lGroup, nextPose);
          }
        }
      }

      // Render live GpuLidar scan rays and active 3D ground contact manifold points
      sensorOverlayGroup.clear();
      const ov = overlaysRef.current;

      if (ov.showLidarRays !== false) {
        const rayPositions: number[] = [];
        for (const model of w.models) {
          if (model.name === 'ground_plane') continue;
          const fkMap = computeModelLinkPoses(model);
          for (const link of model.links) {
            if (!link.sensors || link.sensors.length === 0) continue;
            const lkPose = fkMap.get(link.name) || link.pose;
            const worldX = model.pose[0] + lkPose[0];
            const worldY = model.pose[1] + lkPose[1];
            const worldZ = model.pose[2] + lkPose[2];
            const worldYaw = model.pose[5] + lkPose[5];

            for (const sensor of link.sensors) {
              if (sensor.type === 'gpu_lidar' && sensor.lidar && sensor.visualize) {
                const { horizontalSamples, minAngle, maxAngle, ranges } = sensor.lidar;
                const sx = worldX + sensor.pose[0];
                const sy = worldY + sensor.pose[1];
                const sz = worldZ + sensor.pose[2];
                const startThree = sdfVectorToThree([sx, sy, sz]);

                for (let i = 0; i < horizontalSamples; i += 2) {
                  const frac =
                    horizontalSamples > 1 ? i / (horizontalSamples - 1) : 0;
                  const rayYaw = worldYaw + sensor.pose[5] + minAngle + frac * (maxAngle - minAngle);
                  const dist = Math.min(3.5, ranges[i] ?? sensor.lidar.maxRange);
                  const ex = sx + dist * Math.cos(rayYaw);
                  const ey = sy + dist * Math.sin(rayYaw);
                  const endThree = sdfVectorToThree([ex, ey, sz]);
                  rayPositions.push(
                    startThree.x,
                    startThree.y,
                    startThree.z,
                    endThree.x,
                    endThree.y,
                    endThree.z
                  );
                }
              }
            }
          }
        }
        if (rayPositions.length > 0) {
          const rayGeo = new THREE.BufferGeometry();
          rayGeo.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(rayPositions, 3)
          );
          const rayMat = new THREE.LineBasicMaterial({
            color: 0x0ea5e9,
            transparent: true,
            opacity: 0.42,
          });
          sensorOverlayGroup.add(new THREE.LineSegments(rayGeo, rayMat));
        }
      }

      if (ov.showContactPoints) {
        const contactDotGeo = new THREE.SphereGeometry(0.032, 8, 8);
        const contactDotMat = new THREE.MeshBasicMaterial({
          color: 0x10b981,
          depthTest: false,
        });
        for (const model of w.models) {
          if (model.name === 'ground_plane' || !model.activeContactPoints) continue;
          for (const pt of model.activeContactPoints.slice(0, 12)) {
            const dot = new THREE.Mesh(contactDotGeo, contactDotMat);
            const pThree = sdfVectorToThree(pt);
            dot.position.set(pThree.x, Math.max(0.015, pThree.y), pThree.z);
            dot.renderOrder = 20;
            sensorOverlayGroup.add(dot);
          }
        }
      }

      updateSelectionHighlight(selectedIdRef.current);
    };

    // Raycasting for 3D Interactive Shape Placement & Entity Selection
    const raycaster = new THREE.Raycaster();
    const groundMathPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const pointerDownPos = new THREE.Vector2();

    const computeGroundPlacementPose = (clientX: number, clientY: number): Pose6D | null => {
      const tool = placementToolRef.current;
      if (!tool) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return null;

      const mouse = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const hitPoint = new THREE.Vector3();
      const hit = raycaster.ray.intersectPlane(groundMathPlane, hitPoint);
      if (!hit) return null;

      let gx = Math.max(-14, Math.min(14, hitPoint.x));
      let gy = Math.max(-14, Math.min(14, -hitPoint.z));

      if (snapToGridRef.current) {
        gx = Math.round(gx * 4) / 4;
        gy = Math.round(gy * 4) / 4;
      } else {
        gx = Number(gx.toFixed(2));
        gy = Number(gy.toFixed(2));
      }

      let gz = 0.25;
      if (tool.kind === 'primitive') {
        gz = getDefaultGroundZForPrimitive(tool.shape);
      } else if (tool.kind === 'light') {
        gz = 3.0;
      } else if (tool.kind === 'paste') {
        const src = worldRef.current?.models.find(
          (m) => m.entityId === tool.sourceEntityId
        );
        gz = src ? src.pose[2] : 0.25;
      }

      return [gx, gy, gz, 0, 0, 0];
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!placementToolRef.current) return;
      const nextPose = computeGroundPlacementPose(e.clientX, e.clientY);
      if (nextPose) {
        applySdfPoseToObject(placementPreviewGroup, nextPose);
        const ring = placementPreviewGroup.getObjectByName('ground_target_ring');
        if (ring) {
          ring.position.set(0, -nextPose[2] + 0.01, 0);
        }
        placementPreviewGroup.visible = true;
        onPreviewPoseChangeRef.current(nextPose);
        renderNow();
      }
    };

    const handlePointerDown = (e: PointerEvent) => {
      pointerDownPos.set(e.clientX, e.clientY);
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      if (pointerDownPos.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 6) return;
      if (transformControls.dragging) return;

      // If a Shape / Light / Paste Placement Tool is active, place the entity at the clicked 3D location!
      if (placementToolRef.current) {
        const targetPose =
          computeGroundPlacementPose(e.clientX, e.clientY) || previewPoseRef.current;
        onConfirmPlacementRef.current(targetPose);
        return;
      }

      // Otherwise, raycast to select the clicked 3D entity
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects(clickableMeshes, false);
      if (hits.length > 0) {
        const entityId = hits[0].object.userData.entityId as number | undefined;
        if (entityId !== undefined) {
          onSelectRef.current(entityId);
        }
      }
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    // Keyboard shortcuts: Esc to cancel placement, WASD teleoperation
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && placementToolRef.current) {
        onCancelPlacementRef.current();
        return;
      }

      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') return;
      const w = worldRef.current;
      if (!w) return;
      const targetModel = w.models.find((m) => !m.isStatic && m.name !== 'ground_plane');
      if (!targetModel) return;

      if (e.code === 'KeyW') targetModel.cmdVel.linearX = 1.5;
      else if (e.code === 'KeyS') targetModel.cmdVel.linearX = -1.2;
      else if (e.code === 'KeyA') targetModel.cmdVel.angularZ = 1.3;
      else if (e.code === 'KeyD') targetModel.cmdVel.angularZ = -1.3;
      else if (e.code === 'Space') {
        targetModel.cmdVel = { linearX: 0, linearY: 0, angularZ: 0 };
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const w = worldRef.current;
      if (!w) return;
      const targetModel = w.models.find((m) => !m.isStatic && m.name !== 'ground_plane');
      if (!targetModel) return;
      if (e.code === 'KeyW' || e.code === 'KeyS') targetModel.cmdVel.linearX = 0;
      if (e.code === 'KeyA' || e.code === 'KeyD') targetModel.cmdVel.angularZ = 0;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width: cw, height: ch } = entry.contentRect;
        if (cw > 10 && ch > 10) {
          camera.aspect = cw / ch;
          camera.updateProjectionMatrix();
          renderer.setSize(cw, ch);
          renderNow();
        }
      }
    });
    resizeObserver.observe(container);

    sceneObjectsRef.current = {
      renderer,
      scene,
      camera,
      controls,
      transformControls,
      gridGroup,
      worldRootGroup,
      windArrowsGroup,
      sensorOverlayGroup,
      placementPreviewGroup,
      selectionRingMesh,
      entityObjectMap,
      modelGroupMap,
      modelShadowDiscMap,
      linkGroupMap,
      linkInitialPoseMap,
      clickableMeshes,
      renderNow,
      rebuildSceneFromWorld,
      syncDynamicPoses,
      rebuildPlacementPreview,
      updateSelectionHighlight,
    };

    lastStructureSigRef.current = getWorldStructureSignature(
      worldRef.current,
      overlaysRef.current
    );
    rebuildSceneFromWorld(worldRef.current);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      controls.removeEventListener('change', renderNow);
      transformControls.dispose();
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // 2. Smart Scene Update: Only rebuild meshes when topology/geometry/overlays change;
  //    for pose-only updates, sync transforms in-place so TransformControls stays smooth!
  useEffect(() => {
    const ctx = sceneObjectsRef.current;
    if (!ctx) return;
    const nextSig = getWorldStructureSignature(world, debugOverlays);
    if (nextSig !== lastStructureSigRef.current) {
      lastStructureSigRef.current = nextSig;
      ctx.rebuildSceneFromWorld(world);
    } else {
      ctx.syncDynamicPoses(world);
      ctx.renderNow();
    }
  }, [world, debugOverlays]);

  // 3. Update TransformControls Gizmo attachment, mode, coordinate space, and grid snapping
  useEffect(() => {
    const ctx = sceneObjectsRef.current;
    if (!ctx) return;
    const {
      transformControls,
      entityObjectMap,
      gridGroup,
      updateSelectionHighlight,
      renderNow,
    } = ctx;

    transformControls.setSpace(transformSpace);
    if (snapToGrid) {
      transformControls.setTranslationSnap(0.25);
      transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
      transformControls.setScaleSnap(0.1);
    } else {
      transformControls.setTranslationSnap(null);
      transformControls.setRotationSnap(null);
      transformControls.setScaleSnap(null);
    }

    if (gizmoMode === 'select' || selectedEntityId === null || placementTool !== null) {
      transformControls.detach();
    } else {
      transformControls.setMode(gizmoMode);
      const obj = entityObjectMap.get(selectedEntityId);
      if (obj && obj !== gridGroup) {
        transformControls.attach(obj);
      } else {
        transformControls.detach();
      }
    }

    updateSelectionHighlight(selectedEntityId);
    renderNow();
  }, [selectedEntityId, gizmoMode, transformSpace, snapToGrid, placementTool]);

  // 4. Update 3D Placement Preview Ghost when placementTool or previewPose changes
  useEffect(() => {
    const ctx = sceneObjectsRef.current;
    if (!ctx) return;
    ctx.rebuildPlacementPreview(placementTool, previewPose);
  }, [placementTool]);

  useEffect(() => {
    const ctx = sceneObjectsRef.current;
    if (!ctx || !placementTool) return;
    applySdfPoseToObject(ctx.placementPreviewGroup, previewPose);
    const ring = ctx.placementPreviewGroup.getObjectByName('ground_target_ring');
    if (ring) {
      ring.position.set(0, -previewPose[2] + 0.01, 0);
    }
    ctx.renderNow();
  }, [previewPose, placementTool]);

  // 5. Camera View Presets
  useEffect(() => {
    const ctx = sceneObjectsRef.current;
    if (!ctx || cameraPresetTrigger.seq === 0) return;
    const { camera, controls, renderNow } = ctx;
    const preset = cameraPresetTrigger.preset;

    if (preset === 'iso') {
      camera.position.set(3.4, 2.2, 3.6);
      controls.target.set(0, 0.45, 0);
    } else if (preset === 'top') {
      camera.position.set(0.01, 6.5, 0.01);
      controls.target.set(0, 0, 0);
    } else if (preset === 'front') {
      camera.position.set(4.5, 1.1, 0);
      controls.target.set(0, 0.55, 0);
    } else if (preset === 'side') {
      camera.position.set(0, 1.1, 4.5);
      controls.target.set(0, 0.55, 0);
    } else if (preset === 'follow' && worldRef.current) {
      const hero = worldRef.current.models.find(
        (m) => !m.isStatic && m.name !== 'ground_plane'
      );
      if (hero) {
        const tx = hero.pose[0];
        const ty = hero.pose[2];
        const tz = -hero.pose[1];
        camera.position.set(tx + 2.5, ty + 1.8, tz + 2.5);
        controls.target.set(tx, ty + 0.4, tz);
      }
    }
    controls.update();
    renderNow();
  }, [cameraPresetTrigger]);

  // 6. Single Step Trigger
  useEffect(() => {
    if (stepTrigger === 0 || !worldRef.current) return;
    const w = worldRef.current;
    const stepDt = w.physics.maxStepSize || 0.01;
    stepPhysicsWorld(w, stepDt, draggedEntityIdRef.current);
    simMetricsRef.current.simTime += stepDt;
    simMetricsRef.current.realTime += stepDt;
    simMetricsRef.current.iterations += 1;
    onTelemetryRef.current(
      simMetricsRef.current.simTime,
      simMetricsRef.current.realTime,
      100.0,
      simMetricsRef.current.iterations
    );
    sceneObjectsRef.current?.syncDynamicPoses(w);
    sceneObjectsRef.current?.renderNow();
  }, [stepTrigger]);

  // 7. Continuous Physics & Render Loop when Play is active
  useEffect(() => {
    const ctx = sceneObjectsRef.current;
    if (!ctx) return;

    if (!isSimRunning) {
      ctx.renderNow();
      return;
    }

    let timerId = 0;
    let cancelled = false;
    let lastTime = performance.now();

    const stepAndDraw = () => {
      if (cancelled || !isRunningRef.current) return;
      const now = performance.now();
      const elapsedSec = Math.min(0.05, Math.max(0.01, (now - lastTime) / 1000));
      lastTime = now;

      const w = worldRef.current;
      if (w) {
        const subSteps = 2;
        const subDt = elapsedSec / subSteps;
        for (let s = 0; s < subSteps; s++) {
          stepPhysicsWorld(w, subDt, draggedEntityIdRef.current);
        }
        simMetricsRef.current.simTime += elapsedSec * w.physics.realTimeFactor;
        simMetricsRef.current.realTime += elapsedSec;
        simMetricsRef.current.iterations += subSteps;

        ctx.syncDynamicPoses(w);

        if (now - simMetricsRef.current.lastTelemetryPush > 250) {
          simMetricsRef.current.lastTelemetryPush = now;
          const rtf = w.physics.realTimeFactor * 100;
          onTelemetryRef.current(
            simMetricsRef.current.simTime,
            simMetricsRef.current.realTime,
            rtf,
            simMetricsRef.current.iterations
          );
        }
      }

      ctx.renderNow();

      if (isSoftwareGl) {
        timerId = window.setTimeout(stepAndDraw, 110);
      } else {
        timerId = requestAnimationFrame(stepAndDraw);
      }
    };

    if (isSoftwareGl) {
      timerId = window.setTimeout(stepAndDraw, 60);
    } else {
      timerId = requestAnimationFrame(stepAndDraw);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(timerId);
      clearTimeout(timerId);
    };
  }, [isSimRunning]);

  return (
    <div
      ref={mountRef}
      data-testid="gazebo-3d-viewport"
      className={`w-full h-full relative overflow-hidden bg-[#c8c8c8] ${
        placementTool ? 'cursor-crosshair' : ''
      }`}
    />
  );
};
