import React, { useState, useEffect } from 'react';
import {
  Menu,
  MoreVertical,
  Play,
  Pause,
  RotateCcw,
  MousePointer,
  Move,
  RotateCw,
  Maximize2,
  Grid,
  Camera,
  Copy,
  ClipboardPaste,
  Sun,
  Lightbulb,
  Flashlight,
  Box,
  Circle,
  Triangle,
  Cylinder as CylinderIcon,
  Pill,
  Orbit,
  ChevronRight,
  ChevronDown,
  Plus,
  Lock,
  Unlock,
  Wind,
  Eye,
  Crosshair,
  Compass,
  Trash2,
  Check,
  X,
  RefreshCw,
  Magnet,
  Globe,
  Puzzle,
  Radio,
} from 'lucide-react';
import {
  DebugOverlaySettings,
  LightSpawnType,
  ParsedWorld,
  PlacementToolState,
  Pose6D,
  PrimitiveShapeType,
  SimLight,
  SimLink,
  SimModel,
  TransformGizmoMode,
  TransformSpace,
} from '../types/simulation';
import { getDefaultGroundZForPrimitive } from '../utils/sdfCompiler';
import { GazeboViewport3D } from './GazeboViewport3D';

interface GazeboSimulatorPaneProps {
  world: ParsedWorld | null;
  isSimRunning: boolean;
  onTogglePlay: () => void;
  onPauseSimulation: () => void;
  onStepSimulation: () => void;
  onResetSimulation: () => void;
  stepTrigger: number;
  selectedEntityId: number | null;
  onSelectEntity: (entityId: number) => void;
  onUpdateEntityPose: (entityId: number, newPose: Pose6D) => void;
  onScaleEntity: (entityId: number, scaleFactors: [number, number, number]) => void;
  onDeleteEntity: (entityId: number) => void;
  onToggleModelProperty: (
    modelId: string,
    prop: 'enableWind' | 'selfCollide' | 'isStatic'
  ) => void;
  onSpawnPrimitiveAtPose: (shape: PrimitiveShapeType, pose: Pose6D) => void;
  onSpawnLightAtPose: (lightType: LightSpawnType, pose: Pose6D) => void;
  onPasteModelAtPose: (sourceEntityId: number, pose: Pose6D) => void;
  onSyncSceneToEditor: () => void;
  onUpdateJointTarget?: (
    modelId: string,
    jointId: string,
    mode: 'position' | 'velocity' | 'effort',
    value: number
  ) => void;
  gizmoMode: TransformGizmoMode;
  onChangeGizmoMode: (mode: TransformGizmoMode) => void;
  debugOverlays: DebugOverlaySettings;
  onToggleDebugOverlay: (key: keyof DebugOverlaySettings) => void;
  simTime: number;
  realTime: number;
  rtf: number;
  iterations: number;
  onTelemetryUpdate: (
    simTime: number,
    realTime: number,
    rtf: number,
    iterations: number
  ) => void;
  onOpenPluginBrowser?: () => void;
}

function formatSimTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(
    secs
  ).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

