import React, { useState, useMemo } from 'react';
import {
  Puzzle,
  Search,
  Plus,
  Play,
  Copy,
  Check,
  X,
  ExternalLink,
  Code2,
  Share2,
  Cpu,
  Radio,
  Sliders,
  Globe,
  Zap,
} from 'lucide-react';
import {
  GZ_SYSTEM_TEMPLATES,
  GzSystemTemplate,
  generateSdfSystemSnippet,
  generateUrdfGazeboSnippet,
} from '../utils/gzSystemsCatalog';
import { ParsedWorld } from '../types/simulation';

interface GazeboSystemsBrowserProps {
  activeFilePath: string;
  activeWorld: ParsedWorld | null;
  onInsertPlugin: (templateId: string, targetModelName?: string, autoRun?: boolean) => void;
  isModal?: boolean;
  onClose?: () => void;
}

const CATEGORY_META: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  all: {
    label: 'All Systems (18)',
    color: 'text-sky-400',
    icon: <Puzzle className="w-3.5 h-3.5" />,
  },
  actuation: {
    label: 'Actuation & Control',
    color: 'text-orange-400',
    icon: <Sliders className="w-3.5 h-3.5" />,
  },
  publishing: {
    label: 'State & Odometry',
    color: 'text-emerald-400',
    icon: <Share2 className="w-3.5 h-3.5" />,
  },
  sensor: {
    label: 'Sensors & Raycast',
    color: 'text-cyan-400',
    icon: <Radio className="w-3.5 h-3.5" />,
  },
  world: {
    label: 'World & Physics',
    color: 'text-purple-400',
    icon: <Globe className="w-3.5 h-3.5" />,
  },
  power: {
    label: 'Power & Touch',
    color: 'text-amber-400',
    icon: <Zap className="w-3.5 h-3.5" />,
  },
};

