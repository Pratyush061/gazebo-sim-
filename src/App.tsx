/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Columns, Code2, Box, GripVertical } from 'lucide-react';
import { DEFAULT_FILES } from './data/defaultFiles';
import {
  CompilationResult,
  DebugOverlaySettings,
  LightSpawnType,
  ParsedWorld,
  Pose6D,
  PrimitiveShapeType,
  TerminalHistoryEntry,
  TransformGizmoMode,
  VirtualFile,
} from './types/simulation';
import {
  cloneModelEntityForPaste,
  compileSdfOrUrdf,
  createPrimitiveModelEntity,
  createSpawnLightEntity,
  generateSpawnLightSdfSnippet,
  generateSpawnPrimitiveSdfSnippet,
} from './utils/sdfCompiler';
import {
  cloneParsedWorld,
  deleteEntityFromWorld,
  getNextAvailableEntityId,
  scaleEntityGeometryInWorld,
  updateEntityPoseInWorld,
} from './utils/physicsEngine';
import {
  GZ_SYSTEM_TEMPLATES,
  injectSystemPluginIntoXml,
} from './utils/gzSystemsCatalog';
import { executeUbuntuCommand } from './utils/ubuntuTerminal';
import { VsCodeIdePane } from './components/VsCodeIdePane';
import { GazeboSimulatorPane } from './components/GazeboSimulatorPane';

const STORAGE_KEY = 'gazebo_harmonic_sdf_studio_files_v3';

