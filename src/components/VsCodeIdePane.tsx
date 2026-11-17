import React, { useState, useRef, useEffect } from 'react';
import {
  FileCode,
  FolderOpen,
  Folder,
  Plus,
  Trash2,
  Edit3,
  Check,
  X,
  Play,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Terminal as TerminalIcon,
  Sliders,
  Upload,
  Download,
  Copy,
  Wind,
  Gamepad2,
  ChevronRight,
  ChevronDown,
  FileText,
  Puzzle,
  Share2,
} from 'lucide-react';
import {
  CompilationResult,
  ParsedWorld,
  TerminalHistoryEntry,
  VirtualFile,
} from '../types/simulation';
import { GazeboSystemsBrowser } from './GazeboSystemsBrowser';
import {
  generateRos2BridgeCliCommand,
  generateRos2BridgeYaml,
} from '../utils/gzSystemsCatalog';

interface VsCodeIdePaneProps {
  files: VirtualFile[];
  activeFile: VirtualFile;
  onSelectFile: (file: VirtualFile) => void;
  onUpdateFileContent: (fileId: string, newContent: string) => void;
  onCreateFile: (name: string, folder: string, templateType: 'sdf' | 'urdf') => void;
  onRenameFile: (fileId: string, newName: string) => void;
  onDuplicateFile: (file: VirtualFile) => void;
  onDeleteFile: (fileId: string) => void;
  onUploadFile: (file: File) => void;
  onDownloadActiveFile: () => void;
  compilationResult: CompilationResult;
  onVerifyAndCompile: () => void;
  onCompileAndRun: () => void;
  terminalHistory: TerminalHistoryEntry[];
  terminalCwd: string;
  onRunTerminalCommand: (cmd: string) => void;
  activeWorld: ParsedWorld | null;
  onUpdateJointTarget: (
    modelId: string,
    jointId: string,
    mode: 'position' | 'velocity' | 'effort',
    value: number
  ) => void;
  onUpdateModelCmdVel: (
    modelId: string,
    linearX: number,
    linearY: number,
    angularZ: number
  ) => void;
  onUpdateWorldWind: (vx: number, vy: number, vz: number, enabled: boolean) => void;
  onInsertSystemPlugin: (
    templateId: string,
    targetModelName?: string,
    autoRun?: boolean
  ) => void;
  isPluginModalOpen?: boolean;
  onSetPluginModalOpen?: (open: boolean) => void;
}