export const GazeboSystemsBrowser: React.FC<GazeboSystemsBrowserProps> = ({
  activeFilePath,
  activeWorld,
  onInsertPlugin,
  isModal = false,
  onClose,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    GZ_SYSTEM_TEMPLATES[0].id
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [insertedFeedbackId, setInsertedFeedbackId] = useState<string | null>(null);

  const isUrdfFile = activeFilePath.toLowerCase().endsWith('.urdf');
  const [snippetFormat, setSnippetFormat] = useState<'auto' | 'sdf' | 'urdf'>('auto');

  const movableModels = useMemo(
    () =>
      (activeWorld?.models || []).filter((m) => m.name !== 'ground_plane'),
    [activeWorld]
  );

  const [targetModelName, setTargetModelName] = useState<string>(
    movableModels[0]?.name || 'ros2_urdf_rover'
  );

  const effectiveModelName =
    movableModels.some((m) => m.name === targetModelName)
      ? targetModelName
      : movableModels[0]?.name || 'robot_model';

  const effectiveModel = useMemo(
    () =>
      movableModels.find((m) => m.name === effectiveModelName) ||
      movableModels[0] ||
      null,
    [movableModels, effectiveModelName]
  );

  const filteredTemplates = useMemo(() => {
    return GZ_SYSTEM_TEMPLATES.filter((t) => {
      if (selectedCategory !== 'all' && t.category !== selectedCategory) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        t.label.toLowerCase().includes(q) ||
        t.filename.toLowerCase().includes(q) ||
        t.systemName.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.ros2MsgType.toLowerCase().includes(q)
      );
    });
  }, [selectedCategory, searchQuery]);

  const activeTemplate: GzSystemTemplate =
    filteredTemplates.find((t) => t.id === selectedTemplateId) ||
    filteredTemplates[0] ||
    GZ_SYSTEM_TEMPLATES[0];

  const effectiveIsUrdf =
    snippetFormat === 'auto' ? isUrdfFile : snippetFormat === 'urdf';

  const xmlSnippet = useMemo(() => {
    if (!activeTemplate) return '';
    return effectiveIsUrdf
      ? generateUrdfGazeboSnippet(activeTemplate, effectiveModel)
      : generateSdfSystemSnippet(activeTemplate, effectiveModel).xml;
  }, [activeTemplate, effectiveIsUrdf, effectiveModel]);

  const handleCopySnippet = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 1800);
  };

  const handleTriggerInsert = (templateId: string, autoRun: boolean) => {
    onInsertPlugin(templateId, effectiveModelName, autoRun);
    setInsertedFeedbackId(templateId);
    window.setTimeout(() => {
      setInsertedFeedbackId((prev) => (prev === templateId ? null : prev));
    }, 2000);
    if (autoRun && isModal && onClose) {
      onClose();
    }
  };

  return (
    <div
      data-testid="gazebo-systems-browser"
      className="flex flex-col h-full w-full bg-[#1e1e1e] text-[#cccccc] select-none overflow-hidden"
    >
      {/* Top Browser Header & Filter Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#252526] border-b border-[#333333] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded bg-[#f26522]/20 border border-[#f26522]/40 flex items-center justify-center text-[#f26522] shrink-0">
            <Puzzle className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-white tracking-tight">
                Gazebo Systems &amp; Plugins Browser
              </span>
              <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-[#1e1e1e] text-[#4ec9b0] border border-[#3c3c3c]">
                gz-sim8 / src/systems
              </span>
            </div>
          </div>
        </div>

        {/* Search Input + Target Model Selector */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-[#888888] absolute left-2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search DiffDrive, JointPosition, GpuLidar..."
              aria-label="Search Gazebo system plugins"
              className="pl-7 pr-2.5 py-1 w-52 bg-[#181818] border border-[#3c3c3c] focus:border-[#007acc] rounded text-xs text-white placeholder-[#777777] focus:outline-none"
            />
          </div>

          {movableModels.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-[11px] text-[#999999]">Target Model:</span>
              <select
                value={effectiveModelName}
                onChange={(e) => setTargetModelName(e.target.value)}
                aria-label="Target model for plugin insertion"
                className="bg-[#181818] border border-[#3c3c3c] rounded px-2 py-1 text-xs font-mono text-[#9cdcfe] focus:outline-none"
              >
                {movableModels.map((m) => (
                  <option key={m.id} value={m.name}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <a
            href="https://github.com/gazebosim/gz-sim/tree/main/src/systems"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex items-center gap-1 px-2 py-1 rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] text-[11px] text-[#9cdcfe] transition-colors"
            title="View official gazebosim/gz-sim/tree/main/src/systems repository"
          >
            <span>gz-sim/src/systems</span>
            <ExternalLink className="w-3 h-3" />
          </a>

          {isModal && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Gazebo Systems and Plugins Browser"
              className="p-1 rounded hover:bg-[#3c3c3c] text-[#cccccc] hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Strip */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#202020] border-b border-[#2d2d2d] overflow-x-auto shrink-0">
        {Object.entries(CATEGORY_META).map(([catKey, meta]) => {
          const isActive = selectedCategory === catKey;
          return (
            <button
              key={catKey}
              type="button"
              onClick={() => setSelectedCategory(catKey)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-[#007acc] text-white'
                  : 'bg-[#2a2a2c] text-[#bbbbbb] hover:bg-[#37373d] hover:text-white'
              }`}
            >
              <span className={isActive ? 'text-white' : meta.color}>{meta.icon}</span>
              <span>{meta.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Split Content: Left Plugin List + Right XML Snippet & One-Click Insertion */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
        {/* Left List of Gazebo Systems */}
        <div className="w-full md:w-7/12 border-b md:border-b-0 md:border-r border-[#333333] overflow-y-auto p-2.5 grid grid-cols-1 lg:grid-cols-2 gap-2 content-start">
          {filteredTemplates.map((tpl) => {
            const isSelected = tpl.id === activeTemplate?.id;
            const isJustInserted = insertedFeedbackId === tpl.id;
            const catMeta = CATEGORY_META[tpl.category] || CATEGORY_META.all;

            return (
              <div
                key={tpl.id}
                onClick={() => setSelectedTemplateId(tpl.id)}
                data-testid={`plugin-card-${tpl.id}`}
                className={`flex flex-col justify-between p-2.5 rounded border cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-[#262f3a] border-[#007acc] shadow-sm'
                    : 'bg-[#232325] border-[#333333] hover:border-[#4b5563]'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Cpu className={`w-3.5 h-3.5 shrink-0 ${catMeta.color}`} />
                      <span className="font-semibold text-white text-xs truncate">
                        {tpl.label}
                      </span>
                    </div>
                    <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase rounded bg-[#181818] text-[#9cdcfe] border border-[#383838] shrink-0">
                      {tpl.scope}
                    </span>
                  </div>

                  <div className="text-[11px] font-mono text-[#4ec9b0] truncate">
                    {tpl.filename}
                  </div>

                  <p className="text-[11px] text-[#aaaaaa] line-clamp-2 leading-relaxed">
                    {tpl.summary}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 mt-2 border-t border-[#2f2f32]">
                  <span className="text-[10px] font-mono text-[#888888] truncate">
                    {tpl.ros2MsgType}
                  </span>

                  <button
                    type="button"
                    data-testid={`insert-plugin-${tpl.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTriggerInsert(tpl.id, false);
                    }}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors shrink-0 ${
                      isJustInserted
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#f26522] hover:bg-[#e05615] text-white'
                    }`}
                    title={`One-click insert ${tpl.label} XML snippet into ${activeFilePath}`}
                  >
                    {isJustInserted ? (
                      <>
                        <Check className="w-3 h-3" />
                        <span>Inserted!</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3 h-3" />
                        <span>Insert XML</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Detail & Live XML Snippet Inspector */}
        {activeTemplate && (
          <div className="w-full md:w-5/12 flex flex-col min-h-0 bg-[#181818] overflow-y-auto p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <span>{activeTemplate.label}</span>
                </h4>
                <div className="text-[11px] font-mono text-[#4ec9b0] mt-0.5">
                  {activeTemplate.systemName}
                </div>
              </div>

              {/* Format Switcher: Auto / SDF 1.10 / URDF <gazebo> */}
              <div className="flex items-center bg-[#252526] border border-[#3c3c3c] rounded p-0.5 text-[10.5px]">
                {(['auto', 'sdf', 'urdf'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setSnippetFormat(fmt)}
                    className={`px-2 py-0.5 rounded font-mono uppercase transition-colors ${
                      snippetFormat === fmt
                        ? 'bg-[#007acc] text-white'
                        : 'text-[#999999] hover:text-white'
                    }`}
                  >
                    {fmt === 'auto' ? `Auto (${isUrdfFile ? 'URDF' : 'SDF'})` : fmt}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-[#bbbbbb] leading-relaxed">
              {activeTemplate.summary}
            </p>

            {/* ROS 2 Bridge & gz.msgs Mapping Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-[#222225] p-2 rounded border border-[#333333] text-[11px] font-mono">
              <div>
                <span className="text-[#888888] block text-[10px]">Default Topic:</span>
                <span className="text-[#9cdcfe] break-all">
                  {activeTemplate.defaultTopic.replace(
                    /\{model\}|ros2_urdf_rover|husky_rover_4wd/g,
                    effectiveModelName
                  )}
                </span>
              </div>
              <div>
                <span className="text-[#888888] block text-[10px]">
                  gz.msgs &harr; ROS 2 Type:
                </span>
                <span className="text-[#ce9178] break-all">
                  {activeTemplate.gzMsgType} &rarr; {activeTemplate.ros2MsgType}
                </span>
              </div>
            </div>

            {/* Generated XML Snippet Preview */}
            <div className="flex-1 flex flex-col min-h-[120px]">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-[#cccccc] flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-[#f26522]" />
                  <span>
                    {effectiveIsUrdf
                      ? 'ROS 2 URDF <gazebo> Extension Snippet'
                      : 'SDF 1.10 <plugin> / <sensor> XML Snippet'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleCopySnippet(xmlSnippet, activeTemplate.id)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#2d2d2d] hover:bg-[#3c3c3c] text-[11px] text-[#cccccc]"
                >
                  {copiedId === activeTemplate.id ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Copy XML</span>
                    </>
                  )}
                </button>
              </div>

              <pre
                data-testid="plugin-xml-preview"
                className="flex-1 p-2.5 rounded bg-[#121212] border border-[#2d2d2d] font-mono text-[11px] text-[#dcdcaa] overflow-auto whitespace-pre leading-relaxed select-text"
              >
                {xmlSnippet}
              </pre>
            </div>

            {/* One-Click Insertion Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-1 shrink-0">
              <button
                type="button"
                data-testid="insert-selected-plugin-btn"
                onClick={() => handleTriggerInsert(activeTemplate.id, false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-[#333333] hover:bg-[#444444] text-white border border-[#555555] transition-colors"
              >
                <Plus className="w-3.5 h-3.5 text-[#4ec9b0]" />
                <span>Insert into {activeFilePath.split('/').pop()}</span>
              </button>

              <button
                type="button"
                data-testid="insert-and-run-plugin-btn"
                onClick={() => handleTriggerInsert(activeTemplate.id, true)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded text-xs font-semibold bg-[#f26522] hover:bg-[#e05615] text-white transition-colors shadow"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Insert XML &amp; Run Simulation</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