export default function App() {
  const [files, setFiles] = useState<VirtualFile[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore storage errors
    }
    return DEFAULT_FILES;
  });

  const [activeFileId, setActiveFileId] = useState<string>(() => {
    const r2d2 = DEFAULT_FILES.find((f) => f.name === 'r2d2_starwars.sdf');
    return r2d2 ? r2d2.id : DEFAULT_FILES[0].id;
  });

  const activeFile =
    files.find((f) => f.id === activeFileId) || files[0] || DEFAULT_FILES[0];

  const [compilationResult, setCompilationResult] = useState<CompilationResult>(() =>
    compileSdfOrUrdf(activeFile.content, activeFile.path)
  );

  const [activeWorld, setActiveWorld] = useState<ParsedWorld | null>(() => {
    const initial = compileSdfOrUrdf(activeFile.content, activeFile.path);
    return initial.world ? cloneParsedWorld(initial.world) : null;
  });

  const [isSimRunning, setIsSimRunning] = useState<boolean>(true);
  const [stepTrigger, setStepTrigger] = useState<number>(0);
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(() => {
    const initial = compileSdfOrUrdf(activeFile.content, activeFile.path);
    const r2 =
      initial.world?.models.find((m) => m.name !== 'ground_plane') ||
      initial.world?.models[0];
    return r2 ? r2.entityId : 3;
  });
  const [gizmoMode, setGizmoMode] = useState<TransformGizmoMode>('select');
  const [debugOverlays, setDebugOverlays] = useState<DebugOverlaySettings>({
    showGrid: true,
    showCollisionWireframes: false,
    showInertiaAndCoM: false,
    showJointAxesAndFrames: false,
    showWindVectors: true,
    showLightFrustums: false,
    wireframeMode: false,
    showLidarRays: true,
    showContactPoints: false,
  });

  const [simTelemetry, setSimTelemetry] = useState({
    simTime: 0,
    realTime: 0,
    rtf: 100.0,
    iterations: 0,
  });

  const [terminalCwd, setTerminalCwd] = useState<string>('/home/ubuntu/workspace');
  const [terminalHistory, setTerminalHistory] = useState<TerminalHistoryEntry[]>([
    {
      id: 'init-1',
      command: 'gz sdf -k worlds/r2d2_starwars.sdf',
      cwd: '/home/ubuntu/workspace',
      output: [
        "[gz-sdf] Checking 'worlds/r2d2_starwars.sdf' (Format: SDF -> SDF 1.10)...",
        '[gz-sdf] Check complete: VALID (0 errors, 0 warnings).',
        '  World: "default" | Models: 4 (ground_plane, r2d2, wind_probe_sphere, supply_crate) | Lights: 1',
      ].join('\n'),
      timestamp: Date.now() - 5000,
    },
    {
      id: 'init-2',
      command: 'gz sim -r worlds/r2d2_starwars.sdf',
      cwd: '/home/ubuntu/workspace',
      output: [
        '[Msg] Gazebo Sim Server v8.6.0-harmonic',
        '[Msg] Serving world [default] with real-time 3D multi-body contact physics, inertia, sensors, and wind.',
        '[Msg] Use WASD keys to drive R2-D2 or the Rovers, or open "Gazebo Systems & Plugins" to attach gz-sim systems.',
      ].join('\n'),
      timestamp: Date.now() - 2000,
    },
  ]);

  // Responsive workspace view mode: 'split' | 'ide' | 'sim'
  const [workspaceViewMode, setWorkspaceViewMode] = useState<'split' | 'ide' | 'sim'>(
    'split'
  );
  // Split-screen percentage width for Left IDE (default 48%)
  const [leftPanePercent, setLeftPanePercent] = useState<number>(48);
  const [isDraggingCenterSplit, setIsDraggingCenterSplit] = useState<boolean>(false);
  const [isPluginModalOpen, setIsPluginModalOpen] = useState<boolean>(false);
  const spawnCounterRef = useRef<number>(1);

  // Persist files to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    } catch {
      // ignore quota error
    }
  }, [files]);

  // Pointer-captured center splitter dragging
  const handleCenterSplitterPointerDown = (
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    setIsDraggingCenterSplit(true);

    const onMove = (moveEvt: PointerEvent) => {
      const pct = (moveEvt.clientX / Math.max(window.innerWidth, 320)) * 100;
      setLeftPanePercent(Math.min(76, Math.max(24, Number(pct.toFixed(1)))));
    };
    const onUp = (upEvt: PointerEvent) => {
      setIsDraggingCenterSplit(false);
      target.releasePointerCapture(upEvt.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  // Live debounced compiler check when user edits code
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const res = compileSdfOrUrdf(activeFile.content, activeFile.path);
      setCompilationResult(res);
    }, 180);
    return () => clearTimeout(timer);
  }, [activeFile.content, activeFile.path]);

  const handleSelectFile = useCallback((file: VirtualFile) => {
    setActiveFileId(file.id);
    const res = compileSdfOrUrdf(file.content, file.path);
    setCompilationResult(res);
    if (res.isValid && res.world) {
      setActiveWorld(cloneParsedWorld(res.world));
      const heroModel =
        res.world.models.find((m) => m.name !== 'ground_plane') ||
        res.world.models[0];
      if (heroModel) {
        setSelectedEntityId(heroModel.entityId);
      }
    }
  }, []);

  const handleUpdateFileContent = useCallback((fileId: string, newContent: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === fileId
          ? { ...f, content: newContent, lastModified: Date.now() }
          : f
      )
    );
  }, []);

  const handleVerifyAndCompile = useCallback(() => {
    const res = compileSdfOrUrdf(activeFile.content, activeFile.path);
    setCompilationResult(res);
    const errCount = res.diagnostics.filter((d) => d.severity === 'error').length;
    const warnCount = res.diagnostics.filter((d) => d.severity === 'warning').length;

    setTerminalHistory((prev) => [
      ...prev,
      {
        id: `cmd-${Date.now()}`,
        command: `gz sdf -k ${activeFile.path}`,
        cwd: terminalCwd,
        isError: !res.isValid,
        output: res.isValid
          ? `[gz-sdf] Check complete in ${res.compileTimeMs}ms: VALID (${errCount} errors, ${warnCount} warnings).`
          : `[gz-sdf] Check FAILED (${errCount} errors, ${warnCount} warnings):\n` +
            res.diagnostics
              .map((d) => `  [${d.severity.toUpperCase()}] Line ${d.line}: ${d.message}`)
              .join('\n'),
        timestamp: Date.now(),
      },
    ]);
  }, [activeFile, terminalCwd]);

  const handleCompileAndRun = useCallback(() => {
    const res = compileSdfOrUrdf(activeFile.content, activeFile.path);
    setCompilationResult(res);
    if (res.isValid && res.world) {
      const compiledWorld = res.world;
      setActiveWorld(cloneParsedWorld(compiledWorld));
      setIsSimRunning(true);
      setSimTelemetry({ simTime: 0, realTime: 0, rtf: 100.0, iterations: 0 });
      const firstHero =
        compiledWorld.models.find((m) => m.name !== 'ground_plane') ||
        compiledWorld.models[0];
      if (firstHero) setSelectedEntityId(firstHero.entityId);

      setTerminalHistory((prev) => [
        ...prev,
        {
          id: `run-${Date.now()}`,
          command: `gz sim -r ${activeFile.path}`,
          cwd: terminalCwd,
          output: `[Msg] Compiled '${activeFile.path}' (${res.compileTimeMs}ms) -> Serving world [${compiledWorld.name}] with ${compiledWorld.models.length} models.`,
          timestamp: Date.now(),
        },
      ]);
    } else {
      setTerminalHistory((prev) => [
        ...prev,
        {
          id: `run-err-${Date.now()}`,
          command: `gz sim -r ${activeFile.path}`,
          cwd: terminalCwd,
          isError: true,
          output:
            `[Err] Cannot start simulation: '${activeFile.path}' has compilation errors:\n` +
            res.diagnostics
              .filter((d) => d.severity === 'error')
              .map((d) => `  Line ${d.line}: ${d.message}`)
              .join('\n'),
          timestamp: Date.now(),
        },
      ]);
    }
  }, [activeFile, terminalCwd]);

  // One-click insertion of official Gazebo system plugin XML snippet into the active SDF or URDF file
  const handleInsertSystemPlugin = useCallback(
    (templateId: string, targetModelName?: string, autoRun = true) => {
      const tpl = GZ_SYSTEM_TEMPLATES.find((t) => t.id === templateId);
      if (!tpl) return;

      const isUrdf = activeFile.path.toLowerCase().endsWith('.urdf');
      const targetModelObj =
        activeWorld?.models.find((m) => m.name === targetModelName) ||
        activeWorld?.models.find((m) => m.name !== 'ground_plane') ||
        null;
      const fallbackModelName = targetModelObj?.name || targetModelName || 'robot_model';

      const nextXml = injectSystemPluginIntoXml(
        activeFile.content,
        isUrdf ? 'urdf' : 'sdf',
        templateId,
        targetModelObj
      );

      handleUpdateFileContent(activeFile.id, nextXml);
      const compiled = compileSdfOrUrdf(nextXml, activeFile.path);
      setCompilationResult(compiled);

      if (compiled.isValid && compiled.world && autoRun) {
        setActiveWorld(cloneParsedWorld(compiled.world));
        setIsSimRunning(true);
      }

      setTerminalHistory((prev) => [
        ...prev,
        {
          id: `plg-${Date.now()}`,
          command: `gz plugin --insert ${tpl.filename} -> ${activeFile.path}`,
          cwd: terminalCwd,
          output: `[gz-plugin] Injected '${tpl.systemName}' (${tpl.filename}) into '${activeFile.path}' (Model: ${fallbackModelName}).\n[ros_gz_bridge] Mapped ${tpl.defaultTopic.replace('{model}', fallbackModelName)}: ${tpl.gzMsgType} <-> ${tpl.ros2MsgType}`,
          timestamp: Date.now(),
        },
      ]);
    },
    [activeFile, activeWorld, terminalCwd, handleUpdateFileContent]
  );

  const handleCreateFile = useCallback(
    (name: string, folder: string, templateType: 'sdf' | 'urdf') => {
      const id = `file-${Date.now()}`;
      const path = `${folder}/${name}`;
      const content =
        templateType === 'urdf'
          ? `<?xml version="1.0"?>
<robot name="${name.replace(/\.urdf$/, '')}">
  <link name="base_link">
    <inertial>
      <origin xyz="0 0 0.25" rpy="0 0 0"/>
      <mass value="5.0"/>
      <inertia ixx="0.2" ixy="0" ixz="0" iyy="0.2" iyz="0" izz="0.2"/>
    </inertial>
    <visual>
      <origin xyz="0 0 0.25" rpy="0 0 0"/>
      <geometry>
        <box size="0.4 0.4 0.5"/>
      </geometry>
      <material name="blue">
        <color rgba="0.18 0.52 0.88 1.0"/>
      </material>
    </visual>
    <collision>
      <origin xyz="0 0 0.25" rpy="0 0 0"/>
      <geometry>
        <box size="0.4 0.4 0.5"/>
      </geometry>
    </collision>
  </link>
</robot>`
          : `<?xml version="1.0" ?>
<sdf version="1.10">
  <world name="default">
    <physics name="1ms" type="ode">
      <max_step_size>0.002</max_step_size>
      <real_time_factor>1.0</real_time_factor>
    </physics>
    <gravity>0 0 -9.81</gravity>
    <wind>
      <linear_velocity>1.0 0.0 0.0</linear_velocity>
    </wind>
    <light type="directional" name="sun">
      <cast_shadows>true</cast_shadows>
      <pose>0 0 10 0 0 0</pose>
      <diffuse>0.85 0.85 0.85 1</diffuse>
      <specular>0.2 0.2 0.2 1</specular>
      <direction>-0.5 0.1 -0.9</direction>
    </light>
    <model name="ground_plane">
      <static>true</static>
      <pose>0 0 0 0 0 0</pose>
      <link name="link">
        <collision name="collision">
          <geometry><plane><size>100 100</size></plane></geometry>
        </collision>
        <visual name="visual">
          <geometry><plane><size>100 100</size></plane></geometry>
          <material>
            <ambient>0.8 0.8 0.8 1</ambient>
            <diffuse>0.8 0.8 0.8 1</diffuse>
          </material>
        </visual>
      </link>
    </model>
    <model name="${name.replace(/\.sdf$/, '')}">
      <static>false</static>
      <pose>0 0 1.2 0 0 0</pose>
      <link name="body_link">
        <enable_wind>true</enable_wind>
        <inertial>
          <mass>3.5</mass>
          <inertia>
            <ixx>0.15</ixx>
            <ixy>0</ixy>
            <ixz>0</ixz>
            <iyy>0.15</iyy>
            <iyz>0</iyz>
            <izz>0.15</izz>
          </inertia>
        </inertial>
        <collision name="collision">
          <geometry><box><size>0.5 0.5 0.5</size></box></geometry>
        </collision>
        <visual name="visual">
          <geometry><box><size>0.5 0.5 0.5</size></box></geometry>
          <material>
            <ambient>0.15 0.58 0.88 1</ambient>
            <diffuse>0.18 0.62 0.92 1</diffuse>
          </material>
        </visual>
      </link>
    </model>
  </world>
</sdf>`;

      const newFile: VirtualFile = {
        id,
        name,
        path,
        folder,
        content,
        lastModified: Date.now(),
        description: `Custom ${templateType.toUpperCase()} simulation file`,
      };
      setFiles((prev) => [...prev, newFile]);
      handleSelectFile(newFile);
    },
    [handleSelectFile]
  );

  const handleRenameFile = useCallback((fileId: string, newName: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === fileId
          ? {
              ...f,
              name: newName,
              path: `${f.folder}/${newName}`,
              lastModified: Date.now(),
            }
          : f
      )
    );
  }, []);

  const handleDuplicateFile = useCallback(
    (file: VirtualFile) => {
      const extIndex = file.name.lastIndexOf('.');
      const base = extIndex > 0 ? file.name.slice(0, extIndex) : file.name;
      const ext = extIndex > 0 ? file.name.slice(extIndex) : '.sdf';
      const copyName = `${base}_copy${ext}`;
      const copyFile: VirtualFile = {
        ...file,
        id: `file-${Date.now()}`,
        name: copyName,
        path: `${file.folder}/${copyName}`,
        lastModified: Date.now(),
      };
      setFiles((prev) => [...prev, copyFile]);
      handleSelectFile(copyFile);
    },
    [handleSelectFile]
  );

  const handleDeleteFile = useCallback(
    (fileId: string) => {
      setFiles((prev) => {
        if (prev.length <= 1) return prev;
        const filtered = prev.filter((f) => f.id !== fileId);
        if (fileId === activeFileId && filtered[0]) {
          setActiveFileId(filtered[0].id);
        }
        return filtered;
      });
    },
    [activeFileId]
  );

  const handleUploadFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result || '');
        const isUrdf = file.name.endsWith('.urdf');
        const folder = isUrdf ? 'urdf' : 'worlds';
        const uploaded: VirtualFile = {
          id: `file-${Date.now()}`,
          name: file.name,
          path: `${folder}/${file.name}`,
          folder,
          content,
          lastModified: Date.now(),
          description: 'Imported from local computer',
        };
        setFiles((prev) => [...prev, uploaded]);
        handleSelectFile(uploaded);
      };
      reader.readAsText(file);
    },
    [handleSelectFile]
  );

  const handleDownloadActiveFile = useCallback(() => {
    const blob = new Blob([activeFile.content], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeFile.name;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeFile]);

  const handleRunTerminalCommand = useCallback(
    (cmdText: string) => {
      const res = executeUbuntuCommand(cmdText, {
        cwd: terminalCwd,
        files,
        activeWorld,
        isSimRunning,
        simTime: simTelemetry.simTime,
      });

      if (res.clearScreen) {
        setTerminalHistory([]);
        return;
      }

      if (res.newCwd) {
        setTerminalCwd(res.newCwd);
      }

      if (res.updatedFiles) {
        setFiles(res.updatedFiles);
      }

      if (res.selectFileId) {
        setActiveFileId(res.selectFileId);
      }

      if (res.loadAndCompileFile) {
        setActiveFileId(res.loadAndCompileFile.id);
        const compiled = compileSdfOrUrdf(
          res.loadAndCompileFile.content,
          res.loadAndCompileFile.path
        );
        setCompilationResult(compiled);
        if (compiled.isValid && compiled.world) {
          setActiveWorld(cloneParsedWorld(compiled.world));
        }
      }

      if (res.startSimulation !== undefined) {
        setIsSimRunning(res.startSimulation);
      }

      if (res.cmdVelUpdate && activeWorld) {
        const { modelName, linearX, linearY, angularZ } = res.cmdVelUpdate;
        setActiveWorld((prev) => {
          if (!prev) return prev;
          const next = cloneParsedWorld(prev);
          const m = next.models.find((item) => item.name === modelName);
          if (m) {
            m.cmdVel = { linearX, linearY, angularZ };
          }
          return next;
        });
      }

      if (res.jointUpdate && activeWorld) {
        const { modelName, jointName, targetPosition } = res.jointUpdate;
        setActiveWorld((prev) => {
          if (!prev) return prev;
          const next = cloneParsedWorld(prev);
          const m = next.models.find((item) => item.name === modelName);
          const j = m?.joints.find((item) => item.name === jointName);
          if (j) {
            j.controlMode = 'position';
            j.targetPosition = targetPosition;
          }
          return next;
        });
      }

      if (res.windUpdate && activeWorld) {
        const [wx, wy, wz] = res.windUpdate;
        setActiveWorld((prev) => {
          if (!prev) return prev;
          const next = cloneParsedWorld(prev);
          next.wind.enabled = Math.hypot(wx, wy, wz) > 0.001;
          next.wind.linearVelocity = [wx, wy, wz];
          return next;
        });
      }

      setTerminalHistory((prev) => [
        ...prev,
        {
          id: `term-${Date.now()}-${Math.random()}`,
          command: cmdText,
          cwd: terminalCwd,
          output: res.output,
          isError: res.isError,
          timestamp: Date.now(),
        },
      ]);
    },
    [terminalCwd, files, activeWorld, isSimRunning, simTelemetry.simTime]
  );

  const handleSpawnPrimitiveAtPose = useCallback(
    (shape: PrimitiveShapeType, pose: Pose6D) => {
      const idx = spawnCounterRef.current++;
      const snippet = generateSpawnPrimitiveSdfSnippet(shape, idx, pose);

      setActiveWorld((prev) => {
        if (!prev) return prev;
        const next = cloneParsedWorld(prev);
        const startId = getNextAvailableEntityId(next);
        const newModel = createPrimitiveModelEntity(
          shape,
          idx,
          pose,
          startId,
          activeFile.path
        );
        next.models.push(newModel);
        setSelectedEntityId(newModel.entityId);
        return next;
      });

      if (activeFile.content.includes('</world>')) {
        const updatedXml = activeFile.content.replace(
          '</world>',
          `${snippet}\n  </world>`
        );
        handleUpdateFileContent(activeFile.id, updatedXml);
      }
    },
    [activeFile, handleUpdateFileContent]
  );

  const handleSpawnLightAtPose = useCallback(
    (lightType: LightSpawnType, pose: Pose6D) => {
      const idx = spawnCounterRef.current++;
      const snippet = generateSpawnLightSdfSnippet(lightType, idx, pose);

      setActiveWorld((prev) => {
        if (!prev) return prev;
        const next = cloneParsedWorld(prev);
        const nextId = getNextAvailableEntityId(next);
        const newLight = createSpawnLightEntity(lightType, idx, pose, nextId);
        next.lights.push(newLight);
        setSelectedEntityId(newLight.entityId);
        return next;
      });

      if (activeFile.content.includes('</world>')) {
        const updatedXml = activeFile.content.replace(
          '</world>',
          `${snippet}\n  </world>`
        );
        handleUpdateFileContent(activeFile.id, updatedXml);
      }
    },
    [activeFile, handleUpdateFileContent]
  );

  const handlePasteModelAtPose = useCallback(
    (sourceEntityId: number, pose: Pose6D) => {
      const idx = spawnCounterRef.current++;
      let generatedSnippet = '';

      setActiveWorld((prev) => {
        if (!prev) return prev;
        const sourceModel =
          prev.models.find((m) => m.entityId === sourceEntityId) ||
          prev.models.find((m) => m.name !== 'ground_plane');
        if (!sourceModel) return prev;

        const next = cloneParsedWorld(prev);
        const startId = getNextAvailableEntityId(next);
        const { model: clonedModel, sdfSnippet } = cloneModelEntityForPaste(
          sourceModel,
          idx,
          pose,
          startId
        );
        generatedSnippet = sdfSnippet;
        next.models.push(clonedModel);
        setSelectedEntityId(clonedModel.entityId);
        return next;
      });

      if (generatedSnippet && activeFile.content.includes('</world>')) {
        const updatedXml = activeFile.content.replace(
          '</world>',
          `${generatedSnippet}\n  </world>`
        );
        handleUpdateFileContent(activeFile.id, updatedXml);
      }
    },
    [activeFile, handleUpdateFileContent]
  );

  const handleUpdateEntityPose = useCallback((entityId: number, newPose: Pose6D) => {
    setActiveWorld((prev) => {
      if (!prev) return prev;
      return updateEntityPoseInWorld(prev, entityId, newPose);
    });
  }, []);

  const handleScaleEntity = useCallback(
    (entityId: number, scaleFactors: [number, number, number]) => {
      setActiveWorld((prev) => {
        if (!prev) return prev;
        return scaleEntityGeometryInWorld(prev, entityId, scaleFactors);
      });
    },
    []
  );

  const handleDeleteEntity = useCallback(
    (entityId: number) => {
      let deletedModelName: string | null = null;
      let deletedLightName: string | null = null;

      setActiveWorld((prev) => {
        if (!prev) return prev;
        const m = prev.models.find(
          (item) => item.entityId === entityId && item.name !== 'ground_plane'
        );
        if (m) deletedModelName = m.name;
        const l = prev.lights.find((item) => item.entityId === entityId);
        if (l) deletedLightName = l.name;

        const next = deleteEntityFromWorld(prev, entityId);
        const fallback =
          next.models.find((item) => item.name !== 'ground_plane') ||
          next.models[0];
        setSelectedEntityId(fallback ? fallback.entityId : null);
        return next;
      });

      if (deletedModelName) {
        const modelRegex = new RegExp(
          `\\s*<model\\s+name=["']${deletedModelName}["']>[\\s\\S]*?<\\/model>`,
          'm'
        );
        const updatedXml = activeFile.content.replace(modelRegex, '');
        if (updatedXml !== activeFile.content) {
          handleUpdateFileContent(activeFile.id, updatedXml);
        }
      } else if (deletedLightName) {
        const lightRegex = new RegExp(
          `\\s*<light[^>]*name=["']${deletedLightName}["'][^>]*>[\\s\\S]*?<\\/light>`,
          'm'
        );
        const updatedXml = activeFile.content.replace(lightRegex, '');
        if (updatedXml !== activeFile.content) {
          handleUpdateFileContent(activeFile.id, updatedXml);
        }
      }
    },
    [activeFile, handleUpdateFileContent]
  );

  const handleToggleModelProperty = useCallback(
    (modelId: string, prop: 'enableWind' | 'selfCollide' | 'isStatic') => {
      setActiveWorld((prev) => {
        if (!prev) return prev;
        const next = cloneParsedWorld(prev);
        const model = next.models.find((m) => m.id === modelId);
        if (model) {
          model[prop] = !model[prop];
          if (prop === 'enableWind') {
            model.links.forEach((l) => {
              l.enableWind = model.enableWind;
            });
          }
        }
        return next;
      });
    },
    []
  );

  const handleUpdateJointTarget = useCallback(
    (
      modelId: string,
      jointId: string,
      mode: 'position' | 'velocity' | 'effort',
      value: number
    ) => {
      setActiveWorld((prev) => {
        if (!prev) return prev;
        const next = cloneParsedWorld(prev);
        const model = next.models.find((m) => m.id === modelId);
        const joint = model?.joints.find((j) => j.id === jointId);
        if (joint) {
          joint.controlMode = mode;
          if (mode === 'position') joint.targetPosition = value;
          else if (mode === 'velocity') joint.targetVelocity = value;
          else joint.appliedEffort = value;
        }
        return next;
      });
    },
    []
  );

  const handleUpdateModelCmdVel = useCallback(
    (modelId: string, linearX: number, linearY: number, angularZ: number) => {
      setActiveWorld((prev) => {
        if (!prev) return prev;
        const next = cloneParsedWorld(prev);
        const model = next.models.find((m) => m.id === modelId);
        if (model) {
          model.cmdVel = { linearX, linearY, angularZ };
        }
        return next;
      });
    },
    []
  );

  const handleUpdateWorldWind = useCallback(
    (vx: number, vy: number, vz: number, enabled: boolean) => {
      setActiveWorld((prev) => {
        if (!prev) return prev;
        const next = cloneParsedWorld(prev);
        next.wind = {
          enabled,
          linearVelocity: [vx, vy, vz],
        };
        return next;
      });
    },
    []
  );

  const handleSyncSceneToEditor = useCallback(() => {
    if (!activeWorld) return;
    let updatedContent = activeFile.content;
    for (const model of activeWorld.models) {
      if (model.name === 'ground_plane') continue;
      const poseStr = model.pose.map((v) => Number(v.toFixed(3))).join(' ');
      const modelRegex = new RegExp(
        `(<model\\s+name=["']${model.name}["'][\\s\\S]*?<pose>)([^<]*)(<\\/pose>)`
      );
      updatedContent = updatedContent.replace(modelRegex, `$1${poseStr}$3`);
    }
    handleUpdateFileContent(activeFile.id, updatedContent);
  }, [activeWorld, activeFile, handleUpdateFileContent]);

  const handleResetSimulation = useCallback(() => {
    const res = compileSdfOrUrdf(activeFile.content, activeFile.path);
    if (res.world) {
      setActiveWorld(cloneParsedWorld(res.world));
      setSimTelemetry({ simTime: 0, realTime: 0, rtf: 100.0, iterations: 0 });
    }
  }, [activeFile]);

  const handleTelemetryUpdate = useCallback(
    (simTime: number, realTime: number, rtf: number, iterations: number) => {
      setSimTelemetry({ simTime, realTime, rtf, iterations });
    },
    []
  );

  return (
    <div className="flex flex-col w-screen h-screen overflow-hidden bg-[#1e1e1e]">
      {/* Responsive Top Header Bar */}
      <header className="flex items-center justify-between gap-3 px-3 h-11 bg-[#181818] border-b border-[#2d2d2d] shrink-0 overflow-x-auto">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => e.preventDefault()}
          className="text-sm font-bold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          Gazebo Harmonic SDF Studio
        </a>

        {/* Zone 2: Preset Worlds & URDF Samples */}
        <nav className="hidden lg:flex items-center gap-4 text-xs font-medium text-[#b0b0b0]">
          {[
            { label: 'Empty World', fileName: 'empty.sdf' },
            { label: 'R2-D2 Droid', fileName: 'r2d2_starwars.sdf' },
            { label: '6-DOF Robotic Arm', fileName: 'robotic_arm_6dof.sdf' },
            { label: '4WD Ground Rover', fileName: 'rover_4wd_warehouse.sdf' },
            { label: 'ROS 2 URDF Arm', fileName: 'simple_manipulator.urdf' },
            { label: 'ROS 2 URDF Rover', fileName: 'diff_drive_rover.urdf' },
          ].map((item) => {
            const targetFile = files.find((f) => f.name === item.fileName);
            const isCurrent = activeFile.name === item.fileName;
            return (
              <button
                key={item.fileName}
                type="button"
                onClick={() => targetFile && handleSelectFile(targetFile)}
                className={`hover:text-white transition-colors whitespace-nowrap shrink-0 pb-0.5 ${
                  isCurrent
                    ? 'text-white border-b-2 border-[#f26522]'
                    : 'text-[#aaaaaa]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Workspace View Mode Switcher (Never hides editor on small screens) + Launch CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Workspace Layout Mode"
            className="flex items-center bg-[#252526] border border-[#3c3c3c] rounded p-0.5 text-xs"
          >
            <button
              type="button"
              onClick={() => setWorkspaceViewMode('split')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${
                workspaceViewMode === 'split'
                  ? 'bg-[#007acc] text-white'
                  : 'text-[#bbbbbb] hover:text-white'
              }`}
              title="Split View: Code Editor + 3D Gazebo Simulator"
            >
              <Columns className="w-3.5 h-3.5" />
              <span>Split View</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceViewMode('ide')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${
                workspaceViewMode === 'ide'
                  ? 'bg-[#007acc] text-white'
                  : 'text-[#bbbbbb] hover:text-white'
              }`}
              title="Maximize SDF/URDF Code Editor & Workbench"
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Code IDE</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceViewMode('sim')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded font-medium transition-colors whitespace-nowrap ${
                workspaceViewMode === 'sim'
                  ? 'bg-[#007acc] text-white'
                  : 'text-[#bbbbbb] hover:text-white'
              }`}
              title="Maximize 3D Gazebo Harmonic Simulator"
            >
              <Box className="w-3.5 h-3.5" />
              <span>3D Sim</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleCompileAndRun}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-[#f26522] hover:bg-[#e05615] rounded transition-colors whitespace-nowrap shrink-0"
          >
            Launch Simulation
          </button>
        </div>
      </header>

      {/* Main Responsive Workspace: Left VS Code IDE + Center Splitter + Right Gazebo Harmonic Simulator */}
      <main className="flex-1 flex min-h-0 w-full overflow-hidden relative">
        {/* Left Pane: VS Code SDF/URDF IDE & Ubuntu 24.04 Terminal */}
        {workspaceViewMode !== 'sim' && (
          <div
            style={{
              width: workspaceViewMode === 'ide' ? '100%' : `${leftPanePercent}%`,
            }}
            className="h-full min-w-[260px] overflow-hidden shrink-0"
          >
            <VsCodeIdePane
              files={files}
              activeFile={activeFile}
              onSelectFile={handleSelectFile}
              onUpdateFileContent={handleUpdateFileContent}
              onCreateFile={handleCreateFile}
              onRenameFile={handleRenameFile}
              onDuplicateFile={handleDuplicateFile}
              onDeleteFile={handleDeleteFile}
              onUploadFile={handleUploadFile}
              onDownloadActiveFile={handleDownloadActiveFile}
              compilationResult={compilationResult}
              onVerifyAndCompile={handleVerifyAndCompile}
              onCompileAndRun={handleCompileAndRun}
              terminalHistory={terminalHistory}
              terminalCwd={terminalCwd}
              onRunTerminalCommand={handleRunTerminalCommand}
              activeWorld={activeWorld}
              onUpdateJointTarget={handleUpdateJointTarget}
              onUpdateModelCmdVel={handleUpdateModelCmdVel}
              onUpdateWorldWind={handleUpdateWorldWind}
              onInsertSystemPlugin={handleInsertSystemPlugin}
              isPluginModalOpen={isPluginModalOpen}
              onSetPluginModalOpen={setIsPluginModalOpen}
            />
          </div>
        )}

        {/* Draggable Center Split-Screen Resizer Handle with Grip & Readout */}
        {workspaceViewMode === 'split' && (
          <div
            data-testid="center-workspace-splitter"
            onPointerDown={handleCenterSplitterPointerDown}
            onDoubleClick={() => setLeftPanePercent(48)}
            title="Drag to resize Code Editor and Gazebo Simulator split (Double-click to reset to 48% / 52%)"
            className={`w-2 h-full flex items-center justify-center cursor-col-resize transition-colors shrink-0 z-30 relative group ${
              isDraggingCenterSplit
                ? 'bg-[#007acc]'
                : 'bg-[#2d2d2d] hover:bg-[#007acc]'
            }`}
          >
            <GripVertical className="w-3.5 h-3.5 text-[#888888] group-hover:text-white pointer-events-none" />
            {isDraggingCenterSplit && (
              <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-[#181818] border border-[#007acc] text-[11px] font-mono text-white whitespace-nowrap shadow-lg pointer-events-none">
                IDE {leftPanePercent.toFixed(0)}% | Sim{' '}
                {(100 - leftPanePercent).toFixed(0)}%
              </div>
            )}
          </div>
        )}

        {/* Right Pane: Gazebo Harmonic 3D Physics Simulator & Entity Inspector */}
        {workspaceViewMode !== 'ide' && (
          <div className="flex-1 h-full min-w-[280px] overflow-hidden">
            <GazeboSimulatorPane
              world={activeWorld}
              isSimRunning={isSimRunning}
              onTogglePlay={() => setIsSimRunning((v) => !v)}
              onPauseSimulation={() => setIsSimRunning(false)}
              onStepSimulation={() => setStepTrigger((s) => s + 1)}
              onResetSimulation={handleResetSimulation}
              stepTrigger={stepTrigger}
              selectedEntityId={selectedEntityId}
              onSelectEntity={setSelectedEntityId}
              onUpdateEntityPose={handleUpdateEntityPose}
              onScaleEntity={handleScaleEntity}
              onDeleteEntity={handleDeleteEntity}
              onToggleModelProperty={handleToggleModelProperty}
              onSpawnPrimitiveAtPose={handleSpawnPrimitiveAtPose}
              onSpawnLightAtPose={handleSpawnLightAtPose}
              onPasteModelAtPose={handlePasteModelAtPose}
              onSyncSceneToEditor={handleSyncSceneToEditor}
              onUpdateJointTarget={handleUpdateJointTarget}
              gizmoMode={gizmoMode}
              onChangeGizmoMode={setGizmoMode}
              debugOverlays={debugOverlays}
              onToggleDebugOverlay={(key) =>
                setDebugOverlays((prev) => ({ ...prev, [key]: !prev[key] }))
              }
              simTime={simTelemetry.simTime}
              realTime={simTelemetry.realTime}
              rtf={simTelemetry.rtf}
              iterations={simTelemetry.iterations}
              onTelemetryUpdate={handleTelemetryUpdate}
              onOpenPluginBrowser={() => {
                if (workspaceViewMode === 'sim') {
                  setWorkspaceViewMode('split');
                }
                setIsPluginModalOpen(true);
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
