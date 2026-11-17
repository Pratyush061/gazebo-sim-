import { ParsedWorld, VirtualFile } from '../types/simulation';
import { compileSdfOrUrdf } from './sdfCompiler';

export interface TerminalCommandContext {
  cwd: string;
  files: VirtualFile[];
  activeWorld: ParsedWorld | null;
  isSimRunning: boolean;
  simTime: number;
}

export interface TerminalCommandResult {
  output: string;
  isError?: boolean;
  clearScreen?: boolean;
  newCwd?: string;
  updatedFiles?: VirtualFile[];
  selectFileId?: string;
  loadAndCompileFile?: VirtualFile;
  startSimulation?: boolean;
  pauseSimulation?: boolean;
  resetSimulation?: boolean;
  cmdVelUpdate?: {
    modelName: string;
    linearX: number;
    linearY: number;
    angularZ: number;
  };
  jointUpdate?: {
    modelName: string;
    jointName: string;
    targetPosition: number;
  };
  windUpdate?: [number, number, number];
}

/**
 * Resolves a relative path from the Ubuntu terminal current working directory (`/home/ubuntu/workspace/...`)
 * into a VirtualFile path (`worlds/empty.sdf`).
 */
function resolveWorkspacePath(cwd: string, rawTarget: string): string {
  const baseRel = cwd.replace(/^\/home\/ubuntu\/workspace\/?/, '');
  const cleanTarget = rawTarget.replace(/^\/home\/ubuntu\/workspace\/?/, '').replace(/^\.\//, '');
  if (!baseRel || cleanTarget.includes('/')) {
    return cleanTarget.replace(/^\/+/, '');
  }
  return `${baseRel}/${cleanTarget}`.replace(/^\/+/, '');
}

/**
 * Executes an Ubuntu 24.04 LTS Bash or Gazebo Harmonic (`gz`) command.
 */
export function executeUbuntuCommand(
  rawInput: string,
  ctx: TerminalCommandContext
): TerminalCommandResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { output: '' };
  }

  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  const cmd = tokens[0];
  const args = tokens.slice(1).map((a) => a.replace(/^['"]|['"]$/g, ''));

  switch (cmd) {
    case 'clear':
      return { output: '', clearScreen: true };

    case 'help':
      return {
        output: [
          'Ubuntu 24.04.1 LTS (Noble Numbat) - Gazebo Harmonic CLI Environment',
          '──────────────────────────────────────────────────────────────────────────────',
          'Gazebo Harmonic (gz-sim8) Commands:',
          '  gz sim <file.sdf> [-r]       Compile and launch SDF/URDF world (-r to run immediately)',
          '  gz sdf -k <file.sdf>         Run strict SDF 1.10 / URDF schema & inertia check',
          '  gz sdf -p <file.urdf>        Convert URDF to formatted SDF 1.10 and print XML',
          '  gz topic -l                  List all active Gazebo transport topics',
          '  gz topic -i -t <topic>       Inspect publishers and message type for a topic',
          '  gz topic -t <topic> -m gz.msgs.Twist -p "linear: {x: 1.0}, angular: {z: 0.5}"',
          '                               Publish live velocity command to a robot model',
          '  gz model --list              List all spawned models, entities, and poses',
          '  gz model -m <name>           Inspect links, joints, and inertia of a specific model',
          '  gz wind <vx> <vy> <vz>       Update world aerodynamic wind velocity vector (m/s)',
          '',
          'Ubuntu 24.04 File & System Commands:',
          '  ls [-la] [dir]               List directory contents in virtual workspace',
          '  cd <dir>                     Change current working directory',
          '  pwd                          Print working directory',
          '  cat <file>                   Display file contents',
          '  touch <file.sdf>             Create a new SDF file from template',
          '  mkdir <folder>               Create a virtual directory',
          '  cp <src> <dest>              Copy a file in the workspace',
          '  mv <src> <dest>              Rename or move a file in the workspace',
          '  rm <file>                    Remove a file from the workspace',
          '  grep <pattern> [file]        Search for text or XML tags across files',
          '  uname -a / lsb_release -a    Display Ubuntu 24.04 kernel & distribution info',
          '  top / ps                     Show active Gazebo physics server & GUI processes',
          '  clear                        Clear terminal output',
        ].join('\n'),
      };

    case 'pwd':
      return { output: ctx.cwd };

    case 'whoami':
      return { output: 'ubuntu' };

    case 'uname':
      return {
        output:
          'Linux gz-harmonic-studio 6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC x86_64 GNU/Linux',
      };

    case 'lsb_release':
      return {
        output: [
          'No LSB modules are available.',
          'Distributor ID:\tUbuntu',
          'Description:\tUbuntu 24.04.1 LTS',
          'Release:\t24.04',
          'Codename:\tnoble',
        ].join('\n'),
      };

    case 'top':
    case 'ps': {
      const rtf = ctx.isSimRunning ? '100.0%' : '0.0%';
      const modelCount = ctx.activeWorld?.models.length || 0;
      return {
        output: [
          `top - ${new Date().toTimeString().slice(0, 8)} up 4:12,  1 user,  load average: 0.34, 0.28, 0.21`,
          'Tasks:  14 total,   2 running,  12 sleeping,   0 stopped,   0 zombie',
          '%Cpu(s): 14.2 us,  2.1 sy,  0.0 ni, 83.4 id,  0.3 wa,  0.0 hi,  0.0 si',
          'MiB Mem :   8192.0 total,   5412.4 free,   1640.2 used,   1139.4 buff/cache',
          '',
          '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND',
          `   1042 ubuntu    20   0 1420840 248120  94200 R  ${ctx.isSimRunning ? '24.5' : ' 1.2'}   3.0   1:14.22 gz-sim-server (models=${modelCount}, RTF=${rtf})`,
          '   1048 ubuntu    20   0  984120 182400  78100 S   8.4   2.2   0:42.19 gz-sim-gui',
          '   1081 ubuntu    20   0  312400  44200  28400 S   0.5   0.5   0:04.11 gz-transport-router',
          '   1102 ubuntu    20   0   14280   5420   3600 S   0.0   0.1   0:00.08 bash',
        ].join('\n'),
      };
    }

    case 'ls': {
      const showLong = args.some((a) => a.startsWith('-'));
      const targetArg = args.find((a) => !a.startsWith('-'));
      const relDir = targetArg
        ? resolveWorkspacePath(ctx.cwd, targetArg)
        : ctx.cwd.replace(/^\/home\/ubuntu\/workspace\/?/, '');

      if (!relDir) {
        // Root workspace: show folders and any top-level files
        const folders = Array.from(new Set(ctx.files.map((f) => f.folder)));
        if (!showLong) {
          return { output: folders.map((f) => `${f}/`).join('  ') };
        }
        const lines = [
          'total ' + (folders.length * 4),
          'drwxr-xr-x 5 ubuntu ubuntu 4096 Nov 14 09:44 .',
          'drwxr-xr-x 3 ubuntu ubuntu 4096 Nov 14 09:00 ..',
          ...folders.map(
            (f) => `drwxr-xr-x 2 ubuntu ubuntu 4096 Nov 14 09:44 ${f}/`
          ),
        ];
        return { output: lines.join('\n') };
      }

      const matching = ctx.files.filter(
        (f) => f.folder === relDir || f.path === relDir
      );
      if (matching.length === 0) {
        return {
          output: `ls: cannot access '${targetArg || relDir}': No such file or directory`,
          isError: true,
        };
      }
      if (!showLong) {
        return { output: matching.map((f) => f.name).join('  ') };
      }
      const lines = [
        `total ${matching.length * 4}`,
        ...matching.map(
          (f) =>
            `-rw-r--r-- 1 ubuntu ubuntu ${String(f.content.length).padStart(5, ' ')} Nov 14 09:44 ${f.name}`
        ),
      ];
      return { output: lines.join('\n') };
    }

    case 'cd': {
      const target = args[0] || '';
      if (!target || target === '~' || target === '/home/ubuntu/workspace') {
        return { output: '', newCwd: '/home/ubuntu/workspace' };
      }
      if (target === '..') {
        return { output: '', newCwd: '/home/ubuntu/workspace' };
      }
      const cleanFolder = target.replace(/^\/+|\/+$/g, '');
      const folderExists = ctx.files.some((f) => f.folder === cleanFolder);
      if (folderExists || ['worlds', 'models', 'urdf'].includes(cleanFolder)) {
        return {
          output: '',
          newCwd: `/home/ubuntu/workspace/${cleanFolder}`,
        };
      }
      return {
        output: `bash: cd: ${target}: No such file or directory`,
        isError: true,
      };
    }

    case 'cat': {
      const target = args[0];
      if (!target) {
        return { output: 'cat: missing file operand', isError: true };
      }
      const resolved = resolveWorkspacePath(ctx.cwd, target);
      const found = ctx.files.find(
        (f) => f.path === resolved || f.name === target
      );
      if (!found) {
        return {
          output: `cat: ${target}: No such file or directory`,
          isError: true,
        };
      }
      return { output: found.content };
    }

    case 'touch': {
      const target = args[0];
      if (!target) {
        return { output: 'touch: missing file operand', isError: true };
      }
      const resolved = resolveWorkspacePath(ctx.cwd, target);
      const existing = ctx.files.find((f) => f.path === resolved);
      if (existing) {
        return { output: '', selectFileId: existing.id };
      }
      const parts = resolved.split('/');
      const name = parts[parts.length - 1];
      const folder = parts.length > 1 ? parts[0] : 'worlds';
      const newFile: VirtualFile = {
        id: `file-${Date.now()}`,
        name,
        path: `${folder}/${name}`,
        folder,
        lastModified: Date.now(),
        content: `<?xml version="1.0" ?>
<sdf version="1.10">
  <world name="default">
    <gravity>0 0 -9.81</gravity>
    <light type="directional" name="sun">
      <pose>0 0 10 0 0 0</pose>
      <diffuse>0.8 0.8 0.8 1</diffuse>
      <direction>-0.5 0.1 -0.9</direction>
    </light>
    <model name="ground_plane">
      <static>true</static>
      <link name="link">
        <collision name="collision">
          <geometry><plane><size>100 100</size></plane></geometry>
        </collision>
        <visual name="visual">
          <geometry><plane><size>100 100</size></plane></geometry>
        </visual>
      </link>
    </model>
  </world>
</sdf>`,
      };
      return {
        output: `Created ${newFile.path}`,
        updatedFiles: [...ctx.files, newFile],
        selectFileId: newFile.id,
      };
    }

    case 'mkdir': {
      const folderName = (args[0] || '').replace(/^\/+|\/+$/g, '');
      if (!folderName) {
        return { output: 'mkdir: missing operand', isError: true };
      }
      return {
        output: `Directory '${folderName}/' ready in workspace.`,
        newCwd: `/home/ubuntu/workspace/${folderName}`,
      };
    }

    case 'rm': {
      const target = args.find((a) => !a.startsWith('-'));
      if (!target) {
        return { output: 'rm: missing operand', isError: true };
      }
      const resolved = resolveWorkspacePath(ctx.cwd, target);
      const found = ctx.files.find(
        (f) => f.path === resolved || f.name === target
      );
      if (!found) {
        return {
          output: `rm: cannot remove '${target}': No such file or directory`,
          isError: true,
        };
      }
      if (ctx.files.length <= 1) {
        return {
          output: 'rm: cannot delete the last remaining file in workspace.',
          isError: true,
        };
      }
      return {
        output: `Removed '${found.path}'`,
        updatedFiles: ctx.files.filter((f) => f.id !== found.id),
      };
    }

    case 'mv': {
      if (args.length < 2) {
        return {
          output: 'mv: missing destination file operand',
          isError: true,
        };
      }
      const srcResolved = resolveWorkspacePath(ctx.cwd, args[0]);
      const found = ctx.files.find(
        (f) => f.path === srcResolved || f.name === args[0]
      );
      if (!found) {
        return {
          output: `mv: cannot stat '${args[0]}': No such file or directory`,
          isError: true,
        };
      }
      const destResolved = resolveWorkspacePath(ctx.cwd, args[1]);
      const parts = destResolved.split('/');
      const newName = parts[parts.length - 1];
      const newFolder = parts.length > 1 ? parts[0] : found.folder;
      const updated = ctx.files.map((f) =>
        f.id === found.id
          ? {
              ...f,
              name: newName,
              folder: newFolder,
              path: `${newFolder}/${newName}`,
              lastModified: Date.now(),
            }
          : f
      );
      return {
        output: `Renamed '${found.path}' -> '${newFolder}/${newName}'`,
        updatedFiles: updated,
      };
    }

    case 'cp': {
      if (args.length < 2) {
        return {
          output: 'cp: missing destination file operand',
          isError: true,
        };
      }
      const srcResolved = resolveWorkspacePath(ctx.cwd, args[0]);
      const found = ctx.files.find(
        (f) => f.path === srcResolved || f.name === args[0]
      );
      if (!found) {
        return {
          output: `cp: cannot stat '${args[0]}': No such file or directory`,
          isError: true,
        };
      }
      const destResolved = resolveWorkspacePath(ctx.cwd, args[1]);
      const parts = destResolved.split('/');
      const newName = parts[parts.length - 1];
      const newFolder = parts.length > 1 ? parts[0] : found.folder;
      const copyFile: VirtualFile = {
        ...found,
        id: `file-${Date.now()}`,
        name: newName,
        folder: newFolder,
        path: `${newFolder}/${newName}`,
        lastModified: Date.now(),
      };
      return {
        output: `Copied '${found.path}' -> '${copyFile.path}'`,
        updatedFiles: [...ctx.files, copyFile],
        selectFileId: copyFile.id,
      };
    }

    case 'grep': {
      const pattern = args[0];
      if (!pattern) {
        return { output: 'Usage: grep <pattern> [file]', isError: true };
      }
      const fileArg = args[1];
      const targetFiles = fileArg
        ? ctx.files.filter(
            (f) =>
              f.path === resolveWorkspacePath(ctx.cwd, fileArg) ||
              f.name === fileArg
          )
        : ctx.files;

      const results: string[] = [];
      for (const f of targetFiles) {
        const lines = f.content.split('\n');
        lines.forEach((lineText, idx) => {
          if (lineText.toLowerCase().includes(pattern.toLowerCase())) {
            results.push(`${f.path}:${idx + 1}: ${lineText.trim()}`);
          }
        });
      }
      return {
        output:
          results.length > 0
            ? results.slice(0, 25).join('\n')
            : `(no matches found for "${pattern}")`,
      };
    }

    case 'echo':
      return { output: args.join(' ') };

    case 'gz':
    case 'ign': {
      const sub = args[0];
      if (!sub || sub === '--help' || sub === '-h') {
        return {
          output: [
            'Gazebo Harmonic CLI (gz-sim8 8.6.0)',
            'Available subcommands:',
            '  gz sim [options] [file.sdf]   Launch or control simulation',
            '  gz sdf -k <file.sdf>          Check & validate SDF/URDF syntax and inertia math',
            '  gz sdf -p <file>              Print converted SDF 1.10 representation',
            '  gz topic -l | -t <topic> ...  Inspect or publish to Gazebo transport topics',
            '  gz model --list | -m <name>   Inspect live models, links, and joints',
            '  gz wind <vx> <vy> <vz>        Set world wind velocity vector (m/s)',
          ].join('\n'),
        };
      }

      if (sub === 'sdf') {
        const flag = args[1];
        const fileTarget = args[2] || args[1];
        if (!fileTarget || fileTarget.startsWith('-')) {
          return {
            output: 'Usage: gz sdf -k <file.sdf>  OR  gz sdf -p <file.urdf>',
            isError: true,
          };
        }
        const resolved = resolveWorkspacePath(ctx.cwd, fileTarget);
        const file = ctx.files.find(
          (f) => f.path === resolved || f.name === fileTarget
        );
        if (!file) {
          return {
            output: `Error: File [${fileTarget}] not found in workspace.`,
            isError: true,
          };
        }

        const res = compileSdfOrUrdf(file.content, file.path);
        if (flag === '-p') {
          return {
            output: res.convertedSdfXml || file.content,
          };
        }

        const errCount = res.diagnostics.filter((d) => d.severity === 'error').length;
        const warnCount = res.diagnostics.filter((d) => d.severity === 'warning').length;
        const diagLines = res.diagnostics.map(
          (d) =>
            `  [${d.severity.toUpperCase()}] Line ${d.line}:${d.column} (${d.code}): ${d.message}`
        );

        if (res.isValid) {
          return {
            output: [
              `[gz-sdf] Checking '${file.path}' (Format: ${res.format.toUpperCase()} -> SDF 1.10)...`,
              `[gz-sdf] Check complete in ${res.compileTimeMs}ms: VALID (${errCount} errors, ${warnCount} warnings).`,
              `  World: "${res.world?.name}" | Models: ${res.world?.models.length} | Lights: ${res.world?.lights.length}`,
              ...diagLines,
            ].join('\n'),
          };
        } else {
          return {
            output: [
              `[gz-sdf] Checking '${file.path}'...`,
              `[gz-sdf] Validation FAILED (${errCount} errors, ${warnCount} warnings):`,
              ...diagLines,
            ].join('\n'),
            isError: true,
          };
        }
      }

      if (sub === 'sim') {
        const autoRun = args.includes('-r');
        const fileArg = args.find((a, idx) => idx > 0 && !a.startsWith('-'));
        if (!fileArg) {
          return {
            output: `[gz-sim] Starting simulation clock on active world "${ctx.activeWorld?.name || 'default'}"...`,
            startSimulation: true,
          };
        }
        const resolved = resolveWorkspacePath(ctx.cwd, fileArg);
        const file = ctx.files.find(
          (f) => f.path === resolved || f.name === fileArg
        );
        if (!file) {
          return {
            output: `[gz-sim] Error: Unable to find world file [${fileArg}]`,
            isError: true,
          };
        }
        const res = compileSdfOrUrdf(file.content, file.path);
        if (!res.isValid) {
          const errs = res.diagnostics
            .filter((d) => d.severity === 'error')
            .map((d) => `  [Err] [Line ${d.line}] ${d.message}`)
            .join('\n');
          return {
            output: `[gz-sim] Failed to load '${file.path}' due to SDF compilation errors:\n${errs}`,
            isError: true,
            loadAndCompileFile: file,
          };
        }
        return {
          output: [
            `[Msg] Gazebo Sim Server v8.6.0-harmonic`,
            `[Msg] Loading SDF world file [/usr/share/gz/gz-sim8/${file.path}]`,
            `[Msg] Serving world [${res.world?.name}] with ${res.world?.models.length} models and ${res.world?.lights.length} lights.`,
            autoRun
              ? '[Msg] Physics stepper RUNNING (-r flag active).'
              : '[Msg] World loaded. Press Play or run `gz sim -r` to step physics.',
          ].join('\n'),
          loadAndCompileFile: file,
          startSimulation: autoRun,
        };
      }

      if (sub === 'topic') {
        const worldName = ctx.activeWorld?.name || 'default';
        if (args.includes('-l') || args.includes('--list')) {
          const modelTopics: string[] = [];
          for (const m of ctx.activeWorld?.models || []) {
            if (!m.isStatic) {
              modelTopics.push(`/model/${m.name}/cmd_vel`);
              modelTopics.push(`/model/${m.name}/pose`);
              for (const j of m.joints) {
                modelTopics.push(`/model/${m.name}/joint/${j.name}/cmd_pos`);
              }
            }
          }
          return {
            output: [
              `/clock`,
              `/stats`,
              `/world/${worldName}/clock`,
              `/world/${worldName}/dynamic_pose/info`,
              `/world/${worldName}/scene/info`,
              `/world/${worldName}/wind`,
              ...modelTopics,
            ].join('\n'),
          };
        }

        const tIdx = args.indexOf('-t');
        const pIdx = args.indexOf('-p');
        if (tIdx !== -1 && args[tIdx + 1]) {
          const topic = args[tIdx + 1];
          if (args.includes('-i') || args.includes('--info')) {
            return {
              output: `Publishers [Address, Message Type]:\n  tcp://172.17.0.1:41921, gz.msgs.Twist\nSubscribers:\n  gz-sim-physics-system (${topic})`,
            };
          }
          if (pIdx !== -1 && args[pIdx + 1]) {
            const payload = args.slice(pIdx + 1).join(' ');
            const cmdVelMatch = topic.match(/\/model\/([^/]+)\/cmd_vel/);
            if (cmdVelMatch) {
              const modelName = cmdVelMatch[1];
              const lxMatch = payload.match(/linear\s*:\s*\{[^}]*x\s*:\s*([+-]?\d+(?:\.\d+)?)/i);
              const lyMatch = payload.match(/linear\s*:\s*\{[^}]*y\s*:\s*([+-]?\d+(?:\.\d+)?)/i);
              const azMatch = payload.match(/angular\s*:\s*\{[^}]*z\s*:\s*([+-]?\d+(?:\.\d+)?)/i);
              const linearX = lxMatch ? Number(lxMatch[1]) : 0;
              const linearY = lyMatch ? Number(lyMatch[1]) : 0;
              const angularZ = azMatch ? Number(azMatch[1]) : 0;
              return {
                output: `[gz-topic] Published Twist { linear: {x: ${linearX}, y: ${linearY}}, angular: {z: ${angularZ}} } to ${topic}`,
                cmdVelUpdate: { modelName, linearX, linearY, angularZ },
                startSimulation: true,
              };
            }

            const jointMatch = topic.match(/\/model\/([^/]+)\/joint\/([^/]+)\/cmd_pos/);
            if (jointMatch) {
              const modelName = jointMatch[1];
              const jointName = jointMatch[2];
              const numMatch = payload.match(/([+-]?\d+(?:\.\d+)?)/);
              const targetPosition = numMatch ? Number(numMatch[1]) : 0;
              return {
                output: `[gz-topic] Published Double { data: ${targetPosition} } to ${topic}`,
                jointUpdate: { modelName, jointName, targetPosition },
                startSimulation: true,
              };
            }
          }
        }
        return {
          output:
            'Usage: gz topic -l  OR  gz topic -t /model/<name>/cmd_vel -m gz.msgs.Twist -p "linear: {x: 1.0}, angular: {z: 0.5}"',
        };
      }

      if (sub === 'model') {
        if (args.includes('--list') || args.includes('-l') || args.length === 1) {
          const models = ctx.activeWorld?.models || [];
          return {
            output: [
              `Active Models in World [${ctx.activeWorld?.name || 'default'}]:`,
              ...models.map(
                (m) =>
                  `  • [Entity ${m.entityId}] ${m.name} (static=${m.isStatic}, links=${m.links.length}, joints=${m.joints.length}) pose=[${m.pose.map((v) => v.toFixed(2)).join(' ')}]`
              ),
            ].join('\n'),
          };
        }
        const mIdx = args.indexOf('-m');
        if (mIdx !== -1 && args[mIdx + 1]) {
          const mName = args[mIdx + 1];
          const found = ctx.activeWorld?.models.find((m) => m.name === mName);
          if (!found) {
            return {
              output: `Model [${mName}] not found in world.`,
              isError: true,
            };
          }
          return {
            output: [
              `Model: ${found.name} (Entity ${found.entityId})`,
              `  Pose (x y z r p y): ${found.pose.map((v) => v.toFixed(3)).join(' ')}`,
              `  Static: ${found.isStatic} | Wind Enabled: ${found.enableWind}`,
              `  Links (${found.links.length}):`,
              ...found.links.map(
                (l) =>
                  `    - [Entity ${l.entityId}] ${l.name} (mass=${l.inertial.mass}kg, ixx=${l.inertial.inertia.ixx}, iyy=${l.inertial.inertia.iyy}, izz=${l.inertial.inertia.izz})`
              ),
              `  Joints (${found.joints.length}):`,
              ...found.joints.map(
                (j) =>
                  `    - [Entity ${j.entityId}] ${j.name} (${j.type}: ${j.parent} -> ${j.child}, pos=${j.position.toFixed(2)} rad)`
              ),
            ].join('\n'),
          };
        }
      }

      if (sub === 'plugin') {
        const worldPlugins = ctx.activeWorld?.plugins || [];
        const modelPlugins = (ctx.activeWorld?.models || []).flatMap(
          (m) => m.plugins || []
        );
        const allPlugins = [...worldPlugins, ...modelPlugins];
        return {
          output: [
            'Gazebo Harmonic System Plugins (https://github.com/gazebosim/gz-sim/tree/main/src/systems):',
            ...allPlugins.map(
              (p) =>
                `  • [${p.scope.toUpperCase()}: ${p.targetName || 'default'}] ${p.name} (${p.filename})`
            ),
          ].join('\n'),
        };
      }

      if (sub === 'wind') {
        const vx = Number(args[1] ?? 0);
        const vy = Number(args[2] ?? 0);
        const vz = Number(args[3] ?? 0);
        if ([vx, vy, vz].some((n) => Number.isNaN(n))) {
          return { output: 'Usage: gz wind <vx> <vy> <vz>', isError: true };
        }
        return {
          output: `[gz-wind] Updated world wind linear_velocity to [${vx.toFixed(2)}, ${vy.toFixed(2)}, ${vz.toFixed(2)}] m/s`,
          windUpdate: [vx, vy, vz],
        };
      }

      return {
        output: `gz: unknown subcommand '${sub}'. Type 'help' or 'gz --help' for usage.`,
        isError: true,
      };
    }

    case 'ros2': {
      const topics = ctx.activeWorld?.topics || [];
      if (args.includes('ros_gz_bridge') || args.includes('parameter_bridge')) {
        return {
          output: [
            '[INFO] [ros_gz_bridge]: Creating GZ <-> ROS 2 parameter_bridge node...',
            ...topics.map(
              (t) =>
                `[INFO] [ros_gz_bridge]: Bridging [${t.gzTopic}] (${t.gzMsgType}) <-> [${t.rosTopic}] (${t.rosMsgType}) [${t.direction}]`
            ),
          ].join('\n'),
        };
      }
      return {
        output: [
          'ROS 2 Jazzy Jalisco CLI Bridge Helper:',
          '  ros2 run ros_gz_bridge parameter_bridge --ros-args -p config_file:=ros_gz_bridge.yaml',
          `  Active bridgeable Gazebo topics: ${topics.length}`,
        ].join('\n'),
      };
    }

    default:
      return {
        output: `${cmd}: command not found (Ubuntu 24.04 LTS container). Type 'help' for supported Gazebo & bash commands.`,
        isError: true,
      };
  }
}