export const GazeboSimulatorPane: React.FC<GazeboSimulatorPaneProps> = ({
  world,
  isSimRunning,
  onTogglePlay,
  onPauseSimulation,
  onStepSimulation,
  onResetSimulation,
  stepTrigger,
  selectedEntityId,
  onSelectEntity,
  onUpdateEntityPose,
  onScaleEntity,
  onDeleteEntity,
  onToggleModelProperty,
  onSpawnPrimitiveAtPose,
  onSpawnLightAtPose,
  onPasteModelAtPose,
  onSyncSceneToEditor,
  onUpdateJointTarget,
  gizmoMode,
  onChangeGizmoMode,
  debugOverlays,
  onToggleDebugOverlay,
  simTime,
  rtf,
  iterations,
  onTelemetryUpdate,
  onOpenPluginBrowser,
}) => {
  const [showPoseExpanded, setShowPoseExpanded] = useState<boolean>(true);
  const [showJointsExpanded, setShowJointsExpanded] = useState<boolean>(true);
  const [showSystemsExpanded, setShowSystemsExpanded] = useState<boolean>(true);
  const [inspectorWidth, setInspectorWidth] = useState<number>(320);
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({
    ground_plane: false,
    r2d2: true,
    kuka_arm_6dof: true,
    husky_rover_4wd: true,
    ros2_inspection_arm: true,
    ros2_urdf_rover: true,
  });
  const [showRightInspector, setShowRightInspector] = useState<boolean>(true);
  const [showMoreMenu, setShowMoreMenu] = useState<boolean>(false);
  const [transformSpace, setTransformSpace] = useState<TransformSpace>('world');
  const [snapToGrid, setSnapToGrid] = useState<boolean>(false);

  const handleInspectorSplitterPointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = inspectorWidth;

    const onMove = (moveEvt: PointerEvent) => {
      const nextW = Math.min(460, Math.max(240, startW - (moveEvt.clientX - startX)));
      setInspectorWidth(nextW);
    };
    const onUp = (upEvt: PointerEvent) => {
      target.releasePointerCapture(upEvt.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  // Interactive Gazebo Harmonic Placement Mode (only ONE tool active at a time!)
  const [placementTool, setPlacementTool] = useState<PlacementToolState>(null);
  const [previewPose, setPreviewPose] = useState<Pose6D>([1.2, 0.8, 0.25, 0, 0, 0]);
  const [copiedEntity, setCopiedEntity] = useState<{
    entityId: number;
    name: string;
    pose: Pose6D;
  } | null>(null);

  const [cameraPresetTrigger, setCameraPresetTrigger] = useState<{
    preset: 'iso' | 'top' | 'front' | 'side' | 'follow';
    seq: number;
  }>({ preset: 'iso', seq: 0 });
  const [statusToastMsg, setStatusToastMsg] = useState<string | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const triggerToast = (msg: string) => {
    setStatusToastMsg(msg);
    window.setTimeout(() => {
      setStatusToastMsg((prev) => (prev === msg ? null : prev));
    }, 2600);
  };

  // Locate selected Model, Link, or Light in active world
  let selectedModel: SimModel | undefined;
  let selectedLink: SimLink | undefined;
  let selectedLight: SimLight | undefined;

  if (world && selectedEntityId !== null) {
    selectedModel = world.models.find((m) => m.entityId === selectedEntityId);
    if (!selectedModel) {
      for (const m of world.models) {
        const lk = m.links.find((l) => l.entityId === selectedEntityId);
        if (lk) {
          selectedModel = m;
          selectedLink = lk;
          break;
        }
      }
    }
    if (!selectedModel) {
      selectedLight = world.lights.find((l) => l.entityId === selectedEntityId);
    }
  }
  if (!selectedModel && !selectedLight && world && world.models.length > 0) {
    selectedModel =
      world.models.find((m) => m.name !== 'ground_plane') || world.models[0];
  }

  const activePose: Pose6D = selectedLink
    ? selectedLink.pose
    : selectedModel
    ? selectedModel.pose
    : selectedLight
    ? selectedLight.pose
    : [0, 0, 0, 0, 0, 0];

  const activeEntityId = selectedLink
    ? selectedLink.entityId
    : selectedModel
    ? selectedModel.entityId
    : selectedLight
    ? selectedLight.entityId
    : 4;

  // Ensure a movable entity is selected when switching to Translate / Rotate / Scale
  const handleSelectGizmoMode = (mode: TransformGizmoMode) => {
    setPlacementTool(null);
    onChangeGizmoMode(mode);
    if (mode !== 'select' && world) {
      const isGroundSelected =
        selectedModel?.name === 'ground_plane' && !selectedLink && !selectedLight;
      if (selectedEntityId === null || isGroundSelected) {
        const firstMovable = world.models.find((m) => m.name !== 'ground_plane');
        if (firstMovable) {
          onSelectEntity(firstMovable.entityId);
        }
      }
    }
  };

  // Activate or toggle off a Primitive Shape Placement Tool (Official Gazebo Harmonic behavior)
  const handleSelectPrimitiveTool = (shape: PrimitiveShapeType) => {
    if (placementTool?.kind === 'primitive' && placementTool.shape === shape) {
      setPlacementTool(null);
      return;
    }
    const defaultZ = getDefaultGroundZForPrimitive(shape);
    // Offset default preview coordinates slightly based on current model count so consecutive placements never overlap
    const count = world ? world.models.length : 1;
    const angle = (count * 0.85) % (Math.PI * 2);
    const radius = 1.1 + (count % 3) * 0.45;
    const defaultX = Number((Math.cos(angle) * radius).toFixed(2));
    const defaultY = Number((Math.sin(angle) * radius).toFixed(2));
    setPreviewPose([defaultX, defaultY, defaultZ, 0, 0, 0]);
    setPlacementTool({ kind: 'primitive', shape });
    onChangeGizmoMode('select');
  };

  // Activate or toggle off a Light Placement Tool
  const handleSelectLightTool = (lightType: LightSpawnType) => {
    if (placementTool?.kind === 'light' && placementTool.lightType === lightType) {
      setPlacementTool(null);
      return;
    }
    const count = world ? world.lights.length : 1;
    const defaultX = Number(((count % 3) * 1.1 - 0.8).toFixed(2));
    const defaultY = Number((((count + 1) % 3) * 1.1 - 0.8).toFixed(2));
    setPreviewPose([defaultX, defaultY, 3.0, 0, 0, 0]);
    setPlacementTool({ kind: 'light', lightType });
    onChangeGizmoMode('select');
  };

  // Confirm placement in 3D world (called when user clicks on the 3D ground plane or clicks "Place Here")
  const handleConfirmPlacement = (poseToPlace: Pose6D) => {
    if (!placementTool) return;
    if (placementTool.kind === 'primitive') {
      onSpawnPrimitiveAtPose(placementTool.shape, poseToPlace);
      triggerToast(
        `Placed ${placementTool.shape} at (${poseToPlace[0].toFixed(2)}, ${poseToPlace[1].toFixed(2)}, ${poseToPlace[2].toFixed(2)})`
      );
    } else if (placementTool.kind === 'light') {
      onSpawnLightAtPose(placementTool.lightType, poseToPlace);
      triggerToast(
        `Placed ${placementTool.lightType} light at (${poseToPlace[0].toFixed(2)}, ${poseToPlace[1].toFixed(2)}, ${poseToPlace[2].toFixed(2)})`
      );
    } else if (placementTool.kind === 'paste') {
      onPasteModelAtPose(placementTool.sourceEntityId, poseToPlace);
      triggerToast(
        `Pasted copy of ${placementTool.sourceName} at (${poseToPlace[0].toFixed(2)}, ${poseToPlace[1].toFixed(2)})`
      );
    }
    setPlacementTool(null);
  };

  const handleCaptureScreenshot = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    const filename = `gazebo_sim_${world?.name || 'default'}.png`;
    a.download = filename;
    a.click();
    triggerToast(`Saved screenshot: ${filename}`);
  };

  // Official Gazebo Harmonic Copy Selected Entity button
  const handleCopyEntity = () => {
    const targetModel =
      selectedModel && selectedModel.name !== 'ground_plane'
        ? selectedModel
        : world?.models.find((m) => m.name !== 'ground_plane') || selectedModel;

    if (!targetModel) {
      triggerToast('No model available to copy');
      return;
    }

    setCopiedEntity({
      entityId: targetModel.entityId,
      name: targetModel.name,
      pose: [...targetModel.pose],
    });

    const poseText = `<pose>${targetModel.pose.map((v) => v.toFixed(3)).join(' ')}</pose>`;
    navigator.clipboard?.writeText(poseText).catch(() => {});
    triggerToast(`Copied "${targetModel.name}" — Click Paste to place a clone`);
  };

  // Official Gazebo Harmonic Paste Entity button
  const handlePasteEntity = () => {
    let source = copiedEntity;
    if (!source) {
      const fallbackModel =
        selectedModel && selectedModel.name !== 'ground_plane'
          ? selectedModel
          : world?.models.find((m) => m.name !== 'ground_plane');
      if (!fallbackModel) {
        triggerToast('Select or copy a model first to paste');
        return;
      }
      source = {
        entityId: fallbackModel.entityId,
        name: fallbackModel.name,
        pose: [...fallbackModel.pose],
      };
      setCopiedEntity(source);
    }

    // If user clicks Paste while already in Paste placement mode, place immediately at previewPose!
    if (placementTool?.kind === 'paste') {
      handleConfirmPlacement(previewPose);
      return;
    }

    const offsetPose: Pose6D = [
      Number((source.pose[0] + 0.75).toFixed(2)),
      Number((source.pose[1] + 0.75).toFixed(2)),
      source.pose[2],
      source.pose[3],
      source.pose[4],
      source.pose[5],
    ];
    setPreviewPose(offsetPose);
    setPlacementTool({
      kind: 'paste',
      sourceEntityId: source.entityId,
      sourceName: source.name,
    });
    onChangeGizmoMode('select');
    triggerToast(
      `Placing copy of "${source.name}" — Click in 3D view or click "Place Here"`
    );
  };

  // Keyboard shortcuts for T (Translate), R (Rotate), E (Scale), Del (Delete)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedModel && selectedModel.name !== 'ground_plane') {
          onDeleteEntity(selectedModel.entityId);
          triggerToast(`Deleted model "${selectedModel.name}"`);
        } else if (selectedLight && selectedLight.name !== 'sun') {
          onDeleteEntity(selectedLight.entityId);
          triggerToast(`Deleted light "${selectedLight.name}"`);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedModel, selectedLight, onDeleteEntity]);

  const shapeTools: Array<{
    shape: PrimitiveShapeType;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      shape: 'box',
      label: 'Spawn Box',
      icon: <Box className="w-4 h-4 fill-current/80" />,
    },
    {
      shape: 'sphere',
      label: 'Spawn Sphere',
      icon: <Circle className="w-4 h-4 fill-current/80" />,
    },
    {
      shape: 'cone',
      label: 'Spawn Cone',
      icon: <Triangle className="w-4 h-4 fill-current/80" />,
    },
    {
      shape: 'cylinder',
      label: 'Spawn Cylinder',
      icon: <CylinderIcon className="w-4 h-4 fill-current/80" />,
    },
    {
      shape: 'capsule',
      label: 'Spawn Capsule',
      icon: <Pill className="w-4 h-4 fill-current/80" />,
    },
    {
      shape: 'ellipsoid',
      label: 'Spawn Ellipsoid',
      icon: <Orbit className="w-4 h-4" />,
    },
  ];

  const lightTools: Array<{
    lightType: LightSpawnType;
    label: string;
    icon: React.ReactNode;
  }> = [
    {
      lightType: 'point',
      label: 'Spawn Point Light',
      icon: <Sun className="w-4 h-4" />,
    },
    {
      lightType: 'directional',
      label: 'Spawn Directional Light',
      icon: <Lightbulb className="w-4 h-4" />,
    },
    {
      lightType: 'spot',
      label: 'Spawn Spot Light',
      icon: <Flashlight className="w-4 h-4" />,
    },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-[#f3f4f6] text-[#1f2937] select-none overflow-hidden">
      {/* Authentic Gazebo Sim White Top App Bar */}
      <div className="flex items-center justify-between px-3 h-11 bg-white border-b border-[#d1d5db] shrink-0 relative z-30">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setShowRightInspector((v) => !v)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-700 shrink-0"
            title="Toggle Gazebo Entity Inspector Panel"
            aria-label="Toggle Gazebo Entity Inspector Panel"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-[15px] font-medium text-[#222222] tracking-tight whitespace-nowrap shrink-0">
            Gazebo Sim
          </span>
        </div>

        {/* Visual Debug Overlays & 3-Dots Menu */}
        <div className="flex items-center gap-1 shrink-0 relative">
          <button
            type="button"
            onClick={() => onToggleDebugOverlay('showCollisionWireframes')}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              debugOverlays.showCollisionWireframes
                ? 'bg-orange-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Toggle Collision Geometry Wireframes"
          >
            <Eye className="w-3 h-3" />
            <span>Collisions</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleDebugOverlay('showInertiaAndCoM')}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              debugOverlays.showInertiaAndCoM
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Toggle Center of Mass & Principal Inertia Bounding Boxes"
          >
            <Crosshair className="w-3 h-3" />
            <span>CoM &amp; Inertia</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleDebugOverlay('showJointAxesAndFrames')}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              debugOverlays.showJointAxesAndFrames
                ? 'bg-amber-500 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Toggle Link Coordinate Frames (XYZ) & Joint Axes"
          >
            <Compass className="w-3 h-3" />
            <span>Frames</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleDebugOverlay('showWindVectors')}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              debugOverlays.showWindVectors
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Toggle Aerodynamic Wind Vector Field"
          >
            <Wind className="w-3 h-3" />
            <span>Wind</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleDebugOverlay('showLidarRays')}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              debugOverlays.showLidarRays !== false
                ? 'bg-sky-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Toggle 3D GpuLidar Raycast Scan Visualization"
          >
            <Radio className="w-3 h-3" />
            <span>LiDAR</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleDebugOverlay('showContactPoints')}
            className={`px-2 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors whitespace-nowrap ${
              debugOverlays.showContactPoints
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Toggle 3D Ground Contact Manifold Points"
          >
            <Circle className="w-2.5 h-2.5 fill-current" />
            <span>Contacts</span>
          </button>

          <button
            type="button"
            onClick={() => setShowMoreMenu((v) => !v)}
            className="p-1.5 rounded hover:bg-gray-100 text-gray-700 ml-1 shrink-0"
            title="More Gazebo View & Scene Options"
            aria-label="More Gazebo options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMoreMenu && (
            <div className="absolute right-0 top-9 w-56 bg-white border border-gray-200 rounded shadow-lg py-1 z-50 text-xs text-gray-800">
              <button
                type="button"
                onClick={() => {
                  onToggleDebugOverlay('wireframeMode');
                  setShowMoreMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center justify-between"
              >
                <span>Mesh Wireframe Mode</span>
                <span className="font-mono text-[10px] text-gray-500">
                  {debugOverlays.wireframeMode ? 'ON' : 'OFF'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onToggleDebugOverlay('showLightFrustums');
                  setShowMoreMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center justify-between"
              >
                <span>Show Light Gizmos</span>
                <span className="font-mono text-[10px] text-gray-500">
                  {debugOverlays.showLightFrustums ? 'ON' : 'OFF'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onSyncSceneToEditor();
                  triggerToast('Synced live 3D poses to SDF code editor');
                  setShowMoreMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center gap-2 border-t border-gray-100"
              >
                <RefreshCw className="w-3.5 h-3.5 text-sky-600" />
                <span>Sync Live Poses to SDF Editor</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRightInspector((v) => !v);
                  setShowMoreMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-gray-100 flex items-center justify-between border-t border-gray-100"
              >
                <span>Entity Inspector Panel</span>
                <span className="font-mono text-[10px] text-gray-500">
                  {showRightInspector ? 'VISIBLE' : 'HIDDEN'}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Split Content: 3D Viewport (Left) + Gazebo Model Inspector & Entity Tree (Right) */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* 3D Viewport Area */}
        <div className="flex-1 relative min-w-0 h-full overflow-hidden">
          <GazeboViewport3D
            world={world}
            isSimRunning={isSimRunning}
            stepTrigger={stepTrigger}
            selectedEntityId={selectedEntityId}
            onSelectEntity={onSelectEntity}
            onUpdateEntityPose={onUpdateEntityPose}
            onScaleEntity={onScaleEntity}
            gizmoMode={gizmoMode}
            transformSpace={transformSpace}
            snapToGrid={snapToGrid}
            placementTool={placementTool}
            previewPose={previewPose}
            onPreviewPoseChange={setPreviewPose}
            onConfirmPlacement={handleConfirmPlacement}
            onCancelPlacement={() => setPlacementTool(null)}
            debugOverlays={debugOverlays}
            cameraPresetTrigger={cameraPresetTrigger}
            onTelemetryUpdate={onTelemetryUpdate}
            canvasRefOut={canvasRef}
          />

          {/* Camera View Preset Selector at Bottom-Right above RTF status bar */}
          <div className="absolute bottom-9 right-2 z-10 flex items-center gap-1 bg-[#55585c]/95 px-1.5 py-1 rounded shadow pointer-events-auto">
            {(['iso', 'top', 'front', 'side', 'follow'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() =>
                  setCameraPresetTrigger((prev) => ({ preset, seq: prev.seq + 1 }))
                }
                className="px-2 py-0.5 rounded text-[11px] font-medium text-gray-100 hover:bg-[#6c7075] capitalize whitespace-nowrap"
                title={`Switch camera to ${preset} view`}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Authentic Gazebo Harmonic Top-Left 2-Row Dark Grey Toolbar */}
          <div
            data-testid="gazebo-top-toolbar"
            className="absolute top-0 left-0 z-10 flex flex-col shadow-md pointer-events-auto"
          >
            {/* Row 1: Primitive Shapes & Lights Placement Tools (Select 1 shape at a time, then click in 3D view to place!) */}
            <div className="flex items-center bg-[#55585c] border-b border-[#686b70] px-1 py-0.5 gap-0.5">
              {shapeTools.map(({ shape, label, icon }) => {
                const isSelected =
                  placementTool?.kind === 'primitive' && placementTool.shape === shape;
                return (
                  <button
                    key={shape}
                    type="button"
                    aria-label={label}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectPrimitiveTool(shape)}
                    className={`p-2 rounded transition-colors ${
                      isSelected
                        ? 'bg-[#f26522] text-white shadow-inner ring-1 ring-white/40'
                        : 'text-gray-100 hover:bg-[#6c7075]'
                    }`}
                    title={`${label} — Select tool, then click anywhere on the ground in the 3D view to place`}
                  >
                    {icon}
                  </button>
                );
              })}

              <div className="w-px h-5 bg-[#6c7075] mx-0.5" />

              {lightTools.map(({ lightType, label, icon }) => {
                const isSelected =
                  placementTool?.kind === 'light' &&
                  placementTool.lightType === lightType;
                return (
                  <button
                    key={lightType}
                    type="button"
                    aria-label={label}
                    aria-pressed={isSelected}
                    onClick={() => handleSelectLightTool(lightType)}
                    className={`p-2 rounded transition-colors ${
                      isSelected
                        ? 'bg-[#f26522] text-white shadow-inner ring-1 ring-white/40'
                        : 'text-gray-100 hover:bg-[#6c7075]'
                    }`}
                    title={`${label} — Select tool, then click in the 3D view to place`}
                  >
                    {icon}
                  </button>
                );
              })}
            </div>

            {/* Row 2: Select, Translate, Rotate, Scale/Frame, Grid, Screenshot, Copy Entity, Paste Entity */}
            <div className="flex items-center bg-[#55585c] px-1 py-0.5 w-fit gap-0.5">
              <button
                type="button"
                aria-label="Selection Mode"
                aria-pressed={gizmoMode === 'select' && !placementTool}
                onClick={() => handleSelectGizmoMode('select')}
                className={`p-2 rounded transition-colors ${
                  gizmoMode === 'select' && !placementTool
                    ? 'bg-[#3d4043] text-white ring-1 ring-white/25'
                    : 'text-gray-200 hover:bg-[#6c7075]'
                }`}
                title="Selection Mode (Esc)"
              >
                <MousePointer className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label="Translate Mode"
                aria-pressed={gizmoMode === 'translate' && !placementTool}
                onClick={() => handleSelectGizmoMode('translate')}
                className={`p-2 rounded transition-colors ${
                  gizmoMode === 'translate' && !placementTool
                    ? 'bg-[#f26522] text-white ring-1 ring-white/40'
                    : 'text-gray-200 hover:bg-[#6c7075]'
                }`}
                title="Translate Mode — Smooth 3D XYZ Arrow Gizmo"
              >
                <Move className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label="Rotate Mode"
                aria-pressed={gizmoMode === 'rotate' && !placementTool}
                onClick={() => handleSelectGizmoMode('rotate')}
                className={`p-2 rounded transition-colors ${
                  gizmoMode === 'rotate' && !placementTool
                    ? 'bg-[#f26522] text-white ring-1 ring-white/40'
                    : 'text-gray-200 hover:bg-[#6c7075]'
                }`}
                title="Rotate Mode — Smooth 3D Roll/Pitch/Yaw Gimbal"
              >
                <RotateCw className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label="Scale Mode"
                aria-pressed={gizmoMode === 'scale' && !placementTool}
                onClick={() => handleSelectGizmoMode('scale')}
                className={`p-2 rounded transition-colors ${
                  gizmoMode === 'scale' && !placementTool
                    ? 'bg-[#3b82f6] text-white ring-1 ring-white/40'
                    : 'text-gray-200 hover:bg-[#6c7075]'
                }`}
                title="Scale & Coordinate Space Mode"
              >
                <Maximize2 className="w-4 h-4 text-[#60a5fa]" />
              </button>

              <div className="w-px h-5 bg-[#6c7075] mx-0.5" />

              <button
                type="button"
                aria-label="Toggle 3D Grid"
                aria-pressed={debugOverlays.showGrid}
                onClick={() => onToggleDebugOverlay('showGrid')}
                className={`p-2 rounded transition-colors ${
                  debugOverlays.showGrid
                    ? 'text-white bg-[#3d4043]'
                    : 'text-gray-300 hover:bg-[#6c7075]'
                }`}
                title="Toggle 3D Ground Grid"
              >
                <Grid className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label="Capture Viewport Screenshot"
                onClick={handleCaptureScreenshot}
                className="p-2 text-gray-200 hover:bg-[#6c7075] rounded transition-colors"
                title="Capture Viewport PNG Screenshot"
              >
                <Camera className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label="Copy Selected Entity"
                onClick={handleCopyEntity}
                className="p-2 text-gray-200 hover:bg-[#6c7075] rounded transition-colors"
                title="Copy Selected Entity (Gazebo Copy)"
              >
                <Copy className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label="Paste Entity"
                aria-pressed={placementTool?.kind === 'paste'}
                onClick={handlePasteEntity}
                className={`p-2 rounded transition-colors ${
                  placementTool?.kind === 'paste'
                    ? 'bg-[#f26522] text-white ring-1 ring-white/40'
                    : 'text-gray-200 hover:bg-[#6c7075]'
                }`}
                title="Paste Copied Entity into World (Gazebo Paste)"
              >
                <ClipboardPaste className="w-4 h-4" />
              </button>
            </div>

            {/* Contextual Gazebo Transform Options Bar (World/Local Frame & Snap to Grid) when Translate/Rotate/Scale is active */}
            {gizmoMode !== 'select' && !placementTool && (
              <div
                data-testid="transform-options-bar"
                className="flex items-center gap-1.5 bg-[#3d4043]/95 text-gray-100 px-2 py-1 text-[11px] border-t border-[#686b70] rounded-b shadow"
              >
                <span className="text-orange-400 font-semibold uppercase tracking-wider">
                  {gizmoMode}:
                </span>
                <span className="font-mono text-white truncate max-w-[110px]">
                  {selectedLink
                    ? selectedLink.name
                    : selectedModel
                    ? selectedModel.name
                    : selectedLight?.name || 'entity'}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setTransformSpace((s) => (s === 'world' ? 'local' : 'world'))
                  }
                  className="ml-1 px-1.5 py-0.5 rounded bg-[#55585c] hover:bg-[#6c7075] flex items-center gap-1 text-[10.5px]"
                  title="Toggle World vs Local Coordinate Frame"
                >
                  <Globe className="w-3 h-3 text-sky-400" />
                  <span className="capitalize">{transformSpace} Frame</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSnapToGrid((v) => !v)}
                  className={`px-1.5 py-0.5 rounded flex items-center gap-1 text-[10.5px] ${
                    snapToGrid
                      ? 'bg-sky-600 text-white'
                      : 'bg-[#55585c] hover:bg-[#6c7075] text-gray-200'
                  }`}
                  title="Toggle Grid Snapping (0.25m / 15°)"
                >
                  <Magnet className="w-3 h-3" />
                  <span>Snap {snapToGrid ? 'ON' : 'OFF'}</span>
                </button>
              </div>
            )}

            {/* Interactive Placement Mode HUD Banner when a Shape, Light, or Paste Tool is selected */}
            {placementTool && (
              <div
                data-testid="placement-mode-hud"
                className="flex flex-wrap items-center gap-2 bg-[#25282c]/95 text-white px-2.5 py-1.5 text-xs border-t border-[#f26522] rounded-b shadow-lg max-w-[460px]"
              >
                <span className="font-semibold text-[#f26522] whitespace-nowrap">
                  Placing{' '}
                  {placementTool.kind === 'primitive'
                    ? placementTool.shape.toUpperCase()
                    : placementTool.kind === 'light'
                    ? `${placementTool.lightType.toUpperCase()} LIGHT`
                    : `${placementTool.sourceName} (Copy)`}
                </span>

                <div className="flex items-center gap-1 font-mono text-[11px]">
                  <label className="flex items-center gap-0.5">
                    <span className="text-gray-400">X:</span>
                    <input
                      type="number"
                      step="0.25"
                      aria-label="Placement X coordinate"
                      value={previewPose[0]}
                      onChange={(e) => {
                        const next: Pose6D = [...previewPose] as Pose6D;
                        next[0] = Number(e.target.value) || 0;
                        setPreviewPose(next);
                      }}
                      className="w-12 bg-[#383c42] border border-gray-600 rounded px-1 py-0.5 text-white text-[11px]"
                    />
                  </label>
                  <label className="flex items-center gap-0.5">
                    <span className="text-gray-400">Y:</span>
                    <input
                      type="number"
                      step="0.25"
                      aria-label="Placement Y coordinate"
                      value={previewPose[1]}
                      onChange={(e) => {
                        const next: Pose6D = [...previewPose] as Pose6D;
                        next[1] = Number(e.target.value) || 0;
                        setPreviewPose(next);
                      }}
                      className="w-12 bg-[#383c42] border border-gray-600 rounded px-1 py-0.5 text-white text-[11px]"
                    />
                  </label>
                  <label className="flex items-center gap-0.5">
                    <span className="text-gray-400">Z:</span>
                    <input
                      type="number"
                      step="0.1"
                      aria-label="Placement Z coordinate"
                      value={previewPose[2]}
                      onChange={(e) => {
                        const next: Pose6D = [...previewPose] as Pose6D;
                        next[2] = Number(e.target.value) || 0;
                        setPreviewPose(next);
                      }}
                      className="w-12 bg-[#383c42] border border-gray-600 rounded px-1 py-0.5 text-white text-[11px]"
                    />
                  </label>
                </div>

                <div className="flex items-center gap-1 ml-auto">
                  <button
                    type="button"
                    data-testid="confirm-place-btn"
                    onClick={() => handleConfirmPlacement(previewPose)}
                    className="px-2 py-0.5 rounded bg-[#f26522] hover:bg-[#e05615] text-white font-semibold flex items-center gap-1 text-[11px]"
                    title="Place entity at these coordinates (or click directly on the 3D ground plane)"
                  >
                    <Check className="w-3 h-3" />
                    <span>Place Here</span>
                  </button>
                  <button
                    type="button"
                    data-testid="cancel-place-btn"
                    onClick={() => setPlacementTool(null)}
                    className="px-1.5 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200 flex items-center gap-0.5 text-[11px]"
                    title="Cancel Placement Mode (Esc)"
                  >
                    <X className="w-3 h-3" />
                    <span>Cancel</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {statusToastMsg && (
            <div
              data-testid="gazebo-status-toast"
              className="absolute top-24 left-3 z-20 px-3 py-1.5 rounded bg-gray-900/90 text-white text-xs font-mono shadow"
            >
              {statusToastMsg}
            </div>
          )}

          {/* Authentic Gazebo Bottom-Left Orange Play / Step / Reset Buttons */}
          <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2.5 pointer-events-auto">
            <button
              type="button"
              onClick={onTogglePlay}
              className="w-10 h-10 rounded-full bg-[#f26522] hover:bg-[#e05615] text-white shadow-md flex items-center justify-center transition-transform active:scale-95"
              title={
                isSimRunning ? 'Pause Physics Simulation' : 'Play Physics Simulation'
              }
              aria-label={
                isSimRunning ? 'Pause Physics Simulation' : 'Play Physics Simulation'
              }
            >
              {isSimRunning ? (
                <Pause className="w-4 h-4 fill-current text-gray-900" />
              ) : (
                <Play className="w-4 h-4 fill-current text-gray-900 ml-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (isSimRunning) {
                  onPauseSimulation();
                }
                onStepSimulation();
              }}
              className="w-7 h-7 rounded-full bg-[#f26522] hover:bg-[#e05615] text-gray-900 font-bold shadow flex items-center justify-center text-xs transition-transform active:scale-95"
              title="Step Physics by 1 Increment (Pauses continuous playback and steps 1 frame)"
              aria-label="Step Physics Simulation"
            >
              ...
            </button>

            <button
              type="button"
              onClick={() => {
                onResetSimulation();
                triggerToast('Reset simulation world to initial SDF state');
              }}
              className="w-7 h-7 rounded-full bg-[#f26522] hover:bg-[#e05615] text-gray-900 shadow flex items-center justify-center transition-transform active:scale-95"
              title="Reset World to Initial SDF Poses"
              aria-label="Reset Physics Simulation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Authentic Gazebo Bottom-Right Real-Time Factor (%) Bar */}
          <div className="absolute bottom-0 right-0 z-10 flex items-center gap-3 px-3 py-1 bg-[#d4d4d4]/95 border-t border-l border-[#bdbdbd] text-xs font-mono text-[#222222] rounded-tl">
            <span>&lt;</span>
            <span className="tabular-nums font-medium" title="Real-Time Factor">
              {(isSimRunning ? rtf : 0).toFixed(2)} %
            </span>
            <span className="text-gray-500">|</span>
            <span
              className="tabular-nums text-[11px] text-gray-700"
              title="Simulation Time"
            >
              Sim: {formatSimTime(simTime)}
            </span>
            <span
              className="tabular-nums text-[11px] text-gray-600 hidden md:inline"
              title="Physics Step Iterations"
            >
              Steps: {iterations}
            </span>
          </div>
        </div>

        {/* Right-Hand Gazebo Harmonic Model Inspector & Entity Tree */}
        {showRightInspector && (
          <>
            <div
              onPointerDown={handleInspectorSplitterPointerDown}
              onDoubleClick={() => setInspectorWidth(320)}
              title="Drag to resize Gazebo Entity Inspector panel (Double-click to reset)"
              className="w-1.5 h-full bg-[#d1d5db] hover:bg-[#0284c7] cursor-col-resize transition-colors shrink-0 z-20"
            />
            <div
              style={{ width: `${inspectorWidth}px` }}
              className="bg-[#f5f5f5] flex flex-col shrink-0 overflow-hidden text-[13px] text-[#333333]"
            >
            {/* Top Half: Model Property Inspector */}
            <div className="flex-1 flex flex-col min-h-0 border-b border-[#cccccc] overflow-y-auto">
              {/* Model Header Row */}
              <div className="flex items-center justify-between px-3 py-2.5 bg-[#f5f5f5] border-b border-[#e5e5e5] sticky top-0 z-10">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-sky-500/15 flex items-center justify-center text-[#0284c7]">
                    <Box className="w-4 h-4" />
                  </div>
                  <span className="font-medium text-[#374151]">
                    {selectedLink ? 'Link' : selectedLight ? 'Light' : 'Model'}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-gray-500 text-xs">
                  {selectedModel && (
                    <button
                      type="button"
                      onClick={() =>
                        onToggleModelProperty(selectedModel!.id, 'isStatic')
                      }
                      className="p-1 rounded hover:bg-gray-200 text-gray-600"
                      title={
                        selectedModel.isStatic
                          ? 'Model is Static (Locked) — Click to make Dynamic'
                          : 'Model is Dynamic — Click to Lock as Static'
                      }
                      aria-label="Toggle Model Static Lock"
                    >
                      {selectedModel.isStatic ? (
                        <Lock className="w-3.5 h-3.5 text-[#0284c7]" />
                      ) : (
                        <Unlock className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                  {((selectedModel && selectedModel.name !== 'ground_plane') ||
                    (selectedLight && selectedLight.name !== 'sun')) && (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteEntity(activeEntityId);
                        triggerToast(
                          `Deleted "${
                            selectedModel?.name || selectedLight?.name || 'entity'
                          }"`
                        );
                      }}
                      className="p-1 rounded hover:bg-red-100 text-gray-500 hover:text-red-600"
                      title="Delete Selected Entity (Del)"
                      aria-label="Delete Selected Entity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  <span className="text-[#4b5563] font-medium tabular-nums">
                    Entity {activeEntityId}
                  </span>
                </div>
              </div>

              {/* Property Rows matching Gazebo Sim screenshot */}
              {selectedModel || selectedLight ? (
                <div className="divide-y divide-[#e5e7eb] text-[12.5px]">
                  <div className="flex items-center justify-between px-3 py-2 bg-[#f0f0f0]">
                    <span className="text-[#4b5563]">Name</span>
                    <span className="font-medium text-[#111827] truncate max-w-[165px]">
                      {selectedLink
                        ? selectedLink.name
                        : selectedModel
                        ? selectedModel.name
                        : selectedLight?.name}
                    </span>
                  </div>

                  <div className="flex items-center justify-between px-3 py-2 bg-[#fafafa]">
                    <span className="text-[#4b5563]">Parent Entity</span>
                    <span className="font-mono text-[#111827] tabular-nums">
                      {selectedLink ? selectedModel?.entityId : world?.entityId || 1}
                    </span>
                  </div>

                  <div className="flex items-center justify-between px-3 py-2 bg-[#f0f0f0]">
                    <span className="text-[#4b5563]">Model Sdf</span>
                    <span className="text-gray-500 text-xs">1.10</span>
                  </div>

                  {selectedModel && (
                    <>
                      <div className="flex items-center justify-between px-3 py-2 bg-[#fafafa]">
                        <span className="text-[#4b5563] shrink-0">
                          Source File Path
                        </span>
                        <span
                          className="text-[#111827] truncate max-w-[155px] font-mono text-[11.5px]"
                          title={selectedModel.sourceFilePath}
                        >
                          ...e/gz/gz-sim8/
                          {selectedModel.sourceFilePath.split('/gz-sim8/')[1] ||
                            'worlds/empty.sdf'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between px-3 py-2 bg-[#f0f0f0]">
                        <span className="text-[#4b5563]">
                          Model Canonical Link
                        </span>
                        <span
                          data-testid="model-canonical-link"
                          className="text-[#111827] font-mono text-xs text-right"
                        >
                          {selectedModel.canonicalLink}
                          {selectedModel.virtualRootLink && (
                            <span className="block text-[10px] text-[#0284c7]">
                              (welded {selectedModel.virtualRootLink})
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Wind Mode Switch */}
                      <div className="flex items-center justify-between px-3 py-2 bg-[#fafafa]">
                        <span className="text-[#4b5563]">Wind Mode</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={selectedModel.enableWind}
                          aria-label="Toggle Wind Mode"
                          onClick={() =>
                            onToggleModelProperty(selectedModel!.id, 'enableWind')
                          }
                          className={`w-9 h-4 rounded-full relative transition-colors ${
                            selectedModel.enableWind
                              ? 'bg-[#0284c7]'
                              : 'bg-[#bcbcbc]'
                          }`}
                        >
                          <span
                            className={`block w-3.5 h-3.5 rounded-full bg-white shadow transform transition-transform ${
                              selectedModel.enableWind
                                ? 'translate-x-5'
                                : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>
                    </>
                  )}

                  {/* Expandable + Pose Section */}
                  <div className="bg-[#f7f7f7]">
                    <button
                      type="button"
                      onClick={() => setShowPoseExpanded((v) => !v)}
                      className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left text-[#4b5563] hover:bg-gray-200/60"
                    >
                      <span className="font-mono text-xs font-bold">
                        {showPoseExpanded ? '−' : '+'}
                      </span>
                      <span>Pose</span>
                    </button>

                    {showPoseExpanded && (
                      <div className="px-3 pb-2.5 pt-1 grid grid-cols-3 gap-1.5 bg-white border-t border-gray-200 text-xs">
                        {(
                          ['X (m)', 'Y (m)', 'Z (m)', 'Roll', 'Pitch', 'Yaw'] as const
                        ).map((label, idx) => (
                          <label key={label} className="flex flex-col gap-0.5">
                            <span className="text-[10px] text-gray-500">
                              {label}
                            </span>
                            <input
                              type="number"
                              step="0.1"
                              value={Number(activePose[idx].toFixed(2))}
                              onChange={(e) => {
                                const next: Pose6D = [...activePose] as Pose6D;
                                next[idx] = Number(e.target.value) || 0;
                                onUpdateEntityPose(activeEntityId, next);
                              }}
                              className="w-full bg-[#f3f4f6] border border-gray-300 rounded px-1.5 py-0.5 font-mono text-[11px] text-gray-900 tabular-nums"
                            />
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {selectedModel && (
                    <>
                      {/* Self Collide Switch */}
                      <div className="flex items-center justify-between px-3 py-2 bg-[#f0f0f0]">
                        <span className="text-[#4b5563]">Self Collide</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={selectedModel.selfCollide}
                          aria-label="Toggle Self Collide"
                          onClick={() =>
                            onToggleModelProperty(
                              selectedModel!.id,
                              'selfCollide'
                            )
                          }
                          className={`w-9 h-4 rounded-full relative transition-colors ${
                            selectedModel.selfCollide
                              ? 'bg-[#0284c7]'
                              : 'bg-[#bcbcbc]'
                          }`}
                        >
                          <span
                            className={`block w-3.5 h-3.5 rounded-full bg-white shadow transform transition-transform ${
                              selectedModel.selfCollide
                                ? 'translate-x-5'
                                : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>

                      {/* Static Switch */}
                      <div className="flex items-center justify-between px-3 py-2 bg-[#fafafa]">
                        <span className="text-[#4b5563]">Static</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={selectedModel.isStatic}
                          aria-label="Toggle Static Model"
                          onClick={() =>
                            onToggleModelProperty(selectedModel!.id, 'isStatic')
                          }
                          className={`w-9 h-4 rounded-full relative transition-colors ${
                            selectedModel.isStatic
                              ? 'bg-[#0284c7]'
                              : 'bg-[#bcbcbc]'
                          }`}
                        >
                          <span
                            className={`block w-3.5 h-3.5 rounded-full bg-white shadow transform transition-transform ${
                              selectedModel.isStatic
                                ? 'translate-x-5'
                                : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                      </div>

                      {/* Link Inertial & Mass Readout if link or dynamic model selected */}
                      {selectedModel.links[0] && !selectedModel.isStatic && (
                        <div className="px-3 py-2 bg-white space-y-1 text-[11.5px]">
                          <div className="flex items-center justify-between text-gray-600">
                            <span>Total Mass</span>
                            <span className="font-mono text-gray-900 font-medium tabular-nums">
                              {selectedModel.links
                                .reduce(
                                  (acc, l) =>
                                    acc + (l.inertial.mass > 0.005 ? l.inertial.mass : 0),
                                  0
                                )
                                .toFixed(2)}{' '}
                              kg
                            </span>
                          </div>
                          {(() => {
                            const primaryInertialLink =
                              selectedLink ||
                              selectedModel.links.find((l) => l.inertial.mass > 0.01) ||
                              selectedModel.links[0];
                            return (
                              <div className="flex items-center justify-between gap-2 text-gray-600">
                                <span className="shrink-0">
                                  Principal Inertia (Ixx, Iyy, Izz)
                                </span>
                                <span className="font-mono text-gray-900 text-[11px] tabular-nums truncate">
                                  [{primaryInertialLink.inertial.inertia.ixx},{' '}
                                  {primaryInertialLink.inertial.inertia.iyy},{' '}
                                  {primaryInertialLink.inertial.inertia.izz}]
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Expandable + Joints Telemetry & Live Actuation Section */}
                      {selectedModel.joints.length > 0 && (
                        <div className="bg-[#f7f7f7]">
                          <button
                            type="button"
                            onClick={() => setShowJointsExpanded((v) => !v)}
                            className="w-full flex items-center justify-between px-2.5 py-2 text-left text-[#4b5563] hover:bg-gray-200/60"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-bold">
                                {showJointsExpanded ? '−' : '+'}
                              </span>
                              <span>Joints ({selectedModel.joints.length})</span>
                            </div>
                            <span className="text-[10.5px] font-mono text-[#0284c7]">
                              {selectedModel.links.length} links
                            </span>
                          </button>

                          {showJointsExpanded && (
                            <div className="px-3 pb-2.5 pt-1.5 space-y-2 bg-white border-t border-gray-200 text-xs">
                              {selectedModel.joints.map((joint) => (
                                <div
                                  key={joint.id}
                                  className="p-1.5 rounded bg-[#f8fafc] border border-gray-200 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-1">
                                    <span
                                      className="font-mono text-[11px] font-semibold text-gray-800 truncate"
                                      title={`${joint.parent} -> ${joint.child} (${joint.type})`}
                                    >
                                      {joint.name}
                                    </span>
                                    <span className="font-mono text-[10.5px] text-[#0284c7] tabular-nums shrink-0">
                                      {joint.position.toFixed(2)}{' '}
                                      {joint.type === 'prismatic' ? 'm' : 'rad'}
                                    </span>
                                  </div>
                                  <div className="text-[10px] text-gray-500 font-mono truncate">
                                    {joint.parent} → {joint.child} · axis [
                                    {joint.axis.xyz.join(' ')}]
                                  </div>
                                  {joint.type !== 'fixed' && onUpdateJointTarget && (
                                    <div className="flex items-center gap-1.5 pt-0.5">
                                      <input
                                        type="range"
                                        min={
                                          joint.type === 'continuous'
                                            ? -3.14
                                            : joint.axis.lower
                                        }
                                        max={
                                          joint.type === 'continuous'
                                            ? 3.14
                                            : joint.axis.upper
                                        }
                                        step="0.01"
                                        aria-label={`Inspector joint target ${joint.name}`}
                                        value={joint.targetPosition}
                                        onChange={(e) =>
                                          onUpdateJointTarget(
                                            selectedModel!.id,
                                            joint.id,
                                            'position',
                                            Number(e.target.value)
                                          )
                                        }
                                        className="flex-1 accent-[#f26522] h-1.5 cursor-pointer"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onUpdateJointTarget(
                                            selectedModel!.id,
                                            joint.id,
                                            'position',
                                            0
                                          )
                                        }
                                        className="px-1.5 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 font-mono text-[10px]"
                                        title="Reset joint to 0"
                                      >
                                        0
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Expandable + Systems & Sensors (gz-sim8) Section */}
                      <div className="bg-[#f7f7f7] border-t border-gray-200">
                        <div className="flex items-center justify-between px-2.5 py-2 hover:bg-gray-200/60">
                          <button
                            type="button"
                            onClick={() => setShowSystemsExpanded((v) => !v)}
                            className="flex items-center gap-1.5 text-left text-[#4b5563]"
                          >
                            <span className="font-mono text-xs font-bold">
                              {showSystemsExpanded ? '−' : '+'}
                            </span>
                            <Puzzle className="w-3.5 h-3.5 text-[#f26522]" />
                            <span>
                              Systems &amp; Sensors (
                              {(selectedModel.plugins?.length || 0) +
                                selectedModel.links.reduce(
                                  (acc, l) => acc + (l.sensors?.length || 0),
                                  0
                                )}
                              )
                            </span>
                          </button>

                          {onOpenPluginBrowser && (
                            <button
                              type="button"
                              onClick={onOpenPluginBrowser}
                              className="px-2 py-0.5 rounded bg-[#f26522] hover:bg-[#e05615] text-white text-[10.5px] font-semibold flex items-center gap-0.5"
                              title="Open Gazebo Systems & Plugins Browser to add a plugin"
                            >
                              <Plus className="w-3 h-3" />
                              <span>Add Plugin</span>
                            </button>
                          )}
                        </div>

                        {showSystemsExpanded && (
                          <div className="px-3 pb-2.5 pt-1.5 space-y-1.5 bg-white border-t border-gray-200 text-xs">
                            {(selectedModel.plugins || []).map((plg) => (
                              <div
                                key={plg.id}
                                className="p-1.5 rounded bg-orange-50/70 border border-orange-200 space-y-0.5"
                              >
                                <div className="font-mono text-[11px] font-semibold text-gray-900 truncate">
                                  {plg.name}
                                </div>
                                <div className="font-mono text-[10px] text-orange-700 truncate">
                                  {plg.filename}
                                </div>
                              </div>
                            ))}

                            {selectedModel.links.flatMap((lk) =>
                              (lk.sensors || []).map((sensor) => (
                                <div
                                  key={sensor.id}
                                  className="p-1.5 rounded bg-sky-50/70 border border-sky-200 space-y-0.5"
                                >
                                  <div className="flex items-center justify-between">
                                    <span className="font-mono text-[11px] font-semibold text-gray-900">
                                      {sensor.name} ({sensor.type})
                                    </span>
                                    <span className="font-mono text-[10px] text-sky-700">
                                      {sensor.updateRate} Hz
                                    </span>
                                  </div>
                                  <div className="font-mono text-[10px] text-gray-600 truncate">
                                    topic: {sensor.topic}
                                  </div>
                                  {sensor.lidar && (
                                    <div className="font-mono text-[10px] text-emerald-700">
                                      min range:{' '}
                                      {Math.min(...sensor.lidar.ranges).toFixed(2)} m (
                                      {sensor.lidar.horizontalSamples} rays)
                                    </div>
                                  )}
                                  {sensor.imu && (
                                    <div className="font-mono text-[10px] text-purple-700">
                                      accel Z: {sensor.imu.linearAcceleration[2].toFixed(2)}{' '}
                                      m/s²
                                    </div>
                                  )}
                                </div>
                              ))
                            )}

                            {(selectedModel.plugins?.length || 0) === 0 &&
                              selectedModel.links.every(
                                (l) => (l.sensors?.length || 0) === 0
                              ) && (
                                <div className="text-[11px] text-gray-500 py-1">
                                  No model-specific plugins attached yet. Click{' '}
                                  <strong>+ Add Plugin</strong> to attach DiffDrive,
                                  JointPositionController, GpuLidar, or IMU.
                                </div>
                              )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="p-4 text-xs text-gray-500">
                  Select an entity in the Entity Tree or 3D Viewport to inspect
                  properties.
                </div>
              )}
            </div>

            {/* Bottom Half: Entity Tree */}
            <div className="h-[46%] flex flex-col min-h-0 bg-[#f9fafb]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-[#e5e7eb] bg-[#f5f5f5]">
                <span className="text-[#4b5563] font-medium">Entity Tree</span>
                <button
                  type="button"
                  onClick={() => handleSelectPrimitiveTool('box')}
                  className="p-0.5 text-gray-600 hover:text-gray-900"
                  title="Select Box Placement Tool to add a new model"
                  aria-label="Add Model to Entity Tree"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto py-1 text-[12.5px]">
                {/* World Root Item */}
                <div className="flex items-center gap-2 px-3 py-1.5 text-[#1f2937] font-medium">
                  <Box className="w-4 h-4 text-[#0284c7] fill-[#0284c7]/20 shrink-0" />
                  <span>{world?.name || 'default'}</span>
                </div>

                {/* Models in World */}
                {world?.models.map((model) => {
                  const isModelSelected =
                    selectedEntityId === model.entityId ||
                    (!selectedEntityId && model.name === 'ground_plane');
                  const isExpanded =
                    expandedModels[model.name] ?? model.name !== 'ground_plane';

                  return (
                    <div key={model.id}>
                      <div
                        onClick={() => onSelectEntity(model.entityId)}
                        className={`flex items-center gap-1.5 pl-4 pr-3 py-1.5 cursor-pointer transition-colors ${
                          isModelSelected
                            ? 'bg-[#aedff7] text-[#111827] font-medium'
                            : 'hover:bg-gray-200/70 text-[#222222]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedModels((prev) => ({
                              ...prev,
                              [model.name]: !isExpanded,
                            }));
                          }}
                          className="p-0.5 text-gray-500 hover:text-gray-800"
                          aria-label={`Expand ${model.name}`}
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <Orbit className="w-4 h-4 text-[#0284c7] shrink-0" />
                        <span className="truncate flex-1">{model.name}</span>
                      </div>

                      {isExpanded && (
                        <div className="pl-9 space-y-0.5 py-0.5 bg-gray-100/80">
                          {model.links.map((lk) => {
                            const isLinkSel = selectedEntityId === lk.entityId;
                            return (
                              <div
                                key={lk.id}
                                onClick={() => onSelectEntity(lk.entityId)}
                                className={`flex items-center gap-1.5 px-2 py-1 text-xs cursor-pointer rounded-l ${
                                  isLinkSel
                                    ? 'bg-[#aedff7] text-gray-900 font-medium'
                                    : 'text-gray-700 hover:bg-gray-200/70'
                                }`}
                              >
                                <Circle className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
                                <span className="truncate font-mono text-[11.5px]">
                                  {lk.name}
                                </span>
                              </div>
                            );
                          })}
                          {model.joints.map((j) => (
                            <div
                              key={j.id}
                              onClick={() => onSelectEntity(model.entityId)}
                              className="flex items-center gap-1.5 px-2 py-1 text-xs text-amber-800 hover:bg-gray-200/70 cursor-pointer"
                            >
                              <Compass className="w-3 h-3 text-amber-600 shrink-0" />
                              <span className="truncate font-mono text-[11px]">
                                {j.name} ({j.type})
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Lights in World */}
                {world?.lights.map((light) => {
                  const isLightSelected = selectedEntityId === light.entityId;
                  return (
                    <div
                      key={light.id}
                      onClick={() => onSelectEntity(light.entityId)}
                      className={`flex items-center gap-1.5 pl-4 pr-3 py-1.5 cursor-pointer transition-colors ${
                        isLightSelected
                          ? 'bg-[#aedff7] text-[#111827] font-medium'
                          : 'hover:bg-gray-200/70 text-[#222222]'
                      }`}
                    >
                      <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                      <Lightbulb className="w-4 h-4 text-sky-500 fill-amber-300 shrink-0" />
                      <span className="truncate">{light.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