export const VsCodeIdePane: React.FC<VsCodeIdePaneProps> = ({
  files,
  activeFile,
  onSelectFile,
  onUpdateFileContent,
  onCreateFile,
  onRenameFile,
  onDuplicateFile,
  onDeleteFile,
  onUploadFile,
  onDownloadActiveFile,
  compilationResult,
  onVerifyAndCompile,
  onCompileAndRun,
  terminalHistory,
  terminalCwd,
  onRunTerminalCommand,
  activeWorld,
  onUpdateJointTarget,
  onUpdateModelCmdVel,
  onUpdateWorldWind,
  onInsertSystemPlugin,
  isPluginModalOpen = false,
  onSetPluginModalOpen,
}) => {
  const [fontSize, setFontSize] = useState<number>(13);
  const [showExplorer, setShowExplorer] = useState<boolean>(true);
  const [explorerWidth, setExplorerWidth] = useState<number>(216);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({
    worlds: true,
    urdf: true,
    models: true,
  });
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [isCreatingFile, setIsCreatingFile] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('custom_robot.sdf');
  const [newFileFolder, setNewFileFolder] = useState<string>('worlds');

  const [bottomTab, setBottomTab] = useState<
    'terminal' | 'problems' | 'controls' | 'plugins' | 'ros2'
  >('terminal');
  const [bottomHeight, setBottomHeight] = useState<number>(240);
  const [terminalInput, setTerminalInput] = useState<string>('');
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState<number>(-1);
  const [showConvertedSdfPreview, setShowConvertedSdfPreview] = useState<boolean>(false);
  const [localModalOpen, setLocalModalOpen] = useState<boolean>(false);
  const [copiedBridgeYaml, setCopiedBridgeYaml] = useState<boolean>(false);

  const showPluginModal = isPluginModalOpen || localModalOpen;
  const setShowPluginModal = (open: boolean) => {
    setLocalModalOpen(open);
    onSetPluginModalOpen?.(open);
  };

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setShowConvertedSdfPreview(false);
  }, [activeFile.id]);

  useEffect(() => {
    if (bottomTab === 'terminal') {
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [terminalHistory, bottomTab]);

  // Synchronize line-number gutter scroll with editor scroll
  const handleEditorScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const JumpToEditorLine = (line: number) => {
    if (!textareaRef.current) return;
    const lines = activeFile.content.split('\n');
    let charIndex = 0;
    for (let i = 0; i < Math.min(line - 1, lines.length); i++) {
      charIndex += lines[i].length + 1;
    }
    const lineEnd = charIndex + (lines[line - 1]?.length || 0);
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(charIndex, lineEnd);
    const approxLineHeight = fontSize * 1.55;
    textareaRef.current.scrollTop = Math.max(0, (line - 4) * approxLineHeight);
  };

  const displayedCode =
    showConvertedSdfPreview && compilationResult.convertedSdfXml
      ? compilationResult.convertedSdfXml
      : activeFile.content;

  const lines = displayedCode.split('\n');
  const diagnosticsByLine = new Map<number, typeof compilationResult.diagnostics>();
  for (const diag of compilationResult.diagnostics) {
    const existing = diagnosticsByLine.get(diag.line) || [];
    existing.push(diag);
    diagnosticsByLine.set(diag.line, existing);
  }

  const errorCount = compilationResult.diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = compilationResult.diagnostics.filter(
    (d) => d.severity === 'warning'
  ).length;

  const folders = Array.from(new Set(['worlds', 'urdf', ...files.map((f) => f.folder)]));

  const handleTerminalKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!terminalInput.trim()) return;
      onRunTerminalCommand(terminalInput);
      setTerminalInput('');
      setCmdHistoryIdx(-1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const cmds = terminalHistory.map((h) => h.command).filter(Boolean);
      if (cmds.length === 0) return;
      const nextIdx = cmdHistoryIdx === -1 ? cmds.length - 1 : Math.max(0, cmdHistoryIdx - 1);
      setCmdHistoryIdx(nextIdx);
      setTerminalInput(cmds[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const cmds = terminalHistory.map((h) => h.command).filter(Boolean);
      if (cmdHistoryIdx === -1) return;
      if (cmdHistoryIdx + 1 >= cmds.length) {
        setCmdHistoryIdx(-1);
        setTerminalInput('');
      } else {
        setCmdHistoryIdx(cmdHistoryIdx + 1);
        setTerminalInput(cmds[cmdHistoryIdx + 1]);
      }
    }
  };

  const startRename = (file: VirtualFile, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingFileId(file.id);
    setRenameValue(file.name);
  };

  const commitRename = (fileId: string) => {
    const trimmed = renameValue.trim();
    if (trimmed) {
      onRenameFile(fileId, trimmed);
    }
    setRenamingFileId(null);
  };

  const handleCreateNewFileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFileName.trim();
    if (!clean) return;
    const isUrdf = clean.endsWith('.urdf');
    const finalName =
      clean.endsWith('.sdf') || clean.endsWith('.urdf') ? clean : `${clean}.sdf`;
    onCreateFile(finalName, newFileFolder, isUrdf ? 'urdf' : 'sdf');
    setIsCreatingFile(false);
    setNewFileName('custom_robot.sdf');
  };

  // Pointer-captured resize for Explorer sidebar width
  const handleExplorerSplitterPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = explorerWidth;

    const onMove = (moveEvt: PointerEvent) => {
      const nextW = Math.min(340, Math.max(150, startW + (moveEvt.clientX - startX)));
      setExplorerWidth(nextW);
    };
    const onUp = (upEvt: PointerEvent) => {
      target.releasePointerCapture(upEvt.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  // Pointer-captured resize for Bottom Workbench height
  const handleBottomSplitterPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startH = bottomHeight;

    const onMove = (moveEvt: PointerEvent) => {
      const nextH = Math.min(480, Math.max(140, startH - (moveEvt.clientY - startY)));
      setBottomHeight(nextH);
    };
    const onUp = (upEvt: PointerEvent) => {
      target.releasePointerCapture(upEvt.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  const controllableModels = (activeWorld?.models || []).filter(
    (m) => !m.isStatic && m.name !== 'ground_plane'
  );

  const worldTopics = activeWorld?.topics || [];
  const ros2BridgeYaml = activeWorld ? generateRos2BridgeYaml(activeWorld) : '';
  const ros2BridgeCli = activeWorld ? generateRos2BridgeCliCommand(activeWorld) : '';

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e1e] text-[#cccccc] select-none overflow-hidden border-r border-[#333333] relative">
      {/* VS Code Top Title & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-2.5 py-1.5 min-h-[40px] bg-[#252526] border-b border-[#333333] shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => setShowExplorer((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-[#cccccc] hover:bg-[#37373d] transition-colors whitespace-nowrap shrink-0"
            title="Toggle File Explorer Sidebar"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#007acc]" />
            <span>Explorer</span>
          </button>

          <span className="text-[#555555]">/</span>

          <div className="flex items-center gap-1.5 truncate">
            <FileCode className="w-3.5 h-3.5 text-[#e37933] shrink-0" />
            <span className="text-xs font-mono text-white truncate" title={activeFile.path}>
              {activeFile.path}
            </span>
          </div>

          {activeFile.path.endsWith('.urdf') && (
            <button
              type="button"
              onClick={() => setShowConvertedSdfPreview((v) => !v)}
              className={`px-2 py-0.5 text-[11px] rounded font-medium transition-colors whitespace-nowrap shrink-0 ${
                showConvertedSdfPreview
                  ? 'bg-[#007acc] text-white'
                  : 'bg-[#333333] text-[#cccccc] hover:bg-[#444444]'
              }`}
            >
              {showConvertedSdfPreview ? 'Viewing SDF 1.10' : 'Preview SDF 1.10'}
            </button>
          )}
        </div>

        {/* Font Size, Gazebo Systems & Plugins Browser, and Compiler Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className="hidden sm:flex items-center bg-[#1e1e1e] border border-[#3c3c3c] rounded px-1.5 py-0.5 text-xs"
            title="Editor Font Size"
          >
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.max(11, s - 1))}
              className="px-1 text-[#cccccc] hover:text-white font-mono"
              aria-label="Decrease editor font size"
            >
              A-
            </button>
            <span className="px-1 font-mono text-[11px] text-[#9cdcfe] tabular-nums">
              {fontSize}px
            </span>
            <button
              type="button"
              onClick={() => setFontSize((s) => Math.min(24, s + 1))}
              className="px-1 text-[#cccccc] hover:text-white font-mono"
              aria-label="Increase editor font size"
            >
              A+
            </button>
          </div>

          <button
            type="button"
            data-testid="open-gazebo-plugins-btn"
            onClick={() => setShowPluginModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold bg-[#2d2d30] hover:bg-[#3e3e42] text-[#f26522] border border-[#f26522]/50 transition-colors whitespace-nowrap shrink-0"
            title="Open Gazebo Systems & Plugins Browser (DiffDrive, JointPosition, GpuLidar, IMU...)"
          >
            <Puzzle className="w-3.5 h-3.5 text-[#f26522]" />
            <span>Gazebo Systems &amp; Plugins</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onVerifyAndCompile();
              if (errorCount > 0) setBottomTab('problems');
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-[#333333] hover:bg-[#3e3e42] text-white border border-[#454545] transition-colors whitespace-nowrap shrink-0"
            title="Check XML schema, inertia matrices, and link references (gz sdf -k)"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-[#4ec9b0]" />
            <span>Verify SDF</span>
          </button>

          <button
            type="button"
            onClick={onCompileAndRun}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold bg-[#007acc] hover:bg-[#1f8ad2] text-white transition-colors whitespace-nowrap shrink-0"
            title="Compile SDF/URDF and launch in Gazebo Harmonic 3D Simulator"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Compile &amp; Run</span>
          </button>
        </div>
      </div>

      {/* Main Middle Area: Explorer Sidebar + Resize Splitter + Code Editor */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* File Explorer Sidebar */}
        {showExplorer && (
          <>
            <div
              style={{ width: `${explorerWidth}px` }}
              className="bg-[#252526] flex flex-col shrink-0 overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold tracking-wider text-[#bbbbbb] border-b border-[#333333]">
                <span>Workspace Files</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setIsCreatingFile((v) => !v)}
                    className="p-1 rounded hover:bg-[#37373d] text-[#cccccc] hover:text-white"
                    title="New SDF / URDF File"
                    aria-label="New SDF or URDF File"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1 rounded hover:bg-[#37373d] text-[#cccccc] hover:text-white"
                    title="Import .sdf / .urdf file from computer"
                    aria-label="Import SDF or URDF file"
                  >
                    <Upload className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadActiveFile}
                    className="p-1 rounded hover:bg-[#37373d] text-[#cccccc] hover:text-white"
                    title="Download active file"
                    aria-label="Download active file"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".sdf,.urdf,.xml"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onUploadFile(file);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>

              {/* Inline Create File Form */}
              {isCreatingFile && (
                <form
                  onSubmit={handleCreateNewFileSubmit}
                  className="p-2 bg-[#1e1e1e] border-b border-[#3c3c3c] space-y-1.5"
                >
                  <div className="text-[11px] text-[#9cdcfe] font-medium">Create New File</div>
                  <select
                    value={newFileFolder}
                    onChange={(e) => setNewFileFolder(e.target.value)}
                    aria-label="New file folder"
                    className="w-full bg-[#252526] border border-[#3c3c3c] rounded px-1.5 py-1 text-xs text-white"
                  >
                    <option value="worlds">worlds/ (SDF 1.10)</option>
                    <option value="urdf">urdf/ (ROS 2 URDF)</option>
                    <option value="models">models/ (Custom)</option>
                  </select>
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="my_robot.sdf"
                    aria-label="New file name"
                    className="w-full bg-[#252526] border border-[#007acc] rounded px-2 py-1 text-xs font-mono text-white focus:outline-none"
                    autoFocus
                  />
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => setIsCreatingFile(false)}
                      className="px-2 py-0.5 text-[11px] rounded bg-[#333333] hover:bg-[#444444] text-[#cccccc]"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-2 py-0.5 text-[11px] rounded bg-[#007acc] hover:bg-[#1f8ad2] text-white font-medium"
                    >
                      Create
                    </button>
                  </div>
                </form>
              )}

              {/* Directory Tree */}
              <div className="flex-1 overflow-y-auto py-1">
                {folders.map((folder) => {
                  const folderFiles = files.filter((f) => f.folder === folder);
                  if (folderFiles.length === 0) return null;
                  const isOpen = openFolders[folder] ?? true;

                  return (
                    <div key={folder} className="mb-1">
                      <button
                        type="button"
                        onClick={() =>
                          setOpenFolders((prev) => ({ ...prev, [folder]: !isOpen }))
                        }
                        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-[#cccccc] hover:bg-[#2a2d2e] text-left"
                      >
                        {isOpen ? (
                          <ChevronDown className="w-3.5 h-3.5 text-[#cccccc] shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-[#cccccc] shrink-0" />
                        )}
                        <Folder className="w-3.5 h-3.5 text-[#dcb67a] shrink-0" />
                        <span className="truncate">{folder}</span>
                      </button>

                      {isOpen && (
                        <div className="pl-3">
                          {folderFiles.map((file) => {
                            const isSelected = file.id === activeFile.id;
                            const isRenaming = renamingFileId === file.id;

                            return (
                              <div
                                key={file.id}
                                onClick={() => {
                                  setShowConvertedSdfPreview(false);
                                  onSelectFile(file);
                                }}
                                className={`group flex items-center justify-between px-2 py-1.5 text-xs cursor-pointer rounded-l transition-colors ${
                                  isSelected
                                    ? 'bg-[#37373d] text-white font-medium'
                                    : 'text-[#cccccc] hover:bg-[#2a2d2e]'
                                }`}
                              >
                                {isRenaming ? (
                                  <div
                                    className="flex items-center gap-1 w-full"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="text"
                                      value={renameValue}
                                      onChange={(e) => setRenameValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') commitRename(file.id);
                                        if (e.key === 'Escape') setRenamingFileId(null);
                                      }}
                                      aria-label="Rename file input"
                                      className="w-full bg-[#1e1e1e] border border-[#007acc] rounded px-1.5 py-0.5 text-xs font-mono text-white focus:outline-none"
                                      autoFocus
                                    />
                                    <button
                                      type="button"
                                      onClick={() => commitRename(file.id)}
                                      className="text-emerald-400 hover:text-emerald-300 p-0.5"
                                      aria-label="Confirm rename"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setRenamingFileId(null)}
                                      className="text-rose-400 hover:text-rose-300 p-0.5"
                                      aria-label="Cancel rename"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <FileText
                                        className={`w-3.5 h-3.5 shrink-0 ${
                                          file.name.endsWith('.urdf')
                                            ? 'text-[#4ec9b0]'
                                            : 'text-[#e37933]'
                                        }`}
                                      />
                                      <span className="truncate font-mono text-[11.5px]">
                                        {file.name}
                                      </span>
                                    </div>
                                    <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                                      <button
                                        type="button"
                                        onClick={(e) => startRename(file, e)}
                                        className="p-0.5 text-[#aaaaaa] hover:text-white"
                                        title="Rename file"
                                        aria-label={`Rename ${file.name}`}
                                      >
                                        <Edit3 className="w-3 h-3" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onDuplicateFile(file);
                                        }}
                                        className="p-0.5 text-[#aaaaaa] hover:text-white"
                                        title="Duplicate file"
                                        aria-label={`Duplicate ${file.name}`}
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                      {files.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteFile(file.id);
                                          }}
                                          className="p-0.5 text-[#aaaaaa] hover:text-rose-400"
                                          title="Delete file"
                                          aria-label={`Delete ${file.name}`}
                                        >
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Active File Description Footer */}
              {activeFile.description && (
                <div className="p-2.5 bg-[#1e1e1e] border-t border-[#333333] text-[11px] text-[#999999] leading-relaxed">
                  <div className="text-[#cccccc] font-medium mb-0.5">{activeFile.name}</div>
                  {activeFile.description}
                </div>
              )}
            </div>

            {/* Horizontal Resize Splitter for Explorer Sidebar */}
            <div
              onPointerDown={handleExplorerSplitterPointerDown}
              onDoubleClick={() => setExplorerWidth(216)}
              title="Drag to resize Workspace Explorer sidebar (Double-click to reset)"
              className="w-1.5 h-full bg-[#2d2d2d] hover:bg-[#007acc] cursor-col-resize transition-colors shrink-0 z-10"
            />
          </>
        )}

        {/* Code Editor Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] overflow-hidden">
          {/* Compiler Status Strip */}
          <div className="flex items-center justify-between px-3 py-1 bg-[#252526] border-b border-[#2d2d2d] text-xs shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              {compilationResult.isValid ? (
                <span className="flex items-center gap-1.5 text-emerald-400 font-medium whitespace-nowrap">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    SDF 1.10 Valid ({compilationResult.world?.models.length || 0} models,{' '}
                    {compilationResult.compileTimeMs}ms)
                  </span>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setBottomTab('problems')}
                  className="flex items-center gap-1.5 text-rose-400 hover:underline font-medium whitespace-nowrap"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>
                    {errorCount} Compiler Error{errorCount !== 1 ? 's' : ''} — Click to inspect
                  </span>
                </button>
              )}

              {warningCount > 0 && (
                <button
                  type="button"
                  onClick={() => setBottomTab('problems')}
                  className="flex items-center gap-1 text-amber-400 hover:underline whitespace-nowrap"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>
                    {warningCount} Warning{warningCount !== 1 ? 's' : ''}
                  </span>
                </button>
              )}
            </div>

            <div className="text-[11px] font-mono text-[#858585] whitespace-nowrap">
              {lines.length} lines · UTF-8 · {compilationResult.format.toUpperCase()}
            </div>
          </div>

          {/* Synchronized Line-Number Gutter + Code Textarea */}
          <div className="relative flex-1 flex min-h-0 overflow-hidden">
            <div
              ref={gutterRef}
              className="w-12 py-3 bg-[#1e1e1e] border-r border-[#2d2d2d] text-right pr-2.5 select-none overflow-hidden font-mono text-[#858585] shrink-0"
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: `${Math.round(fontSize * 1.55)}px`,
              }}
            >
              {lines.map((_, idx) => {
                const lineNum = idx + 1;
                const lineDiags = diagnosticsByLine.get(lineNum);
                const hasErr = lineDiags?.some((d) => d.severity === 'error');
                const hasWarn = lineDiags?.some((d) => d.severity === 'warning');

                return (
                  <div
                    key={lineNum}
                    className={`flex items-center justify-end gap-1 ${
                      hasErr
                        ? 'text-rose-400 font-bold bg-rose-950/40'
                        : hasWarn
                        ? 'text-amber-400 font-semibold'
                        : ''
                    }`}
                    title={lineDiags?.map((d) => d.message).join('\n')}
                  >
                    {hasErr && <span className="text-[10px] text-rose-400">●</span>}
                    {!hasErr && hasWarn && <span className="text-[10px] text-amber-400">▲</span>}
                    <span>{lineNum}</span>
                  </div>
                );
              })}
            </div>

            <textarea
              ref={textareaRef}
              value={displayedCode}
              readOnly={showConvertedSdfPreview}
              onChange={(e) => onUpdateFileContent(activeFile.id, e.target.value)}
              onScroll={handleEditorScroll}
              spellCheck={false}
              aria-label="SDF and URDF code editor"
              className="code-input flex-1 w-full h-full py-3 px-3 bg-[#1e1e1e] text-[#d4d4d4] font-mono resize-none focus:outline-none overflow-auto whitespace-pre"
              style={{
                fontSize: `${fontSize}px`,
                lineHeight: `${Math.round(fontSize * 1.55)}px`,
                tabSize: 2,
              }}
            />
          </div>
        </div>
      </div>

      {/* Vertical Resize Handle for Bottom Workbench */}
      <div
        onPointerDown={handleBottomSplitterPointerDown}
        onDoubleClick={() => setBottomHeight(240)}
        title="Drag to resize Bottom Workbench panel (Double-click to reset)"
        className="h-1.5 w-full bg-[#2d2d2d] hover:bg-[#007acc] cursor-row-resize transition-colors shrink-0 z-10"
      />

      {/* Bottom Workbench Panel */}
      <div
        className="flex flex-col bg-[#181818] shrink-0 overflow-hidden"
        style={{ height: `${bottomHeight}px` }}
      >
        {/* Bottom Panel Tab Header */}
        <div className="flex items-center justify-between px-3 h-8 bg-[#252526] border-b border-[#333333] shrink-0 overflow-x-auto">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setBottomTab('terminal')}
              className={`flex items-center gap-1.5 h-8 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                bottomTab === 'terminal'
                  ? 'border-[#007acc] text-white'
                  : 'border-transparent text-[#999999] hover:text-[#cccccc]'
              }`}
            >
              <TerminalIcon className="w-3.5 h-3.5" />
              <span>Ubuntu 24.04 Terminal</span>
            </button>

            <button
              type="button"
              data-testid="workbench-tab-plugins"
              onClick={() => setBottomTab('plugins')}
              className={`flex items-center gap-1.5 h-8 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                bottomTab === 'plugins'
                  ? 'border-[#f26522] text-white'
                  : 'border-transparent text-[#f26522]/90 hover:text-white'
              }`}
            >
              <Puzzle className="w-3.5 h-3.5 text-[#f26522]" />
              <span>Gazebo Systems &amp; Plugins</span>
            </button>

            <button
              type="button"
              data-testid="workbench-tab-ros2"
              onClick={() => setBottomTab('ros2')}
              className={`flex items-center gap-1.5 h-8 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                bottomTab === 'ros2'
                  ? 'border-[#007acc] text-white'
                  : 'border-transparent text-[#999999] hover:text-[#cccccc]'
              }`}
            >
              <Share2 className="w-3.5 h-3.5 text-[#4ec9b0]" />
              <span>ROS 2 Bridge ({worldTopics.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setBottomTab('problems')}
              className={`flex items-center gap-1.5 h-8 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                bottomTab === 'problems'
                  ? 'border-[#007acc] text-white'
                  : 'border-transparent text-[#999999] hover:text-[#cccccc]'
              }`}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>
                Problems ({errorCount}, {warningCount})
              </span>
            </button>

            <button
              type="button"
              onClick={() => setBottomTab('controls')}
              className={`flex items-center gap-1.5 h-8 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                bottomTab === 'controls'
                  ? 'border-[#007acc] text-white'
                  : 'border-transparent text-[#999999] hover:text-[#cccccc]'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Joint &amp; Teleop Actuation</span>
            </button>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              type="button"
              onClick={() => setBottomHeight((h) => (h > 300 ? 220 : 360))}
              className="text-[11px] text-[#999999] hover:text-white px-1.5 py-0.5 rounded bg-[#333333] whitespace-nowrap"
            >
              {bottomHeight > 300 ? 'Compact Panel' : 'Expand Panel'}
            </button>
          </div>
        </div>

        {/* Tab 1: Ubuntu 24.04 Interactive Terminal */}
        {bottomTab === 'terminal' && (
          <div className="flex-1 flex flex-col min-h-0 bg-[#181818] font-mono text-xs overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-1 bg-[#202020] border-b border-[#2a2a2a] overflow-x-auto shrink-0">
              <span className="text-[10px] text-[#888888] whitespace-nowrap">Quick CLI:</span>
              {[
                `gz sdf -k ${activeFile.path}`,
                `gz sim -r ${activeFile.path}`,
                'gz plugin --list',
                'gz topic -l',
                'ros2 run ros_gz_bridge parameter_bridge',
                'gz model --list',
                'help',
              ].map((quickCmd) => (
                <button
                  key={quickCmd}
                  type="button"
                  onClick={() => onRunTerminalCommand(quickCmd)}
                  className="px-2 py-0.5 text-[11px] rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] text-[#9cdcfe] whitespace-nowrap shrink-0 transition-colors"
                >
                  {quickCmd}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2 select-text">
              <div className="text-[#6a9955]">
                Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64) — Gazebo Harmonic (gz-sim8)
              </div>
              {terminalHistory.map((entry) => (
                <div key={entry.id} className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-emerald-400 font-semibold">ubuntu@gz-harmonic</span>
                    <span className="text-[#cccccc]">:</span>
                    <span className="text-[#569cd6]">
                      {entry.cwd.replace('/home/ubuntu/workspace', '~/workspace')}
                    </span>
                    <span className="text-[#cccccc]">$</span>
                    <span className="text-white">{entry.command}</span>
                  </div>
                  {entry.output && (
                    <pre
                      className={`whitespace-pre-wrap pl-2 leading-relaxed text-[11.5px] ${
                        entry.isError ? 'text-rose-400' : 'text-[#cccccc]'
                      }`}
                    >
                      {entry.output}
                    </pre>
                  )}
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>

            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1e1e1e] border-t border-[#2d2d2d] shrink-0">
              <span className="text-emerald-400 font-semibold whitespace-nowrap">
                ubuntu@gz-harmonic
              </span>
              <span className="text-[#569cd6] whitespace-nowrap">
                {terminalCwd.replace('/home/ubuntu/workspace', '~/workspace')}$
              </span>
              <input
                type="text"
                value={terminalInput}
                onChange={(e) => setTerminalInput(e.target.value)}
                onKeyDown={handleTerminalKeyDown}
                placeholder="Type Ubuntu 24.04 or Gazebo command (e.g. gz plugin --list, gz topic -l, ros2 run ros_gz_bridge)..."
                aria-label="Ubuntu 24.04 terminal command input"
                className="flex-1 bg-transparent text-white font-mono text-xs focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Tab 2: Interactive Gazebo Systems & Plugins Browser */}
        {bottomTab === 'plugins' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <GazeboSystemsBrowser
              activeFilePath={activeFile.path}
              activeWorld={activeWorld}
              onInsertPlugin={onInsertSystemPlugin}
              isModal={false}
            />
          </div>
        )}

        {/* Tab 3: ROS 2 Bridge (ros_gz_bridge) & Live gz.msgs Topics */}
        {bottomTab === 'ros2' && (
          <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
            <div className="space-y-2 bg-[#202022] p-2.5 rounded border border-[#333333] overflow-y-auto">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <Share2 className="w-3.5 h-3.5 text-[#4ec9b0]" />
                  <span>Active gz.msgs &harr; ROS 2 Topic Table ({worldTopics.length})</span>
                </span>
              </div>
              <div className="divide-y divide-[#2d2d30] font-mono text-[11px]">
                {worldTopics.map((t, idx) => (
                  <div key={`${t.gzTopic}-${idx}`} className="py-1.5 flex flex-col gap-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[#9cdcfe] font-semibold truncate">
                        {t.gzTopic} &rarr; {t.rosTopic}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2d2d30] text-emerald-400">
                        {t.sourcePlugin}
                      </span>
                    </div>
                    <div className="text-[#ce9178] text-[10.5px]">
                      {t.gzMsgType} &harr; {t.rosMsgType} ({t.frequencyHz} Hz · {t.direction})
                    </div>
                    <div className="text-[#888888] text-[10.5px] truncate">{t.lastPayload}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col space-y-2 bg-[#202022] p-2.5 rounded border border-[#333333]">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">
                  ros_gz_bridge YAML Configuration
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(ros2BridgeYaml).catch(() => {});
                    setCopiedBridgeYaml(true);
                    window.setTimeout(() => setCopiedBridgeYaml(false), 1800);
                  }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#007acc] hover:bg-[#1f8ad2] text-white text-[11px]"
                >
                  {copiedBridgeYaml ? (
                    <>
                      <Check className="w-3 h-3" />
                      <span>Copied YAML</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy ros_gz_bridge.yaml</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="flex-1 p-2 rounded bg-[#141416] border border-[#2d2d2d] font-mono text-[10.5px] text-[#dcdcaa] overflow-auto whitespace-pre select-text">
                {ros2BridgeYaml}
              </pre>
              <div className="text-[10.5px] font-mono text-[#9cdcfe] bg-[#141416] px-2 py-1 rounded border border-[#2d2d2d] truncate select-text">
                $ {ros2BridgeCli}
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Compiler Problems */}
        {bottomTab === 'problems' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5 font-sans text-xs">
            {compilationResult.diagnostics.length === 0 ? (
              <div className="flex items-center gap-2 text-emerald-400 py-4 px-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  No syntax, schema, inertia matrix, or kinematic reference problems detected in{' '}
                  <strong className="font-mono">{activeFile.path}</strong>.
                </span>
              </div>
            ) : (
              compilationResult.diagnostics.map((diag, idx) => (
                <div
                  key={`${diag.code}-${diag.line}-${idx}`}
                  onClick={() => JumpToEditorLine(diag.line)}
                  className="flex items-start justify-between gap-3 p-2 rounded bg-[#252526] hover:bg-[#2d2d30] cursor-pointer border border-[#333333]"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    {diag.severity === 'error' && (
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    {diag.severity === 'warning' && (
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    )}
                    {diag.severity === 'info' && (
                      <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-white font-medium break-words">{diag.message}</div>
                      {diag.suggestion && (
                        <div className="text-[11px] text-[#9cdcfe]">
                          Fix Hint: {diag.suggestion}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="font-mono text-[11px] text-[#858585] whitespace-nowrap shrink-0">
                    Line {diag.line}:{diag.column} · {diag.code}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 5: Interactive Joint Sliders, WASD Teleop & Wind Controller */}
        {bottomTab === 'controls' && (
          <div className="flex-1 overflow-y-auto p-3 grid grid-cols-1 xl:grid-cols-2 gap-3 text-xs">
            <div className="space-y-2.5 bg-[#222222] p-2.5 rounded border border-[#333333]">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <Gamepad2 className="w-3.5 h-3.5 text-[#007acc]" />
                  <span>Wheeled / Droid Teleop (WASD Keys or Controls)</span>
                </span>
              </div>

              {controllableModels.length > 0 ? (
                <div className="space-y-2">
                  {controllableModels.slice(0, 2).map((model) => (
                    <div
                      key={model.id}
                      className="flex flex-wrap items-center justify-between gap-2 bg-[#1a1a1a] px-2.5 py-1.5 rounded border border-[#2d2d2d]"
                    >
                      <span className="font-mono text-[#9cdcfe] font-medium">{model.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onUpdateModelCmdVel(model.id, 1.4, 0, 0)}
                          className="px-2 py-1 rounded bg-[#2d2d2d] hover:bg-[#007acc] text-white font-mono text-[11px]"
                        >
                          W (Fwd)
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateModelCmdVel(model.id, -1.2, 0, 0)}
                          className="px-2 py-1 rounded bg-[#2d2d2d] hover:bg-[#007acc] text-white font-mono text-[11px]"
                        >
                          S (Rev)
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateModelCmdVel(model.id, 0.4, 0, 1.2)}
                          className="px-2 py-1 rounded bg-[#2d2d2d] hover:bg-[#007acc] text-white font-mono text-[11px]"
                        >
                          A (Left)
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateModelCmdVel(model.id, 0.4, 0, -1.2)}
                          className="px-2 py-1 rounded bg-[#2d2d2d] hover:bg-[#007acc] text-white font-mono text-[11px]"
                        >
                          D (Right)
                        </button>
                        <button
                          type="button"
                          onClick={() => onUpdateModelCmdVel(model.id, 0, 0, 0)}
                          className="px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-700 text-white font-mono text-[11px]"
                        >
                          Stop
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[#888888]">No dynamic models in active world.</div>
              )}

              {activeWorld && (
                <div className="pt-1 border-t border-[#333333] space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      <Wind className="w-3.5 h-3.5 text-cyan-400" />
                      <span>World Aerodynamic Wind Vector (m/s)</span>
                    </span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-[11px]">
                      <input
                        type="checkbox"
                        checked={activeWorld.wind.enabled}
                        onChange={(e) =>
                          onUpdateWorldWind(
                            activeWorld.wind.linearVelocity[0] || 2.5,
                            activeWorld.wind.linearVelocity[1],
                            activeWorld.wind.linearVelocity[2],
                            e.target.checked
                          )
                        }
                      />
                      <span>Enable Wind</span>
                    </label>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['X', 'Y', 'Z'] as const).map((axisLabel, idx) => (
                      <div key={axisLabel} className="flex items-center gap-1">
                        <span className="font-mono text-[#999999] text-[11px]">W{axisLabel}:</span>
                        <input
                          type="number"
                          step="0.5"
                          value={activeWorld.wind.linearVelocity[idx]}
                          onChange={(e) => {
                            const next: [number, number, number] = [
                              ...activeWorld.wind.linearVelocity,
                            ];
                            next[idx] = Number(e.target.value) || 0;
                            onUpdateWorldWind(next[0], next[1], next[2], true);
                          }}
                          aria-label={`Wind velocity ${axisLabel}`}
                          className="w-full bg-[#181818] border border-[#3c3c3c] rounded px-1.5 py-0.5 font-mono text-white text-[11px]"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 bg-[#222222] p-2.5 rounded border border-[#333333] overflow-y-auto">
              <div className="font-semibold text-white flex items-center justify-between">
                <span>Articulated Joint Controllers (Position / Velocity / Effort)</span>
              </div>
              {controllableModels.flatMap((m) =>
                m.joints.map((j) => ({ model: m, joint: j }))
              ).length === 0 ? (
                <div className="text-[#888888] py-2">
                  Current world has no articulated joints. Load{' '}
                  <code className="text-[#9cdcfe]">robotic_arm_6dof.sdf</code> or{' '}
                  <code className="text-[#9cdcfe]">r2d2_starwars.sdf</code> to actuate joints.
                </div>
              ) : (
                controllableModels.map((model) =>
                  model.joints
                    .filter((j) => j.type !== 'fixed')
                    .map((joint) => (
                      <div
                        key={joint.id}
                        className="bg-[#1a1a1a] px-2.5 py-1.5 rounded border border-[#2d2d2d] space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] text-[#4ec9b0] truncate">
                            {model.name}::{joint.name}
                          </span>
                          <span className="font-mono text-[11px] text-white tabular-nums">
                            {joint.position.toFixed(2)} rad
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={joint.type === 'continuous' ? -3.14 : joint.axis.lower}
                            max={joint.type === 'continuous' ? 3.14 : joint.axis.upper}
                            step="0.05"
                            value={
                              joint.controlMode === 'position'
                                ? joint.targetPosition
                                : joint.controlMode === 'velocity'
                                ? joint.targetVelocity
                                : joint.appliedEffort
                            }
                            onChange={(e) =>
                              onUpdateJointTarget(
                                model.id,
                                joint.id,
                                joint.controlMode,
                                Number(e.target.value)
                              )
                            }
                            aria-label={`Joint ${joint.name} target slider`}
                            className="flex-1 accent-[#007acc] cursor-pointer"
                          />
                          <div className="flex items-center gap-1">
                            {(['position', 'velocity', 'effort'] as const).map((mode) => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() =>
                                  onUpdateJointTarget(
                                    model.id,
                                    joint.id,
                                    mode,
                                    mode === 'position' ? joint.position : 0
                                  )
                                }
                                className={`px-1.5 py-0.5 rounded text-[10px] uppercase font-mono ${
                                  joint.controlMode === mode
                                    ? 'bg-[#007acc] text-white'
                                    : 'bg-[#2d2d2d] text-[#999999] hover:text-white'
                                }`}
                              >
                                {mode.slice(0, 3)}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Full Modal Overlay for Gazebo Systems & Plugins Browser */}
      {showPluginModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Gazebo Systems and Plugins Browser Modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div className="w-full max-w-5xl h-[82vh] rounded-lg border border-[#444444] shadow-2xl overflow-hidden flex flex-col bg-[#1e1e1e]">
            <GazeboSystemsBrowser
              activeFilePath={activeFile.path}
              activeWorld={activeWorld}
              onInsertPlugin={onInsertSystemPlugin}
              isModal={true}
              onClose={() => setShowPluginModal(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
